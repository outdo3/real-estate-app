# UI/UX V2 ARCHITECTURE

## 1. Executive Summary
본 문서는 "부동산 데이터를 보여주는 서비스"를 넘어 "사용자가 어디에 살지 결정하게 돕는 서비스"로 진화하기 위한 이집(e-jip) UI/UX V2의 마스터 아키텍처입니다. COMPETITOR REVERSE ENGINEERING V1 결과를 바탕으로, 데이터를 사용자가 직접 해석하게 방치하지 않고, 이집이 먼저 결론과 맥락을 제시하는 방향으로 모든 사용자 여정(Journey)과 정보 아키텍처(IA)를 재설계합니다.

## 2. Product UX Principle
- **의사결정 우선**: 더 예쁜 디자인이나 기능 나열이 아닌, 사용자가 덜 헤매고 덜 계산하며 덜 왕복하게 만든다.
- **해석된 데이터**: 원천 데이터(차트, 표)를 노출하기 전에 항상 "그래서 좋다는 건지, 비싸다는 건지" 한 줄 해석을 선행한다.
- **맥락 내 행동(Contextual Action)**: 단지를 보다가 별도의 계산기 앱을 열게 하지 않고, 그 자리에서 즉시 의사결정 도구(자금 계산, 비교)를 제공한다.

## 3. User Jobs
사용자가 이집에서 답을 얻어야 하는 핵심 질문:
1. **이 아파트 괜찮은가?** → Score V2 & 한 줄 브리핑
2. **가격이 적정한가?** → Price Decision Layer (최고가 대비, 주변 대비)
3. **다른 단지보다 좋은가?** → Compare V2 (1:1 핵심 우위 비교)
4. **내 상황에 맞는가?** → Personalization Layer (MY 목적 부합도)
5. **내 돈으로 살 수 있는가?** → Contextual Real Estate Tools (자금 계산기)
6. **이 지역에서 더 나은 선택지가 있는가?** → Map / 대안 단지 추천
7. **지금 무엇을 더 확인해야 하는가?** → Action CTA (비교하기, 임장 기록하기 등)

## 4. Global IA
전체 페이지/기능을 6단계로 재분류:
- **DISCOVER**: `/` (Home), `/map` (지도), AI 검색 → *사용자가 후보를 찾는 단계*
- **UNDERSTAND**: `/apt/[name]` (단지 상세), `/school` (학군), `/stats` (지역 통계) → *단지의 가치와 거시 환경을 이해하는 단계*
- **COMPARE**: `/compare` (비교 기능 - 신설/강화) → *후보군 압축*
- **DECIDE**: `/tools` (상세 페이지 내 자금 계산기) → *현실적 자금 조달 및 매수 타당성 검토*
- **SAVE**: `/my` (관심단지, 최근 본 단지, 목적 설정) → *결정 보류 및 모니터링*
- **ACT**: 커뮤니티, 매물 확인, 중개 연결(향후) → *실제 행동*

## 5. Core Decision Journey
**HOME** → **SEARCH / MAP** → **APARTMENT DETAIL** → **UNDERSTAND** → **COMPARE** → **FINANCIAL FIT** → **SAVE / DECIDE**
- 각 단계는 끊김 없이(State Preservation) 이어져야 하며, 뒤로 가기를 누르면 이전 필터와 스크롤이 완벽히 보존되어야 합니다.
- **CTA 흐름**: [이 집 사려면 얼마?] → [비슷한 다른 단지와 비교] → [관심단지로 찜하기]

## 6. 10s/30s/2m Model (Detail Page)
- **10초 (첫 화면)**: "이 집은 어떤 집인가?" → 단지명, 이집점수(Score), 핵심 브리핑, 실거래/호가 요약.
- **30초 (스크롤 1회)**: "가격은 적당하고, 내가 살 수 있나?" → 실거래 트렌드, **자금 계산기 CTA**, 핵심 장단점(학군/교통 요약).
- **2분 (딥 다이브)**: "세부적인 근거는?" → 평면도, 세부 학구도 맵, 주변 입주물량, 리뷰, 통계 원천 데이터.

## 7. Detail V2 Architecture
단지 상세 정보를 정보의 중요도에 따라 3개의 Tier로 고정 배치합니다. (개인화에 따라 이 순서를 통째로 섞지 않습니다.)
- **TIER 1 (결론/가치)**: E-jip Score V2, 단지 브리핑, 핵심 가격(실거래/호가), [관심 찜하기 / 비교함 담기] 버튼.
- **TIER 2 (맥락/도구)**: Price Decision Layer(가격 적정성 판단), **Contextual Tools (이 집 사려면 얼마?)**, 인프라(교통/교육/생활) 요약.
- **TIER 3 (근거/탐구)**: 실거래가/전세가 상세 리스트, 평형별 상세 데이터, 학군 배정 상세, 단지 세부 제원(주차대수 등).

## 8. Price Decision Layer
- 사용자가 "비싼가 싼가?"를 직관적으로 알 수 있는 레이어.
- **표현**: 최근 실거래가 표시 하단에 "전고점(최고가) 대비 -X% 하락", "최근 3개월 거래량 Y건 (활발)" 등의 텍스트 인사이트를 제공.
- 데이터가 부족한 경우 억지로 지표를 만들지 않고 "최근 거래 없음"으로 명시.

## 9. Score/Briefing
- **Score V2**: 총점을 크게 강조. 하위 4개 도메인을 보여줄 때 방사형 차트 또는 직관적인 Horizontal Bar 활용. NOT_ENOUGH_DATA 시 "데이터 부족" 명확히 안내.
- **Briefing V2**: [강점], [아쉬움], [한줄판단]의 불릿(Bullet) 구조로 제공하여 스크롤 압박을 줄이고 Mobile-first 가독성 극대화.

## 10. Compare V2
- **원칙**: 레이더 차트를 무조건 맹신하지 않고, **Side-by-side** 카드 비교 및 **핵심 차이점(Difference-first)** 텍스트 브리핑을 우선합니다.
- **Core Comparison**: A단지와 B단지의 가격, 교통, 학군, 이집점수 1:1 직관적 표기.
- **Summary Verdict**: "A단지는 학군이 우수하고, B단지는 교통과 가성비가 좋습니다" 형태의 승자 판단(Winner Card) 코멘트 제공.

## 11. Tools V2
- **Contextual Embedded**: 단지 상세 화면 내부에 `[이 집 사려면 얼마 필요할까?]` CTA를 최우선 배치. 탭 시 현재 단지의 가격이 자동 입력된 상태로 자금/대출/취득세 바텀시트 전개.
- **독립 Tools Hub (`/tools`)**: 범용 계산이 필요한 사용자를 위해 별도 메뉴로 유지하되, 모든 결과에서 "이 자금으로 살 수 있는 아파트 찾기"로 역방향 연결.

## 12. HOME V2
- 메뉴판이 아닌 **Decision Home**으로 전환.
- **First-time User**: 검색창, 지도 진입 CTA, AI 조건검색 탭 (Primary Action 최소화).
- **Returning User**: 최근 본 단지, 관심단지(Favorites)의 가격 변동 알림, 내 관심 지역 브리핑 피드를 최상단 노출. 과도한 추천 엔진 도입은 배제하고 확정된 데이터 위주로 전개.

## 13. Navigation V2
- **BottomNav 구성**: `홈` | `지도(검색)` | `비교` | `마이` (총 4개로 억제)
- **통계/부동산도구**: 메인 네비게이션에서 제거. 단지 상세 맥락 속으로 이동하거나 `홈/마이` 내 서브 카테고리로 흡수.

## 14. Map/Search
- **Map**: 필터 및 선택 상태 완벽 보존. 지도 상의 레이어 과적재 방지 (필요 시 토글형).
- **Search**: 일반 명칭 검색창과 AI 조건 검색을 명확한 UI 분리로 제공하되 접근점은 하나로 통합.

## 15. Stats/School
- **Stats**: 파워 유저를 위한 독립 메뉴는 유지하되, 핵심 지표(시장강도, 입주물량)는 단지 상세 Tier 2에 맥락 맞게 이식.
- **School**: 단지 상세의 교육 섹션에서 특정 학교 클릭 시 School 상세로 넘어가며, 언제든 뒤로 가기로 단지 문맥으로 복귀 가능하도록 상태 유지.

## 16. MY/Personalization
- `마이`는 단순 설정 창이 아닌 "내 집 찾기 공간" (Favorites, Recent, Preferences 관리).
- Core IA(정보 순서)를 마음대로 뒤섞는 개인화 금지. 대신, "내 목적(매수/투자)에 부합하는 강점입니다" 식의 Highlight 배지(Badge) 형태의 Personalization Layer 추가.

## 17. Action Layer
- **NOW**: 관심 저장, 단지 1:1 비교, 실시간 자금 계산.
- **NEXT**: 외부 공유, 단지 내 메모 작성.
- **FUTURE**: 중개사 연결, 등기/대출 상담 연결. (현재 없는 기능을 빈 껍데기로 만들지 않음).

## 18. Design System
- Semantic Component 추가 제안: `DecisionSummary` (핵심 점수/브리핑 카드), `ComparisonWinner` (비교 우위 표시), `ContextualCTA` (단지 데이터 주입형 버튼), `DataState` (출처/기준일 표기).
- Emoji 사용 금지 원칙 준수, E-jip Green 톤앤매너 일관성 유지.

## 19. Mobile Rules
- **Thumb Reach**: 비교 담기, 계산하기 등 주요 Action CTA는 모바일 하단(Fixed Bottom) 배치.
- 모바일에서 가로가 긴 표(Table)는 카드형태나 Horizontal Scroll List로 변환.
- 너무 깊은 페이지 뎁스를 피하기 위해 모달(Modal)과 바텀시트(Bottom Sheet) 적극 활용.

## 20. State Preservation
- **지도**: 줌 레벨, 중심 좌표, 필터 상태.
- **상세**: 이전 화면으로 돌아갔을 때 스크롤 위치.
- **비교**: 비교함에 담아둔 후보 단지 리스트.
- **도구**: 사용자가 입력했던 예산, 대출 금리 정보 보존.

## 21. Loading/Empty/Error
- **Loading**: 첫 10초 뷰포트에 해당하는 영역은 스켈레톤(Skeleton) 우선 렌더링.
- **Empty**: "데이터가 없습니다" 대신 "최근 3개월간 실거래가 없습니다" 등 명확한 원인 제공.
- **Error**: API 호출 실패 시 해당 컴포넌트만 에러 바운더리 처리(전체 페이지 크래시 방지).

## 22. Trust UI
- 고신뢰성 서비스의 기본인 "데이터 기준일", "출처(국토교통부, 한국부동산원 등)", "업데이트 시각", "계산 가정치(금리 연 4% 가정 등)"를 UI 하단/툴팁에 반드시 명시.

## 23. Page-by-Page Architecture
- **HOME**: (Purpose) 현재 상태 브리핑 및 진입 / (Primary CTA) 검색창 탭 / (Content) 관심단지 요약.
- **MAP**: (Purpose) 위치 기반 후보 발굴 / (Primary CTA) 핀 터치하여 바텀시트 요약 확인.
- **DETAIL**: (Purpose) 단지 가치 최종 확인 / (Primary CTA) 자금 계산 및 관심 저장.
- **COMPARE**: (Purpose) 두 단지의 우위 판별 / (Primary CTA) 승자 판단 브리핑 확인.
- **TOOLS**: (Purpose) 실행 가능성 타진 / (Primary CTA) 단지 데이터 기반 대출/취득세 계산.
- **MY**: (Purpose) 저장된 탐색 여정 확인 / (Primary CTA) 최근 본 단지 이어서 보기.

## 24. Keep / Move / Merge / Remove
- **KEEP**: 지도, E-jip Score, 단지 브리핑, MY(Favorites/Recent).
- **MOVE**: 부동산 도구 → 단지 상세 Context 내부로 이동.
- **MERGE**: 학교 정보, 지역 통계 핵심 지표 → 단지 상세 정보의 맥락(Tier 2/3)에 통합.
- **REMOVE**: 모바일 환경에 부적합한 데이터 과밀 표(Table), 불필요한 하단 탭바 아이콘(통계, 도구 등 5개 초과 분).

## 25. Implementation Phases
- **V2-0**: Architecture 확정 (본 문서).
- **V2-1**: `Apartment Detail V2` (가장 핵심. Score/Briefing 최상단 배치 및 Tier 재정렬).
- **V2-2**: `Tools V2` (Detail 내부로 계산기 Contextual 연동).
- **V2-3**: `Compare V2` (비교 UX 신설).
- **V2-4**: `Global Navigation & HOME V2` (BottomNav 개편 및 피드형 홈 적용).
- **V2-5**: `Map & Search V2` (탐색/필터 UX 고도화).
- **V2-6**: Full Regression & Polish.

## 26. P0 / P1 / P2
- **P0**: 단지 상세(IA) 전면 개편, 부동산도구(자금 계산기) 단지 상세 연동.
- **P1**: 비교(Compare V2) UX 구현, HOME V2 개편, BottomNav 4구조 축소.
- **P2**: 개인화 목적에 따른 뱃지/강조 계층 도입, 지역 통계 미시적 연동.

## 27. Risks
- 단지 상세 내에 너무 많은 컴포넌트(Score, 차트, 계산기, 학교 등)가 집중되어 초기 렌더링 성능 및 TTI(Time To Interactive)가 저하될 위험 (Server Component 최적화 필수).
- 다중 단지 비교 시 전역 상태(Global State) 관리의 복잡도 증가.

## 28. Open Questions
- 다중 단지 비교(Compare) 시 최대 몇 개까지 모바일에서 허용할 것인가? (2개 제한 우선 권장).
- 자금 계산 시 금리 및 LTV 규제 변경 데이터를 실시간 API로 수급할 것인가, 배치(Batch)로 처리할 것인가?

## 29. Recommended First Implementation Step
- **`UI/UX V2-1 Detail Page Restructuring`**: 이집 서비스의 코어인 `/apt/[name]` 상세 페이지의 Tier 1, 2, 3 정보 재배치 및 브리핑/Score 컴포넌트 최상단 렌더링 개편부터 시작합니다.
