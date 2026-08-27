# STATISTICS V2 — REGIONAL MARKET INTELLIGENCE + TRANSACTION FEED + DECISION DRILLDOWN

> 이름 충돌 참고: `docs/development/STATISTICS-V2-design-and-judgment-system.md`(하이픈
> 표기)가 이미 기존 16개 통계 메뉴의 UX 재편(카테고리 그룹핑, deterministic 문구
> 등)을 "STATISTICS V2"로 문서화해 두었다. 이 문서는 그 위에 **신규 핵심 기능인
> "지역별 실거래 피드"**를 추가하는 STEP을 다룬다 — 기존 16개 메뉴는 이번 STEP에서
> 재작성하지 않았다(§2 KEEP 참고).

## 1. Goal

이집 통계 영역을 "숫자 나열"에서 "지역 시장을 이해하고 후보 단지까지 좁히는
의사결정 도구"로 확장한다. 핵심 신규 기능은 **지역별 실거래 피드**(시도→시군구→
동→단지→면적 drill-down, 일/주/월/사용자 지정 기간, 신고가/상승/하락/거래량/
매매/전세/월세 구분, 취소거래 정책, deterministic 시장 해석)다.

## 2. Current Statistics Audit

전수 조사 결과(Explore agent 감사, 코드 근거 포함):

| 화면(slug) | 분류 | 근거 |
|---|---|---|
| decline/record-high/rising/top-traded/jeonse-risk (`RankingListView`) | **KEEP** | 이미 `/api/stats/rankings`로 라이브 계산, deterministic insight 적용됨, 이번 STEP 범위 아님 |
| volume/gap-invest (`VolumeView`/`GapInvestView`) | **KEEP** | `/api/stats/dashboard`+`yearly` 기반, STATISTICS-V2.1에서 갭투자 정확도 이미 수정됨 |
| compare/multi-compare (`CompareView`) | **KEEP** | 별도 비교 기능, 이번 STEP은 Compare V2 개발 금지(§26 지시) |
| price-map (`PriceMapView`) | **KEEP** | 지도 기반 분위 시각화, 정상 동작 |
| supply/population/foreign-buyer/elevation/large-complex/popular (soon) | **LATER** | 실제 데이터 소스 없음 — 임의 추정 금지 원칙 유지, 이번 STEP도 채우지 않음 |
| **실거래 피드** | **신규 추가** | 기존 메뉴에 없던 핵심 신규 기능(§8) |

기존 화면 중 **REMOVE/MERGE 대상 없음** — 전부 실제 데이터 기반으로 정상 동작 중이라 파괴하지 않았다(AGENTS.md "기존 정상 기능을 임의로 삭제하지 않는다" 준수).

## 3. Competitor Benchmark

- **호갱노노**: 탐색+커뮤니티 중심 — 참고하지 않음(카피 금지 원칙).
- **아실**: 풍부한 분석자료 — 참고하지 않음.
- **부동산지인**: 시장 방향 제시 — 참고하지 않음.
- **당근부동산**: 지역 실거래 UX(§4)를 실제 벤치마크 대상으로 삼음.
- **아파트미**: 일/주/월별 실거래·신고가·거래량 구조(§5)를 벤치마크.

## 4. Daangn Transaction Feed Benchmark

참고한 UX 요소: 시도/시군구/읍면동 선택 상단 고정, 날짜별 자연스러운 그룹핑,
compact row(단지명/거래가/면적/층/계약일), 신고가 badge, 작은 가격 흐름 표시.
그대로 복제하지 않고 이집 해석 레이어(§16)를 그 위에 추가했다.

## 5. Apt2(아파트미) Transaction Structure Benchmark

참고한 구조: 일별/주간/월별 실거래 view, 신고가, 거래량, 시군구 단위 거래
흐름. `TransactionFeedView`의 period preset(오늘/어제/최근7일/이번주/지난주/
최근30일/최근12개월/기간선택)이 이 구조를 반영한다.

## 6. E-jip Differentiation

"무슨 거래가 있었나"에서 끝나지 않고 `buildMarketInterpretation()`(순수 함수,
`src/lib/regional-feed.ts`)이 실제 필터링된 데이터에서만 계산한 5종 문장(거래량
비교/신고가 비중/동 집중/면적대 집중/상승·하락 비교)을 region summary 바로
아래에 배치해 "이 지역이 지금 어떤 상태인가"까지 연결한다. LLM 미사용, 단정적
표현 금지(§17, 테스트로 고정).

## 7. Data Sources

기존 STEP들과 동일하게 **신규 유료 API·신규 데이터 ingestion 없음**:

- MOLIT 실거래 — 기존 `fetchMolitData`(`src/lib/api-molit.ts`)를 그대로 재사용,
  파싱 로직 변경 없음.
- 지역코드 — 기존 `resolveLawdCd`(`src/lib/molit-stats-helpers.ts`, 전국
  법정동코드 프록시)를 그대로 재사용. 새 지역 데이터 추가 없이 서울 강남구 등
  전국 어디든 이미 동작함(§13 라이브 검증).
- 지역 상태 공유 — 기존 `RegionContext`(전국 시도/시군구 hardcoded 목록 이미
  보유)를 그대로 재사용, 새 필터 컴포넌트를 만들지 않았다.
- **persisted 거래 DB 테이블 없음**(감사로 확인 — `Transaction`/`TradeHistory`
  모델은 legacy dead code, 아무 라우트도 참조하지 않음) — 이번 STEP도 스키마를
  추가하지 않고 기존 라이브 fetch 구조를 그대로 따랐다(DB_SCHEMA_CHANGE=NONE).

## 8. Regional Architecture

전국 코드 기반 — `resolveLawdCd(sido, gungu)`가 하드코딩된 부산 전용 테이블이
아니라 전국 법정동코드 프록시를 호출하므로, 서울 강남구(`lawdCd=11680`) 같은
쿼리도 신규 데이터 없이 즉시 동작한다(§13에서 실측 확인). `dong` 필터는 기존
`/api/transactions`와 동일하게 fetch 후 정확히 일치하는 문자열로만 필터링한다
(이름 유사 매칭 없음).

## 9. Period Architecture

`src/lib/regional-feed.ts::resolvePeriodRange(preset, now, custom?)` — 8개
preset(today/yesterday/7d/thisWeek/lastWeek/30d/12m/custom) 전부 순수 함수로
구현, `now`를 인자로 받아 테스트 가능(고정 시각 주입). 월 경계/연도 경계를
정확히 넘어가는 `monthsForRange()`로 MOLIT 월 단위 배치 fetch 대상을 계산한다
(거래 row 개수가 아니라 겹치는 달 개수만큼만 호출 — N+1 방지).

## 10. Transaction Feed

`GET /api/stats/feed` — 신규 API 라우트(`src/app/api/stats/feed/route.ts`).
표시 기간보다 최대 12개월 넓은 lookback을 한 번에 fetch해(신고가/직전거래
비교용) `fetchMonthsThrottled`(기존 공유 전역 세마포어, 동시 3개+200ms 페이싱)로
배치 호출한다 — 새 동시성 풀을 만들지 않았다(모듈 자체 경고: 별도 풀을 만들면
실제 동시 요청 수가 배로 늘어 API 자체 속도 제한에 걸림).

## 11. Transaction DTO

`FeedTrade`(`src/lib/regional-feed.ts`): `uid, aptSeq, name, dong, dealType
('sale'|'jeonse'|'wolse'), dealAmount(만원), excluUseArea(㎡ raw), floorRaw,
dealDate, dealCanceled`. API 응답에서는 여기에 `priceLabel, isRecordHigh,
previousTrade, changeAmount, changePct`를 추가해 내려준다. **대표 평형은
포함하지 않는다** — Unit Master 조인 없이 raw ㎡만 사용(§29 참고, 기존
rankings/dashboard/transactions 라우트의 `exclusiveArea/3.3058` 가짜 평형
계산을 이번 신규 기능에서는 반복하지 않았다).

## 12. Record High

`annotateTrades()`가 (identity+area+dealType) 그룹 안에서 시간순으로 누적
최고가를 계산한다 — 미래 거래가 과거 거래의 신고가 판정에 영향을 주지 않는다
(단위 테스트로 고정, `regional-feed.test.mjs`). lookback 12개월 범위 내
최고가 기준이며(전체 역사상 최고가 아님, 기존 `record-high` 탭과 동일한 정직한
스코프 원칙), 취소거래는 완전히 제외한다.

## 13. Rise/Fall

동일 그룹의 시간순 직전 검증된(비취소) 거래 대비 `changeAmount`(만원)/
`changePct`(%)를 계산한다. 다른 raw area와 비교하지 않는다(84.7855㎡ vs
84.9950㎡을 하나로 합치지 않음, `trade-area-selection.ts`가 이미 확립한 원칙과
동일). 직전거래가 없으면 `null`(0으로 만들지 않음).

## 14. Volume

`RegionSummary.verifiedCount/byDealType`로 집계, 취소거래는 항상 제외.
period preset이 곧 일/주/월 단위 view 역할을 겸한다(오늘=일간, 최근7일/이번주=
주간, 최근30일/최근12개월=월간 성격) — 별도 daily/weekly/monthly 토글을
추가하지 않고 기존 preset 구조로 흡수해 UI 복잡도를 늘리지 않았다.

## 15. Market Summary

Region summary 카드(실거래/신고가/상승거래/하락거래/취소, 5개 이하 핵심
숫자만) — §23 "숫자 과밀 금지" 원칙에 따라 5개 카드로 제한.

## 16. Drilldown

시도→시군구는 기존 `RegionContext`/`RegionSelectModal`(전역 공유)로, 동은
`dong` 쿼리 파라미터로, 단지/면적은 실거래 row 클릭 시 canonical apt 상세
페이지로 이동(§17)한다. 뒤로가기 시 브라우저 기본 동작으로 스크롤 위치가
보존된다(별도 상태 복원 로직 추가 없음, 최소 변경 원칙).

## 17. Apartment Navigation

`goToApt()`(`TransactionFeedView.tsx`)가 `/apt/{encodeURIComponent(name)}?lawdCd=&dong=`
로 이동한다 — 기존 `school-detail-client.tsx`의 `RelatedApartmentRow`와 동일한
패턴(lawdCd+dong으로 동명이 단지 오매칭 방지, canonical identity 우선). 라이브
검증: 힐스테이트이진베이시티아파트 클릭 → 정확한 단지 상세 페이지로 이동, 크래시
없음(§45).

## 18. Compare Connection

이번 STEP에서 Compare V2를 개발하지 않았다(지시 §26 준수). 실거래 row에서는
apt 상세로의 이동만 구현했다 — "비교에 담기" 버튼은 기존 compare state/helper의
안전한 확장 지점을 이번 STEP에서 추가 조사하지 않아 LATER_REQUIREMENT로 남긴다.

## 19. Regional Rankings

Feed 응답에 `topDongs`(거래건수 상위 5개 동), `topAreaBands`(10㎡ 단위 면적대별
거래건수 상위 5개)를 포함한다 — 기간·기준을 응답 자체(`period.label`)로 항상
표시. 별도 "거래량 많은 단지/신고가 많은 단지" 랭킹 화면은 이미 존재하는
`top-traded`/`record-high` 탭이 이 역할을 하고 있어 중복 구현하지 않았다.

## 20. Filters

핵심 3개만 노출: 기간(preset chip), 거래유형(전체/매매/전세/월세 토글),
지역(전역 공유 RegionContext). 가격대/면적 filter는 이번 V1에서 패널로
추가하지 않았다(§28 "과도한 filter panel 금지" 원칙, LATER 후보로 문서화).

## 21. Pagination

offset 기반, 기본 50건/최대 200건(`MAX_LIMIT`), "더보기" 버튼으로 누적 로드.
서버가 한 번에 수천 건을 반환하지 않는다(§31).

## 22. Performance

거래 row 개수만큼 MOLIT을 호출하지 않는다 — 조회 기간을 커버하는 "달" 개수만큼만
배치 호출(§10). 5분 TTL 서버 캐시(`getOrSetCache`, 기존 rankings/dashboard와
동일한 인메모리 캐시 재사용, 신규 캐시 인프라 추가 없음). 콜드/웜 실측(§33 참고).

## 23. Mobile

당근 UX 참고: 상단 고정 지역 필터, 가로 스크롤 기간 chip, 날짜 그룹 헤더, compact
거래 카드(단지명/badge → 가격/변동 → 동/면적/층/일자). 360px/390px 실측
확인(§37) — 가로 스크롤/클리핑 없음, 요약 카드 grid가 자동으로 줄바꿈.

## 24. Desktop

동일 컴포넌트를 그대로 사용(모바일 카드를 억지로 늘리지 않음) — 852px 데스크톱
너비에서도 필터+요약+피드 흐름이 자연스럽게 유지됨을 확인(§37과 동일 스크린샷
세트).

## 25. Error/Empty

`data.apiError`(진짜 API 실패, 국토부 응답 에러) vs `summary.totalCount===0`
(기간 내 실거래 없음)을 명확히 분리 — 같은 "거래 없음" 텍스트를 쓰지 않는다
(§39 지시 그대로 구현, `TransactionFeedView.tsx`의 조건 분기 참고).

## 26. Cancelled Trades

시장 집계(신고가/상승/하락/거래량)에서 기본 제외(`filterVerifiedTrades`) —
기존 `gap-invest-calc.ts`/`school-trade-price.ts`가 이미 확립한 원칙을 그대로
재사용했다. 원거래 자체는 숨기지 않고 feed 목록에 "취소" badge와 함께 표시한다
(§40 지시 준수).

## 27. Data Freshness

Feed 상단에 "실거래 신고 기준이며, 신고 시차로 최근 며칠간 거래는 이후 추가될
수 있어요" 고지 문구를 고정 표시해, 실시간 체결처럼 오해하지 않도록 했다(§41).

## 28. Alert Future

당근의 "지역 실거래 알림" 개념은 유용하지만, 이 앱에 실제 notification
시스템이 아직 없어(§35 지시대로) 가짜 버튼을 넣지 않았다. **LATER_REQUIREMENT**:
서구 실거래 알림/대신동 신고가 알림/84㎡ 5억 이하 거래 알림/관심단지 거래
알림 — 향후 알림 인프라가 생기면 이 feed의 필터 상태(지역+기간+dealType+가격대)
를 그대로 알림 조건으로 재사용할 수 있는 구조로 이미 설계돼 있다(쿼리 파라미터
기반).

## 29. QA

`scripts/run-statistics-v2-qa.ts`(신규, read-only, 실행 중인 dev 서버의
`/api/stats/feed`를 직접 호출) — identity/region/기간경계/취소거래/중복/날짜
그룹/집계 정합성/apartment 링크 안전성/fixture 단지 존재여부를 검사한다. 이
기능이 DB 테이블이 아니라 라이브 API 기반이라(§7) DB 쿼리 대신 API 응답 검증
방식을 택했다. 실행 결과: P0 findings 0건, RELEASE GATE = READY(§46 상세는
최종 리포트 참고).

## 30. Remaining Gaps

- 가격대/면적 filter 패널 미구현(LATER, §20).
- Compare 연결("비교에 담기") 미구현(LATER, §18, 이번 STEP 범위 밖으로 명시됨).
- 지역 실거래 알림은 UI placeholder도 넣지 않음(§28, notification infra 부재).
- URL에 period/dealType 상태가 반영되지 않음(공유 가능한 region URL은 기존
  `/stats?sido=&sigungu=` 수준까지만 — feed 자체의 기간/거래유형 상태는 세션
  로컬 state, §34 "가능하면"이라 이번 V1에서는 구현하지 않음).
- 기존 통계 화면(rankings/dashboard/transactions)의 `/3.3058` 가짜 평형 계산은
  이번 STEP에서 새로 만들지 않았지만 여전히 남아 있다 — 별도
  FIX_STATISTICS_DATA_TRUST STEP으로 분리 권고(§6 감사에서 발견, 이번 신규
  기능 코드에는 반영하지 않음).
- API 실패/거래없음 구분은 "조회 기간에 거래가 0건일 때"만 추가 probe로
  확인한다(진단성 1회 호출) — lookback 12개월 구간 전체에 대해서는 기존
  rankings/dashboard와 동일하게 이 구분이 완전하지 않다(기존 정밀도 유지,
  악화시키지 않음).
