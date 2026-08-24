# E-JIP SCORE V2 STEP 5B — APARTMENT BRIEFING UI & DECISION SUMMARY

## 1. Baseline
- **branch**: `score-v2-step35-expert-calibration`
- **baseline commit**: `9e0a7a9`

## 2. Old Briefing Audit
기존 단지브리핑은 `ApartmentScoreApiResponse`의 `scoreResult.briefing` 데이터를 텍스트 리스트 형태로 단순 렌더링하고 있었습니다. 만약 점수 데이터가 없다면 클라이언트 단의 fallback 로직(`buildAptBrief`)을 활용해 거래 내역, 세대수, 연식 등을 바탕으로 몇 가지 단순 통계적 문장을 만들어 빈 자리를 메우고 있었습니다. 
문제는 '왜 이런 점수인가요?'(Score Explainability)와 '어떤 단지인가요?'(Decision Summary) 간의 역할 구분이 모호했다는 것입니다.

## 3. New Briefing Role & Architecture
새 단지브리핑(`ApartmentBriefingV2.tsx`)은 Score Evidence(점수 산출 근거)를 단순히 나열하는 영역이 아닙니다. V2 Structured Evidence 데이터를 해석하여 **"사용자가 아파트를 판단하기 위해 필요한 결정 정보"**를 보여주는 UI 영역으로 완전히 재설계했습니다. 외부 LLM 의존도 없이 순수하게 결정론적(Deterministic)으로 Evidence 데이터를 해석합니다.

## 4. UI Structure (Decision Summary)
기존의 단순 리스트 UI를 탈피해 시각적으로 구분이 명확한 Card 및 Chip 구조를 적용했습니다.
1. **한줄 판단**: 전체적인 평가를 요약하는 메시지. (예: "전반적인 주거 여건이 우수하며 고른 장점을 갖춘 단지입니다.")
2. **강점 (Strengths)**: V2 Evidence 중 점수에 긍정적으로 기여한 요소 최대 3개. 초록색 체크 아이콘 적용.
3. **아쉬움 (Weaknesses)**: 대중교통 부재 등 점수에 부정적인 영향을 미친 요소 최대 2개. 붉은색 마이너스 아이콘 적용. (단, 단순 결측치는 아쉬움으로 간주하지 않음).
4. **이런 분께 잘 맞아요**: Chip 형태로 개인화 조건을 나열. (예: "대중교통 출퇴근이 잦은 분", "가까운 초등학교 등교 거리를 고려하는 분").
5. **더 확인해볼 점**: 사용자의 다음 액션을 유도하거나 불확실한 데이터를 짚어주는 팁(CTA). 보라색 헬프 아이콘 적용.

## 5. Missing Data Policy & Fallback
- `NOT_ENOUGH_DATA` 상태인 단지(예: 구덕금호)여도 확보 가능한 Raw Fact가 있다면 그에 기반해 강점/아쉬움을 도출합니다. 단, 한줄 판단 영역에는 **"점수 산정 데이터가 충분하지 않아 단지브리핑도 확인 가능한 정보만 제한적으로 제공합니다."**라는 안내 문구를 명확히 노출하여 왜곡을 방지했습니다.
- V2 연동 자체를 실패했거나 데이터가 아예 없는 경우, 기존 V1(`buildAptBrief`)으로 속여 노출하지 않도록 로직을 차단하고 `데이터가 충분하지 않아 단지브리핑을 제공하기 어렵습니다.` 텍스트만을 노출합니다.
- 주차 데이터 `MISSING`은 단점으로 표시하지 않고, **더 확인해볼 점**에 `단지 내 실제 주차 여건 확인`으로 맵핑했습니다.
- 지하철 `CONFIRMED_ABSENT`는 아쉬움(단점)으로 정확히 표기(`지하철역이 멀어 대중교통 이용이 다소 아쉬움`)하되, `MISSING`일 경우엔 더 확인해볼 점(`대중교통 노선 확인`)으로 넘겨 추정을 방지했습니다.

## 6. Score Explainability와 역할 분리
Score UI 영역의 Explainability("왜 이런 점수인가요?")는 "지하철역까지 직선거리 140m", "약국 3개" 등 객관적이고 기계적인 수치를 그대로 제공합니다. 반면 새로 만든 단지브리핑은 이를 "지하철역이 가까워 교통이 편리한 편", "주변 상권 및 생활 편의시설 풍부" 등으로 인간의 언어에 맞게 변환하여 노출합니다.

## 7. QA Results
- **대신해모센트럴**: 모든 V2 Evidence가 잘 채워져 있어, 풍부한 강점과 적합 사용자 타겟(신축 선호 등)이 올바르게 렌더링 됨.
- **협성르네상스**: 지하철/생활 등 무난한 특성에 맞춘 한줄 판단 및 강점 UI 정상 표출 확인.
- **구덕금호**: `NOT_ENOUGH_DATA`이므로 한줄 평가 영역에 제한적 제공 안내 문구 노출 및 V1 대체 텍스트 미노출 확인.
- **Mobile/Desktop UI**: `grid` 레이아웃과 반응형 CSS를 활용해 모바일(360~390px)에서는 1열(스택)으로, 데스크톱에서는 강점/아쉬움이 2열(그리드)로 나란히 표시되어 불필요한 스크롤 방지 및 가독성 확보.

## 8. Development Verification
- 모든 테스트코드(Unit Tests & Benchmark Regression) PASS
- `tsc --noEmit` & `npm run lint` 통과
- `npm run build` 프로덕션 최적화 빌드 성공 (에러 및 워닝 없음)

## 9. Next Step Recommendation
STEP 5B를 통해 단지 상세 페이지 상단의 핵심 UI(Score V2 메인 뷰 및 Decision Summary)를 마무리했습니다. 이제 V2 Engine을 실제 서버 연동 단에 배포하거나, 나머지 API Shadow Integration 검증 및 남은 개발 과제들을 최종 점검하는 마무리 작업이 권장됩니다.
