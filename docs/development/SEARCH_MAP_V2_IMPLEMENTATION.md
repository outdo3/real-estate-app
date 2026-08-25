# SEARCH & MAP V2 IMPLEMENTATION REPORT

## 1. Previous Problems
1. 지도에서 지역명("연산동") 검색 시 아무 반응이 없거나 카카오 API에만 의존하여 불완전하게 동작.
2. 자동완성 기능이 지역 내 아파트를 함께 추천하지 못함.
3. 검색 결과(Home, Search Filter 등) 선택 시 아파트 고유 식별자(aptSeq 등)를 넘기지 않고 이름 문자열(`name`)에만 의존하여 실거래 데이터를 재탐색, 일부 아파트("연산한솔솔파크아파트")에서 실거래 연결이 실패함.
4. 사용자에게 내부 에러 텍스트가 그대로 노출되는 문제.

## 2. Search Architecture
기존에 산재되어 있던 카카오 키워드 검색(`geocoder`) 기반의 `ApartmentAutocomplete` 검색을 100% 자체 DB 기반 통합 검색 API(`/api/search`)로 전환했습니다.
사용자 타이핑마다 외부 API에 다량의 요청을 보내던 구조를 탈피하여 Prisma를 이용한 내부 검색 엔진을 사용합니다.

## 3. Result Types
검색 결과는 다음과 같이 2가지 Type으로 분리됩니다:
- **REGION**: 법정동(`umdName`) 단위 검색 결과 (예: "부산광역시 연제구 연산동")
- **APARTMENT**: 단지 검색 결과 (예: "대신롯데캐슬")

이들은 프론트엔드에서 `UnifiedSearchResult`로 합쳐져 노출됩니다.

## 4. Region Search
사용자가 "연산동" 입력 시 `/api/search`가 DB의 `ApartmentMaster`를 GroupBy하여 해당 법정동 결과를 최상단에 반환합니다. 지역 결과 선택 시 `ApartmentAutocomplete` 내부에서 해당 지역명을 바탕으로 카카오 지오코더를 단 1회 호출해 정확한 Center Lat/Lng를 추출하고 지도를 부드럽하게 이동시킵니다(Map panTo 렌더링).

## 5. Apartment Search
아파트 검색 역시 `name`, `normalizedName` 기반 검색으로 변경되어 "연산 한솔"과 "연산한솔" 등 partial query에 반응할 수 있습니다. 결과 리스트에는 세대수 및 준공연도가 즉각 표시(N+1 조회 제거)됩니다.

## 6. Canonical Identity
아파트 검색 결과 선택 시 더 이상 `name` 하나에만 의존하지 않습니다. `lawdCd`와 `dong`을 강제로 확보하여, `HomeApartmentSearch`, `ApartmentQuickSearch` 등에서 상세페이지(`/apt/[name]`)로 이동할 때 URL 파라미터로 명확한 식별자를 함께 전달합니다.

## 7. Map Movement
지도 검색(Map Viewer)에서 단지 선택 시:
- `handleApartmentSelect`에서 해당 좌표로 `panTo()`를 수행합니다.
- `selectedMarkerId`에 `aptSeq`를 부여하여 단지 마커의 바텀시트 프리뷰가 즉각 팝업되도록 연동했습니다.

## 8. Ranking
현재 지역(Region)이 최상단, 그 다음은 세대수(`totalHouseholds DESC`) 순으로 아파트가 랭킹되어 노출됩니다. 가장 대표성 있는 단지가 상단에 위치합니다.

## 9. Korean Normalization
DB 내 `normalizedName`(`연산한솔` 등 공백 및 suffix 제거 필드)을 OR 조건으로 검색하게 하여 한국어 검색 매칭 정확도를 높였습니다.

## 10. Home Trade Identity Fix
홈 검색 시 연결 실패 원인은 "연산한솔솔파크아파트"라는 검색어만으로 실거래 데이터를 다시 찾으려다 법정동명 유추에 실패했기 때문이었습니다. 이제 `lawdCd`와 `dong` 파라미터가 명시적으로 전달되므로 안정적으로 실거래 조회가 매칭됩니다.

## 11. Mobile
모달과 검색 패널 UI가 360/375/390 너비의 모바일 화면에서 스크롤 및 터치 타겟(padding) 최적화와 함께 오버랩 없이 렌더링 되도록 `ApartmentAutocomplete`의 팝업 위치/z-index 로직을 고도화했습니다.

## 12. Regression
Map 카테고리 필터(생숙/오피스텔 등) 동작과 렌더링, Pyeong AreaSelector(단지마스터)가 검색 교체 후에도 영향을 받지 않도록 `categoryFilter` 등 기존 Props 호환성을 완전히 보존했습니다.

## 13. Next Step
- DETAIL V2-1D 나머지 UI 마이그레이션 진행 (또는 사용자 피드백에 따른 튜닝).
