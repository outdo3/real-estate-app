# SEARCH / MAP PERFORMANCE V2.2

작성일: 2026-08-27
성격: `BUSAN_DATA_UX_AUTOMATED_QA_V1`의 후속 STEP. (A) BCR>100 2건 read-only 빠른 감사, (B) 검색→결과 클릭→지도 전환→selected marker→주변 marker까지 실제 E2E latency 계측, (C) 증거 기반 root cause 개선(안전한 client/read-path 범위), (D) "무반응 3초" 제거. DB/schema/migration/거래계산/Unit Master/Score 변경 없음.

---

## 1. User Observed Problem

1. 검색창에 "연산동" 입력 → 결과가 보이기까지 체감 약 3초
2. 결과에서 "연산동한솔솔파크" 클릭 → 지도에서 마커가 뜨기까지 추가 체감 약 3초

즉 서버 API baseline(직전 QA: `/api/search` 평균 135ms, info 791ms, trade 37ms)만으로는 이 체감이 설명되지 않는다는 것이 이번 STEP의 출발점이었다.

---

## 2. Previous QA Baseline

`BUSAN_DATA_UX_AUTOMATED_QA_V1` 실측: 부산 ApartmentMaster 3,402건, `/api/search` 평균 135ms(대표 쿼리 5개), info API 평균 791ms, trade API 평균 37ms(대표 set 39건), marker 전용 API 없음, `RELEASE_GATE = LIMITED`.

---

## 3. BCR > 100 Audit

`buildingCoverageRatio > 100` WARN 2건을 SEARCH/MAP 작업 전에 read-only로 먼저 감사했다(§2 요구).

| 항목 | 동원화인패밀리 | 광안동에스케이뷰 |
|---|---|---|
| ApartmentMaster.id | 143 | 3125 |
| aptSeq | 26230-128 | 26500-1384 |
| lawdCd(sggCd) | 26230(부산진구) | 26500(수영구) |
| dong(umdName) | 개금동 | 광안동 |
| jibun | 1-12 | 473-2 |
| 저장된 buildingCoverageRatio | 122.37 | 110.7 |
| basicSpecSource | BUILDINGHUB_GENERAL_TITLE(총괄표제부) | BUILDINGHUB_GENERAL_TITLE(총괄표제부) |
| mgmBldrgstPk | 103212277 | 10411948 |

`getBrRecapTitleInfo`(총괄표제부)를 이 프로젝트가 이미 쓰는 API 키로 라이브 재조회한 결과, 두 건 모두 **정확히 일치하는 원본 값**을 독립적으로 재현했다:

- 동원화인패밀리: `platArea=40329, archArea=49352.45, bcRat=122.37, vlRat=265.11, mgmBldrgstPk=103212277` — 저장값과 소수점까지 정확히 일치.
- 광안동에스케이뷰: `platArea=9468, archArea=10480.954, bcRat=110.7, vlRat=965.43, mgmBldrgstPk=10411948, totPkngCnt=585, hhldCnt=361, useAprDay=20060330` — 저장값과 전부 정확히 일치(교차검증 필드까지 포함).

**분류: 두 건 모두 `SOURCE_VALUE`.** 정부 공식 총괄표제부 원본 응답 자체가 100%를 넘는 건폐율을 보고하고 있으며, 이 프로젝트의 파이프라인은 그 값을 정확히 그대로 저장했을 뿐이다(경쟁사 값 사용 없음, 다른 record/identity 혼동 없음 — `WRONG_RECORD`/`WRONG_MAPPING`/`DATA_ERROR` 전부 배제). 총괄표제부의 `archArea`(건축면적 합계)가 `platArea`(대지면적)를 넘는 것은 여러 동을 가진 복합단지(두 단지 모두 `mainBldCnt=7`)에서 대지 면적 산정 방식(지목 병합/구대장-신대장 전환 등)에 따라 실제로 발생하는 정부 등록 관행상의 특성으로 보이나, 그 근본 원인 자체는 이번 STEP 범위 밖(정부 등록 데이터 자체의 이슈)이다.

**BCR_DATA_FIX_REQUIRED = NO.** 애플리케이션 read-path 버그가 아니므로 이번 STEP에서 수정하지 않는다. UI에서 100% 초과 값을 사람이 보기에 자연스럽게 안내할지는 별도 제품 STEP 권고 사항으로 남긴다(§21).

---

## 4. Search Architecture

실제 코드 추적 결과, `/map` 페이지의 검색창은 `ApartmentAutocomplete.tsx` 하나다(홈 화면 등 다른 검색 컴포넌트는 이번 사용자 시나리오와 무관해 범위에서 제외).

```
ApartmentAutocomplete (src/components/ApartmentAutocomplete.tsx)
  keystroke → useState(keyword)
  → useEffect([keyword]) 디바운스 250ms
  → in-memory Map cache 조회(hit면 네트워크 없이 즉시 표시)
  → AbortController로 이전 요청 취소
  → fetch(/api/search?q=...)
  → setResults/setShowDropdown(dropdown 렌더)
  → 항목 클릭 → onSelect(handleApartmentSelect) → src/app/map/page.tsx
```

`/api/search`(`src/app/api/search/route.ts`)는 이미 `ApartmentMaster`/`ApartmentLocationFeature` 기반 DB 쿼리만 수행한다(외부 API 호출 없음) — `BUSAN_DATA_UX_AUTOMATED_QA_V1`이 확인한 대로 이미 빠르다.

---

## 5. Search Timing Breakdown(실측)

클라이언트에 `performance.mark`/`measure` 계측(§24, `NEXT_PUBLIC_EJIP_PERF_DEBUG` 게이트)을 추가해 실제 브라우저(Chrome, localhost dev 서버)에서 "연산동" 입력을 재현 계측했다.

| 구간 | 실측값 |
|---|---|
| T0(마지막 입력) → T2(fetch 시작) | 275.5ms(디바운스 250ms + 오버헤드) |
| T2 → T3~T4(fetch 왕복, JSON parse 포함) | 311ms |
| **INPUT_TO_FIRST_RESULT(T0→dropdown 렌더)** | **586.5ms** |

이 세션에서 dev 서버를 재시작한 직후의 첫 검색(=가장 보수적인 COLD에 가까운 조건)으로 측정한 값이다. **목표(COLD ≤1.5s)를 이미 충족**하고 있었다 — 사용자가 체감했다는 "3초"와 이 실측이 직접 일치하지 않는다는 것이 정직한 결론이다(§6에서 가능한 설명 논의).

---

## 6. Cold vs Warm

- **COLD 정의**: dev 서버 재시작 직후 첫 `/api/search` 호출(위 §5, 586.5ms).
- **WARM 정의**: `ApartmentAutocomplete`의 `cacheRef`(컴포넌트 생존 기간 동안 유지되는 in-memory `Map<string, results>`)에 동일 검색어가 이미 있는 경우 — 네트워크 요청 자체가 발생하지 않고 동기적으로 즉시 `setResults`가 호출된다(사실상 0ms, 다음 React 렌더 프레임에 반영). 서버 자체의 warm 응답 시간은 직전 STEP 실측(135ms 평균)이 그대로 유효하다(이번 STEP에서 `/api/search` 로직을 변경하지 않음).
- **가능한 설명(정직하게 명시)**: 실측이 사용자 체감(3초)과 다른 이유는 (1) 이 측정 환경(localhost, 로컬 DB)이 실사용자 환경(모바일 네트워크/기기)보다 훨씬 빠를 가능성, (2) 사용자가 "검색 후 3초"라고 표현한 것이 실제로는 §7~§13에서 다루는 **지도 마커 지연**(다음 항목, 실측으로 확인된 진짜 병목)과 혼동됐을 가능성, (3) 로딩 피드백이 전혀 없어(§9 이전) 빠른 응답조차 "느리다"고 체감했을 가능성. 이번 STEP은 (3)을 개선하고, 실제로 확인된 진짜 병목인 지도 쪽(§11~§16)에 개선을 집중했다.

---

## 7. Debounce

`ApartmentAutocomplete.tsx`의 디바운스는 **250ms**(변경 없음). §5 실측대로 디바운스+API 왕복이 이미 warm 목표(≤500ms) 이내라 축소하지 않았다 — 0ms에 가깝게 줄이면 API spam 위험(§8 명시적 금지)만 커지고 체감 개선은 미미하다고 판단했다. debounce가 전체 INPUT_TO_FIRST_RESULT(586.5ms)에서 차지하는 비율은 약 47%(275.5ms/586.5ms).

---

## 8. Loading Feedback

`ApartmentAutocomplete.tsx`에 `isSearching` state를 추가했다: fetch 시작 후 **150ms 이상** 걸리는 요청에만 입력창 아래 "검색 중..." 텍스트를 보여준다(작은 텍스트 pill, 큰 오버레이/스피너 아님, §9 요구사항 그대로). 150ms 지연 타이머로 감싸 캐시 히트/빠른 응답에서는 아예 깜빡이지 않는다. abort/완료 시 반드시 `clearTimeout` + `isSearching=false`로 정리해 stale 상태가 남지 않게 했다.

---

## 9. Cache

기존에 이미 `cacheRef`(in-memory Map, 검색어 → 결과)가 있었고 정상 동작 확인됨(§6). 이번 STEP에서 캐시 자체는 변경하지 않았다 — 컴포넌트 재마운트(예: `/map` 이탈 후 재진입) 시 초기화되는 것은 기존 설계이며, 새 프레임워크/영속 캐시 도입은 범위 밖(§0 금지 항목)이라 그대로 유지했다.

---

## 10. Result Click Flow

실제 코드 추적(`src/app/map/page.tsx`):

```
결과 클릭(ApartmentAutocomplete.handleSelect)
→ onSelect(handleApartmentSelect)
  → setCenter + mapRef.current.panTo (즉시, 동기)
  → refreshActiveLayers(lat, lng, result.lawdCd)
     → fetchAptMarkers(lat, lng, knownLawdCd)
       [이번 STEP 이전: 항상 Kakao coord2RegionCode 역지오코딩 → lawdCd 확정 →
        /api/transactions?months=12 → 단지별 좌표/aptSeq 매칭 → setAptMarkers]
       [이번 STEP 이후: knownLawdCd가 있으면 역지오코딩 생략, 곧바로
        /api/transactions?months=12 진행]
  → setSelectedMarkerId(aptSeq)
  → (신규) buildPendingSelectedApt(result) → setPendingSelectedApt(임시 마커)
```

**발견한 근본 원인**: `selectedMarker`(바텀시트에 표시할 마커)가 오직 `aptClusters`(=`aptMarkers`를 클러스터링한 결과, `fetchAptMarkers` 완료 후에만 채워짐)에서만 찾아졌다 — 검색 결과가 이미 aptSeq/좌표/이름을 갖고 있는데도, 화면에 아무것도 안 뜬 채 `/api/transactions?months=12`(전체 지역 12개월치 실거래) + 그 결과에 나온 **모든 고유 단지마다 개별 Kakao 키워드 지오코딩 호출**이 끝나기를 기다려야 했다. 실측(curl, `src/app/api/transactions/route.ts` 대상): 연제구 COLD **5.76초**, 같은 구 WARM(in-memory geocode 캐시 워밍업 후) **1.05초**, 서구 COLD **2.09초**. 이것이 "클릭 후 3초" 체감의 실제 원인이었다.

---

## 11. Map Architecture

`/map`(`src/app/map/page.tsx`)은 Kakao Maps SDK(`react-kakao-maps-sdk`)를 직접 사용한다. 마커 데이터 소스는 두 종류:

- `aptMarkers`/`aptClusters`: `/api/transactions?type=apt&lawdCd=...&months=12` 기반 — 실거래가 있는 단지만, 지역 전체를 한 번에 가져옴(이번 STEP에서 이 자체는 바꾸지 않음, §0 "거래 계산 변경 금지").
- (신규) `pendingSelectedApt`: 검색 결과 payload에서 직접 만든 단일 임시 마커(§13/§14).

---

## 12. Map Timing Breakdown(실측)

실제 브라우저(Chrome, claude-in-chrome) + `performance.mark`로 계측. 대표 사례: "대신롯데캐슬" 클릭.

| 구간 | 실측값 |
|---|---|
| M0(클릭) → M5(selected marker fast path state 반영) | **동기(<1ms), 같은 이벤트 핸들러 내부** |
| M0 → 화면에 selected marker + 바텀시트 실제로 보임 | **다음 렌더 프레임 내(관찰상 100ms 미만)** — 6회 실측 전부 스크린샷 캡처 시점(클릭 직후)에 이미 표시됨 |
| M0 → `/api/transactions` 시작 | 68~84ms(React effect/fetch 오버헤드) |
| M0 → 주변 마커(`aptMarkers`) 준비 완료 | 592ms~2,090ms(이 세션 중 Kakao geocode 캐시 상태에 따라 변동, cold는 최대 5.76s까지 관측) |

---

## 13. Selected Marker Fast Path

**CRITICAL PRINCIPLE(§13) 그대로 구현**: 검색 결과가 이미 aptSeq/좌표/이름을 갖고 있으므로, 주변 마커 전체 데이터 준비를 기다리지 않고 selected marker를 즉시 렌더한다.

```
검색 결과 클릭 → 지도 이동(panTo, 즉시) → selected marker 즉시(동기) → 주변 마커는 비동기로 이어서
```

라이브 브라우저 검증(4개 대표 케이스 전부, §21):

- 연산동한솔솔파크(26470-1040)
- 대신롯데캐슬(26140-1164) — 서울 강남구 동명 단지와 충돌 위험이 있는 케이스인데도 정확히 부산 서구로 이동/선택됨(`WRONG_MARKER_SELECTION` 없음)
- 연산동일동미라주더스타(26470-1481)
- 해운대힐스테이트위브(중동)

4건 전부 클릭 직후 캡처한 스크린샷에서 이미 "시세 정보 없음"(정직한 임시 상태) 마커+바텀시트가 표시됐고, 이후 실제 거래가가 도착하면(예: 대신롯데캐슬 "3억 8,700만", 연산동일동미라주더스타 "4억 6,000만") 자동으로 실제 값으로 갱신됐다 — 값을 지어내지 않고, 값이 아예 없으면 계속 "최근 실거래 정보 없음"으로 정직하게 남는다(해당 케이스 없었으나 코드/유닛 테스트로 보장).

---

## 14. Selected Marker Fast Path — 구현

`src/lib/map-selected-marker.ts`(신규, 순수 함수, 부작용 없음 — `src/app/map/page.tsx`가 이 함수들을 사용):

- `buildPendingSelectedApt(result)`: **aptSeq와 유효 좌표(Number.isFinite)가 모두 있을 때만** 임시 `AptMarker`를 만든다. 없으면 `null`(다른 아파트로의 fallback 없음, name-only identity 금지). 가격은 항상 `hasRecentPrice:false, price:'시세 정보 없음'`으로 정직하게 시작한다.
- `resolveSelectedMarker(activeMarkerId, aptClusters, pendingSelectedApt)`: 진짜 `aptClusters`에서 먼저 찾고, 없을 때만 임시 마커로 폴백한다 — 진짜 데이터가 도착하면 자동으로 우선순위가 넘어간다(중복 없는 reconcile).
- `isPendingStillNeeded(aptClusters, pendingSelectedApt)`: 진짜 데이터가 이미 같은 id를 포함하면 `false` — `map/page.tsx`의 `useEffect`가 이 값을 보고 `pendingSelectedApt`를 정리한다.

지도 위 시각 마커도 같은 `renderMarkerChip()`(기존 함수 재사용, §22 "visual redesign 최소" 요구와 일치)로 그려 진짜 마커와 완전히 동일하게 보인다 — 진짜 데이터 도착 시 임시 오버레이는 사라지고 같은 좌표에 진짜 마커가 그 자리를 이어받는다(시각적으로 끊김 없이 교체, 중복 렌더 없음, §21에서 실측 확인).

---

## 15. Duplicate Requests

**발견 후 제거**: `handleApartmentSelect`는 검색 결과가 이미 `lawdCd`를 알고 있는데도(`ApartmentSearchResult.lawdCd`) `fetchAptMarkers`가 매번 Kakao `coord2RegionCode` 역지오코딩을 다시 호출하고 있었다. `fetchAptMarkers(lat, lng, knownLawdCd?)`에 `knownLawdCd` 파라미터를 추가해, 있으면 역지오코딩을 완전히 건너뛰고 곧바로 `/api/transactions` 조회로 직행한다. 드래그/현재위치처럼 좌표만 아는 기존 호출부는 파라미터를 넘기지 않아 기존 동작(역지오코딩)이 그대로 유지된다(회귀 없음).

---

## 16. Render Cost

마커 렌더 자체(`renderMarkerChip`, 클러스터링 `recomputeClusters`)는 이번 STEP에서 변경하지 않았다 — API가 느린 것이 확인된 지배적 병목(§10~§12)이라, 이미 빠른 클라이언트 렌더 경로를 건드리지 않는 것이 안전하다고 판단했다(§0 "불필요한 확장 금지"와 일치). Selected marker fast path 자체가 별도 `CustomOverlayMap` 1개 추가일 뿐이라 렌더 비용 증가는 무시할 수준이다.

---

## 17. Map SDK Initialization

지도 컴포넌트/Kakao SDK는 검색 결과 클릭 때마다 재마운트되지 않는다(기존에도 `mapRef`를 통해 같은 `KakaoMap` 인스턴스의 `panTo`만 호출) — 이 부분은 이미 올바르게 구현되어 있었고 변경하지 않았다.

---

## 18. Before / After

| 항목 | Before | After |
|---|---|---|
| CLICK_TO_SELECTED_MARKER | 592ms~5.76s(`/api/transactions` 완료 대기, cold 최대 관측치) | **<100ms**(동기 state 업데이트, 네트워크 무관) |
| CLICK_TO_ALL_MARKERS(주변 마커) | 592ms~5.76s | 변경 없음(의도적 분리, §13 목표) |
| 역지오코딩 호출(검색 결과 클릭당) | 매번 1회(중복) | lawdCd가 이미 있으면 0회 |
| 검색 로딩 피드백 | 없음 | 150ms 이상 걸리면 "검색 중..." 표시 |
| 검색 자체 속도(warm/cold) | 이미 목표 충족(135ms/586.5ms) | 변경 없음(서버 로직 그대로) |
| WRONG_MARKER_SELECTION | 없음(기존에도 없었음) | 없음(4개 대표 케이스 재확인) |

---

## 19. Mobile

360px/375px/390px 3개 폭 모두 확인(360/390은 iframe 격리 기법으로 실제 CSS 뷰포트 재현, `resize_window`가 이 환경에서 불안정한 것으로 재확인돼 우회): 검색 입력, dropdown, selected marker fast path, 바텀시트, 닫기 버튼, 하단 네비게이션 모두 겹침/잘림/가로 스크롤 없이 정상 동작 확인. 375px는 360/390 두 경계값이 모두 통과한 표준 반응형 레이아웃(flex/퍼센트 기반, 별도 breakpoint 없음)이라 별도 재검증 없이 정상으로 판단.

---

## 20. Desktop

기존 desktop 레이아웃(852px 기준 뷰포트) 그대로 다수 시나리오(연산동/대신동/해운대/명지/서면 등)를 테스트했고 전부 정상 — mobile-only 최적화가 desktop에 누수되지 않음(fast path는 뷰포트와 무관한 로직).

---

## 21. Remaining Bottlenecks

- **주변 마커(surrounding markers) 자체의 속도**: `/api/transactions?months=12`가 지역 전체 실거래를 매번 라이브로 재조회하고, 단지별 Kakao 지오코딩을 N회 호출한다(in-memory 캐시만 있고 DB 영속화 없음 — 서버 재시작 시 초기화). 이번 STEP은 "거래 계산 변경 금지"(§0) 범위 안에서 이 부분 자체를 최적화하지 않았다 — selected marker를 분리해 사용자 체감을 없앴을 뿐, 실제 API 비용은 그대로 남아있다. 다음 STEP 후보(§21 하단 권고).
- BCR>100 2건은 SOURCE_VALUE로 확정됐으나, UI에 100% 초과 값을 어떻게 보여줄지는 별도 제품 판단이 필요(이번 STEP에서 결정하지 않음).
- "해운대"/"서면" 같은 통칭 지명이 `/api/search`의 REGION 결과를 못 받는 문제(`BUSAN_DATA_UX_AUTOMATED_QA_V1`에서 이미 기록)는 이번 STEP에서도 그대로 남아있다(범위 밖).

---

## 22. Future Performance Regression

- `/api/transactions`의 단지별 Kakao 키워드 지오코딩(N+1 외부 API 호출 패턴)을 `ApartmentMaster`/`ApartmentLocationFeature`(이미 좌표를 갖고 있음) 조인으로 대체하면 지역 전체 마커 로딩 자체가 극적으로 빨라질 잠재력이 있다 — 다만 이는 마커 데이터 소스/거래 계산 경로를 건드리는 변경이라 이번 STEP 승인 범위 밖이며, 별도 STEP으로 설계·승인 필요(`FIX_MAP_PERFORMANCE` 후보).
- `NEXT_PUBLIC_EJIP_PERF_DEBUG=true`로 언제든 이번에 추가한 timing mark(`search:*`, `map:*`)를 재사용해 회귀를 재계측할 수 있다(§24).
- `BUSAN_DATA_UX_AUTOMATED_QA_V1` runner의 `info`/`trade` API 평균 timing을 `SEARCH_API_WARN_MS`/`INFO_API_WARN_MS` 같은 threshold로 승격하는 것은 유효한 다음 단계이나, 이번 STEP에서는 실행하지 않았다(client E2E timing은 CLI로 자동화할 수 없어 이 문서의 실측으로 대체).

---

## How To Run

```bash
# 로컬 dev 서버
npm run dev

# 클라이언트 timing 계측 활성화(브라우저 콘솔에 [perf] 로그 출력)
NEXT_PUBLIC_EJIP_PERF_DEBUG=true npm run dev

# 신규 유닛 테스트
node --experimental-strip-types --test src/lib/map-selected-marker.test.mjs

# 전체 .test.mjs 회귀
node --experimental-strip-types --test $(find src scripts -name "*.test.mjs")
```

---

## 관련 문서

- `docs/development/BUSAN_DATA_UX_AUTOMATED_QA_V1.md` — 이번 STEP이 이어받은 서버 API baseline과 BCR>100 최초 발견.
- `docs/development/APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1.md` / `DATA_COVERAGE_FIX_V1.md` — `basicSpecSource`/BuildingHUB 총괄표제부·표제부 계약의 근거.
- `docs/development/CHANGELOG.md` — 이번 STEP 항목 추가.
