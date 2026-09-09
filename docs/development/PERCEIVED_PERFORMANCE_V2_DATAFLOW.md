# E-JIP PERCEIVED PERFORMANCE V2 — COORDINATE / DATAFLOW

> 선행 문서: `PERCEIVED_PERFORMANCE_AUDIT_V1.md`(측정/병목 목록),
> `PERCEIVED_PERFORMANCE_V2_QUICKWIN.md`(인위적 지연 제거 + 버스 CDN 캐시).
> 이 STEP은 감사 V1의 **P0-1 / P1-5 / P1-6 / P1-7 / P1-10**을 구조적으로 처리한다.

---

## 1. 목적

상세페이지의 **위치(좌표)와 실거래 데이터가 흐르는 방식**을 바꾼다.

두 가지가 같은 뿌리에서 나온 문제였다.

- 화면의 위치 소비자 9개가 **각자 런타임에 위치를 추측**했다 → 느리고, 틀릴 수 있었다.
- 같은 실거래 엔드포인트를 **겹치는 기간으로 5번** 호출했다 → 느리고, 재방문에 또 반복했다.

성능 개선이 목적이지만, 이 STEP에서 실제로 더 크게 바뀐 것은 **정확성**이다.
없어진 경로 중 하나는 "이름으로 검색한 첫 번째 결과를 이 단지의 좌표로 채택"이었고,
그건 AGENTS.md의 *"이름만으로 아파트를 재식별하지 않는다"*에 정면으로 어긋났다.

---

## 2. BEFORE → AFTER 아키텍처

### 2.1 좌표

**BEFORE**

```
상세페이지
  └ primaryAddress = `${regionName || firstTrade.dong} ${displayName}`   ← 주소가 아님
        │
        ├ KakaoPlaces ×6 (환경 탭)  ─┐
        ├ KakaoPlaces ×2 (교통 탭)   ├─ 각자 geocoder.addressSearch(primaryAddress)
        ├ KakaoPlaces ×1 (학군)      │     → 실측 10/10 total_count=0 실패
        ├ BusAccessCard              │     → ps.keywordSearch(primaryAddress) 폴백
        └ KakaoMapEmbed(mode=address)┘        → 결과 75건 중 **첫 번째를 좌표로 채택**
                                              (다른 장소를 집을 수 있는 구조)
  regionName(외부 regcode 프록시, 1,370ms)이 늦게 도착 → primaryAddress 문자열 변경
        → 위 effect 전부 재실행 → 같은 주소를 **18회** 지오코딩, 버스 카드가 skeleton으로 복귀
```

**AFTER**

```
GET /api/apt/[name]?...&withCoordinate=1
  └ resolveCanonicalCoords(prisma, { aptSeq, lawdCd, dong, name })   ← 서버에서 1회
        1순위: aptSeq 정확 일치 (MOLIT canonical id)
        2순위: sggCd + umdName + 정규화 단지명 **완전일치** (동 경계를 넘지 않음)
        실패:  { status: 'NO_COORDINATE', reason }   ← 추측하지 않는다
  └ 응답 envelope에 coordinate 동봉
        │
상세페이지 canonicalCoord (단 하나)
        ├ LivingEnvironmentPanel  → KakaoPlaces(coords)   ← 지오코딩 없음
        ├ NeighborhoodInfoPanel   → KakaoPlaces(coords)
        ├ BusAccessCard(coords)   → 즉시 /api/transit/bus-stops
        ├ SchoolDistrictPanel     → KakaoPlaces(coords)
        └ 지도/로드뷰 모달        → KakaoMapEmbed(mode="coordinate")
        └ "지도에서 위치 보기" 딥링크 → 클릭 즉시 이동(클릭 시점 지오코딩 제거)
```

### 2.2 실거래

**BEFORE** — 겹치는 5회 (`period=12 ⊂ 36 ⊂ 60`)

```
apt-client      /api/apt/{name}?type=apt&period=12
PriceTrendChart /api/apt/{name}?type=apt&period=36
PriceTrendChart /api/apt/{name}?type=rent&period=36
InvestmentMetrics /api/apt/{name}?type=apt&period=60
InvestmentMetrics /api/apt/{name}?type=rent&period=60
기간 전환(1년/3년/5년)마다 +2회
```

**AFTER** — 3회, 기간 전환은 0회

```
apt-client        /api/apt/{name}?type=apt&period=12&withCoordinate=1   ← critical path 유지
PriceTrendChart  ─┐
InvestmentMetrics ┴ /api/apt/{name}?type=apt&period=60      (fetchDetailTrades가 합침)
                    /api/apt/{name}?type=rent&period=60
PriceTrendChart의 1년/3년 view = narrowTradeWindow(60개월 응답)
```

> parent 요청을 60개월로 넓히지 **않은** 이유: 라우트는 12개월씩 청크로 끊어 순차 조회한다
> (`route.ts` chunkSize=12). period=60은 cold일 때 청크 5개가 순차로 돌아 첫 화면
> critical path가 그만큼 늦어진다. 첫 화면은 12개월 그대로 두고, 화면 아래쪽 소비자
> 둘만 60개월 창을 공유한다.

---

## 3. canonical 좌표의 출처와 신뢰 규칙

**출처는 하나다**: `ApartmentMaster.latitude / longitude`.
적재 시점에 검증해 저장한 값이고(schema 주석 M2 §I), 지도 마커 경로
(`map-marker-coords.ts`)가 이미 같은 원천을 쓰므로 화면 간 좌표가 어긋나지 않는다.

`src/lib/apt-canonical-coords.ts`:

| 규칙 | 내용 |
|---|---|
| identity 1순위 | `aptSeq` 정확 일치. `deriveCanonicalAptSeq`가 **후보가 하나로 좁혀질 때만** 값을 준다 |
| identity 2순위 | `sggCd` + `umdName` + 정규화 단지명 **완전일치**. dong 경계를 절대 넘지 않는다 |
| aptSeq로 찾았는데 좌표가 없으면 | 이름 검색으로 **내려가지 않는다** (그건 "이름이 비슷한 무언가"의 좌표다) |
| 좌표가 렌더 불가 값이면 | `MASTER_WITHOUT_COORDS` (0,0 널섬 포함) |
| 못 찾으면 | `NO_COORDINATE` + reason을 그대로 응답에 싣는다 |
| 좌표가 없을 때 화면 | "위치 정보를 확인할 수 없습니다" — 주소 모드로 **폴백하지 않는다** |

**좌표는 단지의 속성이지 조회 조건의 속성이 아니다.**
한 번 확정되면 이후 응답이 좌표를 못 실어와도 지우지 않는다(`adoptCoordinate`).
그러지 않으면 매매↔전월세 토글 시(그 계열에 거래가 없어 identity가 약해지면) 이미 떠 있던
교통/주거환경 카드가 통째로 사라졌다 되돌아온다. 단지가 바뀌면 페이지가 새로 마운트되므로
이 "한 번 확정되면 유지"는 단지 경계를 넘지 않는다.

### 제거된 폴백 (되돌리면 안 되는 것)

1. `geocoder.addressSearch("지역명 + 단지명")` — 주소가 아니라 실측 10/10 실패했다.
2. `ps.keywordSearch(...)` **첫 결과 채택** — 이름 기반 재식별. 다른 단지를 집을 수 있었다.
3. 지도/로드뷰 모달의 `mode="address"` — 위 두 경로를 그대로 탄다.

`BusAccessCard`는 이제 Kakao SDK를 **import조차 하지 않는다**.

---

## 4. 완전성(trust) 계약을 좁은 창에서 다시 계산하는 이유

60개월 응답을 그냥 잘라 쓰면 `partial / failedMonths / monthsRequested / monthsSucceeded`가
**60개월 요청을 설명하는 값**이라 좁은 창에 그대로 붙이면 양방향으로 거짓이 된다.

- 실패한 달이 좁은 창 **밖**인데 1년 화면이 "일부를 못 불러왔다"고 말하거나,
- 실패한 달이 좁은 창 **안**인데 그 사실이 묻히거나.

`src/lib/detail-trade-window.ts`의 `narrowTradeWindow`가 자르는 것과 함께 완전성을
그 창 기준으로 다시 계산한다. `failedMonths`가 YYYYMM 목록이라 추정이 아니라 **정확한
교집합 연산**이다.

| 상황 | 결과 |
|---|---|
| 대상 창 ⊇ 원본 창 | 원본을 그대로 반환(손실 없음) |
| 원본이 전체 실패(apiError) | 그대로 유지 — 상태를 완화하지 않는다 |
| 실패 달이 창 밖 | `partial=false` (없는 실패를 만들지 않는다) |
| 실패 달이 창 안 | `partial=true`, `failedMonths`는 교집합만 |
| 대상 창의 **모든** 달이 실패 | `apiError` — 거래 0건을 "거래 없음"으로 보여주지 않는다 |
| 서버 메타데이터 불일치(`monthsRequested ≠ sourcePeriod`) | 재계산하지 않고 원본 값 유지 — **서버가 말한 것보다 더 완전하다고 주장하지 않는다** |

`src/lib/detail-trade-window.test.ts` — 14개 케이스 전부 PASS.

---

## 5. 재방문 캐시(§7)의 안전 규칙

`src/lib/detail-trade-cache.ts`. 감사 V1 P1-10의 "정확성 주의"를 그대로 지킨다.

- **실패는 캐시하지 않는다.** 캐시하면 다음 방문에서 "성공한 빈 결과"로 굳어져 FAILED가 ZERO로 접힌다.
- **부분 실패(partial)도 캐시하지 않는다.** 일시적 MOLIT 실패가 TTL 동안 고착되면 안 된다.
- 즉 **완전하게 성공한 응답만** 캐시한다 → 캐시된 것은 정의상 `partial=false, apiError=null`이라
  완전성 메타데이터가 캐시 때문에 왜곡될 여지가 없다.
- TTL **5분**. 서버가 이미 갖고 있는 MOLIT 월 캐시(`molit-month-cache.ts`, **1시간**)보다 훨씬 짧다 —
  즉 이 캐시는 서버가 같은 순간에 돌려줬을 값보다 더 오래된 값을 만들지 않는다.
- 저장 위치는 **모듈 스코프 메모리뿐**. sessionStorage/localStorage를 쓰지 않으므로 탭을 닫으면
  사라지고 디스크·다른 탭에 남지 않는다. 이 라우트들은 인증/세션에 의존하지 않는 공개 read 경로다.
- 키에 `aptName / type / period / lawdCd / dong`이 모두 들어가 **다른 단지의 응답이 섞일 수 없다**.
- `withCoordinate`는 **일부러 키에 넣지 않는다** — 넣었더니 같은 거래 데이터가 두 벌로 캐시돼
  매매↔전월세 토글로 돌아왔을 때 같은 데이터를 다시 받아왔다(실측 후 수정).
- in-flight 중복 제거를 함께 해서 PriceTrendChart와 InvestmentMetrics의 동시 요청이 하나로 합쳐진다.

---

## 6. 측정

### 6.1 환경 (감사 V1과 동일한 방법)

- 브라우저: 설치된 Chrome을 playwright-core로 구동(headless), Pixel 7 UA, 390×844
- 네트워크: CDP `Network.emulateNetworkConditions` **4G (9Mbps / 60ms RTT)**
- CPU: `Emulation.setCPUThrottlingRate` **4x**
- 모든 시각은 페이지 내부 단일 `performance.now()` 시계
- 버스 흐름은 서로 다른 6개 구의 **8개 단지(n=8)**

**BEFORE = Production** `https://real-estate-app-park11.vercel.app` (= `origin/main` 8059dcf,
즉 QUICK WIN까지 반영되고 이 STEP은 반영되지 않은 상태).
**AFTER = 로컬 production 빌드**(`next build && next start`).

> **환경 차이를 정직하게 적는다.** 요청 수 / 행 수 / 디코딩 바이트는 환경과 무관해 그대로
> 비교할 수 있다. **wall-clock은 그렇지 않다** — 로컬에는 Vercel CDN이 없어서, QUICK WIN에서
> 넣은 버스정류장 CDN 캐시 이득을 AFTER 쪽이 받지 못한다. 아래에서 시간 항목은 구간별로
> 나누어 어느 부분이 이 STEP의 결과이고 어느 부분이 환경 차이인지 구분해 적는다.

### 6.2 상세페이지 실거래 요청 (§6 / 감사 P1-6)

| 항목 | BEFORE | AFTER | 변화 |
|---|---|---|---|
| 최초 진입 `/api/apt/[name]` 실거래 요청 | **5** | **3** | −40% |
| 그 요청들의 디코딩 바이트 | **456,002 B** | **246,892 B** | **−45.9%** |
| 시세추이 기간 전환 3회(1년/5년/3년)의 요청 | **6** (2회×3) | **0** | −100% |
| 상세 1회 진입당 `ApartmentMaster` 좌표 조회 | (전 요청마다 발생하는 구조였음) | **1** | — |

BEFORE 실측 URL — 감사 §5.1 타임라인과 정확히 일치:

```
type=apt&period=12 / type=apt&period=36 / type=rent&period=36
type=apt&period=60 / type=rent&period=60
```

AFTER 실측 URL:

```
type=apt&period=12&withCoordinate=1     ← parent(critical path)
type=apt&period=60                      ← 차트 + 투자지표 공유
type=rent&period=60                     ← 차트 + 투자지표 공유
```

`withCoordinate=1`은 정확히 **1회**만 나간다(매매/전월세·기간 토글을 거쳐도 1회 유지 — 실측).

### 6.3 재방문 / forward (§7 / 감사 P1-10)

상세 → (앱 안 CTA "비슷한 단지와 비교" 클릭, 클라이언트 라우팅) → back → 상세.

| 항목 | BEFORE | AFTER |
|---|---|---|
| 재진입 시 전체 API 요청 | **12** | **7** |
| 그중 실거래 요청 | **5** | **0** |

AFTER 재진입 시 남는 7건: `log/heartbeat`, `community/posts`, `apt/{name}/score`,
`apt/{name}/info` ×2, `my/recent/sync`, `log/view`.
분석/기록 성격(heartbeat·view·recent/sync)은 **다시 나가는 게 맞다**.
`score`/`info`는 다음 STEP 후보다(§9).

### 6.4 지도 마커 payload (§8 / 감사 P1-5)

같은 로컬 서버에서 두 코드 경로를 같은 순간에 호출해 비교했다(데이터·시점 동일).

| lawdCd | BEFORE 행 / 바이트 | AFTER 행 / 바이트 | 감소 |
|---|---|---|---|
| 26350 해운대구 | 4,579 / **1,942,705 B** | 274 / **63,661 B** | **−96.7%** |
| 26230 부산진구 | 4,531 / 1,950,760 B | 356 / 83,645 B | −95.7% |
| 26110 중구 | 125 / 53,337 B | 51 / 12,070 B | −77.4% |

**정확성 검증** — 서버 `fields=marker` 결과가 클라이언트 dedup 결과와 **완전히 동일**한지
프로그램으로 대조했다(11개 필드 전부, 순서 포함):

```
lawdCd=26350: client-dedup=274 server-marker=274 identicalOrder=true identicalSet=true
              navigation identity: missing=0 extra=0
lawdCd=26230: client-dedup=356 server-marker=356 identicalOrder=true identicalSet=true
              navigation identity: missing=0 extra=0
```

완전성 메타데이터(`partial/monthsRequested/monthsSucceeded/failedMonths`)도 두 경로가 동일하다.

`map/page.tsx`의 클라이언트 dedup 루프는 **그대로 남겼다** — 이미 걸러진 목록에 같은
필터를 다시 적용해도 결과는 같으므로(멱등), 배포 중 구/신 응답이 섞여도 화면이 흔들리지 않는다.

### 6.5 버스 cold path (§9 / 감사 P0-2, n=8)

클릭 → 탭 활성 → 버스 요청 시작 → 응답 → 첫 버스 카드, 구간별 분해:

| 구간 | BEFORE (Production) | AFTER (로컬) |
|---|---|---|
| **A. 클라이언트 사전 지연** (클릭 → 버스 요청 시작) | median **601ms** / worst **1,428ms** | median **24ms** / worst **182ms** |
| **B. E-JIP 서버 처리** | (C에 포함 — 라우트가 TAGO를 그대로 기다린다) | 동일 |
| **C. TAGO 상류 지연** (요청 duration) | median 2,061ms / worst 2,344ms | median 1,910ms / worst **17,999ms** |
| **D. 렌더** (응답 → 첫 카드) | median 20ms | median 31ms |
| 첫 버스 카드(perceived, cold) | median 2,458ms / worst 3,722ms | median 2,333ms / worst 18,051ms |
| 탭 활성(클릭 피드백) | median 14ms | median 25ms |
| 교통 재진입(warm) | median 19ms, 신규 요청 0 | median 19ms, 신규 요청 0 |

**A 구간이 이 STEP의 결과다: 601ms → 24ms (−96%).**
BEFORE의 A 구간은 Kakao SDK 로드 → 반드시 실패하는 `addressSearch` → `keywordSearch` 폴백
3단계였고, 그게 통째로 없어졌다.

**C 구간의 AFTER worst 17,999ms는 이 STEP과 무관하다.** 로컬에는 Vercel CDN이 없어
QUICK WIN에서 넣은 버스정류장 CDN 캐시가 전혀 걸리지 않고, 모든 요청이 TAGO 원본까지 간다.
BEFORE(Production)는 그 캐시 이득을 받은 수치다.

### 6.6 §5의 핵심 질문에 대한 답

> "canonical 좌표/dataflow 정리 후, 남은 worst-case >5초는 거의 전부 TAGO 상류 지연인가?"

**예.** AFTER의 첫 버스 카드 시간은 구성상 `A(24ms) + C(TAGO) + D(31ms)`이고,
클라이언트가 기여하는 몫은 **55ms 수준**이다. 5초를 넘는 케이스(a5 18.0초, a6 5.8초)는
전부 C 구간, 즉 TAGO 상류 응답 시간이다. 클라이언트 쪽에는 더 깎을 것이 남아 있지 않다.

**그래서 durable(DB/schema 기반) 버스 캐시는 여전히 필요하다** — 다만 이 STEP에서는
구현하지 않았다(DB/schema 변경은 별도 승인 STEP).

### 6.7 지오코딩 횟수

| 항목 | BEFORE (Production) | AFTER |
|---|---|---|
| 상세 최초 로드 시 Kakao geocode 호출 | median **6** | **0** |
| 교통 탭 클릭 시 추가 geocode 호출 | median **3** | **0** |
| 1회 여정 합계 | **9** | **0** |

AFTER의 0은 **구조적으로 보장된다**: `KakaoPlaces`/`BusAccessCard`가 `Geocoder`를 아예
생성하지 않고(grep 확인), `BusAccessCard`는 Kakao SDK를 import하지도 않으며,
지도/로드뷰는 `mode="coordinate"`로 열려 Geocoder/Places를 만들지 않는다.

### 6.8 지도 진입 (BEFORE 기준선)

| 항목 | BEFORE (Production, 26110) |
|---|---|
| TTFB | 96ms |
| FCP | 816ms |
| 마커 노출 | 3,068ms |
| 오피스텔 레이어 ON / OFF / 재ON 요청 | 1 / 0 / 0 (재ON은 캐시) |

AFTER의 지도 end-to-end 시간은 **로컬에서 측정할 수 없었다**(§8) — payload 감소분만
확정 측정했다(§6.4).

---

## 7. 회귀 QA

로컬 production 빌드, 360 / 375 / 390 / 430 / 1280 전 폭.

| 항목 | 결과 |
|---|---|
| 가로 overflow | 전 폭 **없음** (BEFORE Production과 동일) |
| 시세추이 1년/3년/5년 전환 후 가격 렌더 | 전 폭 **정상**, 빈 상태·거짓 "일부 실패" 안내 없음 |
| 투자지표 4종(매매가/전세가/전세가율/필요 갭) | 전 폭 정상 (11억 8,000만 / 보 6억 6,000만 / 55.9% / 5.2억) |
| 버스 카드 | 전 폭 렌더, "위치를 찾을 수 없어…"(구 폴백 문구) 미출현 |
| 좌표 없음 문구 오출현 | 없음 |
| 하단 고정 바가 콘텐츠를 덮음 | 없음 |
| 작은 터치 타깃 수 | BEFORE 13 / AFTER 13 (모바일), 20 / 20 (1280) — **변화 없음(기존값)** |
| 매매 ↔ 전월세 토글 시 위치 소실 | **없음** (`locationSurvivedToggle: true`) |
| 상세 → 다른 화면 → back 재진입 | 실거래 재요청 0건, 화면 정상 |
| 콘솔 오류 | Kakao SDK 401(로컬 도메인 미등록)뿐 |

`npx tsx --test src/lib/detail-trade-window.test.ts` → **14 pass / 0 fail**.

---

## 8. Production 검증 (배포 후 실측)

`main` @ `1500b04` 배포 완료 후 실제 도메인(`real-estate-app-park11.vercel.app`)에서
§8의 Kakao 의존 항목을 전부 검증했다. 배포 반영은 두 서버 신호로 확인했다
(`fields=marker` 슬림 응답 동작, `withCoordinate=1` 응답의 coordinate 필드).

### 8.1 Kakao 인증 / 좌표 (360 / 390 / 430 / 1280, 단지 3곳)

| 항목 | 결과 |
|---|---|
| Kakao SDK 로드 | **정상** (401 없음) |
| `sdk.js` 로드 횟수 | **1회/페이지** — 중복 초기화 없음 |
| `addressSearch`(지오코딩) 호출 | **0회** — 전 폭·전 단지 |
| 단지명으로 한 `keywordSearch` | **0회** — 이름 기반 재식별 경로 완전 소멸 |
| 실제 keyword 질의 | `공원` / `KTX` / `기차역` (좌표 주변 POI 검색, 정상) |
| `categorySearch` | 18회 (좌표 주변 POI, 정상) |
| 응답 coordinate | 3단지 모두 `source=APT_SEQ`, `geocodeQuality=exact` |

### 8.2 흐름별 QA

| 흐름 | 결과 |
|---|---|
| A. 상세 → 교통 → 지하철 POI | **PASS** — 지하철/버스 렌더, "위치를 찾을 수 없어…"(구 폴백 문구) 미출현 |
| B. 상세 → 지도 → 로드뷰 → 지도 | **PASS** — 지도(타일 12~15) / 로드뷰(타일 6) 모두 렌더, 재진입 정상, 좌표 없음 문구 오출현 없음 |
| C. 홈 → 지도 → 아파트 마커 | **PASS** — `fields=marker` end-to-end 확인(해운대구 63,660 B / 중구 12,069 B) |
| D. 지도 → 마커 → 상세 → back | **부분** — 마커 클릭 identity는 정확(아래), back 시 지도 view 복원은 §9 참고 |
| E. 지도 → 오피스텔 ON/OFF/ON | **PASS** — 요청 1 / 0 / 0 (재ON은 캐시). 배포 전과 동일 |
| §6. 매매 ↔ 전월세 토글 시 좌표 유지 | **PASS** — 전 폭·전 단지에서 교통/주거환경 카드 유지, 좌표 없음 문구 미출현 |

**마커 → 상세 identity(가장 중요한 정확성 항목)**: 지도에서 `더샵센텀파크2차 10.65억`
마커를 클릭 → `/apt/더샵센텀파크2차?lawdCd=26350&dong=재송동&aptSeq=26350-2092`.
같은 이름 계열의 **1차(aptSeq 26350-2093)로 새지 않았고** canonical identity가 그대로
전달됐다. 이름만으로 다른 단지를 여는 경로가 실제로 없어졌음을 확인한 것이다.

### 8.3 지도 payload — Production 실측 (4G 스로틀, 같은 브라우저·회선)

두 코드 경로가 모두 살아 있어(`fields=marker`는 opt-in) 직접 비교했다.

| 구 | BEFORE 전체 응답 | AFTER 슬림 응답 | 전송 시간 절감 |
|---|---|---|---|
| 해운대구 26350 | 1,942,704 B / **884ms** | 63,660 B / **202ms** | **−682ms** (−96.7% bytes) |
| 부산진구 26230 | 1,950,759 B / 849ms | 83,644 B / 178ms | −671ms (−95.7%) |
| 중구 26110 | 53,336 B / 143ms | 12,069 B / 130ms | −13ms (−77.4%) |

> **지도 기본 진입 구가 중구(가장 작은 구)라서**, `/map` 첫 화면의 전체 시간에는 이 개선이
> 거의 드러나지 않는다(−13ms). 효과는 해운대구·부산진구 같은 큰 구에서 나온다(−0.7초).
> 지도 진입 실측(중구, warm): TTFB 61ms / FCP 480ms / SDK ready 1,420ms /
> 마커 요청 2,310ms / 응답 2,594ms / 첫 마커 2,203ms / 마커 사용가능 3,758ms.
> BEFORE(중구) 마커 노출 3,068ms과 사실상 동일하며, 이는 위 표대로 **예상된 결과**다.

### 8.4 버스 — Production BEFORE vs AFTER (n=8 × 2회 = 15 유효 측정)

| 구간 | BEFORE | AFTER (2회 합산) |
|---|---|---|
| **A. 클라이언트 사전 지연** | median **601ms** / worst 1,428ms | median **69ms** / worst 403ms |
| **C. TAGO 상류** | median 2,061ms | median **91ms** (15회 중 10회 CDN HIT) / worst 7,710ms |
| **첫 버스 카드(cold)** | median **2,458ms** | median **1,916ms** (CDN이 데워진 2회차만 보면 1,387ms) |
| 지오코딩 호출/여정 | **9회** | **0회** |
| warm 재진입 | 19ms, 신규 요청 0 | 67ms, 신규 요청 0 |

CDN 동작 확인: `/api/transit/bus-stops` 같은 좌표 반복 호출 → `MISS` → `HIT` → `HIT`.

> 1회차 배포 직후 측정에서는 TAGO cold miss가 몰려 첫 카드 median이 3,313ms로 나왔다.
> CDN이 데워진 2회차는 1,387ms다. **A 구간(이 STEP이 실제로 바꾼 부분)은 두 회차 모두
> 일관되게 69~76ms**이고, 나머지 변동은 전부 TAGO/CDN 상태에서 온다.

### 8.5 남은 관측치

- 지하철 POI 렌더 시각은 BEFORE 663ms / AFTER 1,416~1,881ms으로 측정됐으나 유효 표본이
  3~6개로 작고 편차가 커서 **결론을 내리지 않는다**. 회귀로 단정할 근거도, 개선으로
  주장할 근거도 부족하다.
- `/api/my/recent/sync`가 비로그인 세션에서 401을 준다. 이 STEP과 무관한 기존 동작이다.

---

## 9. 로컬에서 검증하지 못했던 것 (이제 해소됨 / 남은 것)

**localhost는 Kakao JS SDK 도메인에 등록돼 있지 않아 SDK가 401을 받는다.**
따라서 Kakao에 의존하는 아래 항목은 이 STEP에서 브라우저로 판정하지 못했다.

| 항목 | 상태 | 근거 |
|---|---|---|
| 지하철 등 Kakao POI 카드가 canonical 좌표로 검색되는지 | **미검증(로컬 불가)** | 좌표 전달 자체는 서버 응답으로 확인됨 |
| 지도 / 로드뷰 모달(`mode="coordinate"`) | **미검증(로컬 불가)** | 계약은 OFFICETEL_V1 STEP 6에서 검증된 것을 재사용 |
| `/map` 마커가 `fields=marker`로 뜨는지(end-to-end) | **미검증(로컬 불가)** | 지도 SDK가 안 떠서 마커 요청 자체가 발생하지 않음. **API 레벨은 완전 검증됨**(§6.4) |
| `/map` 오피스텔 레이어 ON/OFF/재ON | **미검증(로컬 불가)** | BEFORE 동작은 정상 확인(§6.8), 이 STEP은 해당 코드를 건드리지 않음 |
| 지도 FCP → 첫 마커 시간(AFTER) | **미측정** | §6.4의 payload 감소가 이 구간에 반영될 것으로 예상되나 수치는 미확보 |

**위 5개 항목은 §8에서 전부 해소됐다.** 배포 후 실제 도메인에서 검증한 결과는 §8.2 참고.

### 9.1 QA 중 새로 관측된 문제 (이 STEP이 건드리지 않은 코드)

**지도 back 복원**: 지도 → 마커 → 상세 → back 하면 지도가 직전에 보던 구/중심으로
돌아오지 않고 다른 구로 재설정된다(해운대구에서 마커를 눌러 상세로 갔다가 back 하면
지도가 26140을 다시 조회한다). 그 요청 자체는 정상이다 — `fields=marker`로 나가고
200/32,899 B의 유효한 마커 데이터를 받는다. 즉 **데이터 경로가 아니라 지도 view 상태
복원의 문제**다.

이 STEP의 `map/page.tsx` 변경은 fetch URL에 `fields=marker` 한 줄을 붙인 것이 전부이고
중심/구 상태 코드는 건드리지 않았다. 다만 **구 배포와의 A/B는 하지 못했다** — Kakao
도메인 등록이 대표 도메인에만 되어 있어 이전 배포의 고유 URL에서는 지도가 아예 뜨지
않는다. 따라서 "기존 문제"라고 단정하지 않고 **별도 조사 대상(P1)**으로 남긴다.

> 참고: 지도 기본 진입 위치(중구 남포동 일대)는 국제시장·자갈치 상권이라 최근 거래가 있는
> 단지가 거의 없다. 그 화면에서 마커 0개는 정상이며, 밀집 구(해운대)로 이동하면 마커가
> 정상 렌더된다(§8.2 C/D). 초기 QA에서 "마커 0개"로 보인 상당수가 이 경우였다.

---

## 9. 남은 P0 / P1

| # | 항목 | 근거 |
|---|---|---|
| P0 | **TAGO 상류 worst-case (로컬 실측 18.0초)** — durable 캐시 필요. DB/schema 변경이라 별도 승인 STEP | §6.5 / §6.6 |
| P1 | 재진입 시 `apt/{name}/score`, `apt/{name}/info` ×2가 여전히 재요청됨 (7건 중 3건) | §6.3 |
| P1 | `/info`가 jibun 확보 전/후 2회 호출되는 구조(설계상 의도됨이나 재진입마다 반복) | §6.3 |
| P1 | 상세페이지 CLS 0.367 (감사 P1-8) — 이 STEP 범위 밖, 그대로 남아 있음 | 감사 V1 |
| P2 | `src/lib/decision-journey/geocode-for-map.ts`가 이제 호출부 없음. AGENTS.md §14에 따라 삭제하지 않고 남겨둠 | — |
| P1 | **지도 back 복원** — 상세에서 back 시 직전 구/중심이 아닌 다른 구로 재설정 | §9.1 |
| P1 | **마커 엔드포인트가 CDN 캐시되지 않는다** — `cache-control: max-age=0, must-revalidate`라 항상 `x-vercel-cache: MISS`. payload가 작아진 지금 CDN까지 태우면 큰 구에서 추가 이득이 있다(버스 정류장과 같은 방식) | §8.3 |
| P2 | 모바일 작은 터치 타깃 13개 (기존값, 이 STEP과 무관) | §7 |

---

## 10. 변경 파일

**신규**

- `src/lib/apt-canonical-coords.ts` — canonical 좌표 해석(서버)
- `src/lib/detail-trade-window.ts` — 넓은 창 → 좁은 창 파생 + 완전성 재계산
- `src/lib/detail-trade-window.test.ts` — 위 계약 14 케이스
- `src/lib/detail-trade-cache.ts` — 공유 진입점(in-flight 병합 + 5분 TTL, 완전 성공만 캐시)

**수정**

- `src/app/api/apt/[name]/route.ts` — `withCoordinate=1` opt-in 좌표 동봉
- `src/app/api/transactions/route.ts` — `fields=marker` opt-in 슬림 응답
- `src/app/apt/[name]/apt-client.tsx` — canonicalCoord 단일 소스, 공유 캐시 사용, 좌표 stickiness
- `src/app/map/page.tsx` — 마커 요청에 `fields=marker`
- `src/components/KakaoPlaces.tsx` — 주소 지오코딩/키워드 폴백 제거, coords prop
- `src/components/BusAccessCard.tsx` — Kakao SDK 의존 제거, coords prop
- `src/components/LivingEnvironmentPanel.tsx` / `NeighborhoodInfoPanel.tsx` / `SchoolDistrictPanel.tsx` — 계약 정렬
- `src/components/apt/InfraTabSection.tsx` — coords/locationReady 전달
- `src/components/PriceTrendChart.tsx` — 60개월 1회 조회 + 기간별 파생
- `src/components/InvestmentMetrics.tsx` — 공유 진입점 사용

---

## 11. 검증 결과

| 검사 | 결과 |
|---|---|
| `npx tsc --noEmit` | `FAIL_EXISTING_SCRIPT_ERRORS` — 24건 전부 `scripts/`(11) + `tmp/`(3), **`src/` 0건** |
| `npx eslint <변경 파일>` | **0 errors**, warning 1건(`apt-client.tsx`의 미사용 eslint-disable — 8059dcf에서도 동일하게 재현되는 기존 값) |
| `npm run build` | **성공** |
| `npx tsx --test src/lib/detail-trade-window.test.ts` | **14 pass / 0 fail** |

---

## 12. 다음 STEP 권장

1. ~~배포 후 Production 검증~~ — **완료(§8)**.
2. **버스 durable 캐시** — DB/schema 승인 STEP. §6.6 / §8.4가 근거. TAGO worst 7,710ms는
   CDN이 비어 있는 좌표에서 여전히 발생한다.
3. **지도 back view 복원 조사** — §9.1.
4. **마커 엔드포인트 CDN 캐시** — §8.3. 버스 정류장과 같은 방식, read-path만 건드리는 안전 작업.
5. **`/score`, `/info` 재진입 캐시** — §5와 같은 안전 규칙(실패·부분실패 미캐시)을 재사용.
