# E-JIP SCORE V2 STEP 6 — DETAIL FINAL QA

## 1. Baseline
- Branch: `score-v2-step35-expert-calibration`
- Commit: `e54600f` (and local wording fixes)

## 2. Runtime Dependency Map
Score V2 아파트 상세페이지 런타임 의존성 흐름:
1. DB / API Route: `src/app/api/apt/[name]/score/route.ts`가 `calculateApartmentScore()` 호출
2. Engine Entry: `src/lib/apartment-score/server/calculate.ts`
3. V2 Adapter: `src/lib/score-v2/adapter.ts` (`adaptToV2Input`)
4. V2 Engine: `src/lib/score-v2/engine.ts` (`calculateScoreV2`)
5. Eligibility: `src/lib/score-v2/eligibility.ts`
6. API Result: `FinalScoreResult._shadowV2`에 주입되어 프론트로 전달
7. Client Type: `ScoreV2Result` (`src/lib/score-v2/types.ts`)
8. Main UI Component: `src/components/ApartmentScoreCard.tsx`
9. Briefing Component: `src/components/ApartmentBriefingV2.tsx`

## 3. 대신해모센트럴 FINAL QA
- **Status**: SCORE_AVAILABLE
- **총점 표시**: V2 정상 노출 (V1 대체 없음)
- **도메인 표시**: 4개 도메인(교통, 생활, 교육, 단지) 점수와 증거 모두 일치. 
- **Briefing**: 신축(2022), 대단지(1057세대), 생활 POI 기반으로 안전한 강점 요약. SHARED 통학구역(대신여중+대신초) 상태 확인 CTA 정상 노출.
- **Explainability**: Component Score가 아닌 팩트 위주로 증거(Evidence)와 일치.

## 4. 협성르네상스 FINAL QA
- **Status**: SCORE_AVAILABLE
- **비교 검증**: 연식(1995년)으로 인한 '30년 이상' 아쉬움 표현과 '1000세대 이상 대단지' 강점 등 객관적 Score Engine 팩트만으로 브리핑이 형성되어 대신해모와의 점수 차이가 납득 가능함.
- **도메인 강점**: 초등학교 직선거리 300m 이내 정상 매핑.

## 5. 구덕금호 FINAL QA
- **Status**: NOT_ENOUGH_DATA
- **UI Fallback**: V1 UI 혼입 없음. 
- **총점 없음**: "점수 산정 데이터가 충분하지 않아 단지브리핑도 확인 가능한 정보만 제한적으로 제공합니다"라는 전용 Empty State.
- **Location Provenance Safe**: 낮은 좌표 정확도에 기반한 잘못된 지하철/버스/상권 팩트는 일절 노출되지 않음.
- **안전한 증거만 노출**: '주차 공간이 비교적 여유로운 편(1.25)' 등 Master Fact만 제한적으로 제공됨. 사용자가 납득 가능.

## 6. Status Contract
- **SCORE_AVAILABLE**: 정상 노출, 도메인 상세, 브리핑 모두 활성화.
- **LIMITED**: 현재 전체 커버리지 계산 로직상 사용되지 않으나, 엔진에서 0.4 <= coverage < 0.75 상태로 반환될 경우 UI상 총점 미노출 상태로 안전 처리됨.
- **NOT_ENOUGH_DATA**: 총점 숨김, Location-derived Evidence 차단.
- **V2 unavailable/error**: API에서 `_shadowV2`가 없어도 V1 fallback이 노출되지 않고 Unavailable state 처리됨.

## 7. Explainability QA
- "왜 이런 점수인가요?"(Explainability) 섹션은 Score Component 원천 Evidence와 완전히 일치함.
- `CONFIRMED_ABSENT` (지하철 없음)와 `MISSING` (데이터 알 수 없음) 간 혼동 없음.
- 주차 데이터 `MISSING` 시 추정된 Era Neutral Ratio를 노출하지 않고 명시적으로 결측 상태임을 표현.

## 8. Briefing QA
- 브리핑은 철저히 **"그래서 이 단지는 어떤 단지인가?"**라는 사실 해석의 역할만 수행.
- Score나 Rank 수치를 브리핑 문구에서 반복하지 않음.
- 임의의 80/40 점수 기반 차단 로직(Presentation Heuristic)을 제거하고, Frozen Semantic Anchor(신축 5년, 1000세대, 300m 등)를 기반으로 작성.
- 주관적 형용사나 불확실한 미래 가치 투영 없음.

## 9. Wording Audit
전수 검색("도보", "통학거리", "우수한", "투자가치" 등) 및 수정 완료:
- `KakaoPlaces.tsx`에서 단순히 반경 직선거리를 "도보 약 N분"으로 단정짓던 치명적 False Claim(워딩) 발견.
- "도보 5분 이내의 초역세권" -> "직선거리 500m 이내의 역세권"으로 수정.
- "도보 약 N분" 계산 로직을 모두 "직선 N m" 표기로 변경. 
- Beta 워딩은 "이집점수 Beta"로 Score V2의 위치상 맥락에 부합하여 유지.

## 10. Mobile & Desktop Visual QA
- **Mobile (360/375/390)**: Card Width가 정상이며 Horizontal Overflow 없음. Briefing Chips 그룹이 Flex-wrap으로 정상 분리됨. Accordion 터치 영역 정상.
- **Desktop**: Content Width 밸런스 유지, 양측면 불필요한 과도 공백 없음, Readability 양호.

## 11. Navigation & State
- 학교, 실거래, 지도, 뒤로가기 등 타 탭/페이지로 이동 후 복귀 시 Score 카드 상태와 브리핑 UI가 정상 유지됨.

## 12. Accessibility
- 적절한 Heading 계층(h3, h4) 유지.
- 긍정/부정 아이콘(`iconGood`, `iconWeak`)의 색상에만 의존하지 않고 텍스트를 반드시 동반.

## 13. Runtime/Error Safety
- `_shadowV2` 필드가 누락되더라도 전체 아파트 상세 페이지가 Crash되지 않고 안전한 Empty State로 렌더링.
- Partial Evidence 존재 시 Optional Chaining 및 Nullish 확인을 통해 런타임 오류 방지.

## 14. Performance Sanity
- 추가 API 요청 N+1 없음. `_shadowV2`는 `calculateApartmentScore` Single Request에 통합되어 전달됨.

## 15. Regression
- PAIR03, PAIR04, PAIR06, PAIR10 등 벤치마크 테스트 스위트 45건 전원 패스.
- Eligibility 및 Score Version 유지 상태(No regression).

## 16. Build Validation
- `tsc --noEmit`: PASS
- `eslint`: PASS
- `next build` (Turbopack): PASS

## 17. Release Recommendation
E-JIP Score V2는 Frozen Engine Formula를 철저히 지키며, Provenance Trust를 확보했고, V1 의존도를 안전하게 끊어내어 **출시 가능한(READY) 상태**입니다. 

---
**FINAL APPROVAL GATE**
- SCORE_V2_FORMULA_FROZEN = YES
- SCORE_V2_PROVENANCE_SAFE = YES
- SCORE_V2_UI_SAFE = YES
- SCORE_V2_BRIEFING_SAFE = YES
- SCORE_V2_REGRESSION = NONE
- STEP_6_STATUS = PASS
- EJIP_SCORE_V2_DETAIL_COMPLETE = YES
