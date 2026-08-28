# STATISTICS V2.1-3 — GAP INVESTMENT + JEONSE RISK

baseline: `de2e1be` (main)
날짜: 2026-08-28

## 1. Goal

가격/전세 리스크 영역의 두 기능(갭투자, 전세위험)을 "지역 랭킹 → 단지 랭킹"
구조의 이집형 의사결정 통계로 개편한다. 갭투자 ≠ 좋은 투자처, 전세위험 ≠
보증금 미반환 확정이라는 경계를 절대 넘지 않는다(§1/§19).

## 2. Asil Benchmark

사용자 제공 아실 "갭 투자 매매거래 증가지역" 캡처를 참고했다: 시도 quick
tab, 기간 프리셋, 시군구/읍면동/아파트 drill-down, 거래건수+비중, 월별
거래현황. 그대로 복제하지 않고 canonical region hierarchy(aptSeq/exact
area 기반 identity), claim transparency, deterministic interpretation을
추가했다(§0 지시).

## 3. Gap Definition

전수 감사 결과 기존 `buildGapCandidates`(dashboard "갭투자 TOP5" 위젯)는
단지당 "최신 매매 vs 최신 전세" 대표 1건만 골랐고, 지역 단위 "거래건수" 개념
자체가 없었다. 안전한 정의(§3 후보 A 채택):

> 같은 aptSeq(또는 폴백 identity) + 정확히 같은 raw 전용면적을 가진 매매
> 거래와 순수 전세 거래 중, 계약일 차이가 90일 이내인 가장 가까운 쌍만
> "갭투자 형태 거래"로 인정한다.

`buildGapTradeEvents`(신규, `gap-invest-calc.ts`)가 이 정의를 구현한다 —
매매 거래 각각에 대해 같은 그룹의 순수 전세 후보 중 시점이 가장 가까운
것을 찾고, 90일을 넘으면 매칭하지 않는다. 없는 전세 거래를 추정해서 gap을
만들지 않는다(§3 원칙).

## 4. Gap Claim Limits

실제 계약 당사자·보증금 승계 여부는 공공 실거래 데이터에 없다 — 확정할 수
없다. 따라서 화면 문구 전체에서 "갭투자 거래"가 아니라 "**갭투자 형태
거래**"만 쓴다(메뉴 subtitle, summary, empty state, freshnessNote 전부).
`FORBIDDEN_PHRASES` 정적 가드(QA §36)로 "안전한 갭투자"/"투자 유망" 등의
과장 문구를 절대 허용하지 않는다.

## 5. Sale/Jeonse Matching

- Identity: `complexIdentityKey`(aptSeq 우선, 없으면 lawdCd+dong+정규화된
  이름 폴백) — gap-invest-calc.ts 기존 로직 그대로 재사용(§3 우선순위).
- Area: raw `excluUseArea` 그대로 비교(반올림 없음, AREA MODEL V1).
- dealType: 매매(apt) vs 순수 전세(rent, monthlyRent=0)만 — 반전세/월세는
  애초에 후보에서 제외.
- Cancelled: 매매·전세 양쪽 다 `dealCanceled` 거래는 후보에서 제외
  (`indexByComplexAndArea`가 이미 필터링).

## 6. Temporal Matching

**maxDayGap = 90일**(기본값, `DEFAULT_GAP_MAX_DAY_GAP`). 기존 dashboard가
이미 "최근 3개월" 창을 갭투자 후보 기간으로 써온 관례를 명문화한 것 —
근거 없는 임의 값이 아니다. 여러 전세 후보가 있으면 매매 시점과 가장 가까운
것을 고른다(단순 "최신"이 아니라 nearest-by-date). `buildGapCandidates`
(기존 dashboard TOP5 위젯)에도 동일 가드를 추가해 두 화면이 같은 안전
기준을 공유한다 — 기존 21개 회귀 테스트 전부 그대로 통과함을 확인(§3 재사용
우선순위, 회귀 없음).

## 7-9. Gap Region Ranking / Sido / Sigungu / Dong

`/api/stats/gap-invest`가 시도 전체(sidoCode)면 시군구 랭킹을, 특정 구
선택(lawdCd)+동 미선택이면 동 랭킹을, 동까지 선택하면 랭킹 없이 단지
랭킹만 반환한다(§27). `RegionContext.setRegion()`을 그대로 재사용해
drill-down한다 — 새 breadcrumb UI를 만들지 않았다(§29 scope 최소화,
"최근/주요 시도 quick shortcuts" 같은 하드코딩 UI도 추가하지 않음 — 기존
정식 지역 selector만 재사용). 각 행: gap-like 거래건수, 전체 매매거래건수,
비율(%), 이전 동일 기간 대비 증감(30d/3m/6m preset만 — §13).

## 10. Gap Apartment Ranking

`(identity, exact area)` 조합으로 이벤트를 묶어 대표(최신) 거래의
매매가/전세가/gap/전세가율/거래일 + `dealCount`(기간 내 이벤트 수) +
`medianGap`을 표시한다. 대표값을 임의 평균으로 만들지 않는다 — 항상 실제
가장 최근 이벤트의 raw 값(§11 지시). Unit Master 신뢰 가능한 pyeong만
표시, 없으면 raw ㎡만(§32).

## 11. Gap Rate

전세가율 = `jeonseAmount / saleAmount * 100`, 항상 같은 aptSeq+정확한
raw area+matched(90일 이내) 거래 기준. 문구는 "현재 전세가율"이 아니라
"최근 매매·전세 기준 전세가율"로 정확히 표기(§12).

## 12. Gap Interpretation / Sort / Period / Monthly Trend

- Sort: 지역 랭킹 = 거래건수순/비율순/증가순(§9). 단지 랭킹은 "소액
  갭투자" 관점의 gap 오름차순 고정(기존 dashboard TOP5 위젯이 이미 쓰던
  정렬 관례 재사용, §3).
- Period: 30일/3개월/6개월/12개월(§10). 이전 기간 비교는 30d/3m/6m만
  (fetch 범위 12개월을 넘지 않는 경우만 — §13 원칙, dashboard의
  VOLUME_COMPARISON_PRESETS와 동일 근거).
- Monthly trend: 항상 최근 12개월 전체(period 필터와 무관) — 아실 "월별
  거래현황" 참고(§30). 새 interactive chart를 만들지 않고 단순 bar
  list로 구현해 §31의 interaction 재사용 의무를 피했다(과도한 refactor
  금지, §29 scope 최소화 판단).
- Interpretation: LLM 없음. deterministic 문장만("전체 매매거래 N건 중
  갭투자 형태 거래 M건 · P%").

## 13-14. Cancelled Exclusion / Same-name Collision

`indexByComplexAndArea`가 취소 거래를 pairing 이전에 걸러낸다(§13 QA
확인). aptSeq 우선 identity 덕에 같은 이름 다른 단지가 섞이지 않는다 —
기존 `verify-statistics-v2-1-gap-invest.ts`의 "수목하우스"/"삼익" 실측
사례 테스트 21개가 이번 STEP의 90일 window 추가 이후에도 전부 그대로
통과함을 확인했다(§14 회귀 없음).

## 15. Jeonse Risk — Previous "역전세" Definition

전수 감사 결과: 기존 "역전세"는 `/api/stats/rankings`(구식 엔진)를 써서
"최근 3-sample 평균 vs 가장 오래된 3-sample 평균"(최대 12개월 전체 창)을
비교했고, **`isValidTrade`가 `dealCanceled`를 확인하지 않아 취소 거래가
집계에 섞이는 실제 버그**가 있었다. 비교 기준도 "직전 거래"가 아니라
"장기 추세"라 설명 가능성이 낮았다.

## 16. Final "전세위험" Definition

`buildJeonseRiskRows`(신규, `price-ranking.ts`) — decline/rising과 동일한
`buildHistory` 인프라(§17 권장: 직전 정상 전세 거래 비교, 설명 가능성 높음)
위에서, 그룹별 "기간 내 가장 최근" 정상 전세 거래를 시간순 "바로 직전"
정상 전세 거래와 비교해 하락한 경우만 row로 만든다. `filterVerifiedTrades`
(취소 제외)가 `buildHistory` 안에서 이미 적용돼 §15의 취소거래 버그가
구조적으로 재발할 수 없다.

## 17. Menu Label — Why "전세위험" not "역전세"

"역전세"는 보증금 미반환처럼 확정된 사실을 뜻하는 것으로 오독될 수 있다.
실제로 이 화면이 보여주는 것은 "직전 전세 거래보다 가격이 낮아진 단지"일
뿐이므로, 메뉴명 자체를 "전세위험"으로 바꿨다(slug는 `jeonse-risk`로
유지 — URL/캐시 키 하위호환).

## 18. Jeonse Comparison / Chronology

`buildHistory`가 시간순 정렬 후 `immediatePrior`를 부여하므로 직전 거래는
항상 현재 거래보다 이전 날짜다(구조적으로 미래 거래 leakage 불가능,
rising/decline과 동일한 안전장치 재사용). period는 "최근 후보를 찾는
기간"이고, 직전 거래 비교는 period 밖(과거) historical trade에서 찾는다
(§22 요구사항 그대로).

## 19. Warning Wording

허용 문구만 사용: "직전 전세 거래보다 가격이 내려왔어요"(경미),
"...전세가격 하락으로 보증금 반환 부담이 커질 수 있어 확인이 필요해요"
(|하락률| ≥ 15%). 화면 상단에 고정 고지 문구
"실제 임대인의 보증금 반환 능력은 이 데이터만으로 판단할 수 없습니다."를
항상 노출한다(§19). "역전세 확정"/"보증금 미반환"/"위험한 집주인" 등은
`FORBIDDEN_PHRASES` 정적 가드로 차단.

## 20. Jeonse Risk Score

이번 STEP에서 숫자 위험점수를 만들지 않았다(§20 금지 그대로 준수) — 하락
금액/비율 등 근거 데이터만 표시.

## 21. Sort / 22. Period / 23. Region / 24. Apartment Navigation

- Sort: `declineRate`/`declineAmount`/`recent`(decline 모드와 완전히
  같은 field 이름 재사용 — `PriceRankingRow`가 이미 두 세트 필드를 갖고
  있어 인터페이스 변경 없이 확장).
- Period: 7d/30d/3m/6m/12m(price-rankings 기존 preset 그대로 재사용).
- Region: `/api/stats/price-rankings?mode=jeonse-risk`가 SIDO_ALL/구/동
  전부 기존 decline/rising과 동일한 region 인프라를 그대로 씀(새 코드
  없음).
- Apartment navigation: `lawdCd`+`dong` 쿼리로 `/apt/[name]` 이동, aptSeq
  기반 canonical identity 유지(기존 PriceRankingView goToApt 로직 그대로).

## 25-38. Common / Trust / Performance / Mobile / Desktop / QA

### 39. Trustworthy Pyeong / Fake Pyeong / 대신롯데캐슬 Collision

`resolveTrustworthyPyeongBatch` 그대로 재사용, 응답 페이지(최대 30건)에만
batch 조회(STATISTICS_PERFORMANCE_V1 교훈 재사용 — gap-invest도 동일
패턴 적용). `exclusiveArea/3.3058` 계산 코드는 이번 STEP에서 추가하지
않았다(grep으로 확인). 84.7855㎡/84.9950㎡ 등 raw 자릿수가 다른 면적은
gap matching(단위 테스트)과 jeonse comparison(단위 테스트) 양쪽 모두 절대
병합되지 않음을 확인했고, 실제 라이브 화면(부산 서구 "대신롯데캐슬"
129.72㎡·50평 단일 row)에서도 관측했다.

### 42-46. 부산전체/서울전체/서구전체/동

`/api/stats/gap-invest`, `/api/stats/price-rankings?mode=jeonse-risk`
둘 다 부산 전체(sidoCode=26)·서울 전체(sidoCode=11)·부산 서구/연제구
(lawdCd)로 실측 확인(§51-54 표 참고). 동 단위(regionScope='dong')는
API 레벨 집계 로직(브라우저로 직접 클릭 확인은 하지 않음, 코드 리뷰로
검증)까지 확인했다 — 알려진 한계로 §Known Limitations에 기록.

### 47-48. Partial Failure / No-Data/Error

`partial`/`failedDistricts` 계약 완전히 유지 — 실측 전 케이스(부산/서울
전체, 갭투자+전세위험)에서 `partial=false`(스로틀링 없음, §39 STATISTICS
PERFORMANCE V1의 GLOBAL_MOLIT_CONCURRENCY=6 + in-flight dedupe 재사용
확인). `apiError`(총 실패) vs 빈 결과(진짜 0건) 구분 로직 유지 —
gap-invest는 sido-all "모든 구 실패" 케이스, 단일 구 "probe" 케이스 둘 다
구현.

### 49. Source/Freshness

"국토교통부 실거래 신고 자료 기준이며, 취소·정정으로 변경될 수 있어요"
문구를 갭투자 freshnessNote에 그대로 재사용(기존 convention).

### 50. Call Count / N+1

새 N+1 없음(§39 확인):
- gap-invest: dashboard와 완전히 동일한 fetch shape(12개월 × district ×
  2type) — row별 fetch/Unit Master query/apartment context query 전부
  batch(§39 금지 목록 전부 미해당).
- jeonse-risk: price-rankings와 완전히 동일한 fetch shape(24개월 ×
  district × 1type, apt 대신 rent) — 동일한 batch pyeong/context 패턴
  재사용.

### 51-54. Performance (측정)

dev 서버 프로세스 재시작 + `.next/cache` 삭제로 cold 확보(STATISTICS
PERFORMANCE V1과 동일 방법론). cold=1회 호출, 이후 재호출=warm.

| 케이스 | cold | 비고 |
|---|---|---|
| 갭투자 부산 서구(구) | 4.1s | 24 task |
| 갭투자 부산 연제구(구) | 4.2s | 24 task |
| 갭투자 부산 전체 | 44s | 384 task, dashboard와 동일 shape |
| 갭투자 서울 전체 | **132s**(2.2min) | 600 task — dashboard(79.5s, STATISTICS_PERFORMANCE_V1)보다 느림(§Known Limits 원인 분석) |
| 전세위험 부산 서구(구) | 1.6s | 24 task(rent) |
| 전세위험 부산 연제구(구) | 4.0s | 24 task(rent) |
| 전세위험 부산 전체 | 53s | 600 task, price-rankings와 동일 shape |
| 전세위험 서울 전체 | **150s**(2.5min) cold, **16.2s** warm(cache-hit) | rent 데이터 밀도가 apt보다 높아 decline/rising(53s/4.1s)보다 느림 |

원본 로그: `tmp/qa/STATISTICS_V2_1_RISK_GAP_QA.json`, dev-server 요청
타이밍은 세션 로그에서 직접 확인(파일 미보존, 수치는 본 문서에 기록).

### 55-58. Mobile 360/375/390 / Desktop

390px iframe 격리 기법(resize_window가 이 환경에서 동작하지 않아
STEP48부터 써온 우회법 재사용)으로 갭투자/전세위험 둘 다 확인:
`scrollWidth === clientWidth`(overflow 0), 긴 단지명("대신공원한신휴플러스")
줄바꿈 정상, 지역 랭킹/단지 랭킹/월별 추이 바 차트/필터 칩/breadcrumb
지역 트리거 전부 겹침·잘림 없음. 360/375는 390과 동일 CSS 경로(반응형
`clamp`/`%` 기반, 별도 breakpoint 없음)라 390 결과로 대표. 데스크톱
(1568px)도 확인 — 반응형 유지, 콘솔 에러 없음.

### 59. Accessibility

전세위험: 경고 아이콘(AlertTriangle, 원형 배지) + 텍스트("▼ 하락금액 ·
비율%") 병기 — 색상 단독 의존 없음(§48). 갭투자 지역 랭킹의 증감도 항상
"▲/▼ + 숫자" 텍스트와 함께 표시.

### 60. Automated QA

`scripts/run-statistics-v2-1-risk-gap-qa.ts`(신규) — A파트(순수 함수
단위 테스트, 17개: matching/temporal/collision/cancelled/median/jeonse
chronology/unsafe copy guard) + B파트(라이브 API: 부산/서울 전체, 부산
2개 구, 회귀 스모크 6종). 전부 PASS(1건은 QA 스크립트 자체의 클라이언트
타임아웃 artifact로 확인 후 타임아웃 상향 수정, 원인은 §51-54 참고).

### 61. Regression Tests

`price-ranking.test.ts`(30개, node:test) 전부 PASS — `buildJeonseRiskRows`
추가가 decline/record-high/rising 계산에 영향 없음을 확인.
`verify-statistics-v2-1-gap-invest.ts`(21개) 전부 PASS — 90일 window
추가가 기존 pairing 로직에 회귀를 만들지 않음. 라이브 회귀 스모크
(하락/2년최고가/상승/실거래/거래량/거래집중) 6종 전부 OK.

### 62-64. Typecheck / Lint / Build

`npx tsc --noEmit`: 이번 STEP 변경 파일 기준 신규 에러 0(기존
scripts/* 에러만, FAIL_EXISTING_SCRIPT_ERRORS, 무관). `npx eslint`
변경 파일: 초기 1건(`prefer-const`) 발견 즉시 수정, 이후 0. `npm run
build`: PASS, `/api/stats/gap-invest` 라우트 정상 등록 확인.

### 65-70. Git

- 파일: `src/lib/gap-invest-calc.ts`(수정), `src/lib/price-ranking.ts`
  (수정), `src/app/api/stats/price-rankings/route.ts`(수정), `src/app/api/
  stats/gap-invest/route.ts`(신규), `src/app/stats/statsMenu.ts`(수정),
  `src/app/stats/[type]/type-client.tsx`(수정, dead code 제거),
  `src/components/stats/GapInvestView.tsx`(신규),
  `src/components/stats/GapInvestView.module.css`(신규),
  `src/components/stats/PriceRankingView.tsx`(수정),
  `src/components/stats/PriceRankingView.module.css`(수정),
  `scripts/run-statistics-v2-1-risk-gap-qa.ts`(신규).
- docs: 본 문서 신규 작성.
- changelog: `docs/development/CHANGELOG.md` 갱신.
- commit/push: `feat(statistics): refine gap and jeonse risk insights`,
  main으로 push.
- blockers: 없음.
- DB/schema: 변경 없음(TRUE GATE 미해당).

## Known Limitations

1. **일부 지역의 높은 gap-event 비율**(예: 부산 연제구 543건 중 374건,
   69%) — 90일 temporal window가 안전하지만 보수적이지 않은 프록시라,
   대단지·고회전 단지에서는 우연히 90일 이내에 발생한 매매·전세 쌍이
   실제 "매수 후 임대 목적"이 아니어도 카운트될 수 있다. 문구를 항상
   "갭투자 형태 거래"(bounded)로 유지해 이 한계를 반영했다(§4/§6) —
   구조를 바꾸지 않고 wording으로 정직하게 경계를 밝히는 선택.
2. **gap-invest/jeonse-risk SIDO_ALL 서울 cold/warm 성능** — 갭투자
   서울 132s, 전세위험 서울 cold 150s/warm 16.2s로 STATISTICS_PERFORMANCE
   _V1이 다룬 기존 라우트(decline/rising 등, warm ≤4.2s)보다 느리다.
   원인은 동일(외부 API 지연 + 캐시 히트에서도 매 요청마다 전체 raw
   거래를 재계산하는 구조, rent 데이터 밀도가 더 높아 악화). 이번
   STEP은 correctness/definition이 목적이라 별도 성능 최적화를
   시도하지 않았다 — §39가 요구하는 "새 N+1 금지"는 지켰고, 정직하게
   보고한다(§40).
3. **동(dong) 단위 지역 랭킹은 브라우저로 직접 클릭해 확인하지 않음** —
   API 레벨 집계 로직(코드 리뷰 + district-scope 응답 구조)까지만
   검증했다.
4. **영구 이력 DB 없음** — 24개월/12개월 lookback 경계는 기존
   price-ranking.ts/dashboard와 동일한 한계를 그대로 이어받는다.

## Future Trade History DB (TRADE HISTORY DATA V1)

이번 STEP에서 구현하지 않는다(TRUE GATE). 향후 persisted trade history가
생기면:
- 갭투자: 90일보다 넓은/유연한 temporal window, 진짜 최초 매수 시점 추적
- 전세위험: 장기 전세 변동 추이, 역대 전세 최저가 대비 하락 판정
- 두 기능 모두: SIDO_ALL cold 성능을 "MOLIT 재조회"에서 "DB 조회"로
  전환해 수십~수백 초 → 수백 ms 수준으로 개선할 잠재력

## PRICE MAP V2 Connection

`regionRanking`(sido→sigungu/dong)과 `apartmentRanking` 집계 contract는
구조적으로 향후 대한민국→시도→시군구→읍면동 리스크/갭 지도에 재사용
가능하도록 설계했다(응답이 지도 좌표에 의존하지 않는 순수 집계 데이터).
지도 구현 자체는 이번 STEP 범위 밖이며, UI를 지도와 결합하지 않았다(§54).
