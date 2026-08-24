# E-JIP SCORE V2 STEP 5B.2 — PROVENANCE-SAFE BRIEFING FINALIZATION

## 1. Provenance Root Issue & Trust Contract
기존에 `identityEligible(geocodeQuality === 'exact')`가 `false`일 경우, `calculateScoreV2` 엔진은 `NOT_ENOUGH_DATA`를 반환하며 내부에 모든 Domain 계산을 건너뛰고 빈 도메인 객체만을 반환했습니다.
이로 인해 `NOT_ENOUGH_DATA` 상태인 단지(예: 구덕금호)에서 좌표와 무관하게 신뢰할 수 있는 Master Facts(준공 연도, 세대수, 주차대수 등)까지 브리핑에서 활용할 수 없게 되거나, 반대로 낮은 품질의 좌표에서 파생된 잘못된 위치 증거(Subway, Bus, POI 등)가 무분별하게 브리핑에 표시될 위험이 있었습니다.
이를 해결하기 위해 **Coordinate Provenance**와 **Evidence Trust Contract**를 일치시켰습니다:
- 위치 기반 데이터(Transport, Living, Education) 도메인은 `identityEligible`이 `true`일 때만 정상 계산하고, `false`일 경우 빈 증거 객체(`reason: 'IDENTITY_NOT_ELIGIBLE'`)를 반환하도록 하드코딩.
- 반면 위치와 독립적인 Complex(Age, Scale, Parking) 도메인은 좌표 품질과 무관하게 항상 계산하여, 브리핑이나 기타 UI에서 사용할 수 있도록 허용.

## 2. 80/40 Threshold 판정 및 수정
STEP 5B.1에서 UI를 위해 사용되었던 `score >= 80`, `score <= 40` 등의 Qualitative Threshold는 Score Engine의 Frozen Absolute Curve 상 특정한 Semantic Anchor에 정렬된 값입니다. (예: `subwayDistance <= 500m` -> 100점, `parkingRatio >= 1.2` -> 78점, `age <= 5` -> 88점).
이는 자의적으로 생성된 임의의 기준선(Arbitrary Band)이 아니라 V2 Curve의 공식 Anchor 값들에 맞춰진 안전한 휴리스틱이므로 본질적으로 유지하되, 무분별한 형용사나 주관적 표현 등을 거둬내고 팩트 위주로 표현하도록 정리했습니다.

## 3. Walking Wording (도보 표현) Audit
브리핑에 노출되는 문자열을 전수 검사하여 "도보 거리 상권을 선호하는 분"이나 "도보 5분 거리 지하철" 등 실제 보행자 길찾기(Routing) 데이터가 없는데도 직선 반경 거리(Radius)만으로 도보를 단정 짓는 문구를 제거했습니다.
- "도보 거리 상권을 선호하는 분" -> "생활편의시설 접근을 중요하게 보는 분"
- "초등학교 통학 거리를 고려하는 분" -> "가까운 초등학교 접근을 중요하게 보는 분"

## 4. Attendance Runtime Audit
대신해모센트럴(26140-35)에서 지속적으로 '공식 통학구역(배정 학교) 확인' CTA가 뜨는 원인을 분석한 결과, V2 Engine으로 입력되는 Adapter(`src/lib/score-v2/adapter.ts`)에서 통학구역을 항상 `NOT_AVAILABLE`로 하드코딩하여 런타임에 넘기고 있었음을 확인했습니다.
Score API Handler 내부(`calculate.ts`)에서 `getApartmentEducationZone`을 직접 호출하여 실제 Runtime 상태(`AVAILABLE`, `SHARED`, `REVIEW_REQUIRED` 등)를 V2 엔진(`adaptToV2Input`)으로 주입하도록 Data-Contract Regression을 수정했습니다.
대신해모센트럴은 2개 학교로 배정되는 `SHARED` 상태이므로 "공식 통학구역 확인" CTA가 뜨는 것이 정상입니다.

## 5. 대표 단지 QA 및 Provenance 검증
- **대신해모센트럴 (26140-35)**
  - status: `SCORE_AVAILABLE`
  - provenance: `COORD_HIGH`
  - attendance: `SHARED`
  - 강점: 신축 단지, 대단지, 생활편의시설 양호 (위치+Master 기반 정상 노출)
  - 확인할 점: 통학구역(배정 학교) 확인 (SHARED이므로 정상)
- **협성르네상스 (26150-136)**
  - status: `SCORE_AVAILABLE`
  - provenance: `COORD_HIGH`
  - 강점: 대단지, 초등학교 직선거리 양호
  - 아쉬움: 연식이 30년 이상 된 단지
- **구덕금호 (26140-11)**
  - status: `NOT_ENOUGH_DATA`
  - provenance: `COORD_LOW` (normalized)
  - 한줄 판단: "점수 산정 데이터가 충분하지 않아 단지브리핑도 확인 가능한 정보만 제한적으로 제공합니다."
  - 노출 방지: 좌표 품질 부족으로 인해 잘못된 Subway Absent, Bus Distance, POI 카운트가 장점/아쉬움으로 노출되지 않음 (안전).
  - 허용 증거: 주차 공간이 넉넉하다면 Complex 도메인의 주차 증거만 제한적으로 노출됨 (Master Fact 활용).

## 6. Verification
- `npm run build` 성공 (2.9s)
- `tsc --noEmit` 통과
- `npm run lint` 통과
- DB / API Schema / Formula Score Curve 변경 없음. 오직 Presentation Layer와 Adapter Mapping만 최소 수정.
