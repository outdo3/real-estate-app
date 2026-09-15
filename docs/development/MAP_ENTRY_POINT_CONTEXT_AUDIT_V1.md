# MAP ENTRY POINT CONTEXT AUDIT V1

- 기준 HEAD: `7c7631d` (main)
- 범위: 코드 전체의 `/map` 진입점 전수 감사 + 재현된 버그 1건 수정. 지오로케이션·마커 엔진·레이어·식별 규칙·DB 무변경.
- 선행: `APT_DETAIL_MAP_CONTEXT_V1.md`(단지 → 지도), `SEARCH_MAP_CONTEXT_V1.md`(지역 → 지도)

## 1. 진입점 전수 목록

검색: `src/**/*.ts(x)`(테스트 제외, 주석 제거)에서 `'/map'`·`"/map"`·`` `/map? `` 문자열, `router.push/replace`·`location.assign`·`href` 사용처, `지도에서/지도 보기` 문구, 지도 페이지 내부 이동. 오피스텔·학교·재개발·분양·커뮤니티·비교·MY·최근/관심 화면에서 `/map`으로 가는 다른 링크는 없었다. `next.config.ts` redirect도 `/map` 대상 없음.

| # | 출처 | 사용자 동작 | 이동 방식 | 쿼리 | 분류 |
|---|---|---|---|---|---|
| 1 | `Header.tsx` NavButton(모바일 하단 탭·데스크톱 메뉴, `bottom-nav-items.tsx`) | "지도" 탭 | `router.push('/map')` | 없음 | A 일반 |
| 2 | `ui/BottomNav.tsx`(지도 화면 하단 탭) | "지도" 탭 | `router.push('/map')` | 없음 | A 일반(지도 위에서 누르면 같은 페이지) |
| 3 | `home-client.tsx` | "지도에서 찾기" | `Link` | 없음 | A 일반 |
| 4 | `my/page.tsx` | 빈 상태 "지도에서 찾아보기" | `Link` | 없음 | A 일반 |
| 5 | `report/page.tsx` | 리포트 허브 가이드 카드 | `Link` | 없음 | A 일반 |
| 6 | `report/ReportActions.tsx` | 지역·일일 리포트 "지도 보기"(`detailHref` 없을 때) | `Link` | 없음 | A 일반 — 단지 리포트는 `detailHref`(상세)로, 비교 리포트는 `extraLinks`(각 상세)로 가서 지도로 가지 않음 |
| 7 | `apt-client.tsx` `handleViewOnMap` | 상세 "지도에서 주변 단지와 보기" | `window.location.assign` | lawdCd·zoom·dong·name·aptSeq·lat·lng | B 단지 |
| 8 | `HomeApartmentSearch.tsx` | 홈 검색 "📍 지역" 결과 | `window.location.assign` | lat·lng·lawdCd | C 지역 |
| 9 | `ApartmentQuickSearch.tsx` | 상세 빠른 검색 "📍 지역" 결과 | `window.location.assign` | lat·lng·lawdCd | C 지역 |
| 10 | 지도 공유(`ShareAction` + `buildMapShareParams`) | 공유 링크 열기 | 외부에서 전체 로드 | lat·lng·zoom·lawdCd(+aptSeq 또는 dong·name) | B/C(전체 로드라 해석 시점 문제 없음) |
| 11 | 뒤로/앞으로 | 지도 → 상세·오피스텔·학교 → back | 브라우저 history | 지도가 `replaceState`로 써둔 현재 상태 | 복원(주소가 이미 /map) |

지도 **내부**(진입점 아님): 하단 카드 상세보기·마커 → `/apt/…`(router.push), 오피스텔 카드·목록 → `/officetel/[id]`, 학교 마커 → `/school/[id]?name&lat&lng&lawdCd`, 지도 안 검색창 → 같은 페이지 state 변경(`handleSearchSelect`, 이동 없음), "내 위치" 버튼 → 사용자가 누른 GPS/IP.

D(기타 명시 컨텍스트: 학교·재개발·오피스텔 → 지도) 진입점은 **없다** — 이 화면들에는 지도로 가는 버튼이 없다.

## 2. 규칙 확인

- B/C는 모두 전체 이동이고 URL이 완전하다(B: aptSeq·lat·lng·lawdCd·dong·name / C: lat·lng·lawdCd). 좌표가 없으면 B는 lat/lng 없이(파서 null → 일반 흐름), C는 `/map`으로 — 추측 없음.
- 명시 컨텍스트 우선: URL center → source `url` 즉시 확정, URL lawdCd가 있으면 GPS·IP 조회 effect 자체를 건너뜀, 늦은 GPS는 `url` 출처를 덮지 않음.
- A는 쿼리가 없어야 일반 흐름(GPS → IP → 기본 지역)을 탄다 — **여기서 버그 발견**(§3).

## 3. 재현된 버그 — 일반 진입이 이전 페이지 쿼리를 상속

지도는 초기 상태를 `useState` 초기화에서 `window.location.search`로 읽는다. 클라이언트 전환(A의 `router.push`/`Link`)에서는 그 시점 주소가 **이전 페이지**다. 이전 페이지 쿼리에 `lat`·`lng`가 있으면 파서가 공유 링크로 인식한다. 코드상 그런 페이지는 학교 상세 `/school/[id]?name&lat&lng[&lawdCd]` 하나(단지 상세·비교·리포트 쿼리에는 lat이 없어 null).

Production(수정 전, 2026-09-15, GPS 없는 환경):

| 경로 | 이전 페이지 쿼리 | 지도 초기화 읽기 | 최종 지도 | 안내 | ipinfo |
|---|---|---|---|---|---|
| 연산자이 상세 → 학군 → 연서초등학교 → 헤더 "지도" | `lat=35.19075…&lng=129.08614…&lawdCd=26470` | `/school/21335731` 쿼리 8회 | 학교 좌표 그대로 `lat=35.1907501823457&lng=129.08614968725&lawdCd=26470` | 없음 | 없음 |
| 연산자이 상세 → 학군 → 부산외국어고등학교 → 헤더 "지도" | `lat=35.18366…&lng=129.09753…&lawdCd=26470` | (같은 경로) | 학교 좌표 그대로, 26470 | 없음 | 없음 |

같은 "지도" 탭이 어느 화면에서 눌렀는지에 따라 일반 흐름 또는 "이전 학교 좌표 공유 링크"로 달라졌다. 학교 링크 중 좌표 없는 canonical 링크(`?lawdCd&aptSeq`)에서 누르면 일반 흐름이라 같은 학교라도 결과가 달랐고, 학교 쿼리의 lawdCd는 **출발 단지/지역의 구**라 학교가 다른 구에 있으면 중심과 마커 구가 어긋날 수 있다(lawdCd가 없으면 기본 서구 26140). 원인 분류: **B 계열(해석 시점) — 방향만 반대**(명시 컨텍스트 소실이 아니라 일반 진입의 가짜 컨텍스트).

## 4. 수정

`src/app/map/page.tsx` `readInitialMapStateFromUrl`에 한 줄:

```ts
if (window.location.pathname !== '/map') return null;
```

- 주소가 이미 `/map`인 경우(전체 로드·공유 링크·뒤로/앞으로)만 URL을 컨텍스트로 인정. 클라이언트 전환으로 막 마운트된 경우는 일반 흐름.
- 명시 진입(B/C)은 이미 전체 이동이라 영향 없음. 뒤로가기는 브라우저가 주소를 먼저 바꾼 뒤 렌더하므로 복원 그대로.
- 대안(일반 "지도" 탭을 전체 이동으로 바꾸기)은 모든 화면의 탭 이동 체감·셸 상태를 바꾸므로 택하지 않았다. 지오로케이션·마커·레이어 코드 무변경, 지도 초기 상태 읽기가 모두 이 한 함수를 거치므로 한 곳만 바꿨다.

## 5. 영향 없음으로 확인한 경로

- 단지 상세·비교·리포트·MY·홈에서의 일반 진입: 쿼리에 lat 없음 → 수정 전후 동일(일반 흐름).
- 지도 → 상세/오피스텔 → back: 주소 `/map?…`로 복원(§7 QA).
- 공유 링크·검색/상세 명시 진입: 전체 로드(§7 QA).

## 6. 테스트

`src/lib/decision-journey/map-entry-context.test.ts` 9건(스펙 1~10, 5·6 통합): (1) 코드의 모든 `/map` 문자열이 분류표와 정확히 일치(새 진입점이 생기면 실패) (2) 일반 진입·경로 가드·학교 쿼리가 파서에선 공유 링크 모양임을 고정 (3) 단지 컨텍스트 (4) 지역 lawdCd (5·6) URL > GPS > IP(시작 IP 조회는 건너뛰는 effect 안에만, 나머지 하나는 "내 위치" 버튼) (7) 좌표 없음 추측 없음 (8) 뒤로가기(진입은 새 항목, 지도는 replaceState만) (9) 하드코딩 없음 (10) 레이어·지오로케이션·마커 프리패치 코드 그대로.
`detail-map-context.test.ts`·`search-map-context.test.ts`의 `readInitialMapStateFromUrl` 고정 정규식에 가드 줄 반영.

| 명령 | 결과 |
|---|---|
| decision-journey 테스트 | 22/22 + 신규 9/9 |
| src 전체 | 2075/2075 |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS(scripts/·tmp/ 기존 25건, 신규 0) |
| eslint(변경 파일 4개) | exit 0 |
| `npm run build` | exit 0(`/map` 정적 유지) |

## 7. Production QA

(배포 후 기록)

## 8. 남은 위험

- 지역·일일 리포트 "지도 보기"는 일반 진입이다. 지역 리포트는 lawdCd만 있고 좌표가 없어 구 중심을 만들면 추측이 되므로 이번에 바꾸지 않았다(제품 결정 필요 시 서버 확정 좌표가 생긴 뒤 C로 승격).
- 클라이언트 전환으로 들어온 일반 진입에서 마커 프리패치(`bootPrefetchLawdCd(window.location.search)`)는 여전히 이전 페이지 쿼리의 lawdCd(예: 단지 상세의 lawdCd)로 응답을 **미리 받아둘 수 있다**. state에는 쓰지 않고 같은 lawdCd로 조회할 때만 재사용하므로 컨텍스트 오류는 아니며, 위치가 다른 구로 확정되면 요청 1건이 낭비된다(수정 전부터 있던 동작, 이번 범위 밖).
- 빠른 검색의 같은 URL history 항목(열 때 push)은 기존 동작 그대로.
