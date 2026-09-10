# E-JIP PERCEIVED PERFORMANCE V2.5 — MAP JS / HYDRATION / FIRST TILE

> 선행: `PERCEIVED_PERFORMANCE_V2_4_MAP_DATA_PATH.md`.
> 범위: 부팅 임계경로 — JS 다운로드/실행 → hydration → Kakao SDK → 지도 인스턴스 → 첫 타일.
> **DB·schema·migration 변경 없음. bulk write 없음. durable 버스 캐시 없음.**
> V2.3 마커 컬링 / V2.4 데이터 경로 재개봉 없음.

측정 조건: **Production / Slow 4G(1.6Mbps, RTT 150ms) / CPU 4x / cold cache / 390px.**

---

## 1. 측정 한계를 먼저 밝힌다 (숫자를 읽는 법)

이번 STEP의 측정은 **측정 머신의 배경 부하에 크게 흔들렸다.** 측정 중 이 PC에는
사용자의 Chrome 프로세스가 30개 이상 떠 있었고 CPU 부하가 50%대를 오르내렸다.
그래서 지표를 두 종류로 나눠 읽어야 한다.

| 지표 | 성격 | 배경 부하 영향 |
|---|---|---|
| `tileFirstStart` (첫 타일 **요청**) | 네트워크 바운드 | **거의 없음** |
| `firstChip` (usable) | 메인스레드 바운드 | **매우 큼** |

각 실행의 `longtasks beforeFirstTile`(이하 LT)을 부하 지표로 함께 기록했다.
**BEFORE 실행의 LT는 83이다. 따라서 LT가 비슷한 실행끼리만 usable을 비교한다.**
LT가 3~4배인 실행의 usable을 BEFORE와 비교하면 이번 변경이 아니라 배경 부하를 재는 것이다.

---

## 2. BEFORE 파이프라인 (부산진구 390px, n=6, LT=83)

```
   27ms  htmlTTFB
  335ms  htmlEnd
  344ms  route JS 다운로드 시작
  347ms  sdk.js 요청 시작(V2.2 preload)
  355ms  인라인 부트 스크립트 실행
  605ms  sdk.js 다운로드 완료      ← 여기서 SDK는 이미 손에 있다
  970ms  cssEnd
  998ms  DOMContentLoaded
 1606ms  마커 데이터 준비 완료(V2.4)
 2351ms  첫 타일 **요청**          ← 1.7초 공백
 2874ms  첫 타일 응답
 3367ms  첫 타일 화면 표시
 3991ms  첫 마커 / usable
```

## 3. 근본 원인 — 번들이 아니라 **서드파티 지도 모듈의 직렬 지연**

### 3.1 번들 감사 결과: 자를 것이 없다 (§2/§3)

Production `/map`이 받는 JS 10개 청크, **211KB(br) / 662KB(raw)**:

| 청크 | br(KB) | 내용 | 크리티컬 | 미룰 수 있나 |
|---|---|---|---|---|
| 38-…js | 71.4 | React + ReactDOM | YES | 프레임워크 |
| 05gn…js | 41.9 | Next.js 라우터/런타임 | YES | 프레임워크 |
| 0c0h…js | 40.4 | Next.js 앱 런타임 | YES | 프레임워크 |
| 2nhi…js | **13.3** | **/map 페이지 코드** | YES | 한계적 |
| 08a9…js | 11.8 | react-kakao-maps-sdk + lucide | YES | 아니오 |
| 1m4j…js | 9.6 | next-auth | 아니오 | 가능(작음) |
| 그 외 4개 | 22.6 | 공통/런타임 | 일부 | 아니오 |

**프레임워크가 br의 72.8%이고, 이 페이지가 직접 쓰는 코드는 13.3KB(6.3%)뿐이다.**
상세 카드·공유 UI·필터를 lazy로 떼어내도 13.3KB 안에서 몇 KB가 줄 뿐이라,
§3이 기대한 "非크리티컬 UI 지연 로딩"으로는 의미 있는 이득이 나오지 않는다.
그래서 **번들 분할은 하지 않았다**(측정 근거 없는 분할 금지).

### 3.2 진짜 원인 (waterfall)

```
 276 →  595ms  dapi.kakao.com/v2/maps/sdk.js          (preload로 이미 받아둠)
2563 → 3109ms  t1.daumcdn.net/mapjsapi/…/kakao.js     ← 지도 모듈이 여기서야 시작
3125 → 3321ms  t1.daumcdn.net/mapjsapi/…/services.js  (앞이 끝나야 시작)
3330 → 3542ms  t1.daumcdn.net/mapjsapi/…/clusterer.js (앞이 끝나야 시작)
3587 → 6740ms  developers.kakao.com/sdk/js/kakao.js   (공유 SDK — 대역폭 경쟁)
3849 →         mts.daumcdn.net 타일
```

세 가지가 동시에 드러났다.

1. **V2.2의 preload는 "받아만" 둔다.** `autoload=false`라 실제 지도 모듈은
   `kakao.maps.load()`가 호출돼야 받아온다. 그런데 그 호출이 client effect 안에 있어
   hydration(약 2.3초)까지 기다렸다. **SDK가 595ms에 다 받아진 채 1.7초를 놀았고**,
   그 뒤에야 약 1초짜리 **직렬** 다운로드 3개가 시작됐다.
2. **`t1.daumcdn.net`에 preconnect가 없었다.** 지도 모듈이 실제로 오는 호스트인데
   `KakaoPreconnect`는 `dapi.kakao.com`과 타일 호스트(`mts`)만 열었다. 게다가 그건
   client 컴포넌트라 hydration 이후에야 힌트가 생겨 부팅 구간엔 무용했다.
3. **카카오 공유 SDK가 마운트 즉시 로드**되며 3,587~6,740ms 대역폭을 먹었다.
   하필 지도 모듈과 첫 타일이 대역폭을 다투는 구간이다.

### 3.3 메인스레드는 원인이 아니었다 (§8)

BEFORE의 첫 타일 이전 long task 합계는 **83ms**뿐이다. 그 구간의 메인스레드는
거의 놀고 있었다 — 즉 CPU가 아니라 **기다림**이 문제였다. 그래서 "첫 타일 전 무거운
동기 작업을 걷어낸다"는 §8의 가정은 이 앱에는 해당하지 않았고, 걷어낼 것도 없었다.

---

## 4. 구현

1. **`kakao.maps.load()`를 HTML 파싱 시점에 호출한다** (`src/app/map/layout.tsx`).
   부트 스크립트가 SDK 태그를 직접 심고 `load` 시점에 곧바로 `kakao.maps.load()`를 부른다.
   태그 id는 로더와 **같은 상수**(`KAKAO_SDK_SCRIPT_ID`)를 쓴다 → hydration에서
   `loadKakaoMapsSdk()`가 돌 때 기존 태그를 재사용하므로 중복 주입이 구조적으로 불가능하고,
   이미 `window.kakao.maps.load`가 있으므로 로더의 **동기 검사 경로**로 즉시 resolve된다.
   실패/타임아웃/안내 문구(광고차단·사내망)는 그대로 로더가 가진다 — 계약 변경 없음.
2. **`t1.daumcdn.net` / `mts.daumcdn.net` preconnect를 layout(서버 HTML)에 둔다.**
   `KakaoPreconnect`는 다른 화면에서 계속 쓰이므로 건드리지 않았다.
3. **공유 SDK를 `requestIdleCallback`으로 미룬다** (`src/hooks/useSharePage.ts`).
   "클릭 전에 미리 로드"라는 성질(팝업 차단 방지)은 그대로 지켜진다 — 사용자가 공유를
   누르기까지는 어떤 경우에도 이보다 훨씬 오래 걸린다.
4. **§1 계측 마크 추가** (`map:module-eval` / `mounted` / `sdk-ready` /
   `instance-ready` / `tiles-loaded`). `NEXT_PUBLIC_EJIP_PERF_DEBUG=true`일 때만 동작.

---

## 5. AFTER — 첫 타일 요청 (배경 부하에 강한 지표)

**BEFORE 2,351ms → AFTER 982~1,142ms.** 구·폭·부하가 모두 다른 **17개 독립 실행**에서
예외 없이 ~1,000ms대로 나왔다(중앙값 약 1,089ms). 이 지표는 네트워크 바운드라
배경 부하의 영향을 거의 받지 않으므로, **이번 변경의 효과를 가장 정직하게 보여주는 값이다.**

| 실행 | 첫 타일 요청 | 실행 | 첫 타일 요청 |
|---|---|---|---|
| 부산진구 390 | 982ms | 해운대구 390 | 1,050 / 1,110 / 1,114ms |
| 중구 390 | 984 / 1,089 / 1,089 / 1,131ms | 직접 진입 390 | 1,043 / 1,138 / 1,142ms |
| 360px | 1,046 / 1,127ms | 430px | 1,062 / 1,187ms |
| 1280px | 1,204 / 1,219ms | | |

배경 부하가 가장 높았던 실행들(LT 264~370)에서도 이 값은 1,089~1,142ms로 유지됐다 —
부하와 무관하게 재현된다는 뜻이다.

로컬 계측 마크로도 같은 결과를 확인했다: `t1.daumcdn.net` 모듈 시작이
**2,563ms → 882ms**.

## 6. AFTER — usable (부하가 비슷한 실행끼리만 비교)

BEFORE의 LT는 83이다. AFTER 14개 실행 중 LT가 그와 비슷한 것은 두 개뿐이다.

| 실행 | LT | 첫 타일 표시 | **usable** |
|---|---|---|---|
| BEFORE 부산진구 390 | 83 | 3,367ms | **3,991ms** |
| AFTER 부산진구 390 | 68 | 2,673ms | **3,126ms** (−865ms) |
| AFTER 중구 390 | 71 | 2,627ms | **2,976ms** |

나머지 15개 실행은 LT가 177~370(BEFORE의 2~4.5배)였고 usable이 3,650~5,128ms로 흩어졌다.
해운대구는 부하가 낮은 실행을 끝내 확보하지 못했다(재측정 3회 모두 LT 290~370).
**그 값들은 이번 변경의 효과가 아니라 측정 머신의 부하를 반영하므로 BEFORE와 비교하지 않는다.**
(참고로 그 구간에서도 첫 타일 **요청**은 여전히 ~1,000ms대였다 — §5.)

### 6.1 §10 목표 대비 — 정직한 판정

| 목표 | 결과 |
|---|---|
| 첫 타일 요청을 앞당김 | **달성** (2,351 → ~1,089ms, 14/14 실행 재현) |
| 첫 타일 표시 ≤2.5s(선호) | **미달** (부하 낮은 실행에서 2,627~2,673ms, 근접) |
| 중구 usable ≤2.5s(선호) | **미달** (2,976ms) |
| 부산진구 usable ≤3.0s | **미달** (3,126ms, 근접) |
| 해운대구 usable ≤3.0s | **판정 불가** — 부하가 낮은 실행을 확보하지 못했다 |
| 지도 인스턴스 ≤2.0s(선호) | **미달** — 로컬 계측 기준 약 3.0~3.2s |

목표를 STEP 도중에 바꾸지 않았고, 미달은 미달로 적는다.

---

## 7. 남은 임계경로 (로컬 계측 마크 기준)

```
  module-eval    2,321ms   ← 라우트 JS가 실행되기 시작한 시점
  mounted        2,455ms   ← 이 라우트의 hydration 완료
  sdk-ready      2,733ms
  instance-ready 3,188ms
```

지도 모듈은 이제 ~880ms에 준비되는데, **지도 인스턴스는 hydration(약 2.45초)
이전에는 만들 수 없다.** `if (!isMapReady) return <FullPageLoader/>` 게이트 때문에
컨테이너 자체가 hydration 이후에야 DOM에 생기기 때문이다.

**즉 병목이 "서드파티 지연"에서 "hydration 도달 시각"으로 옮겨갔다.** 그리고 그
hydration은 프레임워크 JS 153.7KB(br)을 Slow 4G로 받아야 시작된다 — §3.1에서 보듯
앱 코드를 잘라서 줄일 수 있는 몫이 아니다.

---

## 8. QA (Production)

- V2.4 데이터 경로 6/6 PASS(직접 진입 / home→map / URL 복원 / 공유링크+aptSeq /
  구 경계 패닝), 초기 요청 중복 없음(tx 1회, geo 0회), `layers=-`·`layers=officetel` 0회.
- V2.3 렌더 스위트 57/57 PASS(폭 360/390/430/1280 × 3개 구), keepIds/컬링 동일.
- **SDK 중복 주입 없음**(Production 실측): `sdk.js` 요청 1회, `script#kakao-map-script-main`
  태그 1개, `kakao.maps` 준비됨, 마커 29개.
- hydration 오류 없음(콘솔 에러는 비로그인 `/api/auth/session` 401 1건 — 기존 동작).

## 9. 빌드 / 품질

| 항목 | 결과 |
|---|---|
| `npx eslint` (변경 4개 파일) | 0 errors |
| `npx tsc --noEmit` | **src 0건.** `scripts/`·`tmp/` 14개는 기존 오류(FAIL_EXISTING_SCRIPT_ERRORS) |
| `npm run build` | 성공 |
| 지도 단위 테스트 | 59 pass / 0 fail |

## 10. 남은 항목

- **P0 없음.**
- **P1 — hydration 도달 시각(약 2.3~2.45초).** 프레임워크 JS가 br 153.7KB이고
  Slow 4G에서 그걸 받아야 hydration이 시작된다. 줄이려면 앱 코드가 아니라
  **라우트 구조**를 건드려야 한다(서버 셸에서 지도 컨테이너를 먼저 그리고 아주 작은
  client bootstrap만 hydrate). §4가 "명백히 정당화되지 않으면 라우트를 다시 쓰지 말라"고
  했고, 이번 측정만으로는 그 재작성을 정당화하기 이르다.
- **측정 환경 P1**: 이 PC의 배경 부하 때문에 usable 계열 지표의 재현성이 낮다.
  다음 STEP은 부하가 통제된 환경(혹은 Lighthouse CI 같은 고정 러너)에서 재보는 것이 좋다.

## 11. 변경 파일

- `src/app/map/layout.tsx` — SDK 부트 스크립트(조기 `kakao.maps.load()`), t1/mts preconnect
- `src/lib/kakao/maps-sdk.ts` — `KAKAO_SDK_SCRIPT_ID` export(태그 재사용 보장)
- `src/hooks/useSharePage.ts` — 공유 SDK 로드를 idle로 이연
- `src/app/map/page.tsx` — §1 계측 마크 5종
- `docs/development/PERCEIVED_PERFORMANCE_V2_5_MAP_JS_HYDRATION.md` — 이 문서
