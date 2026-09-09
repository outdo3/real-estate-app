# E-JIP PERCEIVED PERFORMANCE V2.1 — MAP RESTORE / MARKER CDN / DETAIL REVISIT

> 선행: `PERCEIVED_PERFORMANCE_AUDIT_V1.md`, `PERCEIVED_PERFORMANCE_V2_QUICKWIN.md`,
> `PERCEIVED_PERFORMANCE_V2_DATAFLOW.md`(§8 Production QA에서 이 STEP의 세 항목이 나왔다).
>
> 범위: P1-A 지도 view 복원 / P1-B 마커 CDN 캐시 / P1-C 상세 재방문 `/score`·`/info`.
> **DB·schema·migration 변경 없음. durable 버스 캐시는 구현하지 않는다.**

---

## 1. P1-A — 지도 view 상태 복원

### 1.1 근본 원인

증상은 "지도 → 마커 → 상세 → back 하면 지도가 사용자가 보던 곳이 아니라 기본 지역으로
돌아간다"였다. 실측에서 back 직후 항상 `lawdCd=26140`을 다시 조회했는데, 그건
`map/page.tsx`의 **기본값 그 자체**다:

```ts
const [currentLawdCd, setCurrentLawdCd] = useState(() => readInitialMapStateFromUrl()?.lawdCd ?? '26140');
const [center, setCenter]               = useState(() => readInitialMapStateFromUrl()?.center ?? { lat: 35.0979, lng: 129.0244 });
const [zoomLevel, setZoomLevel]         = useState(() => readInitialMapStateFromUrl()?.zoomLevel ?? 4);
```

**복원 장치가 없어서가 아니었다.** `readInitialMapStateFromUrl` /
`parseMapStateFromSearchParams` / `matchRestoreIdentity`는 이미 있었고 정상 동작한다
(MAP MARKER UX V2 §21~24). 문제는 **아무도 현재 상태를 URL에 쓰지 않았다**는 것이다 —
이 파라미터들은 지금까지 **공유 버튼**으로만 만들어졌다. 그래서 일반적인
지도→상세→back 경로에서는 돌아온 URL의 쿼리가 비어 있고, 위 초기화식이 전부
`?? 기본값`으로 떨어졌다.

`parseMapStateFromSearchParams`는 `lat`/`lng`가 없으면 `null`을 반환하므로(공유 링크
판정 계약), 쿼리가 비면 복원 자체가 시도되지도 않는다.

### 1.2 상태 아키텍처 BEFORE → AFTER

```
BEFORE
  공유 버튼 ──buildMapShareParams──> URL(lat,lng,zoom,lawdCd,aptSeq|dong+name)
                                      │
  /map 최초 마운트 ───readInitialMapStateFromUrl──> 복원 (공유 링크로 들어올 때만)

  사용자가 지도를 움직임 ──> center/zoom/lawdCd/layers state만 바뀜, URL은 그대로 비어 있음
  상세로 이동 후 back  ──> 빈 쿼리 → 초기화식이 기본값(26140/서구/zoom4/apt만 ON)으로 복귀

AFTER
  공유 버튼 ──buildMapShareParams──> URL            (계약 그대로, layers 없음)
  지도 상태 변화 ──buildMapRestoreParams──> history.replaceState로 같은 URL 계약에 반영
        center · zoom · lawdCd · 고정 선택 단지 identity · layers
                                      │
  /map 마운트 ───readInitialMapStateFromUrl──> center/zoom/lawdCd/layers/selected 복원
  상세로 이동 후 back  ──> 그 URL이 그대로 살아 있으므로 사용자가 보던 맥락으로 복귀
```

### 1.3 구현 결정

| 결정 | 이유 |
|---|---|
| **URL search params**를 쓴다(새 상태 저장소 없음) | 복원 로직·identity 규칙이 이미 URL 계약 위에 만들어져 있다. 재사용이 가장 가볍고, 새 저장소는 규칙을 두 벌로 만든다 |
| `replaceState` (pushState 아님) | 패닝할 때마다 history가 쌓이면 사용자가 back을 여러 번 눌러야 지도를 빠져나간다. 실측 `history.length`가 2에서 늘지 않음을 확인했다 |
| 400ms 디바운스 | 드래그/줌 중 매 프레임 URL을 쓰지 않는다 |
| `isMapReady` 이후에만 쓴다 | 공유 링크로 들어온 파라미터를 우리 기본값으로 덮어쓰면 안 된다 |
| 선택 단지는 **고정 선택(`selectedMarkerId`)만** | `activeMarkerId`는 hover를 포함한다 — 마우스가 지나가기만 해도 URL이 바뀌면 안 된다 |
| identity는 `buildMapShareParams` 재사용 | aptSeq 우선 / dong+name 차선 / **name-only 금지**가 이미 강제돼 있다. 새로 쓰지 않는다 |
| `buildMapShareParams`는 **손대지 않음** | 공유 URL 계약 불변. `layers`는 `buildMapRestoreParams`에만 있고, 파라미터가 없는 예전 링크는 기존 기본 레이어로 열린다 |
| `layers=-`는 "전부 꺼짐" | 파라미터 없음(`null`, 기본값 유지)과 명시적 전부 꺼짐을 구분해야 한다 |

`matchRestoreIdentity`는 그대로다 — 복원 대상이 방금 받은 마커 목록에 **정확히** 있을
때만 선택을 복원하고, 없으면 `null`(선택 없음)일 뿐 다른 단지로 대체하지 않는다.
"stale invalid marker selection"이 구조적으로 불가능한 이유다.

### 1.4 검증 (Production, 4G/4x CPU)

지도 진입 → 검색으로 해운대 이동 → 오피스텔 레이어 ON → 마커 클릭 → 상세 → back.

| 폭 | lawdCd | zoom | layers | center(±0.01) | back 후 마커 | history.length |
|---|---|---|---|---|---|---|
| 360 | ✅ 26350 | ✅ | ✅ apt,officetel | ✅ | 2 | 2 |
| 390 | ✅ 26350 | ✅ | ✅ apt,officetel | ✅ | 2 | 2 |
| 430 | ✅ 26350 | ✅ | ✅ apt,officetel | ✅ | 3 | 2 |
| 1280 | ✅ 26350 | ✅ | ✅ apt,officetel | ✅ | 12 | 2 |

back 직후 URL 실측(390):
`/map?lat=35.1788371859734&lng=129.122223170563&zoom=3&lawdCd=26350&aptSeq=26350-2092&layers=apt%2Cofficetel`

- 클릭한 마커(`더샵센텀파크2차`)가 **선택된 상태로** 복원된다(`aptSeq=26350-2092`).
- 직접 `/map` 진입(파라미터 없음)도 정상 — 기본 지도가 뜬 뒤 URL이 동기화된다.
- 새로고침도 정상(그 시점 URL로 같은 화면이 다시 열린다).
- 오피스텔/아파트 독립 토글 동작 그대로(ON/OFF/재ON = 요청 1/0/0, 재ON은 캐시).

---

## 2. P1-B — 마커 응답 CDN 캐시

### 2.1 BEFORE

```
cache-control: public, max-age=0, must-revalidate     ← Next 동적 라우트 기본값
x-vercel-cache: MISS                                  ← 100% MISS
```

payload는 V2에서 이미 슬림해졌지만(해운대구 63,660 B), 같은 구를 보는 모든 사용자가
매번 원본까지 갔다.

### 2.2 AFTER — 정책과 TTL

`/api/transit/bus-stops`(QUICK WIN B)에서 이미 검증된 정책을 그대로 쓴다.

```ts
const MARKER_SUCCESS_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=1800';
const NO_STORE_CACHE_CONTROL = 'no-store';
function cacheHeaders(fullySuccessful: boolean) { ... }
```

| 규칙 | 근거 |
|---|---|
| **완전하게 성공한 응답만** 캐시 (`!completeness.partial`) | 부분 실패를 CDN에 얹으면 일시적 MOLIT 장애가 TTL 동안 "이 구에는 단지가 원래 이만큼밖에 없다"로 굳는다 — FAILED가 ZERO로 접히는 바로 그 경로 |
| 에러 응답은 명시적 `no-store` | 위와 같은 이유 |
| **s-maxage=300** | 원천인 MOLIT 월 캐시가 1시간(`molit-month-cache.ts`), 상세 클라이언트 캐시가 5분이다. 같은 값으로 맞춰 **origin이 같은 순간에 돌려줬을 값보다 더 오래된 값을 만들지 않는다** |
| stale-while-revalidate=1800 | 갱신 중 화면이 비지 않게 한다. 값의 나이는 최대 30분이며, 신규/취소 거래 반영이 그만큼 늦어질 수 있음을 감수한 범위다 |
| 캐시 키 | Vercel CDN이 **전체 URL(쿼리스트링 포함)**로 잡는다 → `lawdCd`·`type`·`months`·`fields`가 자동으로 키에 포함된다. 구/옵션 간 교차 오염이 구조적으로 없다 |
| 사용자별 데이터 | 이 라우트는 인증·쿠키·세션을 일절 읽지 않는다(전수 확인) |

전체 응답(`fields` 없음)에도 같은 정책을 적용했다 — `/stats/[type]`와 AI 조건검색도
같은 조건에서 동일하게 이득을 본다. 취소(dealCanceled) 처리·완전성 의미는 그대로다.

> Vercel은 `s-maxage`/`stale-while-revalidate`를 **자기 CDN용으로 소비**하고 브라우저로는
> `cache-control: public`만 내려준다. 그래서 배포 확인은 헤더 문자열이 아니라
> `x-vercel-cache` 값으로 해야 한다.

### 2.3 MISS → HIT 실측 (Production)

같은 URL 3회 연속 호출(첫 요청은 캐시 버스팅으로 확실히 MISS로 만듦):

| 구 | req1 | req2 | req3 |
|---|---|---|---|
| 중구 26110 | **MISS 333ms** | HIT 79ms | HIT 80ms |
| 부산진구 26230 | **MISS 886ms** | HIT 97ms | HIT 113ms |
| 해운대구 26350 | **MISS 573ms** | HIT 156ms | HIT 95ms |

브라우저(4G/4x CPU) 지도 진입 5회에서도 마커 응답은 `HIT`(1회 `STALE`)였고,
요청→응답 전송 구간은 99~509ms(중앙값 422ms)였다.

---

## 3. P1-C — 상세 재방문 `/score`, `/info`

### 3.1 `/info`가 두 번 호출되는 이유 — 분류 결과

**중복 호출이 아니다. 파라미터가 다른 2단계 정밀화다.**

| 호출 | 파라미터 | 시점 | 목적 |
|---|---|---|---|
| 1차 | `jibun=` (빈 값) + dong + lawdCd | 실거래와 **병렬** | DB 캐시(name+dong 키)로 대부분 정확한 값을 즉시 얻어 첫 화면을 빨리 띄운다 |
| 2차 | `jibun=1536` + dong + lawdCd | 실거래 응답 도착 후 | 지번이 확정되면 더 정밀한 등기/대장 정보로 조용히 갱신한다(`setInfoLoading` 없이 `setAptInfo`만) |

둘 중 하나를 없애면 **첫 화면이 느려지거나(1차 제거) 정밀도를 잃는다(2차 제거)**.
그래서 합치지 않고, 각자의 파라미터 키로 **캐시**했다. 재방문에서는 둘 다 캐시에서 나온다.

### 3.2 `/score` — 계산이 아니라 전송만 재사용

**점수 계산 로직·공식·가중치는 건드리지 않았다.** 전송 계층 재사용만 추가했다.

캐시 조건이 단순한 `res.ok`가 **아닌** 이유가 이 STEP에서 가장 중요한 신뢰 판단이다:

```ts
// score/route.ts — catch 블록에서도 200을 돌려준다
} catch (error) {
  logServerError(...);
  // §43: 데이터 부족/오류를 사용자 오류(404/500)로 취급하지 않는다.
  return NextResponse.json(emptyResponse('INSUFFICIENT_DATA'));
}
```

즉 **일시적 서버 오류가 HTTP 200 + `status:'INSUFFICIENT_DATA'`로 나온다.** 이걸
`res.ok` 기준으로 캐시하면 그 오류가 TTL 동안 "이 단지는 점수 없음"으로 고정된다.
그래서 **실제로 산출된 점수가 있을 때만**(`score !== null`) 캐시한다.

### 3.3 공용 캐시 코어

`src/lib/detail-resource-cache.ts` — V2의 `detail-trade-cache.ts`가 쓰던 규칙을 그대로
따르되, "무엇이 진짜 성공인가"는 호출부가 `isCacheable`로 정의한다.

- 실패·부분 실패·에러 위장 성공 응답은 캐시하지 않는다
- TTL 5분, 모듈 스코프 메모리만(브라우저 저장소 미사용 → 탭을 닫으면 소멸)
- 키는 canonical identity + 파라미터. 이름만으로 만들지 않는다
- in-flight 중복 제거 포함

### 3.4 실측 (Production)

| 항목 | V2 (이전) | V2.1 (현재) |
|---|---|---|
| 재방문 전체 API 요청 | **7** | **4** |
| 재방문 `/score` | 1 | **0** |
| 재방문 `/info` | 2 | **0** |
| 재방문 실거래 요청 | 0 | 0 |

재방문에 남은 4건은 `log/heartbeat`, `community/posts`, `my/recent/sync`, `log/view` —
전부 분석/기록·커뮤니티 성격이라 **다시 나가는 게 맞다**.

**캐시된 값이 화면에서 그대로 유효한지 확인**: 최초 방문과 재방문의 점수(78/60/68/90점)와
단지정보(2023년 준공 · 4,470세대)가 완전히 동일하며, "산정 준비 중"으로 degrade되지 않았다.

---

## 4. 지도 타이밍 재측정 (Production, 4G / 4x CPU)

### 4.1 폭별 (각 1회)

| 폭 | FCP | SDK ready | 마커 요청 | 마커 응답 | 캐시 | 첫 마커 | 사용가능 |
|---|---|---|---|---|---|---|---|
| 360 | 924 | 3,099 | 4,628 | 4,983 | STALE | 4,269 | 6,197 |
| 390 | 656 | 2,909 | 5,016 | 5,554 | HIT | 4,498 | 6,919 |
| 430 | 516 | 2,874 | 4,717 | 5,017 | HIT | 4,220 | 6,166 |
| 1280 | 520 | 2,586 | 4,888 | 5,584 | HIT | 4,263 | 7,025 |

### 4.2 390에서 n=5 분포

| 지표 | 중앙값 | 범위 |
|---|---|---|
| FCP | 784ms | 512~976 |
| **Kakao SDK ready** | **2,466ms** | **1,451~2,915** |
| 마커 요청 시작 | 4,406ms | 2,391~4,990 |
| 마커 전송(요청→응답) | **422ms** | 99~509 |
| 첫 마커 | 4,060ms | 2,282~4,487 |
| **마커 사용가능** | **5,706ms** | **2,798~6,521** |
| SDK ready → 마커 요청 간격 | **1,921ms** | — |

### 4.3 판정 — 목표 미달, 그러나 원인은 payload가 아니다

**목표(≤2~3초)를 중앙값에서는 만족하지 못한다.** 가장 빠른 실행(SDK ready 1,451ms)만
2,798ms로 목표에 들어왔다.

원인 분해가 분명하다:

- 마커 **전송**은 이제 CDN HIT + 12KB라 99~509ms에 불과하다 — 이 STEP이 바꾼 부분은 이미 작다.
- 시간을 지배하는 것은 **Kakao SDK 로드(중앙값 2.5초, 편차 1.5~2.9초)** 와
  **SDK 준비 후 마커 요청이 나가기까지의 1.9초 공백**이다.
- 지도 기본 진입 구가 **중구(가장 작은 구, 12KB)** 라서 payload 개선이 이 화면의 전체
  시간에 드러날 여지가 애초에 거의 없다(V2 §8.3에서 이미 확인된 구조).

V2 측정치(SDK ready 1,420~2,304ms / 사용가능 3,758~5,568ms)와 같은 편차 band 안이며,
**이 STEP으로 인한 회귀는 관측되지 않았다.** 남은 개선 여지는 SDK 로드와 초기화→요청
구간이고, 그건 별도 STEP이다(§6).

---

## 5. 회귀 QA (Production, 360 / 390 / 430 / 1280)

| 흐름 | 결과 |
|---|---|
| A. 홈 → 지도 | PASS |
| B. 지도 → 아파트 레이어 | PASS (`fields=marker` 사용, 전 폭) |
| C. 지도 → 오피스텔 ON/OFF/재ON | PASS — 요청 1/0/0 (재ON 캐시) |
| D. 지도 이동/줌 → 마커 → 상세 → back | PASS — §1.4 복원 표 |
| E. 상세 → 지도 모달 → 로드뷰 → 지도 | PASS — 지도 타일 12~15, 로드뷰 타일 6, 재진입 정상 |
| F. 상세 → 매매/전월세 토글 | PASS — 좌표 유지, 전 폭 |
| G. 상세 → back/forward | PASS — 재방문 API 4건, 값 동일 |

정확성 항목:

| 항목 | 결과 |
|---|---|
| canonical navigation | ✅ `더샵센텀파크2차` 마커 → `aptSeq=26350-2092` (1차 2093으로 새지 않음) |
| 잘못된 단지 | ✅ 없음 |
| 좌표 회귀 | ✅ 전 폭 `APT_SEQ` / `geocodeQuality=exact` |
| Kakao 첫 결과 폴백 | ✅ `addressSearch` 0회, 단지명 `keywordSearch` 0회 (질의는 공원/KTX/기차역뿐) |
| 오피스텔 회귀 | ✅ 없음 |
| SDK 중복 초기화 | ✅ `sdk.js` 1회/페이지 |
| 실패를 성공으로 캐시 | ✅ 구조적으로 차단(§2.2, §3.2) |

비로그인 세션의 `/api/my/recent/sync` 401은 이 STEP과 무관한 기존 동작이다.

---

## 6. 남은 P0 / P1

| # | 항목 | 근거 |
|---|---|---|
| **P0** | **TAGO 상류 cold worst-case ~7.7초** — durable 캐시 필요. **DB/schema 승인이 필요한 별도 STEP** | V2 §8.4 |
| P1 | **Kakao SDK 로드 1.5~2.9초** — 지도 사용가능 시간을 지배한다. preconnect/사전 로드/로딩 전략 검토 | §4.2 |
| P1 | **SDK ready → 마커 요청 1.9초 공백** — 지도 초기화·지역 확정 순서 문제. payload와 무관 | §4.2 |
| P1 | 상세 CLS 0.367 (감사 P1-8) — 이 STEP 범위 밖, 그대로 남아 있음 | 감사 V1 |
| P2 | 재방문에 남은 4건은 분석/기록 성격이라 의도된 동작 | §3.4 |
| P2 | 모바일 작은 터치 타깃 13개(기존값) | V2 §7 |

---

## 7. 변경 파일

**신규**
- `src/lib/detail-resource-cache.ts` — identity 기반 공개 GET 공용 TTL 캐시(호출부가 성공을 정의)
- `src/lib/map-marker-share.test.ts` — 복원 계약 13 케이스

**수정**
- `src/lib/map-marker-share.ts` — `serializeLayers` / `parseLayerParam` /
  `buildMapRestoreParams` / `mapParamsToQueryString` 추가, `ParsedMapState.layers` 추가
  (`buildMapShareParams`는 불변 — 공유 계약 유지)
- `src/app/map/page.tsx` — layers를 URL에서 복원, view 상태를 `replaceState`로 동기화
- `src/app/api/transactions/route.ts` — 완전 성공 응답에만 CDN 캐시 헤더
- `src/app/apt/[name]/apt-client.tsx` — `/score`, `/info`(2단계 모두) 공용 캐시 경유

---

## 8. 검증 결과

| 검사 | 결과 |
|---|---|
| `npx tsc --noEmit` | `FAIL_EXISTING_SCRIPT_ERRORS` — 24건 전부 `scripts/`(11) + `tmp/`(3), **`src/` 0건** |
| `npx eslint <변경 파일>` | **0 errors** (기존 warning 1건 유지) |
| `npm run build` | **성공** |
| `map-marker-share.test.ts` | **13 pass / 0 fail** |
| `detail-trade-window.test.ts` | **14 pass / 0 fail** |

---

## 9. 다음 STEP 권장

1. **버스 durable 캐시** — 유일하게 남은 P0. DB/schema 승인 STEP.
2. **지도 초기화 경로** — SDK 로드 전략 + "SDK ready → 마커 요청" 1.9초 공백 단축.
   지도 사용가능 시간의 대부분이 여기 있다.
3. 상세 CLS(P1-8).
