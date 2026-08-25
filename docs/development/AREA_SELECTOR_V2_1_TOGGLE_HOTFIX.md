# AREA SELECTOR V2.1 TOGGLE HOTFIX

## 1. Bug
모바일 및 데스크탑의 아파트 상세 페이지에서 AreaSelector 상단 우측에 있는 "㎡ | 평" 토글을 클릭해도 평형 칩들의 라벨이 변경되지 않는 문제가 보고됨. (예: 연산동일동미라주더스타 등에서 토글 반응 없음)

## 2. Root Cause
- `apt-client.tsx` 내에서 관리되는 `areaUnit` 상태(state)가 자식 컴포넌트인 `AreaSelector`로 props로 전달되지 않음.
- AreaSelector 내부에서 평/㎡에 따른 라벨 변경 렌더링 로직이 누락되어 있었음.

## 3. Toggle Rule
단지에 구축된 Unit Master 데이터 중 최소 1개 이상이 신뢰할 수 있는 `representativePyeong`(대표 평형)을 보유하고 있을 때만 "㎡ | 평" 토글 UI를 렌더링하도록 조건부 렌더링 적용. 의미 없는 "가짜 평형(단순 나누기 3.3)"을 방지하기 위함.

## 4. Unit Master Available
Unit Master가 존재하는 경우, `areaUnit` 상태에 따라:
- **㎡ 모드**: `전용 84.79㎡` 형태의 컴팩트한 기본 라벨 적용.
- **평 모드**: 대표 평형 우선(`34평`). 충돌(동일 대표 평형 내 다른 전용면적)이 있는 경우에만 보조 라벨로 `전용 84.79㎡` 등을 추가로 보여주어 칩 구분 보장.

## 5. Unit Master Missing
- 신뢰할 수 있는 대표 평형(`representativePyeong`)이 전체 타입 중 하나도 없으면 토글 UI 자체를 아예 노출하지 않음.
- 이 경우 기존대로 정확한 법정 전용면적(exact canonical exclusive area)만 표시.

## 6. Mixed Coverage
한 단지 내에 어떤 타입은 대표 평형이 있고, 어떤 타입은 없는 경우:
- 대표 평형이 있는 타입은 평 모드일 때 평형(예: 34평)을 정상 표기.
- 없는 타입은 동일 화면(평 모드)에서도 강제로 추정하지 않고 `전용 71㎡` 등 실측 전용면적으로 Fallback되어 표시.

## 7. Collision
동일 단지 내 동일한 `representativePyeong`이 여러 전용면적 타입에 존재할 경우 (예: 대신롯데캐슬 84.79㎡ 와 84.99㎡ 가 모두 34평인 경우):
- 평 모드에서 칩의 메인 라벨은 `34평`으로 두고, 서브 라벨(pyeongLabel) 영역에 `전용 84.79㎡`를 함께 노출하여 사용자가 두 칩을 구별할 수 있도록 함.

## 8. Scroll Hint
가로 스크롤 칩들의 우측이 잘려 안 보일 때 스크롤 가능하다는 것을 인지하기 쉽도록, 우측 끝단에 흰색 fade-out(`linear-gradient`) overlay 힌트를 추가함.

## 9. Mobile
360/375/390 너비의 모바일 화면에서, 긴 라벨이나 칩 텍스트 및 Fade Hint가 레이아웃을 깨지 않고 정상 동작함.

## 10. Regression
- 토글 동작 시 라벨 노출(UI)만 변경되며, 실제 내부의 필터링 키(canonical identity)는 exact area(`84.7855` 등)를 그대로 유지하므로 실거래가 검색 및 표출 로직(Trade filter)은 100% 정상 작동.
