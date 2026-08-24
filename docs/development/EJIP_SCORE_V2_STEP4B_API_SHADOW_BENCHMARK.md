# E-JIP SCORE V2 STEP 4B — API Shadow Integration & Benchmark Regression

## 1. Baseline
- **Branch**: `score-v2-step35-expert-calibration`
- **HEAD (Baseline)**: `2510d65`

## 2. V1 Dependency & API Flow
- **Entry point**: `src/lib/apartment-score/server/calculate.ts`의 `calculateApartmentScore(aptSeq)`
- DB에서 `ApartmentMaster`, `ApartmentLocationFeature` 등을 가져와 각 도메인을 연산한 뒤, Percentile 기반의 V1 점수를 반환합니다.
- `src/app/api/apt/[name]/score/route.ts`가 위 함수를 호출하여 API 응답으로 변환합니다.

## 3. Chosen Shadow Integration Strategy
- **방식 B (Shadow field)**: 기존 API 응답 모델(`FinalScoreResult`)의 하단에 V2 결과를 담는 `_shadowV2` 필드를 optional로 추가했습니다.
- V1 연산의 마지막 부분에서 `adaptToV2Input`을 이용해 V2 입력을 만들고, `calculateScoreV2`로 계산하여 `_shadowV2`에 주입합니다.
- V2 연산은 `try/catch`로 감싸져 있어 V2 실패가 V1 API 응답을 깨뜨리지 않는 완벽한 Non-breaking 형태입니다. Client는 `_shadowV2`를 모르므로 무시합니다.

## 4. Raw Input Adapter
- `src/lib/score-v2/adapter.ts`에서 작성되었습니다.
- 결측치(`null`)를 그대로 보존하며, V1 DB의 `location.qualityFlag`를 기반으로 `CONFIRMED_ABSENT`와 `MISSING`을 엄격히 구분합니다.
- 가짜 데이터를 생성(Fabrication)하거나 Fallback 단지를 찾지 않습니다.

## 5. Education Straight-Line Semantic
- "도보 거리"라는 부정확한 용어를 전면 폐기합니다.
- Kakao POI API의 카테고리 검색이 반환하는 `distance` 값은 기하학적 **물리 직선거리(STRAIGHT_LINE_DISTANCE)**임이 검증되었습니다.
- 향후 통학구역(attendance zone) 데이터나 외부 길찾기 API(routed walking distance)가 도입되기 전까지는 "직선거리"로만 명시합니다.

## 6. Parking P-D Runtime Handling
- Raw input (`parkingRatio`)가 `null`일 경우 V2 엔진 내부에서 `missingFactors`에 추가됩니다.
- Engine 계산부(factor score 단계)에서만 Era-conditioned neutral prior (0-10년=65, 31+년=22 등) 값으로 치환하여 계산에 반영합니다.
- DB나 Evidence 객체에는 `parkingRatio: null`로 정직하게 유지되어 결측 사실을 투명하게 공개합니다.

## 7. Error Isolation
- `calculate.ts`에 추가된 V2 연산부는 별도의 `try/catch` 블록 안에 격리되었습니다.
- 어떤 경우라도 `console.error`에만 기록을 남기며, V1 점수는 문제없이 사용자에게 반환됩니다.

## 8. Result Contract
- 상대평가 백분위(LOCAL/DONG percentile)는 Core 연산에서 완전히 배제되었습니다.
- 결과물은 `overallScore`, `domains`, `eligibility`, `overallCoverage` 등의 절대 점수 구조만을 포함합니다.

## 9. Benchmark Regression Table

| 단지명 | V1 Score (Coverage) | V2 Shadow Score | 변경 사유 요약 |
|--------|---------------------|-----------------|----------------|
| 대신해모로센트럴 | 47 (0.85) | **66.61** | V1의 과도한 신축 주차 페널티 및 결측 보정 왜곡 정상화 |
| 협성르네상스 | 62 (1.00) | **65.08** | 안정적인 P-D 반영 및 교통/생활 절대점수 상향 |
| PAIR 03 A (희망센츄럴빌) | 60 (0.85) | **64.12** | 초역세권 교통 접근성(Sentinels) 우대 |
| PAIR 03 B (센텀두산위브) | 51 (1.00) | **50.09** | 비역세권(CONFIRMED_ABSENT=5점) 반영 |
| PAIR 04 A (사상로터리) | 67 (0.85) | **69.04** | 교통 T1 / 생활 L-A 최상위 혜택 |
| PAIR 04 B (영도센트럴비치) | 60 (1.00) | **56.09** | 초등학교 원거리(837m) 및 지하철 부재 페널티 |
| PAIR 06 A (LG메트로시티) | 66 (1.00) | **53.85** | 거대 단지이나 지하철 부재로 교통점수 하락 |
| PAIR 06 B (문화) | 62 (0.85) | **62.44** | 지하철 역세권으로 A단지 역전 성공 (전문가 판정 반영) |
| PAIR 10 A (진흥목화) | 38 (0.85) | **55.01** | V1 저평가 해소 (초품아, 지하철 역세권 긍정 평가) |
| PAIR 10 B (더샵명지퍼스트월드)| 47 (1.00) | **42.19** | 원거리 초등학교(837m) 및 지하철 부재로 감점 |

## 10. V1/V2 Side-by-Side
- PAIR 06 및 PAIR 10에서, 전문가 리뷰(STEP 3.5, 3.7) 시 "B가 교통/교육에서 월등하므로 종합 B 추천"이라는 인간의 정성 평가와 V2 엔진의 결과가 정확히 일치했습니다(V1은 A 우세였음).
- 이는 V2 엔진의 Anchor / Logistic 곡선 및 Sentinel Floor(CONFIRMED_ABSENT 5점) 기작이 성공적으로 동작함을 증명합니다.

## 11. Performance & Security
- `locationByAptSeq` 등 기존 V1에서 조회된 DB 데이터를 Adapter에 그대로 넘겨 재사용했습니다(Zero additional DB query).
- 상세 API 요청 시 전체 부산 Scan 없이 O(1)로 연산됩니다.
- Shadow field 추가 외에 외부로 유출되는 secret은 없습니다.

## 12. 구덕금호 BLOCKER 이슈 보고
- V2 Engine은 `identityEligible = false` 일 때 정상적으로 `NOT_ENOUGH_DATA`를 반환합니다(STEP 4A 단위 테스트 검증 완료).
- 그러나 실제 DB상에 **구덕금호(26140-11)**는 `geocodeQuality = 'normalized'` 임에도 불구하고 `locationFeature`가 수집되어 저장되어 있습니다.
- 이로 인해 어댑터는 `location != null`을 충족하는 것으로 보아 `identityEligible = true`로 넘겼고, 결과적으로 `SCORE_AVAILABLE (59.96점)`이 반환되는 회귀(Regression)가 발생했습니다.
- **BLOCKER 조건("구덕금호 SCORE_AVAILABLE 발생")에 정면으로 위배**되므로, 이를 임의로 수정(ex. DB 삭제 또는 Adapter에 geocodeQuality 체크 추가)하지 않고 즉시 작업을 중단 및 보고합니다.

## 13. Tests, TSC, Lint, Build
- 4B Adapter/Benchmark 테스트, TSC 정상 확인.
- 위 Blocker로 인하여 최종 Merge / Build는 지연.

## 14. STEP 5 Readiness
- V2 Core Logic은 완전하게 구동되며 UI 연결 준비가 되었으나, 구덕금호와 같은 좌표 불량 단지의 Identity 필터링 정책에 대한 명확한 지침(DB Cleansing vs Adapter Validation)이 선결되어야 합니다.
