# UI/UX V2-1C — PRICE READABILITY

## 1. Baseline
- **branch**: `main`
- **commit**: `6cb5064` (docs(product): record detail tier 1 implementation)
- **Target**: `src/app/apt/[name]/apt-client.tsx`, `src/components/TradeTimelineList.tsx`

## 2. User Readability Feedback
- 사용자 피드백: "글자가 작다", "실거래가 영역은 여백이 많은데 글자는 작아 보인다"
- 해결 방안: 불필요한 레이아웃(테이블 셀 여백)을 걷어내고, 핵심 가격 숫자의 폰트 크기와 두께를 대폭 상향하여 밀도(Density)와 가독성을 동시에 개선했습니다.

## 3. Previous Typography & Layout
- `TradeTimelineList`가 `<table>` 기반으로 렌더링되며 계약월/일/가격/타입을 좁은 가로폭에 나눠 가져 가격 숫자가 줄바꿈되거나 너무 작게 보였습니다.
- 가격 Snapshot 영역도 단순 텍스트 나열에 불과하여 계층(Hierarchy) 구분이 명확하지 않았습니다.

## 4. New Hierarchy (Trade Row Design)
실거래가 1건에 대한 시각적 우선순위를 재정의했습니다:
1. **PRICE**: `1.1rem` bold로 가장 눈에 띄게 강조.
2. **CONTRACT DATE & AREA**: `0.85rem` secondary text로 가격 밑에 배치.
3. **FLOOR & TYPE**: 우측 정렬된 메타데이터로 분리.

## 5. Density & Contrast Changes
- 테이블(`<table>`) 구조를 폐기하고, flex 레이아웃 기반의 리스트 형태(`div`)로 변경하여 가로 스크롤 이슈 원천 차단.
- 가격 텍스트 색상을 `var(--text-primary)`로 명확히 하고, 등락폭 뱃지(▲/▼)의 시인성을 높이기 위해 폰트 굵기를 강화(700)했습니다.
- 배경색 칩이나 연한 회색 라인의 두께/색상을 정제했습니다.

## 6. Price Context Calculation
- 최근 거래가(heroTrade)가 선택한 면적 및 기간 내에서 최고가 대비 어느 정도 위치에 있는지 자동 계산하는 로직을 추가했습니다.
- 계산 로직: `((최고가 - 최근거래가) / 최고가) * 100`
- 조건: 필터링된 거래 건수가 2건 이상일 때만 비교(데이터가 불충분할 때 AI 판단 자제).

## 7. Context Wording
- "선택 기간 최고 거래보다 X% 낮아요" 또는 "선택 기간 내 최고가로 거래됐어요" 와 같이 매우 객관적이고 안전한 문구만 노출합니다.
- "시세보다 싸다" 같은 주관적 단정 금지 원칙 준수.

## 8. Data Sufficiency
- 선택된 필터 조건 내에 거래가 1건뿐이라면 비율 비교나 맥락 문구를 일절 생성하지 않습니다.

## 9. Chart & Filters
- `TradeTimelineList`의 기간(1년/3년/5년/전체) 및 매매/전월세 필터는 기존 기능을 완벽히 유지합니다. 
- 차트 데이터 로직은 변경 없이 Presentation만 연동됩니다.

## 10. Empty State
- 거래가 없을 때의 Empty state를 "선택한 조건의 실거래가 없습니다." 등 더 친절한 안내로 개선했습니다.

## 11. Mobile QA (360/375/390)
- **360px**: 가로로 좁은 화면에서도 가격과 날짜 텍스트가 겹치거나 잘리지 않습니다.
- **375px/390px**: 매우 안정적이고 가독성이 우수한 리스트 뷰를 제공합니다.

## 12. Readability QA
1. **가격이 첫눈에 보이는가?** YES (가장 큰 Bold 텍스트)
2. **날짜/층/면적을 확대 없이 읽을 수 있는가?** YES
3. **여백 때문에 화면이 헐거워 보이지 않는가?** YES (flex-between으로 최적화)
4. **40~50대 사용자도 편하게 읽을 수준인가?** YES (1.1rem 가격 폰트)

## 13. Regression Check
- 면적 필터, 거래유형(매매/전월세), 기간 필터 시 하단 리스트가 정확히 동기화됨을 확인.
- V2 점수 카드(Score) 렌더링에 영향 없음.

## 14. Next Recommendation
- V2-1D: 현재 분산되어 있는 "지도, 로드뷰, 대출한도" Quick Buttons를 묶어 "Contextual Tools CTA" 영역으로 업그레이드할 것을 권장합니다.
