# E-JIP PERCEIVED PERFORMANCE V2.2 — MAP INIT PIPELINE

> 선행: `PERCEIVED_PERFORMANCE_V2_DATAFLOW.md`, `PERCEIVED_PERFORMANCE_V2_1.md`.
> 범위: 지도 초기화 파이프라인(SDK 로드 / 지역 결정 / 마커 요청)의 직렬 의존 제거.
> **DB·schema·migration 변경 없음. durable 버스 캐시는 구현하지 않는다.**

---

## 1. 먼저 측정했다 (원인 추정 금지)

V2.1은 "지도 사용가능 5,706ms, SDK ready → 마커 요청 1.9초 공백"으로 끝났다.
이번에는 **바꾸기 전에** 페이지 내부 시계(`performance.now()`, T0=navigationStart)로
파이프라인 전 구간을 찍었다.

### 1.1 BEFORE 파이프라인 (Production, 4G / 4x CPU, 390, n=4, 직접 진입)

```
   608ms  FCP
 1,133ms  sdk.js 요청 시작        ← hydration이 끝나야 로더 effect가 돈다
 1,258ms  sdk.js 다운로드 완료     ← 다운로드는 125ms뿐 (root layout preconnect가 이미 일함)
 1,488ms  SDK ready (kakao.maps.load 콜백)
 2,034ms  coord2RegionCode 시작   ← 지도 인스턴스 생성 후, Kakao 역지오코딩 왕복
 2,146ms  coord2RegionCode 완료
 2,229ms  마커 요청 시작
 2,365ms  마커 응답 완료
 2,208ms  첫 마커
 2,772ms  마커 사용가능(>3)
```

**SDK ready 이후에만 741ms를 더 기다린다.** 그 안에 지도 인스턴스 생성(약 546ms)과
Kakao 역지오코딩 왕복(약 112ms)이 들어 있다.

### 1.2 V2.1이 보고한 5,706ms와의 차이 — 정정

V2.1의 숫자는 계측 오류가 아니었다(같은 harness로 Node 시계/페이지 시계를 같은 실행에서
비교해보니 차이는 140~160ms뿐이다). **Production이 그때보다 지금 더 빠르다** — 지배 변수인
Kakao SDK 로드가 그 측정 창에서 1,451~2,915ms(중앙값 2,466ms)였고, 지금은 1,224~1,385ms다.
즉 V2.1의 5,706ms는 "그 시점 Kakao 네트워크가 느렸던 창"을 담은 값이다.
이 문서의 BEFORE/AFTER는 **같은 날 연속으로 측정한 값끼리** 비교한 것이다.

### 1.3 근본 원인 (코드로 확인)

```ts
// 초기 로드는 지도 인스턴스를 기다린다
useEffect(() => {
  if (!isMapReady) return;                       // ← GATE 1
  refreshActiveLayers(center.lat, center.lng, initialShareLawdCdRef.current ?? undefined);
}, [isMapReady]);

// 그리고 지역을 알아내려고 Kakao를 한 번 더 왕복한다
const lawdCd = knownLawdCd ?? (await resolveLawdCd(lat, lng));   // ← GATE 2
// resolveLawdCd → new kakao.maps.services.Geocoder().coord2RegionCode(...)
```

- **GATE 1**: 마커 데이터는 **우리 HTTP API**다. 지도 인스턴스도 SDK도 필요 없는데 기다렸다.
- **GATE 2**: 좌표 → lawdCd 역지오코딩. URL이 이미 lawdCd를 주는 진입에서는 불필요하다
  (그 경로는 `initialShareLawdCdRef`로 이미 건너뛰고 있었다 — 실측 `regionCalls=0`).

---

## 2. AFTER 파이프라인

```
BEFORE                                   AFTER
──────────────────────────────────       ──────────────────────────────────
HTML                                     HTML + <link rel=preload sdk.js>   ← /map 라우트에서만
  ↓ hydration                              ↓ (브라우저가 파싱 중 SDK 다운로드 시작)
  ↓ effect → 로더가 script 주입             ↓ hydration
  ↓ sdk.js 다운로드                         ↓ 마운트 즉시 마커 payload prefetch (URL이 lawdCd를 아는 진입)
SDK ready                                  ↓ 로더가 script 주입 → 이미 받아둔 것을 재사용
  ↓ 지도 인스턴스 생성                     SDK ready
  ↓ coord2RegionCode (Kakao 왕복)            ↓ 지도 인스턴스 생성
마커 요청 ────────────────────            마커 요청은 이미 끝나 있음(prefetch)
마커 응답                                  마커 응답 재사용
첫 마커                                    첫 마커
```

### 2.1 변경 1 — `/map` 라우트에서 SDK preload

`src/app/map/layout.tsx`(서버 컴포넌트)가 `<link rel="preload" as="script">`를 심는다.
URL은 로더와 **같은 함수**(`kakaoMapsSdkUrl()`)로 만든다 — 한 글자만 달라도 브라우저가
두 번 받는다.

- preload는 **받아만 두고 실행하지 않는다.** 실행 시점·`kakao.maps.load()` 호출·중복 주입
  방지는 여전히 `loadKakaoMapsSdk()`가 통제한다(초기화 계약 불변).
- `/map` 하위에만 적용 — 지도를 쓰지 않는 화면은 SDK를 받지 않는다.

### 2.2 변경 2 — 마커 payload prefetch (렌더 순서 불변)

URL이 이미 lawdCd를 주는 진입(공유 링크 / V2.1 복원)에서만, 마운트 즉시 마커 응답을
받아둔다. **상태는 전혀 건드리지 않는다.**

직접 진입(파라미터 없음)은 **의도적으로 그대로 뒀다** — 그 경로의 지역은 GPS/IP로 정해지는
center에 달려 있어서, 일찍 쏘면 지오로케이션이 도착하기 전의 기본 center로 엉뚱한 구를
조회할 수 있다. 속도를 위해 지역 정확도를 흔들지 않는다.

### 2.3 중간에 만든 회귀와 그 원인 (기록으로 남긴다)

처음 구현은 조기 단계에서 `fetchAptMarkers()`를 그대로 호출해 **마커를 state에 넣었다.**
데이터는 약 1,000ms 빨리 도착했는데 **사용자가 보는 첫 마커는 오히려 느려졌다.**

| 복원 진입 | 첫 마커 |
|---|---|
| BEFORE | 2,198ms |
| 조기 fetch + state 반영 (실패한 시도) | **3,254ms** |
| payload만 prefetch (채택) | **2,119ms** |

지도 인스턴스를 계측해 원인을 확인했다: 타일 요청 2,082ms → 타일 완료 2,730ms → 첫 마커
3,404ms. 지도가 마운트되는 **첫 커밋에 이미 마커 데이터가 들어 있으면** 인스턴스 생성 ·
타일 로드 · 오버레이 렌더가 한 커밋에 겹치고, 4x CPU 스로틀에서 그게 1초 가까이 밀린다.
그래서 채택안은 **응답만 받아두고 상태는 기존 시점에 그대로 반영**한다. 렌더 순서는
변경 전과 100% 동일하고 네트워크만 앞당겨진다.

---

## 3. 실측 BEFORE → AFTER (Production, 4G / 4x CPU, 390, n=4)

### 3.1 직접 진입 `/map`

| 지표 | BEFORE | AFTER | 변화 |
|---|---|---|---|
| FCP | 608ms | 572ms | −36ms |
| **sdk.js 요청 시작** | **1,133ms** | **198ms** | **−935ms** |
| sdk.js 완료 | 1,258ms | 347ms | −911ms |
| SDK ready | 1,488ms | 1,291ms | −197ms |
| coord2RegionCode 시작 | 2,034ms | 1,865ms | −169ms |
| 마커 요청 시작 | 2,229ms | 2,085ms | −144ms |
| 마커 응답 | 2,365ms | 2,192ms | −173ms |
| 첫 마커 | 2,208ms | 2,069ms | −139ms |
| **마커 사용가능(>3)** | **2,772ms** | **2,424ms** | **−348ms** |
| SDK ready → 마커 요청 | +762ms | +814ms | (설계상 유지 — §2.2) |

### 3.2 복원/공유 진입 (URL에 lawdCd 있음)

| 지표 | BEFORE | AFTER | 변화 |
|---|---|---|---|
| **sdk.js 요청 시작** | 1,138ms | **180ms** | **−958ms** |
| SDK ready | 1,475ms | 1,397ms | −78ms |
| **마커 요청 시작** | 2,038ms | **1,105ms** | **−933ms** |
| 마커 응답 | 2,115ms | 1,298ms | −817ms |
| 첫 마커 | 2,198ms | 2,119ms | −79ms |
| **SDK ready → 마커 요청** | **+546ms** | **−264ms** | 요청이 SDK보다 **먼저** 출발 |

§6 목표("마커 요청이 SDK ready보다 먼저 시작") **달성**.

### 3.3 구 × 폭 (복원 진입, 각 1회)

| 구 | 폭 | sdk.js 요청 | SDK ready | 마커 요청 | 마커 응답 | 첫 마커 | 사용가능 | gap | bytes |
|---|---|---|---|---|---|---|---|---|---|
| 중구 26110 | 360 | 157 | 1,259 | 1,016 | 1,091 | 1,922 | **2,240** | −243 | 12,069 |
| 중구 | 390 | 196 | 1,235 | 962 | 1,036 | 1,955 | **2,278** | −273 | 12,069 |
| 중구 | 430 | 167 | 1,224 | 988 | 1,060 | 1,997 | **2,314** | −236 | 12,069 |
| 중구 | 1280 | 171 | 1,251 | 1,006 | 1,074 | 1,963 | **2,322** | −245 | 12,069 |
| 부산진구 26230 | 360 | 183 | 1,264 | 1,028 | 1,781 | 1,927 | 3,003 | −236 | 83,644 |
| 부산진구 | 390 | 164 | 1,348 | 1,058 | 1,162 | 1,988 | 3,237 | −290 | 83,644 |
| 부산진구 | 430 | 160 | 1,385 | 1,068 | 1,158 | 2,059 | 3,303 | −317 | 83,644 |
| 부산진구 | 1280 | 167 | 1,275 | 1,045 | 1,145 | 2,027 | 3,613 | −230 | 83,644 |
| 해운대구 26350 | 360 | 191 | 1,283 | 1,030 | 1,122 | 2,038 | 3,054 | −253 | 63,660 |
| 해운대구 | 390 | 192 | 1,297 | 1,044 | 1,134 | 2,124 | 3,115 | −253 | 63,660 |
| 해운대구 | 430 | 188 | 1,226 | 964 | 1,057 | 2,069 | **2,791** | −262 | 63,660 |
| 해운대구 | 1280 | 154 | 1,313 | 1,020 | 1,107 | 2,050 | 3,237 | −293 | 63,660 |

**전 조합에서 `regionCalls=0`, 마커 요청이 SDK ready보다 230~317ms 먼저 출발한다.**

### 3.4 목표 대비 판정

| 구 | 사용가능 | 목표(≤2~3초) |
|---|---|---|
| 중구 | 2,240~2,322ms | **충족** |
| 해운대구 | 2,791~3,237ms | 경계(1/4는 충족) |
| 부산진구 | 3,003~3,613ms | **미충족** |

**남은 비용은 네트워크가 아니라 렌더다.** 부산진구는 마커 응답이 1,145ms에 끝나는데
사용가능은 3,613ms다 — 그 사이 약 2.4초는 마커 클러스터링·오버레이 렌더(4x CPU 스로틀)다.
병목이 SDK/네트워크에서 **마커 렌더**로 옮겨갔다.

---

## 4. 중복 SDK 초기화 없음 (검증)

preload가 실제로 재사용되는지 별도 확인:

```
width 390 / 1280 — networkRequestEvents=1, responseEvents=1
resourceTimings=[{ initiator: "link", start ~190ms, dur ~124ms }]
```

리소스 타이밍 항목이 **1개**이고 initiator가 `link`(preload)다 — script 태그는 받아둔 것을
재사용하며 두 번 내려받지 않는다.

> 참고: 다른 harness에서 `sdkJsLoads=2`로 보이는 경우가 있는데, 그건 마커 → 상세 → back
> 여정에서 **상세페이지가 자기 SDK를 로드**하기 때문이다. 지도 페이지의 중복 초기화가 아니다.

---

## 5. 회귀 QA (Production, 360 / 390 / 430 / 1280)

| 항목 | 결과 |
|---|---|
| §8 지도 복원(center/zoom/lawdCd/layers/선택 단지) | **PASS** 전 폭, `history.length` 2 유지 |
| back 후 마커 존재 | PASS (360:2, 390:2, 430:3, 1280:12) |
| §9 오피스텔 ON/OFF/재ON | **PASS** — 요청 1/0/0 (재ON 캐시) |
| 마커 → 상세 canonical identity | PASS (예: 코모도에스테이트 / 보수동한웅베어스) |
| `fields=marker` 사용 | PASS 전 폭 |
| 마커 응답 CDN | HIT 전 폭 |
| `addressSearch`(지오코딩) | **0회** 전 폭 |
| 직접 `/map` 진입 | PASS (기본 지도 정상, `regionCalls=1`로 기존 경로 유지) |
| 복원 URL 진입 | PASS (`regionCalls=0`) |
| 무한 로딩 / 상태 리셋 / history 회귀 | 없음 |

---

## 6. §10 상세 CLS — 감사 결과 (이번 STEP에서는 수정하지 않음)

Production 실측(390, 4G/4x CPU):

| 항목 | 값 |
|---|---|
| **CLS 합계** | **0.1751** (감사 V1의 0.367에서 이미 절반 이하로 내려와 있다) |
| 최대 shift | **0.1127 @ 9,106ms** — source가 클래스 없는 `DIV.` 3개로 특정되지 않음 |
| 2위 shift | **0.0604 @ 2,814ms** — `ApartmentScoreCard`(score/header) 삽입 |
| 총 shift 수 | 6 |

**수정하지 않았다.** §10의 기준("근본 원인이 저위험이고 명확히 입증될 때만 수정")에서,
가장 큰 기여분(0.1127)의 원인 요소가 특정되지 않았다. 여기서 ScoreCard만 손대면 전체의
1/3만 건드리면서 상세 UI에 min-height 류의 변경을 넣게 되므로, **전용 trace가 붙은 별도
STEP**이 맞다.

---

## 7. 남은 P0 / P1

| # | 항목 | 근거 |
|---|---|---|
| **P0** | TAGO 상류 cold worst-case ~7.7초 — durable 캐시(**DB/schema 승인 필요, 이 STEP 범위 밖**) | V2 §8.4 |
| **P1** | **마커 렌더/클러스터링** — 부산진구 기준 응답 1,145ms → 사용가능 3,613ms(약 2.4초가 렌더) | §3.3 |
| P1 | 직접 진입의 `coord2RegionCode` 왕복 — 좌표→법정동을 Kakao 없이 서버에서 풀 수 있으면 제거 가능 | §1.3 |
| P1 | 상세 CLS 0.1751, 최대 shift 원인 미특정 | §6 |
| P2 | 모바일 작은 터치 타깃 13개(기존값) | V2 §7 |

---

## 8. 변경 파일

**신규**
- `src/app/map/layout.tsx` — `/map` 라우트 전용 SDK preload

**수정**
- `src/lib/kakao/maps-sdk.ts` — `kakaoMapsSdkUrl()` 단일 URL 생성 지점(preload/주입 공유)
- `src/app/map/page.tsx` — 마커 payload prefetch(상태 미변경) + 기존 조회 경로에서 재사용

---

## 9. 검증 결과

| 검사 | 결과 |
|---|---|
| `npx tsc --noEmit` | `FAIL_EXISTING_SCRIPT_ERRORS` — 24건 전부 `scripts/`(11)+`tmp/`(3), **`src/` 0건** |
| `npx eslint <변경 파일>` | **0 errors** |
| `npm run build` | **성공** |
| `map-marker-share.test.ts` + `detail-trade-window.test.ts` | **27 pass / 0 fail** |

---

## 10. 다음 STEP 권장

1. **마커 렌더 비용** — 지금 지도 사용가능 시간의 대부분이다(밀집 구 약 2.4초).
   클러스터링 알고리즘/오버레이 수/렌더 배치가 대상이며 네트워크는 이미 아니다.
2. **버스 durable 캐시** — 유일하게 남은 P0. DB/schema 승인 STEP.
3. **상세 CLS 전용 trace** — 최대 shift(0.1127) 원인 특정 후 수정.
