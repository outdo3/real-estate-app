# E-JIP REGIONAL PRICE COMPARISON V1 — 하위 지역별 평균 매매가격

- 날짜: 2026-09-19 (KST) · 기준 커밋 `1b89c7b`
- 범위: 통계 거래량 화면(`/stats/volume`)에 하위 지역 가격 비교 섹션 추가(옵션 A). DB write 0 · schema 0 · 새 쿼리 0 · 취소 repair 0 · 결함 B 0 · price-rankings 0.

## 목적

"매매 중앙가격" KPI 하나로는 지역 안의 가격 차이가 보이지 않는다. 선택한 기간 그대로
- 부산 전체 → **구별 평균 매매가격**(16개 구·군)
- 부산의 구 → **동별 평균 매매가격**(법정동)

을 보여준다.

## 정의

| 항목 | 결정 |
|---|---|
| 평균 | 기간 안 유효(취소 아님) 매매 행 거래금액의 산술평균(만원 반올림). 현재 DB 상태 그대로(false-cancel 28행·결함 B 미수정) |
| 건수 | 유효 행 하나 = 한 건(내용 dedupe 없음 — TOP_COMPLEX_AGGREGATION_TRUST_AUDIT_V1) |
| 지역 identity | 구: `lawdCd`. 동: 그 구 행의 `dong`(원천 법정동 umdNm). 행정동 추정 없음 |
| 기간 | 거래량 요약과 같은 `resolveVolumePeriod` — 오늘·어제·7일·15일·30일·3개월(기존 달력 3개월 정의 유지) |
| 거래 없음 | 평균을 만들지 않는다(`avgAmount: null`) → "거래 없음". 0원 평균 표시 없음 |
| 표본 적음 | 5건 미만에 "표본 적음" 표시. 숨기지 않는다(최소 건수 필터 없음) |
| 정렬 | 평균 높은 순 → 건수 많은 순 → 지역명. 거래 없는 지역은 맨 뒤 |
| ㎡당 | 보조 문구(면적 유효 거래의 금액÷전용면적 평균). 면적 없으면 생략 |
| 동 목록 | 최근 12개월 유효 거래에 실제로 나타난 법정동. 기간 안 거래가 없으면 "거래 없음" 행 |

### 표본 기준 5건 근거 (Read-only 실측, 부산)

동 단위는 30일에도 1건·2~4건 동이 흔하다(서구 30일 12개 동 중 1건 4 · 2~4건 5). 기존 브리핑 해석 기준(`MIN_SAMPLE_FOR_INTERPRETATION = 10`)을 쓰면 서구 30일 12곳 중 10곳이 "표본 적음"이 돼 라벨의 변별력이 없어진다. 평균 하나를 보여주는 데 1건 평균은 곧 그 거래가격이라는 점만 분명히 하면 되므로 5건 미만으로 정했다. 숨김 기준이 아니라 표시 기준이다.

## 구현

| 파일 | 내용 |
|---|---|
| `src/lib/stats/region-price-comparison.ts` (신규) | 순수 함수 `buildRegionPriceComparison` · `dongUniverseFromTrades` · `formatRegionAvgPrice` |
| `src/app/api/stats/dashboard/route.ts` | 이미 읽은 12개월 `verifiedApt`(요약 `sale`과 같은 행)로 6개 기간 `regionPriceByPeriod` 계산. 시도 전체의 구 목록은 이미 부르는 `getSigunguListForSido` 결과 재사용. 캐시 키 v4 → v5 |
| `src/components/stats/VolumeChartCard.tsx` · `.module.css` | 요약 KPI 아래·거래 많은 단지 위에 섹션. 매매 칩에서만 표시. 상위 5 + "전체 N곳 보기"/"접기". 각 행: 순위·지역명·평균가 + "N건 · ㎡당 M만원 · 표본 적음" |

N+1 없음 — 새 DB/외부 호출이 없다. 한장 브리핑의 중앙가격 KPI는 그대로 둔다.

## 건수 대조 (로컬 production build, 실 DB read-only)

하위 합계 + 미분류 = `volumeSummaryByPeriod[p].sale.currentCount` — 4개 범위 × 6개 기간 **24/24 MATCH**, 미분류 0.

| 범위 | 7일 | 15일 | 30일 | 3개월 |
|---|---|---|---|---|
| 부산(16구) | 228 | 792 | 1,912 | 6,769 |
| 서구(19동) | 10 | 34 | 62 | 214 |
| 해운대구(7동) | 29 | 95 | 237 | 838 |
| 사하구(8동) | 23 | 49 | 176 | 543 |

## 알려진 한계

- 평균은 면적·단지 구성의 영향을 크게 받는다(소형 위주 동은 낮게 나온다). 화면에 "시세를 뜻하지 않아요"를 밝혔다.
- 정렬이 평균 기준이라 짧은 기간에는 1건짜리 동이 1위가 될 수 있다(예: 해운대구 7일 중동 1건). "표본 적음" 라벨로 드러낸다.
- 한장 브리핑/이미지: `DistributionSection`(구·군별/동별 거래 분포)에 평균을 붙이면 레이아웃이 바뀌어 FOLLOW_UP.

## 테스트

`src/lib/stats/region-price-comparison.test.ts` 20개. 기존 계약 테스트 2개 캐시 키 v4 → v5 갱신(`period-parity`, `volume-period`).
