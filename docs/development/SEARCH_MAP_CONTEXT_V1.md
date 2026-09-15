# SEARCH → MAP CONTEXT PRESERVATION V1 (HOME + QUICK SEARCH)

- 기준 HEAD: `a8567bc` (main)
- 범위: `HomeApartmentSearch`·`ApartmentQuickSearch`의 "📍 지역" 결과 → `/map` 이동. 지도 코어·지오로케이션·마커·검색 랭킹·검색 결과 매핑·식별 규칙·DB 무변경.
- 관련: `APT_DETAIL_MAP_CONTEXT_V1.md`(같은 해석 시점 문제, §5 "같은 원인을 가진 다른 진입"에서 후속 확인 권장했던 두 곳)

## 1. 현재 흐름(코드 기준)

| 결과 종류 | HomeApartmentSearch | ApartmentQuickSearch(상세 모달) |
|---|---|---|
| `REGION` | `router.push('/map?lat=…&lng=…')` | 같음(모달 닫기 없이 이동) |
| `APARTMENT` | verify API → `/apt/[name]?lawdCd&dong&aptSeq` (**지도로 가지 않음**) | verify API → `onClose()` → `/apt/[name]?lawdCd&dong` |
| `OFFICETEL` | `/officetel/[id]` | (해당 분기 없음) |

- **지도로 가는 경로는 지역 결과뿐**이다. 단지 결과는 상세로 가므로 "검색한 단지가 지도 중심·선택" 규칙은 이 두 컴포넌트에 해당 경로가 없다(단지 identity·aptSeq 흐름은 그대로 두었다).
- 지역 결과의 좌표: `ApartmentAutocomplete`가 선택 시 `"${sido} ${sigungu} ${dong}"`을 Kakao `Geocoder.addressSearch`로 변환. SDK가 없거나 실패하면 `0,0`.
- 지역 결과의 `lawdCd`: 검색 API(`/api/search`)가 `sggCd`(시군구 5자리)로 준다. 자동완성이 `onSelect`에 그대로 전달하지만 **지도 URL에는 실리지 않았다**.
- 지역 결과는 단지 identity(aptSeq/name)를 갖지 않는다 → 지도 선택 복원 대상 없음(만들면 안 됨).

## 2. 재현 (Production, 2026-09-15, 수정 전 코드)

이 환경은 GPS 없음 → GPS 실패 시 IP 폴백(중구 26110)이 발생하는 조건. 클릭 후 약 12초 뒤 확인.

| 경로 | 검색어 · 선택 | 이동 URL(pushState 계측) | 최종 지도 | 안내 |
|---|---|---|---|---|
| 홈 | 연산동 → 부산 연제구 연산동 | `/map?lat=35.1825602536452&lng=129.085536368165` | `lat=35.1017&lng=129.03&lawdCd=26110`(중구) | "현재 위치를 확인하지 못해 접속 지역 기준으로 보여드려요." |
| 홈 | 명지동 → 부산 강서구 명지동 | `/map?lat=35.1066795355093&lng=128.915171586425` | 26110 중구, 마커 요청 26140→26110 | 표시 |
| 빠른 검색(연산자이 상세) | 우동 → 부산 해운대구 우동 | `/map?lat=35.1727271517301&lng=129.148399576019` | 26110 중구 | 표시 |
| 빠른 검색(연산자이 상세) | 화명동 → 부산 북구 화명동 | `/map?lat=35.2357636793361&lng=129.013861621487` | 26110 중구 | 표시 |

4/4 재현. 생성 URL의 좌표는 모두 선택한 동의 좌표였다.

대조(전체 로드, 주소창):

| URL | 최종 | 마커 요청 | 안내 |
|---|---|---|---|
| `/map?lat=35.18…&lng=129.08…` (검색이 만든 그대로) | center 유지, **`lawdCd=26140`(서구)** | 26140 | 없음 |
| `/map?lat=35.18…&lng=129.08…&lawdCd=26470` | center 유지, 26470 | 26470 | 없음, ipinfo 요청 없음 |

증거(해석 시점): 수정 전 홈에서 클릭 직후 `window.location.search`로 만든 `URLSearchParams`를 계측 — 처음 9회는 `pathname=/`·쿼리 비어 있음(지도 페이지의 `readInitialMapStateFromUrl` 초기화 8곳 + 부트 프리패치 읽기와 같은 수), 그 뒤에야 `/map`·`lat,lng`를 읽었다.

## 3. 원인

두 가지가 겹쳐 있었다.

- **B. router timing(주원인)** — 상세 → 지도와 같다. `router.push` 클라이언트 전환 중 지도 초기 상태가 이전 페이지(홈/상세) 쿼리를 읽음 → lat 없음 → 파서 null → 지오로케이션 effect 실행 → GPS 실패 → IP 위치(중구)로 확정 → 안내 표시.
- **A. URL 내용 누락(부원인)** — 전체 로드여도 URL에 `lawdCd`가 없으면 `parseMapStateFromSearchParams`가 `DEFAULT_LAWD_CD`(서구 26140)로 채워 **선택한 지역이 아닌 서구 마커**를 불렀다(연산동 중심인데 서구 데이터 = 기본 지역). B만 고치면 안내·중구 이동은 사라지지만 기본 지역 데이터가 남는다.

C(파서)는 계약대로 동작(lat/lng 없으면 null, lawdCd 없으면 기본값). D(선택 복원)는 해당 없음(지역 결과엔 identity 없음). E(좌표 누락)는 이번 재현에선 아님(4건 모두 좌표 존재) — 단 SDK 미로드 시 `0,0` 경로가 있어 §5에서 방어.

## 4. 수정

`src/lib/decision-journey/registry.ts`에 `buildRegionMapUrl({ lat, lng, lawdCd })` 추가, 두 컴포넌트의 지역 분기 한 줄씩:

```ts
window.location.assign(buildRegionMapUrl(result));
```

- 이동 방식: 상세 → 지도에서 Production 검증된 전체 이동(`assign`) 재사용.
- URL: `lat`·`lng`는 기존과 같은 값·같은 순서. **`lawdCd`를 추가**(검색 API가 준 5자리 시군구 코드일 때만). 스펙의 "URL 내용 그대로"와 다른 점 — §2 대조에서 lawdCd 없이는 전체 로드여도 기본 지역(서구) 데이터가 되는 것을 확인했기 때문(QA 기준 "기본지역으로 가면 FAIL"). 값은 검색 결과가 이미 가진 것이며 새로 만들거나 추정하지 않는다.
- 좌표 없음(`0,0`/NaN — 자동완성의 "이동할 수 없음" 표시): 가짜 중심(`/map?lat=0&lng=0` = 기니만)을 만들지 않고 기존 기본 진입 `/map`(GPS→IP→기본 지역)으로 보낸다. 수정 전에는 `lat=0&lng=0`이 그대로 URL에 실렸다.
- helper를 둔 이유: 두 호출부가 같은 규칙(좌표 판정 + lawdCd 형식 검증)을 가져야 하고 순수 함수로 테스트하기 위해. 기존 `buildDetailMapUrl` 옆에 두었다.
- 바꾸지 않은 것: `ApartmentAutocomplete` 매핑·지오코딩, 검색 API, 단지/오피스텔 분기, 빠른 검색의 history push/popstate 처리, 지도 페이지 전체.

## 5. 테스트

`src/lib/decision-journey/search-map-context.test.ts` 10건: (1) 홈 지역 분기 assign·router 미사용 (2) 빠른 검색 동일 (3) 단지 결과는 기존 상세 이동·aptSeq 유지, 지역 URL은 identity 없음 (4) 좌표·lawdCd 그대로 (5) 명시 컨텍스트 > 기본 지역·지오로케이션, 잘못된 lawdCd 미포함 (6) 선택 복원 로직 그대로 (7) 좌표 없음 → `/map`, 지오코딩 추가 없음 (8) 검색 결과 매핑 그대로 (9) 뒤로가기(replace 없음, 빠른 검색 history 처리 그대로) (10) 지도 코어 그대로·하드코딩 없음.
`detail-map-context.test.ts`의 "다른 진입은 router.push 그대로" 고정을 새 동작으로 갱신.

| 명령 | 결과 |
|---|---|
| 관련 테스트(신규 10 + 상세 8) | 18/18 |
| src 전체 | 2066/2066 |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS(scripts/·tmp/ 기존 25건, 신규 0) |
| eslint(변경 파일 5개) | exit 0 |
| `npm run build` | exit 0 |

## 6. Production QA

(배포 후 기록)

## 7. 알려진 문제 / 다음

- 빠른 검색은 열릴 때 같은 URL history 항목을 하나 쌓는다(뒤로가기 = 닫기). 지역 선택으로 지도로 가면 그 항목이 남는 것은 수정 전과 같다(§6에서 확인).
- 지도 하단 카드·기타 `/map` 진입의 `router.push`는 이번 범위 밖(미감사).
