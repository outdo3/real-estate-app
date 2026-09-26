# GYEONGGI PUBLIC BETA BLOCKER FIX PREP V1

## 목적

첫 경기 Production cron 검증을 기다리는 동안, `GYEONGGI_CRON_AND_PUBLIC_READINESS_AUDIT_V1` §10의 공개 전 UX blocker를
**로컬 전용**으로 수정·테스트한다. Production 상태(스위치·env·cron·DB·배포)는 바꾸지 않는다.

- 기준점: `5d03257` (origin/main = Production)
- 작업 위치: worktree `.worktrees/gyeonggi-beta-blockers`, branch `gyeonggi-beta-blockers-prep`
- `GYEONGGI_BETA_ENABLED = false` 그대로 · push/deploy 없음 · DB write 없음

## 수정

| # | Blocker | 원인 | 수정 |
|---|---|---|---|
| 1 | 닫힌 지역 지도가 "표시할 아파트가 없습니다" | 지도가 `/api/transactions`의 `regionUnsupported`를 읽지 않고 0건 문구로 접음 | `resolveAptMapNotice`(src/lib/map/apt-map-notice.ts): 실패·부분 실패·**미지원**·검증된 0건을 서로 다른 문구로. 마커 캐시에도 `regionUnsupported` 보존(캐시 히트에서 "0건"으로 바뀌지 않게) |
| 2 | 지도 "부산 외 지역… 부산 데이터를 우선 제공" | 판정이 부산 좌표 상자, 문구가 부산 고정 → 서울 beta 8구(마커 정상)에서도 뜸 | `OutOfBusanNotice`는 지도가 조회한 구(`currentLawdCd`)의 `map` 축으로 판정(`shouldShowMapRegionNotice`), 특정 시도를 말하지 않는 중립 문구. 네트워크 호출 추가 없음, 세션당 1회·닫기 동작 유지 |
| 3 | 상세 "한장 리포트" CTA가 `report` 축을 보지 않음(서울 8구 포함) | CTA href가 aptSeq만 확인 | `publicAptReportHref` / `publicCompareReportHref`(report-links.ts): canonical aptSeq 앞 5자리의 `isPublicRegionAllowed(…, 'report')`. 상세 카드·비교 CTA 적용. 리포트 페이지 자신의 canonical 경로(`aptReportHref`)는 그대로 |
| 4 | `/api/school`·`/api/school/stats`가 "수원시"까지만 파싱 → 수원 4구 합산 | `region.split(' ')[1]` | `resolveSchoolRegionQuery`: canonical lawdCd 우선(registry fullName), 없으면 시도 뒤 토큰 **전부**. `addressMatchesRegion`은 시/군/구 토큰을 **연속·정확 일치**로 판정(부분 문자열 아님). 학교 페이지가 lawdCd를 함께 보냄. 학원 위치 라벨도 `parts[2]` 고정 → `dongTokenAfterSigungu` |
| 5 | null 좌표 master 19행 | (결함 아님 — 확인) | 검색 좌표 null · 마커 루프가 좌표 없는 거래 제외 · 좌표 없는 선택은 "위치 정보가 없어 지도에 표시할 수 없습니다" 안내 후 이동 안 함 · 0,0 이동 금지(`hasUsableHandoffCoords`). 코드 변경 없음, 테스트로 고정 |

## 설계 결정

- 지역 판정은 전부 `isPublicRegionAllowed`(allowlist) 하나 — pathname·시도 이름·`startsWith('11')` 하드코딩 없음.
- 두 게이트(`publicAptReportHref`, `shouldShowMapRegionNotice`)는 판정 함수를 주입받을 수 있다 — 테스트가 `simulateRegionEnablement`로 "켜면"을 보기 위해서다. 런타임 기본값은 항상 `isPublicRegionAllowed`.
- 학교: 시도 전체(시/군/구 없음) 요청은 lawdCd가 와도 특정 구로 바꾸지 않는다(기존 "빈 목록" 계약 유지). lawdCd와 이름이 다르면 lawdCd가 이긴다.
- 부산·서울 자치구는 시/군/구가 한 토큰이라 학교 판정 결과가 예전과 같다(테스트 14에서 16구 전부 비교).

## 테스트

`src/lib/region/gyeonggi-beta-blockers.test.ts` — 20건(요청 목록 1–15 + 시뮬레이션 + 소스 계약).
기존 테스트 중 문구/배선이 의도적으로 바뀐 4곳을 갱신: `sitemap-scope`(안내 문구·props), `apt-report-cta-flow`, `stats-report-entry`, `transactions-read-state`(캐시 모양).

## 알려진 문제 / 미검증

- 학교 파서의 경기 주소 형태("경기도 수원시 장안구 …")는 registry·Kakao 표기 기준 fixture로 검증했다. **실제 NEIS J10 응답으로는 확인하지 않았다**(네트워크 호출 없이 진행).
- 모바일 360/375/390px 실측 미실시 — 경기가 닫혀 있어 Preview 배포에서 확인해야 한다.
- 공개 STEP에서 스위치를 켤 때 기존 테스트 고정값(검색 allowlist 24→32 등, readiness audit §10-5)은 별도로 갱신해야 한다.

## 다음 STEP

첫 경기 cron 결과 검증 PASS → 이 branch를 main에 반영(승인) → 공개 STEP(GYEONGGI_PUBLIC_BETA_APPROVAL)에서 스위치·cronSync 결정.
