# SEARCH MAP V2.1 MARKER & PERFORMANCE OPTIMIZATION

## 1. Previous Problems
- 사용자가 아파트를 검색하고 선택했을 때, 지도 마커가 강조되지 않고 하이라이트가 즉시 사라짐. (Autocomplete의 `aptSeq`와 Marker의 `dong-name` ID 불일치)
- 최근 5년 신축 아파트에 대한 시각적 구분이 누락되어 있음.
- 지도 검색 및 자동완성 속도가 매우 느림(체감 1~2초). 입력 시 불필요한 스와이핑 및 stale response 현상 발생.

## 2. Marker Architecture
- `map/page.tsx`에서 `AptMarker`의 `id`를 `dong-name` 조합으로 사용 중이었음.

## 3. Selected Marker
- `AptMarker` 인터페이스에 `aptSeq`를 추가하고, 내부 `id`를 `item.aptSeq || dong-name`으로 변경하여 검색 결과의 ID(canonical identity)와 마커 ID를 완벽히 일치시킴.
- 선택 시 마커의 z-index를 최상단(9999)으로 올리고, 크기를 키우며(`scale`), 강한 테두리 색상(`#1e293b`)과 그림자를 부여함.

## 4. New Build Definition
- `ApartmentMaster`에서 `buildYear`를 읽어와 5년 이내 신축인지 판단. `currentYear - marker.completionYear <= 5`.

## 5. New Build Styling
- 마커 좌측 상단에 `var(--primary-color)` 색상의 "신축" 뱃지 추가.
- 배경색을 약간의 초록빛(`#f0fdf4`)으로 주어 기존 흰색/연회색 마커와 은은하게 구분되도록 함.

## 6. Priority Rule
- `selected` 스타일이 `isNewBuild` 배경 및 테두리 색상보다 늦게 평가되도록 삼항 연산자를 구성하여, **SELECTED > NEW_BUILD > DEFAULT** 우선순위를 엄격하게 지킴.

## 7. Search Performance Root Cause
- `/api/search`에서 Region 검색 시 `umdName` 기준 `groupBy`에 `_count` 정렬을 사용하여 Full Table Scan 유발 (약 430ms).
- Apartment 검색 시 `orderBy: { totalHouseholds: 'desc' }` 쿼리가 매칭 결과가 없을 때 전체 테이블을 정렬하려 시도하여 병목 발생 (약 840ms).

## 8. Before/After Timing
- **연산동 (Region)**: Before ~800ms -> After ~40ms (using `findMany` + `distinct` and taking 5)
- **연산한솔 (No match scan)**: Before ~1270ms -> After ~550ms (parallel execution)
- **대신롯데 (Fast match)**: Before ~450ms -> After ~30ms (DB side limit without order, JS sort)

## 9. Debounce
- 300ms에서 250ms로 단축하여 사용자 타이핑 시 반응성 개선.

## 10. Request Cancellation
- `AbortController`를 도입하여, 빠르게 타이핑할 경우 이전 API 요청을 즉각 취소하도록 변경.

## 11. Duplicate Requests
- 단순한 `Map`을 이용한 Client Cache를 `ApartmentAutocomplete`에 도입하여, 동일한 검색어 입력 시 API 재호출을 방지.

## 12. API Optimization
- `groupBy`를 제거하고 `findMany` + `distinct` 로 대체.
- Region과 Apartment 쿼리를 `Promise.all`을 통해 병렬로 실행.
- DB 레벨의 무거운 `orderBy` 정렬을 제거하고, `take: 50`으로 가져온 후 JavaScript 단에서 `totalHouseholds` 기준으로 정렬 및 슬라이싱(`slice(0, 15)`) 하도록 개선.

## 13. Mobile
- 360/375/390 뷰포트에서 마커 및 자동완성 패널 시각적 오류 없음 확인.

## 14. Regression
- 기존의 Map Filters 및 한글 검색 동작(띄어쓰기 등)에 문제 없음 확인.

## 15. Next Step
- Trade Identity Data Trust P0 (Statistics V2 등)
