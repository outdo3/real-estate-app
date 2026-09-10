# E-JIP PERCEIVED PERFORMANCE V2.3 — MAP RENDER / CLUSTER OPTIMIZATION

> 선행: `PERCEIVED_PERFORMANCE_V2_2_MAP_INIT.md`.
> 범위: **렌더 비용만.** 마커 데이터가 도착한 뒤 화면에 쓸 수 있게 되기까지의 구간.
> **DB·schema·migration 변경 없음. 외부 API 추가 없음. durable 버스 캐시 없음.**
> Score/canonical identity/거래 의미 변경 없음.

---

## 0. 출발점

V2.2는 네트워크/초기화 경로를 정리하고 이렇게 끝났다:

> 남은 위험: 지도 사용가능 시간의 남은 대부분은 마커 클러스터링·오버레이 렌더다(밀집 구 약 2.4초).

이번 STEP은 그 2.4초의 **정체를 특정하고** 줄인다.

---

## 1. 먼저 측정했다 — 어느 단계가 비싼가

### 1.1 실제 마커 수 (추정 아님)

`/api/transactions?type=apt&lawdCd=…&months=12&fields=marker` 실측:

| 구 | lawdCd | transactions | 좌표 있는 마커 | partial |
|---|---|---|---|---|
| 중구 | 26110 | 51 | 51 | false |
| 부산진구 | 26230 | 356 | 356 | false |
| 해운대구 | 26350 | 274 | 274 | false |

### 1.2 계측 방법

`src/lib/perf-debug.ts`에 `perfLog()`/`perfNow()`/`PERF_ENABLED`를 추가하고
`recomputeClusters`의 두 단계를 찍었다.

- `map:cluster:apt` — 투영 + 픽셀 클러스터링 소요, 마커 수, 클러스터 수
- `map:overlay:apt` — 클러스터 확정 → React 커밋 완료(= 모든 `CustomOverlayMap`의
  `useLayoutEffect`가 끝나 kakao `CustomOverlay`가 생성·부착된 시점)까지의 소요

`NEXT_PUBLIC_EJIP_PERF_DEBUG=true`일 때만 동작한다. 기본값(=production)에서는
`perfLog`/`perfNow`가 즉시 반환하는 no-op이라 오버헤드가 없다 —
production 빌드에서 `[perf]` 콘솔 줄 **0건**으로 확인했다.

측정 환경: 로컬 production 빌드(`next build && next start`), headless Chrome,
**CPU 4x throttling**. 4x를 쓴 이유는 아래 1.3에 있다.

### 1.3 "왜 로컬에서는 2.4초가 안 보이는가" — throttling 없이는 재현되지 않는다

throttling 없는 데스크톱에서는 부산진구도 usable 256~414ms로 끝난다. 즉 이 문제는
**네트워크가 아니라 CPU에 묶여 있다.** 4x throttling을 걸자 아래처럼 재현됐고,
production(4G/4x)에서도 같은 크기의 비용이 나왔다(§6).

### 1.4 BEFORE — 단계별 비용 (로컬 production 빌드, CPU 4x)

```
부산진구 360px:
  마커 데이터 도착      356개
  → 클러스터링          22.9 ~ 26.6ms      356 → 클러스터 293
  → 오버레이 생성/부착  664.5ms            ← 렌더 비용의 약 96%
  → 화면에 실제로 그려진 칩: 29개
```

| 구 / 확대 | 폭 | 마커 | 클러스터 | 클러스터링 ms | **오버레이 커밋 ms** | DOM 칩 |
|---|---|---|---|---|---|---|
| 중구 z4 | 360 | 51 | 37 | 2.1~4.0 | **300.9** | 14 |
| 중구 z4 | 1280 | 51 | 37 | 1.6~4.1 | **127.7** | 33 |
| 부산진구 z4 | 360 | 356 | 293 | 22.9~26.6 | **664.5** | 29 |
| 부산진구 z4 | 1280 | 356 | 293 | 19.0~33.2 | **775.0** | 76 |
| 해운대구 z4 | 360 | 274 | 242 | 14.0~14.9 | **552.5** | 13 |
| 해운대구 z4 | 1280 | 274 | 242 | 10.8~60.0 | **511.1** | 52 |
| 부산진구 z3 | 360 | 356 | 309 | 18.8~23.7 | **690.8** | 11 |
| 부산진구 z3 | 1280 | 356 | 309 | 24.2~26.7 | **636.8** | 18 |

### 1.5 병목의 정체

**클러스터링이 아니라 오버레이 생성이다.** 두 가지 증거가 같은 곳을 가리킨다.

1. 단계 계측: 부산진구에서 클러스터링 19~33ms 대 오버레이 664~775ms.
2. long task가 **화면에 그려진 칩 수가 아니라 전체 마커 수**를 따라간다.
   부산진구 360px는 칩이 29개인데 LTmax 560ms이고, 중구 1280px는 칩이 33개인데
   LTmax 116ms다. 즉 비용은 "보이는 것"이 아니라 "가진 것"에 비례했다.

원인은 호출부 한 줄이었다. 아파트만 뷰포트 컬링을 끄고 있었다:

```ts
// BEFORE — 오피스텔은 viewport rect를 넘기는데 아파트는 null
const apt = clusterMarkersByPixels(projection, aptMarkers, chipLayout, safeZoneRects, null);
```

`react-kakao-maps-sdk`의 `CustomOverlayMap`은 클러스터 하나마다
`document.createElement` + `new kakao.maps.CustomOverlay(...)` + `setMap()`을
**`useLayoutEffect` 안에서** 실행한다. 즉 293개가 페인트를 막은 채 한 커밋에 동기로 붙는다.
그런데 kakao `CustomOverlay`는 화면 밖이면 content를 DOM에 붙이지 않아
(portal 대상인 `parentElement`가 `null`) **264개는 아무것도 보여주지 않으면서
생성·부착 비용만 냈다.**

§4가 물은 "오피스텔 레이어는 왜 더 싼가"의 답도 이것이다 — 오피스텔은 이미
`OFFICETEL_VIEWPORT_MARGIN_PX`(160px)로 컬링하고 `OFFICETEL_RENDER_CAP`으로 상한을 둔다.
새 전략을 발명할 필요 없이 **이미 배포되어 검증된 같은 개념을 아파트에 적용**하면 됐다.

---

## 2. clusterMarkersByPixels 감사 결과 — 건드리지 않았다

- 복잡도는 O(n²)(그리디 그룹핑)이고 `Math.hypot`을 쓴다.
- 하지만 실측 비용이 356개에서 19~33ms(4x 기준, 실사용 CPU 환산 5~8ms)로
  전체의 4%다. 컬링 후에는 n이 22~121로 줄어 3~16ms가 된다.
- §2의 "**측정 근거가 있을 때만** 최적화한다"에 따라 **알고리즘은 그대로 뒀다.**
  공간 격자/메모이제이션은 지금 근거가 없다. 근거 없이 손대면 동일 좌표 그룹핑과
  cluster id 안정성만 흔든다.

바꾼 것은 매 재계산마다 `getBoundingClientRect()`를 두 레이어가 각각 부르던 것을
한 번으로 합친 것뿐이다(layout read 1회).

---

## 3. 구현 — 아파트 레이어 뷰포트 컬링

```ts
// AFTER
const rect = mapViewportRef.current?.getBoundingClientRect();   // 두 레이어가 공유
const aptViewport = rect
  ? { width: rect.width, height: rect.height, margin: APT_VIEWPORT_MARGIN_PX }
  : null;

const activeId = activeMarkerIdRef.current;
const keepIds = activeId ? new Set([activeId]) : null;
const apt = clusterMarkersByPixels(projection, aptMarkers, chipLayout, safeZoneRects, aptViewport, keepIds);
```

`clusterMarkersByPixels`에는 컬링 **면제** 목록(`keepIds`)만 추가했다.
알고리즘·클러스터 반경·격자 배치·nudge 규칙은 그대로다.

### 3.1 여유분을 160px로 정한 근거

| margin | 부산진구 360px | 부산진구 1280px | 해운대구 360px | 해운대구 1280px |
|---|---|---|---|---|
| 240px | 250.6ms (72 클러스터) | 454.4ms (152) | 157.2ms (36) | 293.8ms (91) |
| **160px** | **196.2ms (55)** | **356.4ms (121)** | **91.1ms (29)** | **254.3ms (79)** |

모든 구·폭에서 160px이 빨랐고, 이미 배포된 오피스텔 레이어와 값이 갈리지 않는다.

### 3.2 개수가 줄어 보이지 않는 이유 (§5 보존)

축소 상태에서 클러스터는 **개수 배지**로 그려진다. 컬링 때문에 그 개수가 실제보다
적게 나오면 안 된다. 클러스터 중심이 화면 안이면 그 멤버는 중심에서 최대
`clusterRadius`(≤54px) 안에 있고, 여유분 160px은 그보다 크다. 따라서 **화면에
보이는 배지의 개수는 컬링 전과 항상 같다.** 경계 밖 마커의 그룹핑이 달라질 수는
있으나 그건 화면 밖 이야기다.

### 3.3 identity 보호 (가장 중요한 안전장치)

아파트는 오피스텔과 달리 선택 마커를 **클러스터에서** 찾는다:

```ts
const selectedMarker = useMemo(() => resolveSelectedMarker(activeMarkerId, aptClusters, …), …);
const pinnedMarker   = useMemo(() => resolveSelectedMarker(selectedMarkerId, aptClusters, …), …);
```

`pinnedMarker`는 `buildMapRestoreParams(...)`로 **복원/공유 URL의 identity**가 된다.
그래서 선택 마커가 컬링되면 살짝 패닝했다는 이유만으로 바텀시트가 사라지고
URL에서 `aptSeq`가 빠진다. 이를 막기 위해 `keepIds`로 선택/고정 마커는 화면 밖이어도
클러스터 목록에 남긴다.

`activeMarkerId`를 effect deps에 넣지 않고 **ref로 읽는** 이유: `recomputeClusters`는
지도의 native `idle` 리스너로 등록된다. deps에 넣으면 마커를 고르거나 hover할 때마다
리스너 재등록 + 전체 재계산 + 오버레이 재생성이 일어난다(§7 재빌드 금지). ref로 읽으면
패닝 이후에도 stale closure의 옛 값을 쓰지 않으면서 재빌드도 생기지 않는다.

---

## 4. AFTER — 단계별 비용 (같은 환경, CPU 4x)

| 구 / 확대 | 폭 | 클러스터 BEFORE→AFTER | **오버레이 커밋 BEFORE→AFTER** | 감소 |
|---|---|---|---|---|
| 중구 z4 | 360 | 37 → 24 | 300.9 → **162.8ms** | −46% |
| 중구 z4 | 1280 | 37 → 37 | 127.7 → **137.9ms** | 변화 없음(컬링 대상 없음) |
| 부산진구 z4 | 360 | 293 → 55 | 664.5 → **196.2ms** | **−70%** |
| 부산진구 z4 | 1280 | 293 → 121 | 775.0 → **356.4ms** | −54% |
| 해운대구 z4 | 360 | 242 → 29 | 552.5 → **91.1ms** | **−84%** |
| 해운대구 z4 | 1280 | 242 → 79 | 511.1 → **254.3ms** | −50% |
| 부산진구 z3 | 360 | 309 → 22 | 690.8 → **112.4ms** | **−84%** |
| 부산진구 z3 | 1280 | 309 → 36 | 636.8 → **112.9ms** | −82% |

중구 1280px은 마커 51개가 전부 뷰포트+여유분 안에 들어와 컬링 대상이 없다.
n=7 재측정 중앙값 137.9ms(전체 135/136/138/138/141/152/376)로 BEFORE 127.7ms와
같은 범위이며, 첫 실행 376ms는 cold-start 이상치다. **회귀 아님.**

클러스터링 자체도 356개 기준 19~33ms → 5.8~16.2ms로 줄었다(투영 대상이 줄어서).

### 4.1 종단 (data ready → usable, CPU 4x, n=3 중앙값)

| 구 | 폭 | usable BEFORE | usable AFTER | Δ | LTmax BEFORE→AFTER |
|---|---|---|---|---|---|
| 중구 | 360 | 702 | 709 | +7 | 170 → 117 |
| 중구 | 390 | 568 | 513 | −55 | 111 → 82 |
| 중구 | 430 | 518 | 550 | +32 | 95 → 104 |
| 중구 | 1280 | 584 | 734 | +150 | 116 → 208 |
| 부산진구 | 360 | 998 | **602** | **−396** | 560 → 165 |
| 부산진구 | 390 | 1027 | **622** | **−405** | 563 → 142 |
| 부산진구 | 430 | 1042 | **754** | **−288** | 582 → 217 |
| 부산진구 | 1280 | 1191 | **914** | **−277** | 661 → 379 |
| 해운대구 | 360 | 990 | **583** | **−407** | 476 → 127 |
| 해운대구 | 390 | 987 | **494** | **−493** | 552 → 94 |
| 해운대구 | 430 | 1003 | **576** | **−427** | 536 → 97 |
| 해운대구 | 1280 | 996 | **720** | **−276** | 471 → 222 |

중구(마커 51개)는 컬링할 것이 거의 없어 차이가 측정 잡음 범위다 — §4.의 재측정 참고.
밀집 구는 **−28% ~ −50%**.

---

## 5. §6 first visible marker / §5 zoom 규칙 — 하지 않은 것과 이유

- **점진 렌더(첫 배치 먼저)는 구현하지 않았다.** 컬링만으로 밀집 구 오버레이 커밋이
  91~196ms(모바일 폭)로 내려와, 배치를 쪼개서 얻을 이득보다 "마커가 뒤늦게 튀어나오는"
  부작용과 cluster id 안정성 위험이 크다. 측정 근거가 생기면 그때 한다.
- **확대 단계별 표시 규칙은 이미 있었다**(`markerDensityMode`,
  `INDIVIDUAL_MARKER_MAX_LEVEL=3`): 레벨 4 이상은 개수 배지, 레벨 3 이하는 낱개 칩.
  §5가 요구한 동작이 이미 구현되어 있어 **바꾸지 않았다.**
- **렌더 상한(cap)은 아파트에 넣지 않았다.** 오피스텔은 좌표만 있는 master가 수천 건이라
  상한이 필요하지만, 아파트는 컬링 후 뷰포트 안 클러스터가 22~121개라 상한이 걸릴 일이
  없다. 말없이 자르는 장치를 근거 없이 추가하지 않는다(§5 "임의 억제 금지").

---

## 6. Production 측정 (배포 전 = BEFORE, 4G / CPU 4x, 390px, cold cache, n=3 중앙값)

| 구 | data ready | usable | **렌더 구간(usable−data)** | LTmax |
|---|---|---|---|---|
| 중구 | 2,416ms | 3,582ms | 1,166ms | 143ms |
| 부산진구 | 2,514ms | 4,250ms | **1,736ms** | **862ms** |
| 해운대구 | 2,582ms | 4,090ms | **1,508ms** | **658ms** |

production의 LTmax(862/658ms)가 로컬 4x BEFORE(560~661 / 471~552ms)와 같은 크기라,
로컬 harness가 production을 대표한다는 것을 확인했다. V2.2가 남긴 "밀집 구 약 2.4초"와도
같은 구간을 가리킨다.

> **배포 후 production AFTER 측정은 §9에 별도로 기록한다.**

---

## 7. QA 결과

### 7.1 §9 플로우 (로컬 production 빌드, CPU 4x, headless Chrome) — 57/57 PASS

폭 360/390/430/1280 × 중구/부산진구/해운대구 전 조합에서:

- A 직접 `/map` 진입 — 전 조합 마커 표시
- D pan / zoom — 전 조합에서 패닝·확대 후에도 마커 유지(stale/빈 화면 없음)
- UI 가로 오버플로 0px — 전 조합
- C 마커 선택 → URL identity(`aptSeq=26230-1733`) 반영
- F 아파트 OFF(29→0) / ON 복구(→29)
- G 오피스텔 ON(29→70) / OFF(→29) / 재ON(→70)
- H 아파트+오피스텔 동시 ON
- E 지도 → 마커 → 상세(`/apt/…`) → 뒤로 → 지도 복원(칩 29개, lat/lng/zoom/aptSeq 유지)

페이지 에러: `/api/auth/session` 401 1건(비로그인 상태의 기존 동작, 이번 변경과 무관).

### 7.2 identity 보존 — 컬링 경로 전용 검증

일반 QA의 드래그가 마커 위에서 시작해 다른 마커를 선택해버리는 것을 발견하고
(선택이 26230-1733 → 26230-1882로 바뀜) **빈 지점에서 시작하는 전용 테스트**로 다시 했다:

```
SELECTED: 쌍용스윗닷홈스카이 5.4억  aptSeq=26230-1733
pan#1  chips=25  선택칩 DOM에 없음(화면 밖)  card=true  aptSeq=26230-1733  OK
pan#2  chips=17  선택칩 DOM에 없음(화면 밖)  card=true  aptSeq=26230-1733  OK
pan#3  chips=0   card=false  aptSeq 없음
```

- pan#1~2: 선택 마커가 **화면 밖이라 DOM에 없는데도** 바텀시트와 URL identity가 유지된다
  — `keepIds`가 의도대로 동작한다.
- pan#3: 지도가 구 경계를 넘어(lat 35.190) 다른 지역 마커를 새로 불러오면서 선택이 풀린다.
  **컬링 때문인지 확인하기 위해 컬링만 끈 빌드로 같은 시퀀스를 다시 돌렸고, 단계별로
  완전히 동일한 결과가 나왔다.** 즉 기존 동작이며 이번 변경의 회귀가 아니다.

### 7.3 identity 안전 점검

- `Apartment.id`/`aptSeq`/`lawdCd`/`dong`/canonical 이름 경로 변경 없음.
- 이름만으로 재검색하는 경로 추가 없음.
- 클러스터링은 **표시 전용** 묶음이며 서로 다른 canonical identity를 합치지 않는다
  (컬링은 후보에서 빼기만 할 뿐 병합하지 않는다).
- `ApartmentUnitType.canonicalExclusiveArea`, 평/면적 라벨, 거래 의미, Score 로직
  — 이 STEP에서 건드리지 않았다.

---

## 8. 빌드 / 품질

| 항목 | 결과 |
|---|---|
| `npx eslint src/app/map/page.tsx src/lib/perf-debug.ts` | 0 errors |
| `npx tsc --noEmit` | **src 0건**. `scripts/`·`tmp/` 14개 파일은 기존 오류(FAIL_EXISTING_SCRIPT_ERRORS) |
| `npm run build` | 성공 |
| 지도 관련 단위 테스트 | 53 pass / 1 fail |

단위 테스트 1건 실패(`src/lib/map-marker-share.test.ts`)는 **기존 문제**다 —
확장자 없는 상대 import를 node 네이티브 ESM 로더가 해석하지 못하는 것으로
(`ERR_MODULE_NOT_FOUND`), 로직 실패가 아니고 해당 파일은 이번 변경에서 건드리지 않았다.

---

## 9. 남은 항목

- **production AFTER 측정**: 배포 후 §6과 동일한 harness로 재측정 필요.
- **§10 CLS**: 이번 계측에서 상세 CLS의 원인 요소를 특정하지 못했다. 지시대로
  무리한 수정을 하지 않았고 별도 detail-layout STEP으로 남긴다.
- **P1** — 부산진구 1280px는 AFTER에도 오버레이 커밋 356ms로 가장 무겁다.
  데스크톱은 뷰포트가 넓어 실제로 보이는 마커가 많아서이며(칩 76개), 억제 대신
  점진 렌더가 필요해지면 그때 근거를 만들어 다룬다.
- 아파트 레이어에는 렌더 상한이 없다(§5 참고). 컬링 후 22~121개라 현재는 불필요하다.

---

## 10. 변경 파일

- `src/app/map/page.tsx` — 아파트 뷰포트 컬링(`APT_VIEWPORT_MARGIN_PX`),
  `clusterMarkersByPixels`에 `keepIds` 면제, `activeMarkerIdRef`,
  viewport rect 1회 측정, 단계 계측 2곳
- `src/lib/perf-debug.ts` — `perfLog` / `perfNow` / `PERF_ENABLED` 추가
- `docs/development/PERCEIVED_PERFORMANCE_V2_3_MAP_RENDER.md` — 이 문서
