# E-JIP SCORE V2 STEP 5A — UI & EXPLAINABILITY

## 1. Baseline
- **branch**: `score-v2-step35-expert-calibration`
- **baseline commit**: `b9e0bdc`

## 2. Old V1 UI Audit
기존 V1 UI는 `ApartmentScoreCard.tsx` 컴포넌트에서 100점 만점의 총점과 `가까운 지하철역 374m: 60점` 같은 카테고리별 단순 점수 및 간단한 문장(explanation)을 표시하는 형태였습니다. 결측치나 NOT_ENOUGH_DATA에 대해서는 `점수 산정 준비 중입니다`로 간결하게 표시하고 있었습니다.

## 3. V2 UI Architecture
새로운 V2 점수를 UI에 안전하게 연결하기 위해:
- `ApartmentScoreApiResponse` 타입에 `_shadowV2` 속성을 선택적으로 추가하여 V2 결과를 클라이언트로 전달받습니다.
- `ApartmentScoreCard.tsx` 내부에서 `result._shadowV2`가 존재하면 완전히 새로운 V2 전용 레이아웃을 렌더링하도록 분기(Branching)했습니다. 만약 V2 데이터가 없으면 기존 V1 레이아웃을 그대로 Fallback 렌더링하여 안전성을 확보했습니다.

## 4. Status Handling
- **SCORE_AVAILABLE**: 4개 Core Domain(교통, 생활, 교육, 단지)에 대한 세부 점수와 Evidence를 표시합니다.
- **LIMITED**: 점수 숫자 옆에 노란색 "제한된 데이터" 뱃지를 추가했습니다.
- **NOT_ENOUGH_DATA**: 총점을 표시하지 않고 기존 카드와 동일하게 "점수 산정에 필요한 데이터가 부족합니다."라는 안내 메시지만을 표시하는 컴팩트한 형태의 카드로 Fallback 합니다 (구덕금호 등 적용).

## 5. Domain Presentation
4개의 핵심 영역을 2x2 Grid 형태가 아닌 CSS Flexbox 기반 리스트로 구성하여 모바일에서도 시인성이 좋게 배치했습니다.
- 각 Domain 헤더에는 영역명과 점수를 배치하고, 그 아래에는 핵심 근거(Evidence)를 1줄로 표시합니다.
- 예: `[교통 82점] 지하철 140m · 버스정류장 85m`

## 6. Education Semantic
기존 V1 등에서 혼동을 줄 수 있었던 "도보"라는 표현을 완전히 배제하고, Education 영역의 설명과 Explainability 근거 문장에 **"가까운 초등학교 직선거리 약 {X}m"**이라는 명확한 표현을 강제했습니다. 통학구역(attendance zone) 데이터가 없는 경우 추가적인 설명(`공식 통학구역 데이터가 아직 지원되지 않는 지역입니다`)을 병기했습니다.

## 7. Parking Missing Semantic
주차 데이터가 결측(`MISSING`)된 경우 추정값을 계산된 Raw Fact처럼 속이지 않고, **"주차 정보가 없어 해당 항목은 데이터 결측 처리 기준을 적용했습니다."**라는 안내 문구를 노출하여 사용자에게 투명하게 알리도록 처리했습니다.

## 8. Explainability
"왜 이런 점수인가요?" 버튼(Accordion)을 클릭하면 펼쳐지는 Explainability 전용 뷰를 만들었습니다.
- 각 Domain(교통, 생활, 교육, 단지)별로 `evidence` 객체의 순수한 Raw Fact를 사람이 읽을 수 있는 문장으로 변환하여 리스트 형태로 보여줍니다.
- 수학적 수식이나 Percentile/Contribution을 직접 노출하지 않고, "점수는 교통·생활·교육·단지를 동일 비중(각 25%)으로 반영하여 산출합니다."라는 주석을 추가해 직관적으로 이해할 수 있게 구성했습니다.

## 9. V1 Handling
V1 점수를 V2 UI인 것처럼 속이지 않기 위해, `_shadowV2` 속성이 없는 경우 코드를 완전히 분리해 기존 V1 컴포넌트 JSX를 그대로 반환(Fallback)하게 유지했습니다.

## 10. Mobile UX
- 모바일 디바이스(360px ~ 390px)를 최우선으로 고려하여 Flexbox의 컬럼 레이아웃으로 V2 도메인을 쌓았습니다.
- 한 눈에 영역별 상태(점수 + 요약)를 훑어볼 수 있으며, 자세한 이유는 아코디언 안에 숨겨 지나친 스크롤이 발생하지 않도록 했습니다.

## 11. Tests & QA
- `npm run build`를 통해 모든 TypeScript 타입 에러와 Lint 문제를 해결 및 검증 완료했습니다.
- **구덕금호**: `NOT_ENOUGH_DATA` 상태에 따라 "점수 산정에 필요한 데이터가 부족합니다" 문구와 컴팩트 카드가 정상 노출됨을 코드 분기상 확인했습니다.
- **대신해모/협성**: `SCORE_AVAILABLE` 상태이므로 4개 도메인 전체의 V2 Score 및 Explainability UI가 정상 렌더링됨을 확인했습니다.

## 12. Known Limitations & STEP 5B Recommendation
- **단지브리핑 (Algorithmic Briefing)**: 현재 V2 UI는 순수하게 Score의 Explainability(점수 산정 근거)만을 제공합니다. 기존 V1의 AI 브리핑 시스템(단지 전체의 장단점을 서술하는 종합 문장)은 아직 V2에 맞춰 업데이트되지 않았으므로, STEP 5B에서 단지브리핑 영역의 디자인과 로직을 분리 및 갱신해야 합니다.
