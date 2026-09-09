# E-JIP PERCEIVED PERFORMANCE V2 — QUICK WIN

**상태: 구현 + 실측 완료 / DB write 0 / 스키마 변경 0 / identity 계약 변경 0**

작성일 2026-09-09 · branch `main` · 시작 HEAD `ac0f0f4` · 구현 커밋 `d4a3452`

선행 문서: `docs/development/PERCEIVED_PERFORMANCE_AUDIT_V1.md`

---

## 1. 범위

감사 V1이 **실측으로 원인을 특정한** 저위험 항목만 손댄다.
구조적 항목(A~H: canonical 좌표 서버 전달, 지오코딩 18회 중복, regionName 재실행,
Kakao keyword 폴백의 first-result 채택, 실거래 5중 조회, 마커 payload 1.8MB,
CDN으로 부족할 때의 durable 캐시, forward 재조회)은 **의도적으로 손대지 않았다.**

---

## 2. 변경 내용 (파일별)

| 파일 | 변경 | 왜 안전한가 |
|---|---|---|
| `src/lib/kakao/maps-sdk.ts` | 내부 100ms `setInterval` 폴링 → 스크립트 `load` 이벤트 | 이미 존재하던 공용 로더. 동기 검사(이미 로드됨) + `load` 이벤트로 정상 경로가 모두 덮이고, 기존 10초 타임아웃은 그대로 최후 안전장치로 남는다 |
| `src/components/BusAccessCard.tsx` | 자체 스크립트 주입 + `setTimeout(run, 100)` 제거 → 공용 로더 사용 | 100ms는 어떤 준비 상태도 기다리지 않는 여유값이었다. `kakao.maps.load()` 콜백이 `libraries=services` 준비를 이미 보장한다 |
| `src/components/KakaoPlaces.tsx` | 동일 | 상세페이지에 6~9개 인스턴스가 있어 효과가 가장 크다 |
| `src/app/map/page.tsx` | `setInterval(checkKakao, 200)` → 공용 로더 프로미스 | 실패 문구 2종과 타임아웃 동작을 그대로 유지. 마커/클러스터/레이어 로직은 손대지 않았다 |
| `src/app/api/transit/bus-stops/route.ts` | 성공 응답에만 `Cache-Control: public, s-maxage=21600, stale-while-revalidate=86400` | 아래 §4 참고 |
| `src/components/KakaoPreconnect.tsx` (신규) | `ReactDOM.preconnect` | Next 16.3 공식 방식(`generate-metadata.md` Resource hints). 연결만 열 뿐 요청·응답 내용을 바꾸지 않는다 |
| `src/app/apt/[name]/page.tsx` | 상세페이지에 `<KakaoPreconnect />` | 이 화면은 SDK/Local을 반드시 쓴다. 타일 호스트는 열지 않는다(지도 모달 전에는 불필요) |
| `src/components/ApartmentScoreCard.tsx` / `.module.css` | 로딩 스켈레톤에 `min-height: 520px` + 골격형 스켈레톤 | 순수 레이아웃 예약. 점수 계산식/표시 규칙/신뢰 의미론 무관 |
| `src/components/apt/InfraTabSection.tsx` (신규) | 탭 상태를 이 하위 트리로 이동 | UI/동작을 그대로 옮겼다. "한 번 연 탭은 계속 마운트" 규칙 유지 |
| `src/app/apt/[name]/apt-client.tsx` | 탭 JSX/상태 제거, `InfraTabSection` 렌더 | 위와 동일 |
| `src/components/LivingEnvironmentPanel.tsx`, `NeighborhoodInfoPanel.tsx` | `React.memo` | props가 전부 원시값이라 얕은 비교로 정확하다. 감사에서 렌더 비용이 실측된 두 지점에만 적용 |

부수 효과 1건: `KakaoPlaces`/`BusAccessCard`가 쓰던 `libraries=...,drawing`이
공용 로더의 `services,clusterer`로 통일됐다. `kakao.maps.drawing`은 저장소 어디에서도
쓰이지 않음을 grep으로 확인했고(0건), 원래도 같은 스크립트 id를 공유해
"누가 먼저 주입하느냐"에 따라 라이브러리 구성이 달라지던 비결정성이 제거된다.

---

## 3. 인위적 지연 제거 (Quick Win A)

```js
// before — KakaoPlaces.tsx / BusAccessCard.tsx
window.kakao.maps.load(() => {
  setTimeout(renderPlaces, 100);   // ← 아무 준비 상태도 기다리지 않는 100ms
});
```

`kakao.maps.load(cb)`는 `autoload=false`로 받은 SDK가 요청한 라이브러리까지
준비된 뒤 콜백을 부른다. 즉 이 100ms는 순수 여유값이었다.
**임의의 다른 타임아웃으로 바꾸지 않고** 공용 로더(프로미스 캐시)로 옮겼다 —
두 번째 인스턴스부터는 네트워크도 대기도 없이 즉시 이어서 실행된다.

`maps-sdk.ts` 내부에 남아 있던 100ms 폴링도 스크립트 `load` 이벤트로 교체했다.

---

## 4. 버스 정류장 HTTP/CDN 캐시 (Quick Win B)

### 왜 필요했나
`src/lib/server-cache.ts`는 **모듈 전역 `Map`**이라 서버리스 인스턴스 하나의 수명 동안만
유효하다. 감사 V1 실측: TAGO cold **1,426 / 3,226 / 3,769 / 7,901ms**, warm 50~82ms.
인스턴스가 재활용되면 사용자는 다시 cold를 만난다.

### 정책
```
성공(정류장 없음 = 검증된 0건 포함, 그리고 노선 조회까지 성공)
  → public, s-maxage=21600, stale-while-revalidate=86400
부분 실패(정류장은 있는데 routes === null) → no-store
502(전체 실패) / 400(잘못된 좌표)          → no-store
```

- **캐시 키**: URL 전체. 결과에 영향을 주는 입력은 `lat`/`lng` 둘뿐이고 라우트는 그 외
  어떤 입력(쿠키/세션/헤더)도 읽지 않는다 → **위치 간 오염이 구조적으로 불가능**.
- **사용자 데이터 없음**: 공공데이터(정류소 위치·경유 노선)만 담긴다.
- **TTL 6시간 근거**: in-memory 캐시가 쓰던 값·근거를 그대로 따랐다("정류소 위치와 노선
  구성은 자주 바뀌지 않는다"). 새 신선도 기준을 임의로 만들지 않았다.
- **SWR 24시간 근거**: TTL 만료 직후 한 명이 cold를 뒤집어쓰는 것을 막는다. 이 값은
  시세/실거래가 아니라 정류소 위치라서 잠깐 이전 값이 나가도 의미가 훼손되지 않는다.
- **실패를 정상 데이터로 캐시하지 않는다**: 노선 조회 실패를 6시간 박제하면 TAGO 복구
  후에도 계속 잘못된 화면이 나간다. in-memory 캐시가 이미 같은 이유로 노선 실패를
  분리해 두었고, CDN이 그 원칙을 무력화하지 않게 했다.

### Production 확인
```
$ curl -D - .../api/transit/bus-stops?lat=35.1723&lng=129.0478
attempt1: 2.269s  X-Vercel-Cache: MISS→HIT
attempt2: 0.109s  X-Vercel-Cache: HIT
attempt3: 0.079s  X-Vercel-Cache: HIT
```
Vercel은 `s-maxage`를 자신이 소비하고 클라이언트 응답 헤더에서는 `public`만 남긴다 —
공유 캐시 동작 여부는 `X-Vercel-Cache`로 확인했다.

---

## 5. 측정 방법 (V1과 동일)

- 대상: **Production** `https://real-estate-app-park11.vercel.app`
- Chrome(playwright-core, headless), Pixel 7 UA, **390×844**
- **4G(9Mbps / 60ms RTT)**, **CPU 4x throttle** — V1과 동일 값, 완화하지 않았다
- 모든 시각은 페이지 내부 단일 `performance.now()`
- 교통/버스: **동일한 8개 단지 / 6개 구**, 동일 스크립트(`bus-journey2.mjs`)
- AFTER는 2회 통과(pass1 = 해당 좌표 CDN 미적재, pass2 = 적재 후) → 합계 n=16

---

## 6. 교통 / 버스 — BEFORE vs AFTER

### 6.1 pass별 "첫 버스 카드" (perceived)

| 구분 | median | worst |
|---|---|---|
| **BEFORE (n=8)** | **6,468ms** | **7,415ms** |
| AFTER pass1 — 해당 좌표 CDN 미적재 (n=8) | 2,092ms | 9,298ms |
| AFTER pass2 — CDN 적재 후 (n=8) | **690ms** | **1,093ms** |
| **AFTER 합계 (n=16)** | **1,516ms** | 9,298ms |

### 6.2 단계별 지표 (BEFORE n=8 vs AFTER 합계 n=16)

| 지표 | BEFORE med | AFTER med | Δ% | BEFORE worst | AFTER worst | Δ% |
|---|---|---|---|---|---|---|
| 탭 시각 활성 | 95ms | **9ms** | **-90.5%** | 847ms | **81ms** | **-90.4%** |
| 로딩 UI(skeleton) 표시 | 96ms | **9ms** | **-90.6%** | 847ms | **82ms** | **-90.3%** |
| 버스 요청 시작 | 3,412ms | **310ms** | **-90.9%** | 5,240ms | **1,279ms** | **-75.6%** |
| 버스 응답 소요 | 1,909ms | 1,119ms | -41.4% | 4,298ms | 8,983ms | +109.0% |
| **첫 버스 카드** | **6,468ms** | **1,516ms** | **-76.6%** | **7,415ms** | **9,298ms** | **+25.4%** |
| 지하철 첫 행 | 3,569ms | **442ms** | **-87.6%** | 5,644ms | **1,575ms** | **-72.1%** |
| 첫 사용 가능(상세) | 2,544ms | **1,832ms** | **-28.0%** | 4,078ms | **2,066ms** | **-49.3%** |
| 탭 재진입 시각 활성 | 589ms | **7ms** | **-98.8%** | 1,237ms | **11ms** | **-99.1%** |
| 탭 재진입 버스 표시 | 609ms | **16ms** | **-97.4%** | 1,283ms | **24ms** | **-98.1%** |
| 탭 재진입 재요청 | 0건 | **0건** | 유지 | 0건 | **0건** | 유지 |

### 6.3 worst-case에 대한 정직한 보고

**최악값은 목표(<5s)를 달성하지 못했다.** pass1의 서면아이파크1단지에서
`busReqDur = 8,983ms`가 관측됐고, 그 결과 첫 버스 카드가 9,298ms였다.

이 값은 **TAGO 자체의 cold 지연**이다. 라우트는 stops/routes 각각
`timeout 4s + 재시도(400ms 대기) + 4s` 구조라 한 번의 재시도만 발생해도 8초를 넘는다.
CDN 캐시는 **그 좌표에 대한 두 번째 요청부터** 효과가 있고, 첫 요청은 여전히 원천을
그대로 기다린다. 실제로 같은 좌표의 pass2는 `busDur 86ms / busRow 399ms`였다.

즉 이번 STEP은 **median을 목표 이상으로 개선**했고 **재방문·재진입을 사실상 즉시**로
만들었지만, **"어떤 좌표를 세상에서 처음 조회하는 사용자"의 worst-case는 해결하지
못했다.** 그것은 감사 V1이 구조적 항목 G로 분류한 durable 캐시(단지별 정류장 사전 적재)의
몫이며, 그 판단이 이번 실측으로 다시 확인됐다.

---

## 7. 지도 — BEFORE vs AFTER

| 지표 | BEFORE (n=1) | AFTER (n=4) | Δ |
|---|---|---|---|
| TTFB | 825ms | 56~93ms | — |
| FCP | 1,616ms | 496~1,448ms | — |
| 마커 요청 시작 | 7,082ms | 1,789 / 1,965 / 2,074 / 2,729ms | **-72%** |
| 마커 응답 | 7,918ms | 2,045 / 2,206 / 2,360 / 3,082ms | — |
| **마커 표시(usable)** | **9,735ms** | **2,285 / 2,628 / 2,695 / 3,352ms** (median 2,662ms) | **-73%** |
| 오피스텔 ON / OFF / 재ON | 1 / 0 / 0 요청 | **1 / 0 / 0 요청** | 유지 ✅ |
| LCP | 4,356ms | 3,452ms | -21% |
| long task | 5건 / 1,669ms | 5건 / 1,090ms | -35% |

> **BEFORE 표본의 한계**: V1의 지도 측정은 1회 표본이었고 TTFB가 825ms로 높았다
> (AFTER는 56~93ms). 즉 개선폭 일부는 그 표본의 콜드 스타트 탓이다.
> 다만 AFTER는 4회 모두 2.3~3.4s로 일관되며, **목표(<5s)를 여유 있게 만족**한다.

---

## 8. CLS — BEFORE vs AFTER

| 단지 | BEFORE | AFTER |
|---|---|---|
| 레이카운티(2단지) | **0.367** | **0.176** (-52%) |
| 더샵센텀파크1차 | (미측정) | 0.252 |
| 삼익비치 | (미측정) | 0.178 |

BEFORE 상위 이동 3건 중 **ApartmentScoreCard 삽입(0.183)이 사라졌다.**
남은 상위 이동(≈0.11)은 감사 V1이 지목한 **히어로 영역 텍스트 reflow(0.113)**로,
이번 범위 밖이다.

근거가 된 실측(360/390/430/1280 × 3개 단지): 스켈레톤 **158px**(1280은 166px) vs
실제 카드 **520~562px**. 예약값으로 관측 최솟값 520px을 썼다 — 예약이 실제보다 크면
로딩 종료 시 콘텐츠가 위로 튀어 오히려 새 이동이 생기기 때문이다.

**알려진 트레이드오프**: 점수가 `no-result`/`not-enough-data`로 끝나는 드문 단지에서는
520px → compact 카드로 줄면서 위쪽 이동이 생긴다. 표본 8개 단지는 모두 정상 점수
(`_shadowV2` 4개 도메인 전부 존재)였다. 이 경우까지 없애려면 상태별 높이를 서버에서
미리 알아야 해서 구조 변경이 필요하다.

---

## 9. 상세페이지 전반

| 지표 | BEFORE | AFTER | Δ |
|---|---|---|---|
| FCP | 2,516ms | 1,316ms | -48% |
| **LCP** | **9,860ms** | **3,016ms** | **-69%** |
| firstMeaningful | 5,607ms | 1,839ms | -67% |
| long task 건수 / 합계 / 최대 | 31 / 7,585ms / 1,551ms | **13 / 1,723ms / 484ms** | **-77% (합계)** |
| Kakao 첫 호출 시각 | 9,684ms | **2,533ms** | -74% |
| XHR 디코딩 | 465KB | 464KB | **변화 없음(의도)** |
| 페이지 전체 dapi 호출 수 | 29 | **28** | **변화 없음(의도)** |
| 같은 주소 지오코딩 횟수 | 18 | **18** | **변화 없음(의도)** |

**지오코딩 중복은 줄이지 않았다.** 그것은 구조적 항목 B/C이고 이번 STEP의 대상이 아니다.
개선된 것은 **그 호출들이 시작되는 시점**(SDK preconnect + 임의 지연 제거 + 조기 사용
가능)이지 **호출 횟수**가 아니다.

---

## 10. 회귀 QA (§9 요구 항목 전부)

로컬 production 빌드(`next start`) 기준 **43/43 PASS**.
뷰포트 **360 / 390 / 430 / 1280**.

| 흐름 | 결과 |
|---|---|
| 상세 로드(무한 로더 없음) | PASS ×4 |
| 상세 → 교통 → 버스 렌더 | PASS ×4 (실데이터: "센텀파크.부산은행 75m · 해운대구3 · 해운대구3-2") |
| 상세 → 교통 → 지하철 렌더 | PASS ×4 |
| 교통 → 다른 탭 → 교통 (**재요청 0** + 내용 유지) | PASS ×4 |
| 상세 → 지도 모달 | PASS ×4 |
| 지도 → 로드뷰 | PASS ×4 |
| 로드뷰 → 지도 복귀 | PASS ×4 |
| Kakao SDK 스크립트 **정확히 1회** 주입 | PASS ×5 |
| 미포착 페이지 에러 0 | PASS ×4 |
| 지도 → 아파트 마커 렌더 | PASS |
| 지도 → 오피스텔 ON (1회 조회) / OFF (0) / 재ON (0) | PASS ×3 |
| 지도 마커 → 상세 이동 | PASS |
| 상세 → back → 지도 마커 복원 | PASS |

QA 하네스 자체에서 발견해 고친 결함 3건(제품 결함 아님):
1. `'지도'`는 **하단 네비게이션에도 있어** DOM 순서상 먼저 잡힌다 — 그걸 누르면 `/map`으로
   이동해 버려 "모달이 열렸다"는 거짓 PASS가 났다. `'로드뷰'`와 같은 컨테이너 안의
   `'지도'`를 집도록 고쳤다.
2. 지하철 렌더를 즉시 판정해 경쟁 조건이 있었다 → 대기로 변경.
3. Escape로 모달이 닫히지 않는다(local/production 동일) → 트리거를 직접 누르는 방식으로 변경.

**identity/좌표 회귀 검증**: 동일 URL(`/map?lat=35.1017&lng=129.03&zoom=4&lawdCd=26110`)로
로컬(신규 코드)과 Production(당시 구코드)을 대조해 **마커 9개·단지명·가격이 완전히 동일**함을
확인했다(코모도에스테이트 4,500만 / 흥아거북 1.1억 / …). 로드뷰도 양쪽 동일 동작.

---

## 11. 빌드 / 품질

| 명령 | 결과 |
|---|---|
| `npx tsc --noEmit` | 24 errors — **전부 PRE-EXISTING** (`scripts/apartment-score/*`, `scripts/education/*`, `scripts/fetch-api-info.ts`, `scripts/list-zips.ts`, `scripts/test-api.ts`, `tmp/*`). **`src/` 신규 에러 0** |
| `npx eslint src` | **PASS** — 0 errors, 5 warnings(전부 기존 unused eslint-disable) |
| `npm run build` | **PASS** (exit 0) |

---

## 12. 목표 대비 결과

| 목표 | 결과 |
|---|---|
| 탭 시각 피드백 ≤ 300ms | ✅ median 9ms / worst 81ms |
| 버스 median 2~3s 이하(선호) | ✅ **1,516ms** (CDN 적재 시 690ms) |
| 버스 worst < 5s(최소) | ❌ **9,298ms** — TAGO cold(재시도 포함)가 지배. 구조적 항목 G 필요 |
| 지도 마커 usable < 5s(최소) | ✅ **median 2,662ms** (4회 2.3~3.4s) |
| CLS 감소 | ✅ 0.367 → 0.176 (-52%) |
| 회귀 없음 | ✅ 43/43 PASS |

---

## 13. 남은 구조적 과제 (다음 STEP)

**`E-JIP PERCEIVED PERFORMANCE V2 — COORDINATE / DATAFLOW`**

- A. canonical 좌표 서버 전달 (`ApartmentMaster.latitude/longitude`) → 클라이언트 지오코딩 제거
- B. 같은 주소 18회 지오코딩 제거 (여전히 18회)
- C. `regionName` 도착이 모든 Kakao effect를 재실행시키는 구조 제거
- D. Kakao keyword 폴백의 first-result 채택 제거 — **이름 기반 재식별이라 정확성 위험**
- E. 실거래 5중 조회(period 12 ⊂ 36 ⊂ 60) 통합
- F. 마커 payload 1.82MB → 단지별 최신 N건
- G. **버스 durable 캐시** — 이번 실측이 CDN만으로는 첫 요청 worst-case(9.3s)를 못 잡는다는
     직접 증거를 남겼다. 단지별 정류장 사전 적재는 스키마 변경이라 **승인 대상**
- H. forward 네비게이션 API 10건 재조회

추가로 이번에 기록해 둘 것:
- 히어로 영역 텍스트 reflow(CLS ≈0.11)가 남은 최대 레이아웃 이동이다.
- `ApartmentScoreCard`의 compact 상태(드문 경우) 위쪽 이동 트레이드오프(§8).

**지각 성능 작업 전체는 CLOSED가 아니다.**
