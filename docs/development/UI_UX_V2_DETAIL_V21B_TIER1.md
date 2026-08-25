# UI/UX V2-1B — APARTMENT DETAIL TIER 1 IMPLEMENTATION

## 1. Baseline
- **branch**: `main`
- **commit**: `82541bb` (feat(ui): restructure apartment detail tier one)
- **Target**: `src/app/apt/[name]/apt-client.tsx` 상단 정보 위계(Tier 1) 재편

## 2. Previous Render Order
1. Hero Top (넓은 여백의 타이틀 및 주소)
2. AreaSelector (면적 선택 칩)
3. Price Trend Chart (시세 차트)
4. Investment Metrics (투자 지표)
5. Apt Spec Grid (제원)
6. E-JIP SCORE V2 (점수 카드)
7. Quick Buttons (지도, 로드뷰, 대출한도)
8. Trade Timeline List (실거래 리스트)
9. Apartment Briefing V2 (브리핑 텍스트)

## 3. New Tier 1 Order
1. **Compact Hero**: 단지명과 주소, Favorite/Share 액션을 콤팩트하게 밀착.
2. **Area & Price Snapshot**: 면적 칩(`AreaSelector`)과 해당 면적의 최신 실거래 요약 텍스트를 위로 끌어올림.
3. **E-JIP Score V2**: 단지의 절대 가치를 객관적으로 평가한 점수 카드를 첫 화면 맥락 안으로 이동.
4. **Apartment Briefing V2**: 점수에 대한 인간어(Human-readable) 해석을 Score 직하단에 배치.

## 4. Hero Changes
- `heroTop`의 Flex 구조를 조정하여 찜(FavoriteButton)과 공유(KakaoShareButton)를 제목 옆 상단으로 끌어올렸습니다.
- 과도한 수직 여백(margin/padding)을 제거하여 모바일 Viewport 낭비를 최소화했습니다.

## 5. AreaSelector Placement
- 시세, 점수, 브리핑을 읽기 전 사용자가 "이게 어느 평형 기준인지" 즉각 인지하도록 가격 스냅샷 바로 위로 이동했습니다.
- 실거래 필터(매매/전월세, 1년/3년 등) 중 '면적'은 상단에 남기고 나머지 필터는 하단 원천 데이터 리스트(TradeTimelineList)에 남겨두었습니다 (상태 커플링 유지).

## 6. Price Snapshot Placement
- Hero 직하단에 배치하여 "그래서 최근 얼마에 거래됐나?"라는 핵심 질문을 가장 먼저 해결합니다. 
- 복잡한 차트를 스크롤 하단(Tier 2)으로 밀어내고, 텍스트 형태의 최고가/최저가 및 최신 실거래가만 Snapshot 형태로 렌더링합니다.

## 7. Score Move
- 중간 구역에 고립되어 있던 `ApartmentScoreCard`를 Tier 1으로 전진 배치했습니다.
- Score 컴포넌트 자체의 내부 계산 로직, eligibility, NED 처리 기준은 100% 원형 보존했습니다.

## 8. Briefing Move
- 최하단 실거래 리스트 아래에 있던 `ApartmentBriefingV2`를 Score 바로 밑으로 끌어올렸습니다.
- 두 컴포넌트는 물리적(UI)으로는 분리하되, 맥락(Context)상 하나로 읽히도록 인접 배치했습니다.

## 9. Preserved Features
- **Tier 2/3**: PriceTrendChart, InvestmentMetrics, TradeTimelineList, AptSpecGrid, Quick Buttons, Infra Tabs, Map 등은 삭제되지 않고 안전하게 아래로 이동했습니다.
- **Quick Buttons**: 기존의 대출한도, 지도, 로드뷰 CTA는 보존되었습니다 (추후 V2-1C/1D에서 Contextual Tool로 변경 예정).

## 10. NED Behavior
- 데이터 부족(NOT_ENOUGH_DATA) 단지의 경우, 기존과 동일하게 "데이터가 부족하여 이집점수를 산정하지 못했습니다" 안내가 Tier 1에서 정상 출력됩니다. 

## 11. Mobile QA
- **360px / 375px / 390px**: Hero 영역 축소 덕분에 첫 화면에서 Title, Price Snapshot, Score V2 상단부까지 시야에 들어오는 밀도(Density) 높은 UX 달성.
- 가로 스크롤 및 컴포넌트 간 오버랩 겹침 문제 없음 확인.

## 12. Desktop QA
- 중앙 정렬(`container`) 레이아웃을 그대로 준용하되, 데스크탑에서도 동일한 수직 위계(Tier)로 논리적인 읽기 흐름을 유지합니다.

## 13. Regression Check
- **Score V2**: 대신해모센트럴(정상) / 구덕금호(NED) 등 기존 벤치마크 점수/상태 변화 없음.
- **Area/Trades**: AreaSelector 클릭 시 state 정상 업데이트 및 하단 차트/리스트 연동됨.
- **Auth/Favorite**: `FavoriteButton` 로그인 인텐트 및 추가/제거 정상 동작. 

## 14. Limitations
- 가격 정보(최고가 대비 하락률 등)를 추가로 도출하는 로직은 본 단계에서 구현하지 않았습니다. (다음 STEP인 Price Layer에서 구현 필요).
- '대출한도' Quick Button은 아직 낡은 모달 연동 방식으로 남아 있습니다.

## 15. V2-1C Recommendation
다음 구현 단계(V2-1C)에서는:
- Tier 2의 Price Chart 하단에 "최고점 대비 몇 %" 식의 계산된 Price Layer를 보강하고,
- 실거래 리스트 뷰 및 거래 빈도 요약 등을 강화할 것을 제안합니다.
