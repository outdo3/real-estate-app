# UI/UX V2-1A — APARTMENT DETAIL RESTRUCTURING BLUEPRINT

## 1. Current Detail Audit
현재 `/apt/[name]` (단지 상세)의 컴포넌트 아키텍처는 데이터가 수집되는 순서대로 병렬 나열되어 있어, 의사결정의 맥락(Context)이 자주 단절되는 문제를 안고 있습니다.

## 2. Entry Points
- **HOME Search/AI Search**: `?lawdCd=...&dong=...`
- **MAP**: 지도에서 핀을 클릭하여 진입 (`/apt/[name]`)
- **MY (Favorites / Recent)**: 즐겨찾기 및 최근 본 단지 리스트에서 직접 진입
- **School / Stats**: 주변 단지 랭킹 또는 학교 배정 단지 목록에서 진입
- **Share**: 카카오톡 공유 링크를 통한 진입 (외부 유입)
*특이사항*: 외부 유입이나 Map에서 진입 시, 사용자의 이전 Navigation State(지도 위치, 이전 검색어) 보존이 V2의 중요 UX 과제입니다.

## 3. Component Tree
현재 구현된 상세 페이지 주요 컴포넌트 트리:
- `page.tsx` (Metadata / Server Wrapper)
  - `apt-client.tsx` (Main Client Component)
    - `Header` & `ApartmentSearchTrigger`
    - `HeroTop` (Title, Address, Meta, FavoriteButton, KakaoShareButton)
    - **[Price/Spec]**: `AreaSelector`, `PriceTrendChart`, `InvestmentMetrics`, `AptSpecGrid`
    - **[Score]**: `ApartmentScoreCard`
    - **[Quick Buttons]**: 지도, 로드뷰, 대출한도
    - **[Trades & Briefing]**: `TradeTimelineList` (w/ Filter), `ApartmentBriefingV2`
    - **[Infra Tabs]**: `LivingEnvironmentPanel`, `NeighborhoodInfoPanel`, `EducationPanel`
    - **[Bottom]**: `KakaoMapEmbed`, `CommunityPreview`, `AdContainer`

## 4. Current Render Order
모바일 렌더 순서 (위에서 아래로):
1. **Header & Search Bar**
2. **Hero Title & Meta** (단지명, 공유, 찜)
3. **Price & Area Selector** (최근 거래가, 면적 선택)
4. **Price Trend Chart** (실거래/전세 차트)
5. **Investment Metrics** (투자 지표)
6. **Apt Spec Grid** (세대수, 주차, 연식 등 제원)
7. **E-JIP SCORE V2** (이집점수 카드)
8. **Quick Buttons** (지도, 로드뷰, 대출한도)
9. **Trade Timeline List** (실거래 타임라인)
10. **Apartment Briefing V2** (단지 브리핑 텍스트)
11. **Infra Tabs** (주거환경 / 교통 / 학군)
12. **Map & Community Preview**

*문제점*: `Score V2`와 `Briefing V2`가 서로 다른 구역(Zone)에 분리되어 해석의 일관성이 깨짐. 면적 선택(AreaSelector)이 실거래 리스트와 너무 멀리 떨어져 있음.

## 5. Data Availability
- **AVAILABLE**: 단지명, 주소, 세대수/연식/주차(AptSpecGrid), 면적(AreaLabels), 실거래 타임라인, 실거래 차트(PriceTrendChart), E-jip Score V2, Briefing V2(강점/아쉬움/판단), 학교(EducationPanel), 교통(NeighborhoodInfoPanel), 주거환경(LivingEnvironmentPanel), 관심저장(Favorite), 최근본단지(Recent Sync).
- **PARTIAL**: 갭투자 지표(InvestmentMetrics - 실거래 기반 추정), 대출한도(현재 Quick Button으로 존재하나 단지 시세와 Contextual 연동 미비).
- **NOT_AVAILABLE**: 실시간 매물(호가) 정보(플랫폼 종속적 한계).

## 6. Price Reality Check
현재 이집 데이터 구조 내에서 구현 가능한 "가격 의사결정(Price Layer)" 지표:
- **가능 (안전)**: 최근 실거래가, 동일 면적 최고가(전고점) 대비 하락률, 최근 3개월 거래량 추이, 전세가율.
- **불가능 (위험)**: "현재 네이버부동산 최저 호가", "실시간 매물 가격 기준 저평가 여부".
- **결론**: 실시간 호가를 크롤링하거나 거짓으로 생성하지 않고, `trades` 데이터를 가공한 "최고가 대비 현재 회복률"과 "최근 거래 빈도"를 바탕으로 가격 맥락(Context)을 제공합니다.

## 7. Score Audit
- **현행**: `ApartmentScoreCard`가 Hero 구역과 실거래 구역 사이에 애매하게 위치.
- **의미 유지**: 가격을 배제한 '실거주/입지 가치'의 절대 평가. (Score V2 계산식 및 NED 동작 변경 금지).
- **개선 방향**: 점수(Score)는 결론이므로, 상세 페이지 최상단(Tier 1)으로 끌어올려 사용자가 진입 즉시 단지의 객관적 급(Tier)을 인지하게 합니다.

## 8. Briefing Audit
- **현행**: `TradeTimelineList` 아래에 `ApartmentBriefingV2`가 위치하여, 스크롤을 한참 내려야 비로소 단지의 맥락을 알 수 있음.
- **개선 방향**: 브리핑(인간어 해석)은 점수(Score) 바로 아래에 붙어, "이 점수가 왜 나왔는지"를 즉각 설명하는 한 몸으로 동작해야 합니다.

## 9. 10s View
(상세 진입 직후 스크롤 없이 보이는 영역)
1. **Hero**: 단지명, 주소, 찜하기, 공유하기
2. **TIER 1 (결론)**: 
   - E-jip Score V2 (핵심 방사형/바 차트)
   - Apartment Briefing V2 (강점/아쉬움 요약)
   - 최근 실거래가 요약 (면적 선택 칩 포함)

## 10. 30s View
(1~2회 스크롤 시 보이는 영역)
3. **TIER 2 (맥락과 자금)**:
   - Price Decision Layer (최고가 대비 하락률, 가격 트렌드 차트)
   - **Contextual Tools CTA**: [이 집 사려면 얼마 필요할까?] (대출한도 버튼 대체 및 강화)
   - Compare CTA: [주변 비슷한 단지와 비교하기] (신설 영역 진입점)
   - Infra 요약 (학군/교통 핵심 배지)

## 11. 2m View
(관심을 갖고 딥 다이브하는 영역)
4. **TIER 3 (근거 데이터)**:
   - Trade Timeline List (실거래 리스트 뷰)
   - Infra Tabs (세부 학구도, 대중교통 노선, 편의시설 상세 맵)
   - Apt Spec Grid (용적률, 세대수, 주차대수 등 상세 제원)
   - Community Preview

## 12. Tier IA
모든 섹션을 3단계로 재배치 (Blueprint):
| Section | Current Position | New Position | Why |
| :--- | :--- | :--- | :--- |
| **Score V2** | 중간 | **TIER 1** | 사용자가 가장 먼저 알아야 할 객관적 가치 결론. |
| **Briefing V2** | 하단 | **TIER 1** | Score를 인간의 언어로 설명하는 핵심 요소. |
| **Area Selector** | 상단 | **TIER 1 (Price 내)** | 면적에 따라 가격 결론이 바뀌므로 가격 직상단에 위치 필수. |
| **Price Trend Chart** | 상단 | **TIER 2** | 결론(가격/점수) 인지 후, 트렌드(맥락) 확인 용도. |
| **Real Estate Tools** | Quick Button | **TIER 2** | 가격 트렌드 바로 아래 "내 자금으로 가능한가?" 흐름 연결. |
| **Trade List** | 하단 | **TIER 3** | 원천 데이터(Raw Data)는 결론 확인 후 증빙 자료로 사용됨. |
| **Apt Spec Grid** | 상단 | **TIER 3** | 준공년도, 세대수 외의 세부 제원은 첫 판단 요소가 아님. |

## 13. Keep / Move / Merge
- **KEEP**: Hero Header, Score V2, Briefing V2, Price Trend Chart, Infra Tabs.
- **MOVE**: Score & Briefing을 Tier 1 최상단으로 이동. Apt Spec Grid를 하단으로 내림.
- **MERGE**: `Quick Buttons`의 "대출한도"를 "자금 계산기 CTA"로 격상하여 가격/차트 하단에 맥락 맞게 통합.
- **REMOVE_FROM_PRIMARY_VIEW**: 중복되는 단순 정보 모달(단지정보 등) 및 커뮤니티 배너 하단화.

## 14. Hero Blueprint
- **현재**: 단지명 옆에 주소, 메타 라인이 길게 나열됨.
- **Blueprint**: 모바일 세로 높이 절약을 위해 Title 영역과 찜/공유 버튼을 동일 선상(Flex-row)에 간결히 배치. `heroRegionLabel`과 단지명을 합쳐 1줄 내지 2줄로 압축(Compact Hero).

## 15. Area Selector
- 면적 선택은 **모든 가격 데이터와 차트, 실거래 리스트의 기준점**입니다.
- 단지 상세의 Tier 1 (최신 가격 표시부) 바로 위에 `AreaSelector` 칩(Chip) 형태로 배치.
- 탭 시 하위 Price Trend Chart와 Trade Timeline List가 리렌더링됨을 명확히 인지하게 UI를 구성합니다.

## 16. Contextual Tools Entry
- **진입점**: Tier 2 (가격 차트 바로 아래).
- **디자인**: 일반 버튼이 아닌 **액션 카드(Action Card)** 형태.
- **데이터 바인딩**: 현재 `selectedArea`의 `latestPriceNum`을 Context 파라미터로 넘겨 바텀시트/모달로 자금 계산기가 열릴 수 있는 진입점을 마련합니다. (실제 도구 내부 구현은 Tools V2 단계에서 진행).

## 17. Compare Entry
- **진입점**: Tier 1 끝단 또는 Tier 2 시작점 (자금 계산기와 인접).
- **디자인**: 플로팅 액션 버튼(FAB) 또는 인라인 배너. "[비교] 이 단지와 고민 중인 아파트가 있나요?"
- 현재 비교 모듈이 없으므로, 향후 V2-3 Compare 구현 시 활성화될 Placeholder 영역을 설계합니다.

## 18. Mobile Action Model
- **Bottom Fixed Area 제안**: 
  - 스크롤을 내려도 항상 쫓아오는 하단 Sticky Bar.
  - 구성: [현재 선택된 면적의 요약 가격] + [관심 저장 아이콘] + [자금 계산 Primary 버튼].
  - 이를 통해 긴 페이지 스크롤 중에도 언제든 '저장'과 '계산(결정)'이 가능하도록 합니다.

## 19. Navigation / State
- 지도(`MAP`)에서 진입 시 뒤로 가기(`BACK`) 시 지도의 Zoom, Pan, Filter State가 초기화되지 않도록 클라이언트 라우팅 캐시(Navigation 보존) 아키텍처를 유념하여 설계합니다 (V2-5 단계 과제).

## 20. Loading / Empty / Error
- **Score NED**: 기존 "데이터 부족" 카드 디자인 유지. 강제로 0점 처리하지 않음.
- **Trades 없음**: "해당 평형의 실거래 내역이 없습니다"라는 명확한 Empty State 컴포넌트(Illustration + Text) 노출.
- **Skeleton**: 페이지 진입 시 전체 로딩 스피너 대신, Hero + Score + Price 영역 크기의 Skeleton UI를 렌더링하여 TTI(Time To Interactive) 체감 속도 개선.

## 21. Trust UI
- 실거래가 리스트 및 차트 하단에 "출처: 국토교통부 실거래가 공개시스템", "최근 업데이트: YYYY.MM.DD" 등 정보의 신뢰도(Trust)를 보증하는 캡션(Caption)을 일관성 있게 배치합니다.

## 22. Duplication
- 현재 Quick Buttons에 있던 기능과 본문 내용의 중첩 해결 (대출한도는 자금 도구로 통합).
- 실거래가 필터(매매/전월세, 1년/3년 등)는 Area Selector와 분리하여 차트와 리스트에 공통 적용되도록 상태를 끌어올림(State Hoisting).

## 23. Mobile Vertical Budget
360px 모바일 기준 (예상 Viewport):
- 첫 화면 (0~100vh): Header(60px) + Compact Hero(80px) + Score V2(180px) + Briefing(150px) + 최신가격(100px) => 스크롤 없이 핵심 가치 파악 완료.
- 두 번째 화면 (100vh~200vh): 차트 + 자금 계산기 CTA + 비교 CTA.
- 불필요한 공백(Margin)을 줄여 밀도(Density)를 아실 수준은 아니더라도 현행보다 높입니다.

## 24. Desktop
- 데스크탑 환경에서는 Tier 1(Score/Briefing/Price)을 좌측 컬럼으로 고정(Sticky)하고, Tier 2/3(Chart/Trades/Infra)를 우측 스크롤 영역으로 배치하는 Two-Column Layout(Split View) 확장을 염두에 둡니다.

## 25. Implementation Steps
Detail V2 개편은 다음 3단계로 구현을 권장합니다:
- **V2-1B**: `Tier 1 / Hero / Summary restructuring` (컴포넌트 재배치 및 Hero/Score/Briefing 위계 조정).
- **V2-1C**: `Price Layer + Trades hierarchy` (가격 맥락 추가 및 AreaSelector/Chart/List 상태 정비).
- **V2-1D**: `Contextual Tools + Sticky Bottom Action` (계산기 진입점 및 고정 Action Bar 구현).

## 26. Regression Boundaries
이 UI/UX 개편 과정에서 절대 깨지면 안 되는 핵심 기능:
- [ ] `ApartmentScoreCard`의 Score V2 계산 결과 및 NED 상태.
- [ ] `AreaSelector` 선택 시 `TradeTimelineList`와 `PriceTrendChart`의 필터링 동기화.
- [ ] 즐겨찾기(FavoriteButton) 및 카카오톡 공유(KakaoShareButton) 동작.
- [ ] URL 파라미터(`lawdCd`, `dong`)를 통한 API 패치 동작.
- [ ] `recordApartmentVisit` (최근 본 단지 Sync) 로직.

## 27. Risks
- 너무 많은 정보(Score, Chart, Briefing)가 스크롤 상단(Tier 1/2)으로 이동함에 따라, 서버/클라이언트 첫 렌더링 병목(Performance)이 발생할 수 있으므로 Lazy Loading(Dynamic Import) 경계선을 재조정해야 함.

## 28. Recommended V2-1B
- 다음 STEP(V2-1B)에서는 `apt-client.tsx` 내 JSX 구조를 본 Blueprint의 TIER 1 / TIER 2 / TIER 3 구조로 물리적으로 **재배치(Restructuring)**하는 작업부터 수행합니다.
