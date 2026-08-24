# E-JIP SCORE V2 STEP 4A — Engine Foundation

## 1. Baseline
- **Branch**: `score-v2-step35-expert-calibration`
- **HEAD (Baseline)**: `3b21f9f`

## 2. V1 Dependency Map
V1 Score 시스템은 데이터 조회(DB)와 채점(Percentile)이 강결합된 구조입니다.
- **API Route**: `src/app/api/apt/[name]/score/route.ts` 가 클라이언트 요청을 받습니다.
- **V1 Core Entry**: `src/lib/apartment-score/server/calculate.ts` (`calculateApartmentScore`)가 단지 seq를 받아 DB를 조회하고 최종 점수를 생성합니다.
- **V1 Modules**: `types.ts`, `config.ts`, `percentile.ts`, `categories/` 하위 모듈들.
- **소비자(Consumer)**: 웹 프론트엔드의 단지 상세 페이지 등.
- **결론**: V2 Engine은 이 구조와 완전히 분리된 `src/lib/score-v2/`에 순수 함수(Pure Function) 형태로 구현되었으며, 이번 STEP에서는 V1 코드를 전혀 수정하지 않았습니다. (API shadow integration은 STEP 4B에서 진행)

## 3. 신규 V2 파일 구조 (`src/lib/score-v2/`)
- `types.ts`: V2 raw input 및 result contract 정의.
- `curves.ts`: Frozen curve formula (subway, bus, age, scale, parking, living 등).
- `transport.ts`: T1 (Subway 70% + Bus 30%, sentinel-aware).
- `living.ts`: L-A (편의점/마트/약국/병원 composition, park/daycare는 evidence).
- `education.ts`: E-A (초등 접근성 100%).
- `complex.ts`: Age, Scale, Parking (P-D era-conditioned 처리 포함).
- `eligibility.ts`: SCORE_AVAILABLE, LIMITED, NOT_ENOUGH_DATA 판정.
- `engine.ts`: 순수 함수 기반의 O(1) Core engine 진입점 (`calculateScoreV2`).

## 4. Frozen Formula Mapping
STEP 2, 3, 3.5, 3.7의 문서에서 동결(Frozen)된 anchor와 수식을 정확히 1:1 대응하여 구현했습니다. 모든 커브는 내부적으로 [5, 95]로 clamping 됩니다.

## 5. Transport T1 + Sentinel
- **Subway (70%)**: `A_PIECEWISE_LINEAR` 곡선 적용.
- **Sentinel**:
  - `VALUE`: 거리에 따른 점수 부여.
  - `CONFIRMED_ABSENT`: 5점(floor) 명시적 부여. MISSING과 다르게 처리.
  - `MISSING` / `INVALID_OR_UNRESOLVED`: null 반환 (재분배 대상).
- **Bus (30%)**: 거리(logistic, 50%)와 정류장 수(halfLife 포화, 50%)의 혼합.

## 6. Living L-A
- **Composition**: 편의점(30%) + 마트(20%) + 약국(25%) + 병원(25%).
- 각 POI는 `halfLife`를 적용한 점진적 포화(saturating) 수식을 사용 (dense area 점수 폭증 방지).
- 결측(null)과 수집된 0개(0)를 엄격히 분리하여 결측 시에만 weight redistribution이 일어나도록 구현.
- 공원과 어린이집은 계산 점수에 넣지 않고 Evidence로만 제공.

## 7. Education E-A
- Kakao POI 기준 물리적 초등학교 도보 거리만 채점에 반영 (Logistic curve).
- `attendanceZoneStatus`(통학구역)는 오직 Evidence 목적으로 기록되며 점수에 반영하지 않음 (학교 서열화 방지).

## 8. Complex
- **Age (45%)**: 재건축 기대 배제, 현재 상품성만 반영하는 꺾은선(Anchor) 모델.
- **Scale (40%)**: 세대 수 증가에 따른 점진적 점수 상승 모델 (1000세대 이후 포화).
- **Parking (15%)**: 실제 데이터(`parkingRatio`)가 있을 경우 V1의 편차를 줄인 곡선 모델 적용.

## 9. Parking P-D (Era-Conditioned Neutral Prior)
- Parking이 `KNOWN`이면 실측 점수 적용.
- Parking이 `MISSING`일 경우 가짜(Fabricated) 주차비율 원시값을 생성하지 않습니다.
- 대신, 연식(Age Band)별로 수집된 다른 `KNOWN` 단지의 평균 환산 점수(Era-neutral score: `0-10: 65, 11-20: 68, 21-30: 53, 31+: 22`)를 **모델 내부(Factor score)**에서만 대체합니다.
- Coverage는 결측으로 기록되며, Missing Reasons에도 명확히 노출됩니다.

## 10. Eligibility / Status
- `SCORE_AVAILABLE`: Coverage >= 0.75 & `identityEligible = true`
- `LIMITED`: Coverage >= 0.4 & `identityEligible = true`
- `NOT_ENOUGH_DATA`: Coverage < 0.4 또는 `identityEligible = false` (구덕금호 케이스 등)

## 11. Result Contract
- `types.ts`의 `ScoreV2Result`에 정의된 바와 같이, `calculateScoreV2`는 `overallScore`, `domains` (4개), `overallCoverage`, `missingReasons`, `eligibility`, `relativeContext`(임시)를 포함하여 반환합니다.
- 모든 점수는 Float 형을 유지하며 반올림은 상위 Layer에 위임합니다.

## 12. Explainability-Ready Evidence
- 각 도메인 결과 안에 `evidence` 객체를 포함했습니다. 이는 이후 UI가 "왜 이 점수가 나왔는지" 설명할 수 있는 구조화된 원시 팩트와 중간 연산값입니다. (예: `subwayIsSentinel`, `parkingModelTreatment`)

## 13. Deterministic Handling
- DB, Timezone, Locale, Array Ordering에 의존하지 않는 완전한 순수 함수 형태.
- 연식 계산을 위해 `referenceYear`(기본 2026)를 주입할 수 있어 언제 돌려도 같은 값을 보장합니다.

## 14. Test 결과
- `scripts/score-v2-step4a/score-v2.test.ts`를 작성하여 `node --test`로 실행.
- T1 (sentinel), L-A (sparse/dense, zero vs null), E-A (near/far), Complex P-D 등 총 45개 테스트 항목 모두 PASS.

## 15. TSC
- `src/lib/score-v2/` 및 `scripts/score-v2-step4a/` 대상 TSC 컴파일 에러 없음. (기존 프로젝트 내 `scripts/education` 폴더 등에 pre-existing type error가 있으나 STEP 4A 범위와 무관)

## 16. Lint
- ESLint 오류 없음 확인.

## 17. Build 실행 여부
- 아직 프로덕션 코드(API 등)에 연동하지 않았고, V1이 온전히 동작 중이므로 전체 빌드는 수행하지 않았습니다. (STEP 4B에서 통합 시 수행 권장)

## 18. Benchmark Fixture 상태 / Provenance
- `scripts/score-v2-step4a/fixtures.ts` 에 작성 완료.
- 대상: 대신해모, 협성르네상스, 구덕금호, PAIR 03, PAIR 10 등.
- 출처: STEP 2, 3, 3.5, 3.7 문서의 실제 DB Raw Input 값(Answer Key)을 그대로 차용. 가상의 추정치나 Fallback은 사용하지 않았습니다. 구덕금호는 정상적으로 `NOT_ENOUGH_DATA` 반환을 확인했습니다.

## 19. Known Limitations
- V2 Engine 자체는 LOCAL(동) / SIGUNGU(구) 단위의 백분위(Percentile) 맥락을 알지 못하므로, 이 부분은 STEP 4B에서 외부(호출부)가 공급해 주어야 합니다.

## 20. STEP 4B Handoff
- Core Engine은 준비 및 검증되었습니다.
- STEP 4B에서는:
  1. API Shadow Integration (V1과 V2 점수 동시 계산 후 로깅)
  2. 실제 DB 기반 Benchmark Regression 검증
  3. App 통합 및 Full Build 확인을 진행하면 됩니다.
