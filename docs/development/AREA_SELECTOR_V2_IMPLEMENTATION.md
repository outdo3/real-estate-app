# AREA SELECTOR V2 IMPLEMENTATION REPORT

## 1. Previous Problem
기존 Area Selector는 MOLIT 실거래 데이터에 의존하여 "최근 36개월 내 거래가 있는" 전용면적만을 노출했으며, 공급면적/대표평형을 추정 산식(전용면적 / 3.3058)에 기반하여 가짜 평수("약 25.6평")로 표시하여 사용자에게 혼란을 주었습니다. 대형 평수 등 최근 거래가 없는 평형은 Selector에서 아예 누락되는 문제도 존재했습니다.

## 2. Unit Master Source
새로운 Area Selector V2는 앞서 구축한 `ApartmentUnitType` Production DB를 primary source로 사용합니다. API(`/api/apt/[name]/info`)에서 단지 정보와 함께 `unitTypes` 배열을 반환받아 클라이언트의 상태로 저장(`unitMaster`)하고 이를 하위 UI 컴포넌트로 전달합니다.

## 3. Raw vs Display Unit
API가 내려준 Raw Unit 목록은 Presentation Layer(`groupToDisplayUnits` helper)를 거쳐 `DisplayUnit` DTO 배열로 변환됩니다. 동일한 아파트 내에서 `canonicalExclusiveArea`가 정확히 일치하는 raw variant들은 하나의 `DisplayUnit`으로 묶이며(`householdCount` 합산, `supplyArea` Min/Max 갱신 등), 이 DisplayUnit 단위로 Area Selector의 칩 및 모달에 렌더링됩니다.

## 4. Micro Variants
- 서구 실데이터 내 Micro-variant 집계: 대신롯데캐슬 84.7855㎡의 경우 공급면적 112.3554㎡(196세대)와 112.3632㎡(1세대) 2개의 variant가 존재.
- 이 둘은 동일한 `canonicalExclusiveArea`(84.7855)를 가지므로 화면 상으로는 197세대의 단일 Display Unit 칩으로 성공적으로 병합되었습니다.

## 5. Representative Pyeong
Display Unit 그룹 내의 모든 variant가 동일한 `representativePyeong`을 가질 경우 해당 평형(예: 34평)을 화면에 표시합니다. 만약 그룹 내 variant 간 대표 평형이 불일치하면, 강제로 선택하지 않고 fallback으로 전용면적(예: 전용 84.79㎡)만을 표시합니다.

## 6. Provenance
`representativePyeongSource`는 기존 규칙을 유지합니다:
- 모든 variant가 `OFFICIAL_LABEL`인 경우에만 `OFFICIAL_LABEL` 유지
- 그 외의 경우 `SUPPLY_AREA_DERIVED`로 하향조정 혹은 불일치 시 `UNKNOWN` 처리

## 7. Collision (Same-label)
대신롯데캐슬 84.7855㎡와 84.9950㎡는 산식에 의해 모두 "34평" 도출이 가능합니다. UI 상의 라벨 충돌을 막기 위해 AreaChip 및 모달 리스트에서는 "34평 · 전용 84.79㎡", "34평 · 전용 85.00㎡"와 같이 2차 식별자(보조 전용면적)를 명확하게 동시 표기하도록 구성되었습니다. (이전처럼 "34(전용 84)" 식의 임의 병합 금지)

## 8. Fallback
REVIEW 대상 단지이거나 데이터가 없는 단지에 대해서는 기존처럼 실거래 데이터(trades) 기반으로 Area 칩들을 동적 렌더링합니다. 이 경우 "약 xx평" 등의 Fake Pyeong 계산식 적용을 배제하여 "전용 84.79㎡"의 정확한 전용면적 표시만 노출합니다.

## 9. Trade Filtering
Display Unit이 선택될 경우, 거래내역 리스트 필터링은 Display Unit의 그룹키인 `canonicalExclusiveArea`(exact match) 원본 데이터를 그대로 유지하며 필터링이 수행됩니다. 평형이나 공급면적으로 필터링하지 않으므로 기존 거래내역 로직이 100% 보존됩니다.

## 10. Daesin Regression
대신롯데캐슬 테스트 결과:
- 84.7855㎡ (196+1세대 병합): "34평 · 전용 84.79㎡" 표시 완벽
- 84.9950㎡ (191세대): "34평 · 전용 85.00㎡" 로 완전히 분리 표기 유지됨
- 129.7178㎡ (79세대 대형): 과거 거래가 없음에도 불구하고 Selector에 "50평 · 전용 129.72㎡"로 성공적 노출 및 필터 시 "거래 없음" 표출 확인.

## 11. Seo-gu QA
서구 READY 11개 아파트 전수에 대해 Selector 렌더링, 중복 칩 제거, 정확한 세대수 노출, 미거래 타입 렌더링이 문제없이 동작함을 확인했습니다.

## 12. Mobile
모달은 기존 `<select>` 방식에서 Bottom/Centered sheet 방식으로 개선되었습니다.
360/375/390 너비의 디바이스에서 가로 스크롤 가능한 AreaChip 렌더링 및 모달 클릭 타겟(padding 확장)이 모두 잘림이나 겹침 없이 동작하도록 최적화되었습니다.

## 13. Regression
- 기존 "㎡ / 평" 단순 토글 버튼: 공급면적 기반 평형이 적용된 현재 상황에서 혼란을 주지 않도록 UI에서 완전 제거되었습니다.
- 상세페이지 상단 Hero 라벨 표기도 `renderHeroAreaLabel` 헬퍼를 통해 안전한 DisplayUnit 체계 또는 전용면적 기본 표기로 연동되었습니다.
- 타 페이지/성능 Regression 없음 (TypeCheck/Build 패스).

## 14. Next Step
검색/지도 상에서의 Area Selector 필터 연동 (SEARCH/MAP V2 개선) 혹은 DETAIL V2-1D 나머지 UI 마이그레이션이 권장됩니다.
