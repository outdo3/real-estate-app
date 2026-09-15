# APT DETAIL → MAP CONTEXT PRESERVATION V1

- 기준 HEAD: `a58c6e7` (main)
- 범위: 상세 "지도에서 주변 단지와 보기" 버튼의 이동 방식 한 줄. 지도 코어·마커·레이어·지오로케이션 정책·식별 규칙·DB 무변경.

## 1. 현재 흐름(코드 기준)

| 단계 | 실제 |
|---|---|
| 상세 버튼 | `apt-client.tsx` `handleViewOnMap` → `buildDetailMapUrl({ lawdCd, dong, name, aptSeq: canonicalAptSeq, lat/lng: canonicalCoord })` → `router.push` |
| 좌표 | 서버(`/api/apt/[name]`)가 검증된 identity로 준 canonical 좌표. 없으면 lat/lng 없이 이동(추측 없음). 버튼은 `addressReady`(거래 응답 완료, 좌표 확정과 같은 응답) 이후에만 노출 |
| 지도 URL 해석 | `parseMapStateFromSearchParams`: **lat/lng가 없으면 null**(공유/복원 링크 아님). 있으면 center·lawdCd·restoreIdentity(aptSeq 우선, 없으면 dong+name)·layers |
| 지도 초기 상태 | `readInitialMapStateFromUrl()`이 `useState`/`useRef` 초기화 안에서 `window.location.search`를 읽음(center·zoom·lawdCd·restoreIdentity·layers·initialLocation·initialShareLawdCdRef) |
| 첫 위치 | URL center 있으면 source `url`로 즉시 확정 + URL lawdCd 있으면 지오로케이션 effect 건너뜀. 없으면 GPS → IP(ipinfo) → 기본 지역(서구) |

## 2. 재현 (Production, 2026-09-15)

| 단지 | 버튼이 만든 URL | 약 10초 뒤 지도 |
|---|---|---|
| 우동 롯데 `26350-9`(수영구) | `lawdCd=26350 … aptSeq=26350-9 … lat=35.1634…&lng=129.1476…` | `lat=35.1017&lng=129.03&lawdCd=26110`(중구), aptSeq 없음, 선택 없음, "현재 위치를 확인하지 못해 접속 지역 기준으로 보여드려요." |
| 대청동2가 그린시티 `26110-837`(중구) | `lawdCd=26110 … aptSeq=26110-837 … lat/lng` 포함 | 같은 IP 중심·26110, aptSeq 없음, 선택 없음, 안내 표시 — 접속 지역이 우연히 같은 구라 **정상처럼 보였을 뿐** |
| 연산동 연산자이 `26470-1066`(연제구) | `lawdCd=26470`, lat/lng 포함 | 26110 중구, aptSeq 없음, 선택 없음, 안내 표시 |

대조: **같은 URL을 주소창으로 직접 열면**(전체 로드) 롯데가 선택된 채 해당 좌표 중심·26350·aptSeq 유지, 안내 없음.

증거: 버튼 클릭 직후 `URLSearchParams` 생성을 계측 — 지도 초기화 시점의 읽기가 모두 `location.pathname = /apt/...`, 쿼리에 aptSeq는 있고 **lat는 없음**(= 상세페이지 쿼리)이었다.

## 3. 원인

**B. 지도 URL 해석 시점 문제**(D 지오로케이션 덮어쓰기는 그 결과).

`router.push`(App Router 클라이언트 전환)는 새 페이지를 렌더한 뒤 history URL을 반영한다. 지도 페이지는 초기 상태를 렌더 중(`useState` 초기화)에 `window.location.search`로 읽기 때문에 **이전 페이지(상세)의 쿼리**를 읽었다. 상세 쿼리에는 lat/lng가 없어 파서가 null → `initialShareLawdCdRef`도 null → 지오로케이션 effect 실행 → GPS 실패 시 IP 위치로 확정 → 지도가 URL을 IP 기준 상태로 다시 씀(`replaceState`) → aptSeq·선택 소실.

URL 생성(A)·좌표 누락(E)·캐시(F)는 원인이 아니다(생성 URL 정상, 좌표 존재, 전체 로드 시 정상).

## 4. 명시적 컨텍스트 우선 규칙

상세에서 특정 단지로 지도를 열면: canonical aptSeq → 서버 canonical 좌표 → 그 URL 파라미터가 확정 위치다. 기존 지도 규칙(URL center = source `url`, URL lawdCd 있으면 지오로케이션 생략, 늦은 GPS는 `ip`/`default` 출처일 때만 반영)이 이미 이를 보장하므로 **지도가 올바른 URL을 읽게만** 하면 된다. 이름 퍼지 매칭·동/지번 폴백·기본 지역 덮어쓰기 없음.

## 5. 수정

`handleViewOnMap`의 `router.push(url)` → `window.location.assign(url)`(같은 URL, 전체 이동).

- 이미 Production에서 정상 동작하는 공유/딥링크 경로를 그대로 재사용(새 이동 모델 없음). 지도 layout의 SDK 부트·마커 프리패치 스크립트도 전체 로드에서만 동작하는 설계라 그대로 맞는다.
- 지도 페이지 초기화 구조(`useSearchParams` + Suspense 전환 등)는 바꾸지 않았다 — 정적 프리렌더 셸·체감 성능에 영향이 가는 지도 코어 변경이기 때문.
- 좌표가 없으면 기존처럼 lat/lng 없는 URL → 지도 기본 흐름(추측 없음).
- 뒤로가기: `assign`은 새 history 항목 — 지도에서 back 시 상세로 복귀.

### 같은 원인을 가진 다른 진입(이번 범위 밖, 미수정)

`HomeApartmentSearch`·`ApartmentQuickSearch`의 `router.push('/map?lat=…&lng=…')`도 같은 해석 시점 문제를 가질 수 있다(코드 구조상 동일). 이번 STEP은 상세 버튼만 고쳤다 — 후속 확인 권장.

## 6. 테스트

`src/lib/decision-journey/detail-map-context.test.ts` 8건: aptSeq 유지·선택 복원, canonical 좌표 사용, 기본 지역·늦은 GPS보다 명시 컨텍스트 우선(지도 규칙 고정), 원인 고정(router.push 아님·지도가 초기화 시 window.location을 읽음), 좌표 없으면 추측 없음, 뒤로가기(assign), 하드코딩 없음, 다른 진입·지도 레이어/지오로케이션 코드 그대로.

| 명령 | 결과 |
|---|---|
| 신규 테스트 | 8/8 |
| src 전체 | 2056/2056 |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS(기존 25건, 신규 0) |
| eslint(변경 파일) | exit 0(경고 2건은 기존 eslint-disable 주석) |
| `npm run build` | exit 0 |

## 7. Production QA (배포 `68b1439`, 2026-09-15)

상세 → [지도에서 주변 단지와 보기] → 지도 로드 약 14초 후 확인(창 폭 데스크톱, 이 환경은 GPS 없음 → 수정 전에는 IP 폴백이 발생하던 조건).

| 단지 | 지도 URL(최종) | 선택 카드 | 폴백 안내 |
|---|---|---|---|
| 우동 롯데 `26350-9` | `lat=35.1634441587193&lng=129.147619699842&lawdCd=26350&aptSeq=26350-9` | 롯데 · 우동 | 없음 |
| 대청동2가 그린시티 `26110-837` | `lat=35.10321045948634&lng=129.0301324876445&lawdCd=26110&aptSeq=26110-837` | 그린시티 · 대청동2가 | 없음 |
| 연산동 연산자이 `26470-1066` | `lat=35.1879046843468&lng=129.089787157079&lawdCd=26470&aptSeq=26470-1066` | 연산자이 · 연산동 | 없음 |

- 뒤로가기(롯데): 지도 → back 1회 → `/apt/롯데?…aptSeq=26350-9` 상세 복귀, 버튼 정상. 이동 시 history 항목 1개 추가(중복 없음).
- 다른 진입 회귀: `/map` 직접 진입은 기존과 같이 GPS 실패 → IP 지역(26110) + 안내 표시, 마커 로드 정상.
- 좌표 중심은 지도가 URL에 다시 쓴 center 값으로 확인(canonical 좌표와 동일).
