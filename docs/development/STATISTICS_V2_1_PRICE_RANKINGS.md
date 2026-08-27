# STATISTICS V2.1-1 — DECLINE + RECORD HIGH + RISING

## 1. Goal

통계 가격 카테고리 핵심 3개 화면(하락/신고가/상승)을 "단순 숫자 나열"에서
"사용자가 의미를 이해하고 단지 탐색으로 이어질 수 있는 의사결정형 통계"로
개편한다. 데이터 → 해석 → 비교 → 탐색 → 행동 흐름을 하나의 row 안에서
완결시킨다(비교 기준일 명시, deterministic 해석 문구, canonical 단지 이동).

## 2. Benchmark

아실의 요소(순위/지역/거래가격/면적/층/계약일/이전가격→현재가격)를 참고했지만
그대로 복제하지 않고 이집만의 차별점을 추가했다:

- 비교 기준일을 항상 명시(§10 evidence display) — "왜 이 숫자가 나왔는지" 확인 가능.
- 하락/신고가/상승 각각 다른 비교 기준(최고가 대비 vs 직전거래 대비)을 정확히
  구분 — 아실류 서비스가 종종 뭉뚱그리는 지점을 감사에서 발견하고 명시적으로
  분리했다(§4 참고).
- data trust(같은 aptSeq+같은 raw area, 취소거래 제외, 미래거래 누출 없음)와
  deterministic interpretation(LLM 없음, 증거 기반 문구만)을 전 row에 강제.

## 3. Common UX

세 화면 모두 신규 공용 컴포넌트 `PriceRankingView`
(`src/components/stats/PriceRankingView.tsx`)를 공유한다 — 중복 구현 없음.
공통 구조: 질문형 subtitle → 기간 chip → 정렬/면적 드롭다운 → summary →
row 리스트(순위/단지명/지역·면적·평형/현재가/변동/비교기준일/해석) →
더보기. jeonse-risk/top-traded는 이번 STEP 범위 밖이라 기존
`RankingListView`/`RANKING_CONFIGS` 경로를 그대로 유지했다(회귀 방지).

## 4. Decline Definition

기존 `/api/stats/rankings`의 하락 계산은 "최근 N건 평균 vs 오래된 N건 평균"
(단지 전체, 면적 무관)이었다 — 이번 감사에서 확인된 문제 2가지: (1) 같은
단지의 서로 다른 면적 거래가 섞일 수 있음, (2) "평균 대 평균"은 사용자
질문("과거 최고가 대비 얼마나 내려왔나")에 정확히 답하지 못한다.

새 정의(§8/§9, `src/lib/price-ranking.ts::buildDeclineRows`): (동일
aptSeq+동일 raw 전용면적) 그룹에서 기간 내 "가장 최근" 정상 매매 거래 하나를
뽑아, 그 거래 **이전** 역대 최고가(같은 그룹, 취소 제외, 미래 거래 누출 없음)
와 비교한다. 이전 최고가가 없거나 현재가가 그 이상이면 하락 row가 아니다.
공식: `declineAmount = currentPrice - previousHistoricalHigh`,
`declinePct = declineAmount / previousHistoricalHigh * 100`.

## 5. Record High Definition

`§11/§12`: 기간 내 각 정상 매매 거래에 대해 "그 거래 **이전** 역대 최고가"를
실제로 넘어섰는지 판정한다(`buildRecordHighRows`). 이전 최고가가 없는(그룹의
첫 거래) 경우 신고가 후보가 아니다 — "이전 최고가가 존재해야 함" 조건을
구조적으로 강제한다. 같은 그룹에서 기간 내 여러 건이 각각 경신했다면(예:
8월 5일 1차 경신, 8월 20일 2차 경신) 전부 별도 row로 남긴다 — 임의로 하나만
고르지 않는다.

## 6. Rising Definition

이번 STEP의 핵심 감사 결과(§14): 기존 하락/상승 계산이 "N-avg vs N-avg"였던
것과 달리, 상승은 **직전 거래**(역대 최고가가 아님) 대비로 정의해야 사용자
질문("최근 가격이 올랐나")에 정확히 답한다. `buildRisingRows`가 그룹별
"기간 내 가장 최근" 정상 거래를 시간순 바로 직전 거래와 비교한다. 하락 후
소폭 반등한 경우에도(역대 최고가보다는 훨씬 낮아도) 직전 거래보다만 높으면
상승 row로 정직하게 표시한다 — 역대 최고가와 혼동하지 않는다(단위
테스트로 이 구분을 명시적으로 고정).

## 7. Area Identity

세 화면 모두 `identityKey`(aptSeq 우선, 없으면 name+dong)와 `areaKey`(raw
전용면적 소수점 그대로)를 `regional-feed.ts`에서 재사용한다 — 84.7855㎡와
84.9950㎡을 하나로 합치지 않는다(§21 unit collision, 대신롯데캐슬 fixture로
실측 확인: raw area 4종이 병합 없이 유지됨).

## 8. Pyeong Rule

`src/lib/statistics-pyeong-resolver.ts`(FIX_STATISTICS_DATA_TRUST STEP에서
이미 구축)를 그대로 재사용 — Unit Master `representativePyeong`이 있고
`representativePyeongSource !== 'UNKNOWN'`이며 raw area가 정확히 일치할
때만 평형을 표시한다. 없으면 `pyung: null`(raw ㎡만 표시). `exclusiveArea /
3.3058` 계산은 이번 신규 코드 어디에도 없다(QA 스크립트의 정적 가드로 확인).

## 9. Interpretation Rules

LLM 미사용, 전부 `price-ranking.ts`의 순수 함수(`buildDeclineInterpretation`/
`buildRecordHighInterpretation`/`buildRisingInterpretation`)가 산술적으로
검증 가능한 사실만 생성한다:

- 하락: -40% 이하 "과거 최고가와 차이가 크게 벌어졌어요", -20% 이하 "과거
  최고가보다 가격이 내려와 있어요", 그 외 "소폭 낮은 가격이에요".
- 신고가: 트레일링 12개월 표본 3건 이상이면 "최근 12개월 동일 면적 거래 중
  최고가예요", 아니면 "이 면적의 이전 최고가를 넘어섰어요".
- 상승: 트레일링 12개월 동일 그룹 검증 거래 3건 이상(§15 표본 규칙)이면
  "최근 거래가격이 이전보다 높은 수준에서 이어지고 있어요", 아니면 단순히
  "직전 거래보다 올랐어요"(1건 비교만으로 "상승세"라고 단정하지 않음).

"저평가"/"매수기회"/"싸다"/"반등 가능" 등 투자 권유형 표현은 코드 어디에도
없다(단위 테스트로 금칙어 부재 고정).

## 10. Filters

기간: 7일/30일/3개월/6개월/12개월(§5, 세 화면 공통 default=30일). 정렬:
하락(하락률순 기본/하락금액순/최근거래순), 신고가(최근순 기본/신고가
상승액순/신고가 상승률순/거래가격순), 상승(상승률순 기본/상승금액순/
최근거래순) — §7 지시 그대로 구현. 면적: raw 전용면적을 10㎡ 단위로 묶은
표시용 밴드(`areaBandLabel`, regional-feed.ts 재사용, 그룹핑/비교 identity에는
전혀 영향 없음 — 순수 표시 필터).

## 11. Region

기존 REGION FILTER V2 인프라(`RegionContext`/`RegionSelectModal`/
`getSigunguListForSido`)를 그대로 재사용 — 새 selector 없음. 부산 전체/서울
전체/시군구 전체/동 레벨 전부 실측 확인(§31 QA fixture 결과 참고). 시도 전체
결과는 row마다 `sigunguName`(서버가 이미 조회해 둔 구 목록에서 파생, 추가
네트워크 호출 없음)을 붙여 "해운대구 우동"처럼 구+동을 함께 표시한다(§26,
동 이름만으로는 여러 구에 걸쳐 모호할 수 있음).

## 12. Sorting

`/api/stats/price-rankings`가 `sort` 쿼리 파라미터로 8개 정렬 옵션을
지원한다(§7 표 그대로). 기존 API 확장이 아니라 신규 API라 하위호환 이슈
없음.

## 13. Error/NoData

`apiError`(국토부 API 총체적 실패) vs 결과 0건(해당 기간 내 진짜로 하락/
신고가/상승 조건을 만족하는 거래가 없음)을 명확히 분리해 서로 다른 문구를
보여준다. 시도 전체 집계에서 일부 구만 실패하면 `partial: true` +
`failedDistricts`로 부분 실패를 정직하게 알린다(기존 REGION FILTER V2
계약 그대로 재사용).

## 14. Mobile

360/375/390 전부 iframe-isolation으로 실측 — row 카드가 좁은 화면에서도
줄바꿈만 될 뿐 가로 스크롤/잘림 없음, 10억대 가격·두 자리 퍼센트·▼/▲
기호+텍스트+색상 병행 표시(§40 접근성) 전부 정상 렌더.

## 15. Performance

같은 (지역, 24개월 트레일링) 조합을 **기간/정렬/모드와 무관하게 한 번만
fetch**하도록 설계했다 — 사용자가 7일→30일→3개월로 기간을 바꿔도 재fetch
없이 서버 캐시(5분)에서 재계산만 한다. 실측(전체 QA 스크립트 실행 기준):

| 조회 | 결과 |
|---|---|
| 부산 서구/연제구/해운대구, 서울 강남구(4개 구 × 3개 모드) | 전부 정상, 초 단위 이내 |
| 부산 전체 신고가(단독, cold) | 58.8초 |
| 부산 전체 신고가(warm, 재요청) | 2.7초 |
| 부산 전체(decline/record-high/rising 3모드 순차) | 전부 성공, distinctDistricts 12~14 |
| 서울 전체(decline/record-high/rising 3모드 순차) | 전부 성공, distinctDistricts 17~20 |

기존 STATISTICS DATA TRUST STEP의 dashboard sido-all(62.6초 cold)과 동일한
규모(24개월×16~25구×apt 1타입)라 그 STEP에서 이미 disclosure된 한계를
그대로 유지했다 — 이번 STEP이 새로 악화시키지 않았다(§31 요구사항 충족).
대규모 성능 인프라 재설계는 하지 않았다(§31 지시대로 범위 밖).

## 16. QA

신규 `scripts/run-statistics-v2-1-price-ranking-qa.ts`(read-only, 라이브
API 검증): decline/record-high/rising 공식 정합성, groupKey same-area
정합성, 정렬 정확성, 중복 row 부재, canonical 링크 안전성(name/lawdCd
존재), fake-pyeong 정적 가드, Unit Master collision(대신롯데캐슬 4종 raw
area), 시도 전체(부산/서울) 실제 다구 혼재 확인 + sigunguName 존재 +
partial 필드 계약. 계산 로직 자체는 `src/lib/price-ranking.test.ts`(27개
단위 테스트: 하락/신고가/상승 각 정의, 취소거래 제외, 미래거래 누출 부재,
표본 규칙, unit collision, interpretation 금칙어 부재)로 이미 커버.

실행 결과: P0 findings 0건, RELEASE GATE = READY.

## 17. Known Limitations

- historical high window를 "전체 역사"가 아니라 트레일링 24개월로 제한했다
  (§12 원문의 "전체 history" 지시와 실제 성능 제약 사이의 절충 — 문서화
  요구사항 그대로 명시). 24개월보다 오래된 유일한 과거 최고가는 이번
  구현에서 보이지 않는다.
- 면적 필터는 표시용 10㎡ 밴드이며 정확한 raw area 단위 필터(예:
  "84.7855㎡만") 드롭다운은 제공하지 않는다(사용성/성능 절충).
- URL 상태 동기화(§29)는 API 파라미터 수준(`?mode=&lawdCd=&period=&sort=`)
  으로는 이미 가능하지만, 브라우저 주소창에 실제로 반영하는 것은 이번
  STEP에서 구현하지 않았다(REGION FILTER V2 STEP이 이미 남긴 동일한 gap과
  같은 범주, 대규모 라우팅 리팩터 필요 시 후속 STEP으로 defer).
- 사도 전체 성능(부산 58초, 서울은 구 수가 더 많아 더 느릴 것으로 예상)은
  여전히 느리다 — 새 캐시 레이어(예: 계산 결과 자체를 캐싱)가 필요하면
  스키마 변경 없이도 가능하지만 이번 STEP 범위 밖(§31 "대규모 성능 infra
  재설계 금지").

## 18. Next Step

FIX_PRICE_RANKINGS(발견된 gap이 있다면) 또는
STATISTICS_V2_1_TRANSACTION_ACTIVITY(다음 카테고리 확장) 중 PM 판단 필요.
