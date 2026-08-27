# STATISTICS V2.1-2 — TRANSACTION ACTIVITY (실거래 / 거래량 / 거래집중)

## 1. Goal

통계 "거래" 카테고리 핵심 3개 화면(실거래/거래량/거래집중)을 단순 나열·표가
아니라 "지금 어디에서 실제 거래가 일어나고 있는가 → 지역 거래가 늘고
있는가 → 어떤 단지에 거래가 집중되고 있는가"를 한 흐름으로 이해할 수 있는
이집형 거래활동 통계로 개편한다. STATISTICS V2(실거래 feed 최초 구축),
STATISTICS DATA TRUST + REGION FILTER V2(SIDO_ALL), STATISTICS V2.1-1(가격
랭킹 bounded record-high) 위에 쌓는다 — 세 화면 모두 기존 아키텍처
(RegionContext, regional-feed.ts, molit-stats-helpers, statistics-pyeong-resolver)를
재사용하고 새 fetch 메커니즘/state 라이브러리를 만들지 않았다.

## 2. Benchmark Findings

아실 거래량(연도별 표, 매매/전세 구분, 가격+거래량 동시 제공)과 아실
많이산단지(거래건수 순위, 자유로운 날짜 범위), 당근 실거래(feed 중심,
sparkline, 신고가/변화 badge)를 참고했다. 그대로 복제하지 않고:

- 실거래는 이미 STATISTICS V2에서 구축된 `TransactionFeedView`/`/api/stats/feed`를
  그대로 재사용·보강했다(신규 재구축 아님).
- 거래량은 "숫자 하나"가 아니라 "이전 기간 대비 변화"를 1순위 정보로 삼았다.
- 많이산단지는 그대로 이식하지 않고, 실제 데이터 의미(거래건수)에 맞게
  "거래집중"으로 이름부터 다시 정의했다(§4/§5).

## 3. Product Questions

- 실거래: "오늘/최근 실제로 어떤 집이 거래됐지?"
- 거래량: "요즘 이 지역에서 거래가 실제로 늘고 있나?"
- 거래집중: "최근 어떤 단지에서 거래가 많이 이루어졌지?"

세 질문을 혼동하지 않도록 화면/API를 분리했다(feed는 개별 거래 나열,
volume은 지역 집계+비교, concentration은 단지 단위 집계+비교).

## 4. Menu Semantics Audit

전수 조사 결과, 현재 라이브 메뉴 중 "인기"라는 이름이 붙어 있던
`slug: 'top-traded'`(`src/app/stats/statsMenu.ts`)는 실제로는
`/api/stats/rankings`가 계산한 **순수 거래건수 랭킹**(`sort: tradeCount desc`,
comment: "최근 12개월 매매 거래 건수 기준")이었다 — 조회수/검색/관심등록/
비교담기/공유/재방문 같은 사용자 행동 신호는 전혀 쓰이지 않았다. 반면
진짜 사용자 행동 기반 popularity 화면은 `slug: 'popular'`("인기단지",
`status: 'soon'`, `soonReason: '단지별 조회수를 아직 집계하고 있지 않습니다.'`)로
이미 별도 예약돼 있었다 — 즉 앱 안에 "인기"라는 이름이 두 군데서 서로 다른
뜻으로 쓰이고 있었다.

## 5. Menu Semantics — Before / After

| 항목 | Before | After |
|---|---|---|
| title | 인기 | 거래집중 |
| subtitle | 거래량 집중 인기 단지 | 최근 거래가 몰린 단지 |
| colorToken | popular(보라) | brand(그린, 거래 카테고리 기본색) |
| icon | ShoppingCart(🛒) | Target(📌) |
| 화면/데이터 | RankingListView + `/api/stats/rankings`(월 단위 tradeCount) | ConcentrationView + `/api/stats/concentration`(day-precise 기간 + 직전 기간 대비 증감) |
| slug | `top-traded`(변경 없음 — URL 안정성 유지) | `top-traded` |

`popular`(진짜 인기단지, soon)는 이번 STEP에서 건드리지 않았다 — §23 future
note에 그대로 남긴다.

## 6. "인기" Data Claim Audit

결론: 거래건수 기반이면 "인기"/"선호"를 절대 쓰지 않는다(§23 원칙 그대로
적용). 대단지·분양 시점 등 다른 이유로도 거래건수가 많을 수 있어 "거래가
많았다"는 사실과 "선호도가 높다"는 해석은 다르다 — 화면 문구
(`ConcentrationView.tsx`)에 이를 명시하는 disclaimer를 넣었다: "거래건수
순위는 단지 규모·분양 시점 등에 따라 자연스럽게 달라질 수 있어 선호도를
뜻하지 않아요."

## 7. Common Filter Architecture

세 화면 모두 기존 `RegionContext`/`RegionSelectModal`을 그대로 재사용한다
(새 region selector 없음) — `/stats/[type]` 페이지 안에서 탭을 전환해도
지역 선택은 Context가 이미 전역으로 유지한다. 기간 preset은 화면 성격에
맞게 두 그룹으로 나눴다(§9 근거, 새 3번째 preset 시스템을 만들지 않고
기존 두 시스템을 재사용):

- 실거래: `regional-feed.ts`의 `PeriodPreset`(오늘/어제/7일/이번주/지난주/30일/12개월)
- 거래량/거래집중: `price-ranking.ts`의 `PriceRankingPeriodPreset`(7일/30일/3개월/6개월/12개월,
  거래량은 7일·30일·3개월 비교만 지원 — §10 근거) — 7일/30일이 세 화면
  공통 어휘로 겹친다.

---

## REAL TRANSACTIONS(실거래)

## 8. Real Transaction Feed

기존 `/api/stats/feed` + `TransactionFeedView`(STATISTICS V2에서 구축)를
재사용·보강했다 — 신규 재구축이 아니다. 이번 STEP에서 추가한 것:

1. 신고가 badge 안전성 버그 수정(§20)
2. 세대수/입주연도 배치 조회(§8 스펙, 아래)
3. mini price trend(sparkline, §9 스펙)

## 9. Date Grouping

기존 `groupTradesByDate`(계약일 내림차순, 같은 날짜는 금액 내림차순) 그대로
유지 — 이미 STATISTICS V2에서 구현돼 있었다. 회귀 없음(기존 테스트 통과).

## 10. Price Context

기존 계약: 거래가 + 직전거래 대비 변동(▲/▼ + 색상 + %). 변경 없음.

## 11. Mini Trend — Sample Rule & Implementation

`regional-feed.ts`의 `annotateTrades`가 각 거래에 `recentTrend`(같은
identity+area+dealType 그룹의 최근 최대 5건, 자기 포함, 시간순, 미래
leakage 없음)를 함께 계산하도록 확장했다 — 이미 annotateTrades가 그룹별로
순회하며 계산하던 부산물이라 **새 DB/API 호출이 없다**(§34 N+1 금지 원칙
준수). `/api/stats/feed`는 표본이 3건 미만이면 `recentTrend: null`로 내려
차트를 숨기고, 3건 이상일 때만 노출한다. UI(`MiniTrend`, 순수 SVG
polyline, 장식용이라 `aria-hidden`)는 텍스트(▲▼ + 금액 + %)가 이미
전달하는 정보를 보강만 한다(§42 접근성 — 색상/차트 단독 전달 없음).

## 12. Apartment Age / Households(세대수·입주연도)

`statistics-pyeong-resolver.ts`에 `resolveApartmentContextBatch`를
신규 추가했다 — pyeong 조회와 **동일한 identity 규칙**(aptSeq 단일 매칭
우선, name+dong 단일 매칭 폴백, 모호하면 매칭하지 않음 — "다른 단지로
fallback 금지" 원칙)을 공유하는 별도 batch 조회다. `Apartment` 테이블의
기존 `totalHouseholds`/`approvalDate` 컬럼(건축물대장 기반, 이미 다른
화면에서 신뢰돼 쓰이던 값)만 읽는다 — 새 데이터 소스/스키마 변경 없음.
feed route는 페이지(최대 50~200건)에 보이는 거래의 unique identity만
모아 쿼리 1쌍(aptSeq batch + name/dong batch)으로 처리한다(N+1 금지).
값이 없으면 그냥 숨긴다(추정 금지).

## 13. 2-Year-High Context — Bug Found & Fixed

감사 중 실제 버그를 발견했다: 기존 `annotateTrades`는 `runningMax`를
`-Infinity`로 시작해, 조회 lookback 안에서 **처음 관측된 거래**(비교할
과거 데이터가 전혀 없는 거래)까지 무조건 "신고가"로 표시하고 있었다.
`price-ranking.ts`(V2.1-1에서 구축)는 이미 "이전 최고가가 실제로 존재하고
그것을 넘어서야만 신고가"라는 원칙을 채택했는데, feed만 이 원칙에서
벗어나 있었던 것 — 두 화면이 서로 다른 정의로 "신고가"를 판정하는
불일치였다. `runningMax`를 `number | null`로 바꿔 "이전 검증 거래가
없으면 신고가 아님"을 구조적으로 강제했다(§20 상세).

## 14. Unsafe "신고가" Claim — Audit & Fix

기존 feed는 badge/summary에 무제한 단어 "신고가"를 그대로 썼는데, feed의
실제 lookback은 preset·SIDO_ALL 여부에 따라 12개월~24개월 사이에서
가변적이다(price-ranking처럼 고정 24개월이 아님 — §34 성능 이유로 SIDO_ALL은
표시 기간만, 단일 구는 +12개월). 고정 "2년최고가" 라벨을 그대로 갖다
쓰면 실제 조회 범위보다 넓게 주장하는 경우가 생긴다. 대신
`windowCoverageLabel(from, to)`를 신규 작성해 **실제 fetch 범위**로부터
정직한 라벨을 계산한다(60일 이하는 "N일", 그 이상은 "N개월"/"N년"으로
반올림, 절대 실제보다 넓게 주장하지 않음). 결과적으로 단일 구 기본
조회(12개월 lookback)는 "1년최고가", SIDO_ALL 7일 조회는 "7일최고가",
12개월 preset 조회는 "2년최고가"로 자동으로 정확히 표시된다 — 하드코딩
없이 실제 데이터 범위와 문구가 항상 일치한다.

## 15. Volume Definition

## 16. Volume Aggregation

기존 `/api/stats/dashboard`(월별 그래프, SIDO_ALL 지원)를 그대로 재사용,
`/api/stats/yearly`(연도별 표)는 **여전히 SIDO_ALL 미지원**이다(§17). 이번
STEP에서 신규 추가한 것은 `volumeSummaryByPeriod`(7일/30일/3개월,
현재기간 vs 직전 동일기간 비교, sale/jeonse/wolse 분리) — dashboard가
이미 12개월치 fetch해둔 raw trade 배열(`dealDate` 보유) 위에서 순수
배열 필터/카운트만 하고, **새 MonthTask fetch를 추가하지 않았다**(§34).
6개월/12개월 비교는 의도적으로 지원 범위에서 제외했다 — 그 직전 동일
기간까지 계산하려면 최대 24개월 lookback이 필요한데, 현재 fetch는
정확히 12개월만 받아두므로 6개월 preset의 "직전 6개월"이 fetch 경계에
걸쳐 실제보다 적게 집계되는(정확성 손상) 위험이 있다 — "정확한 데이터
claim"을 성능/재사용보다 우선했다(§ priority list). 장기 흐름(6개월~12개월)은
기존 월별 bar chart가 그대로 담당한다(변경 없음).

## 17. SIDO_ALL / YEARLY_SIDO_ALL — Re-audit

- `거래량(그래프)` SIDO_ALL: 기존부터 지원(PASS, 이번 STEP도 유지) —
  `volumeSummaryByPeriod`도 동일 캐시 안에서 계산되므로 SIDO_ALL에서도
  그대로 동작한다.
- `거래량(연도별 표)` SIDO_ALL: **이번 STEP에서도 미지원 유지**. 재검토
  결과: `yearly/route.ts`는 애초에 `sidoCode` 파라미터 자체가 없다(구조적
  미지원). 단일 구 하나도 이미 "연도(2014~현재, ~12개년) × 월(최대 12) ×
  2타입" = 200회 이상의 MOLIT 호출이 필요한데, 이를 시도 전체(구
  16~25개)로 곱하면 3,000~5,000+ 호출이 되어 현재 스로틀 구조로는 안전하게
  완주할 수 없다(§13 volume 감사에서 실측한 dashboard SIDO_ALL cold
  106초조차 12개월 fetch 기준 — 연도별 표는 그 10배 이상 규모). 영구
  캐시/사전 집계 인프라(별도 STATISTICS PERFORMANCE V1) 없이는 정직하게
  지원할 수 없다 — 기존처럼 표 토글 버튼을 `disabled`로 두고 "연도별
  표는 시/군/구를 선택하면 볼 수 있어요" 안내를 유지한다(코드 변경 없음).

## 18. Volume Comparison

`VolumeSummaryStrip`(신규, `type-client.tsx`)이 기간(7일/30일/3개월) +
현재 선택된 거래유형(매매/전세/월세, 기존 칩과 공유) 기준 "현재기간
건수 vs 직전 동일기간 건수, 증감(▲/▼ + 건수 + %)"를 최상단에 보여준다.
"거래량이 많다"가 아니라 "얼마나 변했는지"를 1차 정보로 삼는다(§18 원칙).
"시장 회복"/"매수세 강함" 같은 해석 표현은 쓰지 않는다 — 숫자와 방향만.

---

## TRADE CONCENTRATION(거래집중)

## 19. Concentration Definition

신규 `/api/stats/concentration` + `ConcentrationView`. 정의: 기간 내 같은
단지(identityKey — aptSeq 우선, 없으면 name+dong, `regional-feed.ts`가
이미 확립한 원칙 재사용) **정상(비취소) 거래 건수**, 면적 무관(단지 전체
합산). `regional-feed.ts`에 `buildConcentrationRanking`(순수 함수, 단위
테스트 6개)으로 구현했고, MOLIT fetch/식별/취소 제외/dedup 로직은 전부
`toFeedTrade`/`identityKey`/`filterVerifiedTrades`/`dedupeTrades`(기존
feed가 쓰던 것과 100% 동일한 함수)를 그대로 재사용한다 — 같은 거래가
두 화면에서 다르게 집계될 여지가 없다.

## 20. Why It Is Not "Popularity"

§6/§23 참고. 화면 문구("거래건수 순위는 단지 규모·분양 시점 등에 따라
자연스럽게 달라질 수 있어 선호도를 뜻하지 않아요")와 정적 QA guard(§49,
"인기 1위"/"가장 좋아하는 단지"/"매수 선호 1위" 등 금지 문구가 소스에
다시 들어오지 않는지 자동 검사)로 이중으로 강제한다.

## 21. Filters

지역(공유) · 기간(최근 7일/30일/3개월, 기본 30일) · 거래유형(매매/전세/월세,
기본 매매) · 정렬(거래건수순/거래증가순/최근거래순). 가격/면적/세대수
필터는 이번 STEP 범위 밖(§21 원 스펙 "고급" 항목, API/데이터가 안전하게
지원하는 것만 우선 구현하는 원칙에 따라 defer) — `totalHouseholds`는
표시(보조 context)만 하고 필터/정렬 기준으로는 쓰지 않았다(§24 원칙:
1000세대당 정규화 같은 새 핵심 랭킹은 이번 STEP에서 만들지 않음).

## 22. Region / Household Context

SIDO_ALL에서도 각 row는 거래 자신의 `lawdCd`(구별로 다를 수 있음)를 쓴다
— feed와 동일 원칙, 다른 구 단지로 잘못 연결되지 않는다. 세대수/입주연도는
§12와 동일한 `resolveApartmentContextBatch`를 상위 30개 항목에만 적용
(쿼리 2쌍 고정).

## 23. Pyeong / Data Trust

대표 평형은 최근 거래의 raw 면적을 `resolveTrustworthyPyeongBatch`(기존
함수, 변경 없음)로 조회 — Unit Master가 없으면 raw ㎡만 노출, `/3.3058`
가짜 평형 계산 없음(정적 QA guard로도 재확인).

## 24. Error / Partial / No-Data

feed와 동일한 `partial`/`failedDistricts`(SIDO_ALL 일부 구 실패)와
`apiError`(전체 실패, 거래 0건과 구분)를 그대로 재사용해 응답에 포함한다.

---

## COMMON

## 25. 부산전체 / 서울전체(SIDO_ALL) 실측

QA 스크립트(`scripts/run-statistics-v2-1-transaction-activity-qa.ts`,
아래 §22 QA 참고) 실측 기준:

| 화면 | 부산 전체 cold | 부산 전체 warm | 서울 전체 cold | 서울 전체 warm |
|---|---|---|---|---|
| 실거래(feed) | ~3.3초 | ~2.8초 | ~5.8초 | ~5.2초 |
| 거래량(dashboard) | ~43초 | 즉시(<0.1초, 5분 캐시) | **~96~106초**(gap-invest-calc.ts 버그 수정 후 정상 완료 확인) | 즉시(<0.1초, 5분 캐시) |
| 거래집중(concentration) | ~5~18초(구간별 편차) | 즉시(<0.1초, 5분 캐시) | ~7~30초(district 25개 × ~2~3개월 × 1타입) | 즉시(<0.1초, 5분 캐시) |

**추가로 발견/수정한 버그**: QA 실측 중 서울 전체(SIDO_ALL) 거래량이
`{success:false}`로 완전히 죽는 것을 발견했다 — dev 서버 로그로 원인을
추적한 결과, `src/lib/gap-invest-calc.ts`의 `normalizeAptName(name)`이
`!name`만 방어하고 있어, 서울 규모 12개월치 전월세 데이터 안에 드물게
섞인 문자열이 아닌(예: 숫자) `name` 값을 만나면 `.replace is not a
function`으로 **크래시**했다(부분 실패가 아니라 지역 전체가 죽는 더 나쁜
실패 모드). 기존 코드(전세가율 §6 계산부)이며 이번 STEP이 새로 만든
코드가 아니지만, 이번 STEP이 강화하려는 바로 그 "거래량 SIDO_ALL" 경로를
100% 막고 있어 최소 방어 코드(`typeof name !== 'string'`) 한 줄로
고쳤다 — 정상 입력의 동작은 전혀 바뀌지 않는다. 수정 후 서울 전체 거래량
재확인 PASS.

거래량 SIDO_ALL cold가 느린 것은 **이번 STEP 이전부터 존재하던 특성**이다
(dashboard는 12개월×2타입×구 수의 MOLIT fetch가 이미 hotIssues/gapInvest/
topPrices 등 기존 기능을 위해 필요했다). 이번 STEP에서 추가한
`volumeSummaryByPeriod` 계산은 이미 fetch된 배열 위의 순수 필터/카운트뿐이라
추가 네트워크/DB 호출이 0건이다 — 측정으로 이를 확인했다(§34 N+1 audit).
5분 서버 캐시(`getOrSetCache`)가 있어 같은 지역을 반복 조회하면 즉시
응답한다.

## 26. Request-count / N+1 Audit

- feed: mini trend/세대수 조회는 페이지당(최대 200건) 쿼리 1쌍 고정 —
  거래 건수만큼 반복 조회하지 않는다.
- concentration: 상위 30개 항목만 세대수/평형 batch 조회(쿼리 2쌍 고정).
- volume: 신규 계산 전부 이미 fetch된 배열 위의 인메모리 연산, 추가 fetch
  0건.
- 신규 MonthTask/DB 쿼리 패턴은 기존 feed/rankings/dashboard와 동일한
  `fetchMonthsThrottled(WithStatus)` / `getOrSetCache` / batch Prisma
  `findMany`만 사용했다 — 새 fetch 메커니즘 없음.

## 27. Mobile / Desktop

브라우저 실측(iframe-isolation 기법으로 실제 360px viewport 강제 —
`resize_window`가 창 자체는 리사이즈해도 실제 `window.innerWidth`가
반영되지 않는 이 환경의 알려진 제한을 우회): 실거래/거래집중/거래량 세
화면 모두 360px에서 `document.documentElement.scrollWidth ===
clientWidth`(가로 overflow 없음) 확인. 실거래 row는 단지명+가격+mini
trend(56×20px 고정, flex 우측 정렬)+세대수/연식까지 포함해도 줄바꿈만
되고 넘치지 않음(`tradeRowMid`/`tradeRowMeta`의 기존 `flex-wrap` 대응).
거래집중 row는 rank(고정폭)+본문(flex, `min-width:0`+ellipsis)+지표
(고정폭 우측 정렬) 3분할이라 긴 단지명도 잘리기만 함. 거래량 요약은
기존 `panel`/`FilterChip` 컴포넌트를 재사용해 모바일 카드 스타일을 새로
만들지 않았다. 거래량→거래집중 cross-link 버튼 클릭 시 기간/거래유형이
그대로 유지된 채 이동하는 것도 360px 화면에서 실제 클릭으로 확인했다.
데스크톱(1400×900)은 기존 `.panel` max-width 컨테이너 안에서 동일하게
렌더(별도 2-column 대시보드 신설 없음, §41 원칙) — `/stats` 랜딩 그리드의
"거래집중" 카드도 Target 아이콘 + 브랜드 그린으로 정상 반영 확인.

## 28. Accessibility

색상 단독 전달 없음 — 상승/하락은 ▲/▼ 기호 + 텍스트(건수/%) + 색상을
항상 함께 쓴다. mini trend SVG는 `aria-hidden`(장식용, 텍스트가 이미
같은 정보 전달). 모든 필터는 버튼 기반(키보드 포커스 가능, 기존
`FilterChip`/`chip` 패턴 재사용).

## 29. Automated QA

신규 `scripts/run-statistics-v2-1-transaction-activity-qa.ts`
(read-only, GET만 호출). 검사 항목: recordHighCoverageLabel 필드 존재,
취소거래의 신고가/mini-trend 오염 여부, mini trend 3건 미만 노출 금지,
volume 기간별 changeCount 산술(`current - previous`), concentration
rank/정렬/deltaCount 산술, 이전-현재 기간 연속성(끊김/겹침 없음),
SIDO_ALL region echo·구간 분산도, partial 플래그, dong 필터, no-data vs
api-error 구분, **popularity overclaim 정적 가드**(§23의 금지 문구 5종 +
top-traded 메뉴 title/color 회귀 감지), 기존 fake-pyeong 가드 재사용.

## 30. Regression

`docs/development/`의 기존 QA 스크립트(`run-statistics-v2-qa.ts`,
`run-statistics-v2-1-price-ranking-qa.ts`)는 이번 STEP에서 수정하지
않았다 — 하락/2년최고가/상승/역전세/갭투자/compare/stats-home 로직은
건드리지 않았다(가격 랭킹 정의 변경 없음). 기존 `.test.mjs` 전체
154/154 PASS(회귀 없음), `regional-feed.test.mjs`는 33개로 확장(신규
14개 + 기존 19개 갱신), `statistics-pyeong-resolver.test.mjs`는 13개로
확장(신규 2개).

## 31. Typecheck / Lint / Build

`npx tsc --noEmit`: 이번 STEP이 변경한 파일 기준 신규 에러 0건. 저장소
전체에는 `scripts/apartment-score/*`, `scripts/education/*`,
`scripts/list-zips.ts`, `scripts/test-api.ts`, `scripts/fetch-api-info.ts`에
이번 STEP과 무관한 기존(pre-existing) 에러가 있다 —
FAIL_EXISTING_SCRIPT_ERRORS. `npx eslint`(변경 파일 전체): 에러 0건.
`npm run build`: PASS(`/api/stats/concentration` 포함 전 라우트 컴파일
성공).

## 32. Known Limitations

- 거래량 연도별 표(yearly) SIDO_ALL: 구조적으로 미지원, 정직하게
  안내(§17).
- 거래량 기간 비교는 6개월/12개월을 지원하지 않는다(§16 근거 — 정확성
  우선). 장기 흐름은 기존 월별 차트로 확인 가능.
- URL state: region/period/dealType 전체를 URL에 완전히 동기화하지는
  않았다. 거래량 → 거래집중 cross-link 1곳만 `?period=&dealType=`
  쿼리스트링으로 전달하고, 거래집중이 최초 마운트 시 이를 읽어 초기값으로
  쓴다(§26/§32 "안전하게 가능한 범위"). 그 외 필터 변경은 URL에 반영되지
  않는다(기존 stats 상세 화면 전반의 알려진 제한, 이번 STEP이 새로 만든
  제한이 아님).
- 거래량 SIDO_ALL cold fetch(특히 서울, ~100초대)는 기존부터의 성능
  한계이며 이번 STEP 범위(대규모 persisted cache/DB 인프라, 별도
  STATISTICS PERFORMANCE V1)가 아니다.
- 거래집중의 "정렬: 거래증가순"은 현재기간-직전기간이 모두 동일 fetch
  범위 안에 있어 항상 신뢰 가능하지만, 두 기간의 절대 표본 수가 작을 때
  (예: 소규모 단지, 7일 preset) delta 값의 통계적 의미는 제한적이다 —
  화면에서 별도 경고 문구는 추가하지 않았다(과잉 설계 방지, 필요 시 후속
  STEP에서 표본 크기 안내 추가 검토).

## 33. Analytics-based Popularity — Future

진짜 "인기"(사용자 행동 기반)는 `slug: 'popular'`("인기단지", 아직
`soon`)로 이미 예약돼 있다. 향후 ANALYTICS V1에서 조회/검색/관심등록/
비교담기/공유/재방문 로그가 쌓이면 별도 구현 대상이며, 이번 STEP의
거래건수 기반 "거래집중"과는 명확히 분리된 지표로 유지해야 한다 — 절대
하나로 합치지 않는다.

## 34. PRICE MAP V2 Connection

`buildConcentrationRanking`/`volumeSummaryByPeriod`는 지역×기간×단지
단위의 거래량/증감을 이미 순수 함수로 계산해두므로, 향후 "지역 변동지도"
(대한민국→시도→시군구→읍면동→단지 단위 거래량/상승하락 시각화)가
이 aggregation contract를 좌표(위경도)만 얹어 재사용할 수 있도록 함수
시그니처를 특정 UI에 묶어두지 않았다(트레이드/집계 로직과 렌더링을
분리). 이번 STEP에서 지도 구현은 하지 않았다.

## 35. 84㎡ Ranking Connection

이번 STEP은 84㎡/국민평형 순위를 구현하지 않았다(별도 후속 기능,
`price-ranking.ts`의 "최고가"라는 단어도 이 미래 기능을 위해 이미
예약돼 있음 — statsMenu.ts 기존 주석 참고). 거래집중이 raw area 그대로
유지(§23, 병합 없음)하는 원칙을 지켰으므로, 향후 84㎡ 순위 기능이 같은
`FeedTrade`/`groupKey` 계약을 재사용하는 데 장애가 없다.

## 36. Next Step

`STATISTICS_V2_1_RISK_GAP` 또는 `STATISTICS_PERFORMANCE`(거래량/거래집중
SIDO_ALL cold 시간 단축을 위한 persisted cache 검토) 중 ChatGPT PM 판단에
따른다.
