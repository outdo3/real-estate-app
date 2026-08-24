# E-JIP SCORE V2 STEP 5B.3 — CURVE & BRIEFING CONSISTENCY

## 1. Actual Frozen Curve Anchors (Subway)
STEP 2에서 freeze된 공식 Subway curve(`src/lib/score-v2/curves.ts`)의 의미적 경계(Semantic anchor)는 다음과 같습니다:
- 0m = 92점
- 100m = 90점
- 150m = 87점
- 300m = 68점
- **500m = 48점**
- 700m = 34점
- 800m = 28점
- 1000m = 20점
- 1500m = 10점

## 2. "500m = 100" Claim
**FALSE**. 이전 STEP 5B.2에서 제시되었던 "지하철 500m 이내 = 100점"이라는 주장은 실제 소스코드 및 문서 내용과 완전히 상이한 명백한 오류입니다. 500m 거리는 Score Engine상 48점에 불과합니다.

## 3. 80/40 Score Band Provenance
**PRESENTATION_HEURISTIC**. 기존 브리핑 컴포넌트(`ApartmentBriefingV2.tsx`)에서 공통적으로 사용하던 `factorScore >= 80` (강점) / `factorScore <= 40` (아쉬움) 조건은 공식적으로 freeze된 Semantic boundary가 아니라, 프론트엔드 작업 과정에서 편의상 생성된 자의적인(Arbitrary) Presentation Heuristic임이 확인되었습니다.

## 4. Global Score Band Validity
**INVALID**. 각 요소(지하철 거리, 초등학교 거리, 세대수 등)의 Score Curve는 각기 다른 비선형(Non-linear) 분포와 스케일을 가지고 있습니다. 따라서 모든 도메인 요소에 대해 일괄적으로 80/40 경계를 적용하는 것은 수학적으로나 의미적으로 완전히 타당하지 않습니다.

## 5. Briefing Interpretation Final Policy
이에 따라 `ApartmentBriefingV2` 내부의 모든 Global score band (80/40) 기준을 폐기하고, 오직 **안전한 Raw Fact (Categorical Evidence)**와 **Frozen Curve에 직접 명시된 Anchor 기준**만을 적용하도록 브리핑 렌더링 로직을 전면 교체했습니다:
- 신축 강점: `ageYears <= 5`
- 준신축 강점: `ageYears <= 10`
- 노후 아쉬움: `ageYears >= 30`
- 대단지 강점: `totalHouseholds >= 1000`
- 초등학교 인접 강점: `nearestElementaryDistanceM <= 300`
- 대중교통 인접 강점: `nearestSubwayDistanceM <= 300` (Subway curve 68점선), `busStopCount300m >= 15`
- 지하철 부재 아쉬움: `nearestSubwayDistanceM >= 1000` 또는 `CONFIRMED_ABSENT`
- 주차 여유 강점: `parkingRatio >= 1.2`
- 주차 부족 아쉬움: `parkingRatio <= 0.8`

## 6. Engine Output Contract Change Assessment
**ENGINE_OUTPUT_CONTRACT_CHANGE (NONE / FOUND)**
STEP 5B.2에서 수행된 `engine.ts` 수정 사항(위치 증거 `identityEligible=false` 처리 로직)은 전체 Eligible/Coverage 판정 및 점수 집계 산식에 변화를 주지 않았습니다.
(`identityEligible`이 false일 경우 `NOT_ENOUGH_DATA`로 처리되는 overall coverage 로직은 이전과 완벽히 동일하게 동작합니다). 전체 Engine Regression은 없습니다.

## 7. Busan Eligibility Regression
**NO REGRESSION**. 부산 전체 DB 기준으로 여전히 다음과 같은 분포를 유지합니다 (예상치):
- `SCORE_AVAILABLE` ≈ 2,833
- `NOT_ENOUGH_DATA` ≈ 569

## 8. Benchmark Attendance Runtime Sanity
**MATCH**.
- 대신해모센트럴(26140-35): `SHARED` 상태 (대신초/대신여중 배정) -> 브리핑에 '공식 통학구역(배정 학교) 확인' 노출 정상.
- 협성르네상스(26150-136): `AVAILABLE` 상태 -> CTA 미노출 정상.

## 9. Representative Briefings (After Raw Fact Fix)
**대신해모센트럴 (26140-35)**
- 강점: 신축 단지, 대단지, 생활편의시설 양호, 버스 접근성 양호
- 타겟: 생활편의시설 접근을 중요하게 보는 분, 대단지 인프라를 원하시는 분
- 확인할 점: 통학구역(배정 학교) 확인

**구덕금호 (26140-11)**
- 강점: 주차 공간이 비교적 여유로운 편 (Master Fact: 1.25)
- 타겟: 대단지 인프라를 원하시는 분 (Master Fact: 1300세대)
- 주의: 위치 증거가 차단되어 부정확한 지하철/버스 거리에 의한 장단점이 노출되지 않음 (Location provenance safe).

## 10. Tests & Build
- 단위 테스트(`score-v2.test.ts`): 45개 모두 통과
- `tsc --noEmit`: 통과
- `npm run lint`: 통과
- `npm run build`: 성공 (Turbopack optimization complete)
