# E-JIP PERCEIVED PERFORMANCE V2.4 — MAP MARKER DATA PATH

> 선행: `PERCEIVED_PERFORMANCE_V2_3_MAP_RENDER.md`.
> 범위: 마커 **데이터 경로** — 초기 lawdCd 결정 / 지역 시퀀싱 / 마커 요청 시작 / 응답.
> **DB·schema·migration 변경 없음. bulk write 없음. durable 버스 캐시 없음.**
> canonical identity / 거래·취소 의미 / Score 로직 변경 없음.

측정 조건은 이 문서 전체에서 동일하다:
**Production / Slow 4G(1.6Mbps, RTT 150ms) / CPU 4x / cold cache / 390px / n=6~8 중앙값.**
직접 진입은 결정론을 위해 **위치 권한 거부 + ipinfo.io 차단**으로 고정했다(그래야 center가
항상 기본값에 머물러 BEFORE/AFTER가 같은 경로를 탄다).

---

## 1. 전제부터 확인했다 — "data ready가 느리다"는 진단은 틀렸다

V2.4 지시는 "남은 지배 비용은 data ready ~2.6s"에서 출발한다. 그런데 §1이 못박은 대로
**역지오코딩을 원인으로 가정하지 않고** 먼저 재보니, 2.6초의 정체가 전혀 달랐다.

### 1.1 BEFORE 파이프라인 (lawdCd가 URL에 있는 진입)

```
   317ms  인라인 스크립트 실행 가능 시점(HTML 파싱 중)
   935ms  DOMContentLoaded
 2,236ms  마커 요청 **시작**        ← 여기가 문제
 2,618ms  마커 응답 완료
 3,335ms  첫 지도 타일
 3,930ms  첫 마커 / usable
```

같은 실행에서 함께 잰 값:

| 항목 | 실측 | 판정 |
|---|---|---|
| 마커 API 서버 시간(`responseStart - requestStart`) | **20~23ms** | 서버는 느리지 않다 |
| CDN | `X-Vercel-Cache: HIT`, Age ~200s, brotli | 캐시 정상 |
| CDN cold(새 캐시 키) | MISS, TTFB **205ms** | cold도 느리지 않다 |
| `coord2RegionCode` 호출 수 | **0회** | 이 경로엔 역지오코딩이 아예 없다 |

**즉 2.6초 중 2.2초는 "요청을 걸기까지의 대기"였다.** 데이터가 늦게 오는 게 아니라
요청을 늦게 건다. 원인은 `fetch`가 client effect 안에 있어 **JS 177KB 다운로드 +
hydration**이 끝나야 출발하기 때문이다.

### 1.2 결정적 확인 — 데이터를 공짜로 만들어도 usable이 안 변한다

추정을 배제하기 위해, 마커 응답을 **네트워크 없이 즉시** 돌려주도록 가로채고
(Playwright route fulfill, 실제 payload 그대로) 나머지 조건은 동일하게 뒀다.

| 부산진구 | txEnd | firstTile | **firstChip** |
|---|---|---|---|
| 그대로 | 2,656ms | 3,336ms | **3,658ms** |
| 데이터 즉시 제공 | 2,262ms | 3,277ms | **3,666ms** |

**데이터를 394ms 앞당겨도 usable은 8ms 차이(=측정 잡음)로 그대로다.**
lawdCd 진입에서 data ready는 **이미 임계경로가 아니었다** — 응답(2,6초)이 첫 타일(3,3초)
보다 먼저 도착하므로, 마커는 데이터가 아니라 **지도 준비**를 기다리고 있었다.

직접 진입에서도 같은 실험을 했다: txEnd 3,885 → 3,502ms인데 firstChip은 3,971 → 3,898ms
(**−73ms**). 응답을 빠르게 해도 소용없고, **요청 시작 시점(txStart 3,4초)** 자체가
문제라는 뜻이다.

### 1.3 직접 진입(/map, 파라미터 없음)의 추가 비용

```
   261ms  인라인 스크립트 실행 가능
   894ms  DOMContentLoaded
 3,208ms  첫 지도 타일
 3,435ms  마커 요청 시작        ← hydration + isMapReady + 지오코딩을 다 기다린 뒤
 4,305ms  마커 응답 완료
 4,414ms  첫 마커 / usable
```

여기서는 `coord2RegionCode`가 **1회** 호출된다(실측 약 195ms). 그런데 그 호출이 알아내는
값은 **상수**였다: 기본 center `(35.0979, 129.0244)` → `26140`(서구). 실제로 요청 URL을
찍어보면 `coord2regioncode.json?x=129.0244&y=35.0979` → `lawdCd=26140`으로,
`parseMapStateFromSearchParams`가 이미 fallback으로 쓰던 `'26140'`과 같은 값이다.
**이미 아는 지역을 다시 알아내려고 서드파티를 왕복한 것이다.**

---

## 2. 근본 원인

1. **요청이 hydration 뒤에 있다** (모든 진입). `fetch`가 client effect 안에 있어
   JS 다운로드 + hydration이 끝나는 2.2초까지 출발하지 못한다.
2. **기본 지역을 상수로 알고 있으면서 역지오코딩으로 다시 알아낸다** (직접 진입).
   기본 center와 기본 lawdCd의 관계가 코드 두 곳(page의 좌표 리터럴, share의 `'26140'`
   fallback)에 흩어져 있어서 "이미 안다"는 사실이 코드에 드러나 있지 않았다.

서버·DB·MOLIT·CDN은 원인이 아니다(§4/§5 참고).

---

## 3. 구현

### 3.1 요청을 HTML 파싱 시점으로 당긴다 (`src/app/map/layout.tsx`)

인라인 스크립트는 hydration을 기다리지 않는다. 같은 요청을 약 320ms에 출발시키고,
응답은 `window.__EJIP_APT_BOOT__`에 **promise로만** 얹어둔다.

**state는 절대 건드리지 않는다.** V2.2에서 이미 확인된 제약이다 — 조기에 state를 채우면
지도 인스턴스 생성/타일 로드와 오버레이 렌더가 한 커밋에 겹쳐 오히려 느려졌다
(첫 마커 2,190 → 3,254ms). 렌더 순서는 그대로 두고 네트워크만 앞세운다.

URL은 페이지와 **같은 함수**(`aptMarkerRequestPath`)로 만든다. V2.2에서 SDK preload와
실제 주입 URL이 한 글자 달라 두 번 받은 적이 있어 단일 지점을 강제했다.

### 3.2 기본 지역을 상수로 드러낸다 (`src/lib/map-marker-share.ts`)

```ts
export const DEFAULT_LAWD_CD = '26140';
export const DEFAULT_MAP_CENTER = { lat: 35.0979, lng: 129.0244 } as const;
export function isDefaultMapCenter(center): boolean   // 정확히 일치할 때만 true
```

초기 로드에서 center가 **아직 기본값 그대로**일 때만 역지오코딩을 건너뛴다:

```ts
const knownLawdCd =
  initialShareLawdCdRef.current ?? (isDefaultMapCenter(center) ? DEFAULT_LAWD_CD : undefined);
refreshActiveLayers(center.lat, center.lng, knownLawdCd);
```

GPS/IP가 center를 옮겼거나 공유 링크로 들어왔으면 이 분기를 타지 않으므로 **기존
역지오코딩 경로가 그대로** 유지된다. 근사 비교가 아니라 정확 일치를 쓰는 이유는,
근사로 보면 "기본값 근처의 다른 구"까지 서구로 단정해 엉뚱한 구의 마커를 부를 수 있기
때문이다. 패닝·지역 이동에서 쓰이는 `resolveLawdCd`는 손대지 않았다.

### 3.3 다른 구의 데이터를 절대 쓰지 않게 하는 장치

부트 promise는 **lawdCd가 정확히 일치할 때만** 채택한다. 기본 지역 응답을 받아뒀는데
사용자가 다른 구를 보고 있으면 그 응답은 버린다(쓰면 다른 구의 마커를 보여주게 된다).
GPS가 다른 지역을 돌려준 경우 부트 요청 1건이 낭비되지만, 화면에는 언제나 올바른 구만
나온다 — 정확도를 속도와 바꾸지 않는다.

판정 규칙은 순수 함수 `bootPrefetchLawdCd()`로 분리해 테스트한다(`map-boot-prefetch.test.mjs`,
6/6 pass): 아파트 레이어가 꺼진 링크(`layers=-`, `layers=officetel`)에서는 받지 않고,
5자리 숫자가 아닌 lawdCd는 요청하지 않는다.

---

## 4. 마커 서버 경로 (§4)

- 경로 판정: **B. MOLIT live path.** `/api/transactions`는 `fetchMolitData`로 12개월치를
  병렬 조회한다(DB-first 아님).
- 성능: warm `X-Vercel-Cache: HIT` 시 클라이언트 체감 서버 시간 **20~23ms**,
  cold(새 캐시 키) **TTFB 205ms**. 세 구 모두 동일 수준.
- **바꾸지 않았다.** 성능상 바꿀 이유가 없고, DB-first 전환은 커버리지 근거와 schema
  판단이 필요한 별도 결정이다. 근거 없이 완전성을 주장하지 않는다.

## 5. 캐시 경로 (§5)

- `MARKER_SUCCESS_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=1800'`이
  **완전 성공 응답에만** 붙고, 부분 실패/실패는 `no-store`다(`cacheHeaders(fullySuccessful)`).
  실패·부분 응답·거짓 빈 상태를 캐시하지 않는다는 원칙이 코드로 지켜지고 있다.
- 실측: 반복 요청 `HIT`(Age 203/204/205s), 새 캐시 키 `MISS` 후 정상 채워짐.
- 쿼리 파라미터는 4개 고정(`type/lawdCd/months/fields`)이라 키 파편화가 없다.
- **캐시는 원인이 아니었고, 바꾸지 않았다.**

---

## 6. AFTER — Production 실측

| 진입 | txStart | txEnd(data ready) | geo 호출 | usable |
|---|---|---|---|---|
| 부산진구(lawdCd) | 2,236 → **938** | 2,618 → **1,558** | 0 → 0 | 3,930 → 3,870 |
| 중구(lawdCd) | 2,207 → **932** | 2,423 → **1,186** | 0 → 0 | 3,654 → 3,603 |
| 해운대구(lawdCd) | 2,232 → **934** | 2,596 → **1,456** | 0 → 0 | 3,649 → 3,666 |
| 직접 진입(기본 지역) | 3,435 → **959** | 4,305 → **1,341** | **1 → 0** | 4,414 → **3,655** |

- **마커 요청 시작: 2.2~3.4초 → 0.93~0.96초.**
- **data ready: 2.42~4.31초 → 1.19~1.56초** (§9 "2.6초보다 확실히 아래" 달성).
- **직접 진입 usable 4,414 → 3,655ms (−759ms)**, 역지오코딩 왕복 제거.
- lawdCd 진입의 usable은 거의 그대로다 — **§1.2에서 미리 증명한 그대로다.**
  그 경로에서 data ready는 이미 임계경로가 아니었으므로, 데이터를 앞당겨도 usable은
  움직이지 않는다. 이건 이번 변경의 실패가 아니라 **측정이 예측한 결과**다.

txStart가 인라인 실행 시점(약 320ms)이 아니라 약 935ms인 이유: Slow 4G에서 대역폭이
JS 번들·SDK preload와 경쟁하기 때문이다. 그래도 2,236 → 938ms로 앞당겨진다.

### 6.1 §9 목표 대비 — 정직한 판정

| 목표 | 결과 |
|---|---|
| data ready를 현재 ~2.6초보다 확실히 아래로 | **달성** (1.19~1.56초) |
| 마커 요청 시작 ≤300ms | **미달** (약 935ms — 대역폭 경쟁) |
| 부산진구 usable ≤3s | **미달** (3,870ms) |
| 중구 ≤2.5s | **미달** (3,603ms) |
| 해운대구 ≤3s | **미달** (3,666ms) |

**usable 목표는 데이터 경로로는 달성할 수 없다** — §1.2의 실험이 이를 직접 보여준다
(데이터를 공짜로 줘도 usable 불변). 남은 임계경로는 다음과 같다:

```
   320ms  인라인 스크립트
   940ms  DOMContentLoaded
 1,200~1,560ms  마커 데이터 준비 완료   ← 여기서 대기가 끝난다
 ~2,250ms  hydration 완료(JS 177KB / 13파일, 4x CPU)
 3,255~3,311ms  첫 지도 타일
 3,603~3,870ms  첫 마커 / usable
```

**data ready(1.5초)와 첫 타일(3.3초) 사이의 약 1.8초가 다음 병목이며, 그것은
JS 다운로드·hydration·지도 인스턴스 생성·타일 로드다.**

---

## 7. QA 결과 (Production)

| 플로우 | 결과 |
|---|---|
| A 직접 진입 | PASS — chips 24, tx 1회, **geo 0회**, lawdCd 26140 |
| B home → map(클라이언트 내비게이션) | PASS — chips 24, tx 1회, lawdCd 26140 |
| C URL 복원(부산진구) | PASS — chips 29, tx 1회, geo 0회, lawdCd 26230 |
| D 공유 링크 + aptSeq | PASS — chips 29, `aptSeq=26230-1733` 유지 |
| E 구 경계 넘어 패닝 | PASS — 새 지역 26470 조회, **geo 0→3회**(이동 시엔 정상 사용) |
| G/H 아파트·오피스텔 토글 | PASS (V2.3 스위트 57/57 재실행) |

- **중복 초기 요청 없음**: 모든 진입에서 `/api/transactions` 정확히 1회.
- **불필요한 요청 없음**: `layers=-` 0회, `layers=officetel` 0회.
- **B(home→map)는 클라이언트 사이드 내비게이션이라 인라인 부트 스크립트가 실행되지
  않는다.** 그 경로는 예전과 동일하게 동작하며(마커 정상, 요청 1회) 속도 이득만 없다 —
  회귀 아님.

### 7.1 V2.3 렌더 회귀 없음 (§8)

- V2.3 QA 스위트 **57/57 PASS**(폭 360/390/430/1280 × 3개 구).
- 뷰포트 컬링 + `keepIds` 전용 테스트를 Production에서 재실행: 선택 마커가 화면 밖
  (DOM에 없음)이어도 카드와 `aptSeq=26230-1733` 유지 — V2.3과 **단계별로 동일**.

---

## 8. 빌드 / 품질

| 항목 | 결과 |
|---|---|
| `npx eslint` (변경 3개 파일) | 0 errors |
| `npx tsc --noEmit` | **src 0건.** `scripts/`·`tmp/` 14개 파일은 기존 오류(FAIL_EXISTING_SCRIPT_ERRORS) |
| `npm run build` | 성공 |
| 지도 단위 테스트 | **59 pass / 0 fail** (기존 53 + 신규 6) |

`src/lib/map-marker-share.test.ts`는 여전히 `ERR_MODULE_NOT_FOUND`로 실행되지 않는다 —
확장자 없는 상대 import를 node 네이티브 ESM 로더가 해석하지 못하는 **기존 문제**이며
(import 해석 단계에서 실패해 이번 변경 코드에 도달조차 하지 않는다), 이번 STEP에서
건드리지 않았다. 신규 테스트는 같은 함정을 피해 `.ts` 확장자를 붙였다.

> 권고(범위 밖): 그 파일의 import에 `.ts`를 붙이면 20여 개 테스트가 되살아난다.

---

## 9. 남은 항목

- **P0 없음.**
- **P1 — 다음 병목은 JS/hydration/지도 초기화다.** JS 177KB / 13파일이 4x CPU에서
  hydration을 약 2.25초까지 밀고, 첫 타일이 3.3초다. usable 목표(≤3s)는 이 구간을
  줄여야 달성된다. 데이터 경로로는 불가능함을 §1.2에서 증명했다.
- 직접 진입에서 GPS가 기본 지역과 다른 구를 돌려주면 부트 요청 1건(15~33KB)이 낭비된다.
  화면에는 항상 올바른 구만 나오므로 정확도 문제는 없다.

---

## 10. 변경 파일

- `src/app/map/layout.tsx` — 부트 프리페치 인라인 스크립트
- `src/lib/map-marker-share.ts` — `DEFAULT_LAWD_CD` / `DEFAULT_MAP_CENTER` /
  `isDefaultMapCenter` / `aptMarkerRequestPath` / `bootPrefetchLawdCd`
- `src/app/map/page.tsx` — 부트 promise 채택(lawdCd 정확 일치 시에만), 기본 지역일 때
  역지오코딩 생략, 기본 center 상수화
- `src/lib/map-boot-prefetch.test.mjs` — 부트 판정 규칙 테스트(신규)
- `docs/development/PERCEIVED_PERFORMANCE_V2_4_MAP_DATA_PATH.md` — 이 문서
