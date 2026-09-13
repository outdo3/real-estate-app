# E-JIP FINAL PRE-LAUNCH REGRESSION AUDIT V2

BUSAN WEB RELEASE CANDIDATE · 전체 회귀감사 · Production READ-ONLY(GET) · 2026-09-13

## VERDICT: NO-GO — 단일 P1 1건(격리됨). 그 1건만 해결하거나 LIMITED로 수용하면 CONDITIONAL GO

- P0: **0**
- P1: **2** — 1건 감사 중 수정·배포(P1-1), **1건 미해결(P1-2: `/stats/gap-invest` 부산 전체 콜드 34~38초, 재현됨)**
- 데이터 신뢰 실패: **0** (모든 확인 응답이 partial/failedMonths/apiError 의미를 정확히 지킴)
- 판정 규칙("unresolved launch P1 → NO-GO")을 그대로 적용했다. P1-2는 한 통계 하위 화면의 콜드 지연이며
  결과 데이터는 완전하다. 이 1건을 고치거나(권장: DB-first) 제품 결정으로 LIMITED 수용하면
  남는 조건은 실기기 QA/Naver/외부 색인뿐이다(CONDITIONAL GO).

## 1. Baseline

| 항목 | 값 |
|---|---|
| branch | `main` |
| 감사 시작 HEAD | `4f57be9` (production 배포 확인: 커밋 17:48:25 → 배포 17:48:29 KST, e-jip.com/www alias) |
| 감사 종료 HEAD(코드) | `8c3d0c5` (P1-1 수정, 배포 18:09:31 KST Ready, e-jip.com alias) |
| production canonical | `https://e-jip.com` 200 |
| www | `https://www.e-jip.com/stats` → 308 → `https://e-jip.com/stats` |
| legacy | `https://real-estate-app-park11.vercel.app/report/city/busan` → 308 → 같은 경로 |
| 테스트 | src 1769/1769 pass |
| 사용자 실기기 PASS(기준선 반영) | 지도 첫 현재위치, 로드뷰, 리포트, 최근 본 단지, 커뮤니티 진입, Google/Kakao 로그인(canonical 수정 후), PWA 재설치 |

## 2. Route matrix (production GET, warm 기준 · 콜드는 §18)

| 영역 | route | 결과 | 판정 |
|---|---|---|---|
| HOME | `/` | 200, 0.17s | READY |
| SEARCH | `/api/search?q=대신` | 200, 0.20s, regions 5 / apartments 15 / officetels 8, aptSeq 포함 | READY |
| APT DETAIL | `/apt/대신푸르지오1차?aptSeq=26140-1243&lawdCd=26140&dong=서대신동1가` | 200, 0.16s | READY |
| MAP | `/map` | 200, 0.16s (SSR은 로더만) | READY |
| STATS MAIN | `/stats` | 200, 0.18s | READY |
| STATS feed/area84/supply/change-map/volume/top-traded | `/stats/*` | 전부 200, 0.11~0.15s | READY |
| STATS gap-invest | `/stats/gap-invest` (API 콜드 34~38s) | 200 | **LIMITED (P1-2)** |
| COMPARE | `/stats/compare?a=26140-1243&b=26140-1164` | 200, 0.13s, 제목 "대신푸르지오1차 vs 대신롯데캐슬" | READY |
| REPORT | `/report`, `/report/city/busan`, `/report/district/26140`, `/report/dong/26140/서대신동1가`, `/report/apt/26140-1243`, `/report/compare?a&b`, `/report/daily/2026-09-12` | 전부 200, 0.15~0.40s | READY |
| TOOLS / FINANCE | `/tools`, `/finance-fit` | 200 | READY |
| COMMUNITY | `/community`, `/api/community/posts` | 200 (게시글 0건 — 운영 이슈) | READY |
| MY | `/my` | 200 | READY |
| ADMIN | `/admin/system` → 307 `/my`, `/api/admin/system-health` 401, `/api/admin/users` 401 | READY |
| AUTH | `/api/auth/providers` → kakao, naver, google | Google/Kakao READY, Naver LIMITED |
| PWA | `/manifest.webmanifest` 200, icons 96/192/512 200 | READY |
| SEO | robots/sitemap(36, 전부 e-jip.com)/verification | READY (P2 있음) |
| PARTNER | 상세 하단 중개사 카드 | READY |
| 404 | 없는 경로 404 | READY |

기타 모든 페이지(`/school`, `/presales`, `/redevelopment`, `/privacy`, `/terms`, `/ai-search`) 200.

## 3~15. 영역별

### HOME / SEARCH
- 홈 200, 390px 가로 넘침 없음. 최근 본 단지 게스트/회원 분리는 `recent-auth-parity.test.ts`, `recent-rows.test.ts`(5+더보기) — 사용자 실기기 PASS.
- 검색 결과가 `APARTMENT`/`REGION` 계약과 `aptSeq`·`lawdCd`·`dong`을 그대로 준다. 이름 매칭/재식별은 `apt-name-match`, `search-contract`, `search-ranking`, `search-redaction` 테스트.

### APT DETAIL / MOLIT
| 확인 | 결과 |
|---|---|
| 매매 12m (withCoordinate) | `tradeDataSource=DB`, 12/12, partial=false, apiError=null, 66건, coordinate RESOLVED |
| 매매 60m | DB, 60/60, 267건 |
| 전월세 60m 서구 | MOLIT, 60/60, partial=false, 516건 (콜드 4.60s, 웜 0.06s) |
| 전월세 60m 기장군 | MOLIT, 60/60, partial=false (콜드 7.74s) |
| 매매 60m 기장군 | MOLIT, 60/60 (5.11s) |
| 전월세 60m 서울 강남 | MOLIT, 60/60 (콜드 14.33s — MOLIT long-range class, 부산 출시 범위 밖) |
| score / education | 200 status OK |

(기장/강남은 임의 단지명을 써 거래 0건 — 이름 필터 결과이며 월별 스윕 자체는 60/60 완전.)
- 전역 rate guard/부분 실패 의미/재시도 bounded/in-flight dedup/다른 월·지역 fallback 금지는
  `molit-rate-guard.test.ts` 26 tests로 고정. `audit-molit-throttle-probe.ts`는 실행하지 않았다.

### MAP
- 첫 위치 로더·GPS/IP/기본 폴백·마커 지역 일치·URL 복원은 `map-initial-location.test.ts` 외 map 테스트 13개 파일.
- 마커 API `/api/transactions?type=apt&lawdCd=26140&months=12&fields=marker` 200, 12/12, partial=false, 137건.
- 사용자 실기기: 첫 현재위치·로드뷰 PASS.

### STATS (부산 전체, 콜드/웜)
| API | 콜드 | 웜 | 신뢰 필드 |
|---|---|---|---|
| feed 12m | 4.97s | 0.54s | OK, partial=false, 83,221건(취소 616) |
| feed 서구 7d | 2.07s | 0.43s | OK |
| dashboard | 2.08s | 0.06s | — |
| area84 | 2.60s | 0.16s | OK, 1,234건 |
| **gap-invest** | **34.18s / 37.74s(재측정)** | 0.67s | OK, partial=false, 매매 6,767~6,768 |
| concentration(기본 30d) | 3.86s | 0.17s | OK |
| supply | 0.17s | 0.08s | OK, 34 |
| large-complex | 2.94s | 0.16s | OK, 3,167 |
| region-change sigungu / dong | 0.51s / 0.15s | 0.07s / 0.13s | OK |

### COMPARE / REPORT
- compare·report 페이지 200, 390px 넘침 없음. 짧은 공유 URL(`?a=&b=`)·score parity·export identity는
  `url.test.ts`, `score-identity-parity.test.ts`, `export-identity.test.ts` 외 report 테스트 11개 파일.
- PNG/PDF export는 브라우저 기능이라 서버에서 실행하지 않았다 — 사용자 실기기 리포트 PASS를 기준선으로 둔다.

### AUTH
- providers: kakao/naver/google. legacy 호스트 인증 경로는 308로 e-jip.com에서 시작(CANONICAL HOST REDIRECT V1).
- production error 레벨 로그(최근 3시간): 실제 `/api/auth/callback/kakao`, `/api/auth/signin/google` 트래픽이 있었고
  **OAUTH_CALLBACK_ERROR 0건**(남은 것은 next-auth 내부 `url.parse()` DeprecationWarning뿐).
- Naver: 모바일 state-cookie 이슈는 별도 LIMITED. Google/Kakao 판정에 섞지 않는다.

### MY / RECENT
- 비로그인 `/api/my/recent` 401. 로그인 흐름(닉네임 편집·재로그인)은 자격증명이 없어 production에서 실행하지 않았다 —
  `nickname.test.ts`, `recent-auth-parity.test.ts` + 사용자 실기기 PASS.

### COMMUNITY
- 목록/상세 익명 읽기, 쓰기·댓글 로그인 필요, 관리자 판정은 `anonymous-browsing.test.ts`, `community-launch.test.ts`.
- 공개 API의 작성자 필드는 `name, image, role`만 select(이메일 없음). 게시글 0건은 운영 이슈.

### PARTNER BROKER (production 390px iframe 측정)
- 카드 렌더, 제목 "이 지역 중개가 필요하신가요?", 롯데부동산중개사무소, `051-714-2225`, 링크 1개 `tel:0517142225`,
  "중개사무소 등록번호 제26140-2024-00019호", 카드 폭 358px / 뷰포트 390px. 상세 본문 거래가 표시, 부분 실패 문구 없음.

### ADMIN
- `/admin/system` 비로그인 307 → `/my`, 관리자 API 401. 파싱/redaction은 `system-health.test.ts`, `admin-access.test.mjs`.
- OAuth/cron/sync 로그 미수집은 known limitation(post-launch).

### PWA
- manifest: name "이집 E-JIP", start_url `/`, scope `/`, display standalone, icons 96/192/512 200.
- 레거시 vercel.app에서 설치한 앱은 e-jip.com 재설치 권장(사용자 PASS).

### SEO / DOMAIN
- robots: `/api/`, `/admin`, `/my`, `/community/write` 차단, Sitemap `https://e-jip.com/sitemap.xml`.
- sitemap 36 URL 전부 e-jip.com. OG url/image e-jip.com. Naver·Yandex meta, Google DNS TXT(`google-site-verification`), IndexNow 키 파일 200.
- Bing 전용 meta는 없음(IndexNow로 제출). 

## 18. Performance

페이지 셸(TTFB/total, 웜): 전부 0.08~0.40s. 느린 것은 데이터 API뿐이다(§STATS 표).
- 반복 10s+: **gap-invest 부산 전체 콜드**(34.18s, 37.74s) → P1-2.
- MOLIT long-range(별도 class): 서울 강남 전월세 60m 콜드 14.33s, 기장 7.74s. 신뢰도(부분 실패 0) 우선 설계의 결과.

## 19. Mobile structural (production, 390px same-origin iframe)

`/`, 상세, `/stats`, compare, `/report/city/busan`, `/report/apt/26140-1243`, `/community`, `/my`, `/tools`:
**가로 넘침 0**, 넘치는 요소 0. 모달·지도 컨트롤·하단 탭 겹침은 실기기 항목(사용자 PASS 범위 외는 DEVICE QA).

## 20. Security / privacy

- `/`, `/community`, `/report/city/busan`, 상세, `/my`, 404 HTML: 이메일 0, 토큰/시크릿 패턴 0, 전화번호 패턴 0
  (상세의 중개사 번호는 클라이언트 렌더 — 공개 파트너 정보).
- 관리자/개인 API 401, cron 401. 공개 커뮤니티 API에 이메일 없음. MOLIT 실패 메시지 마스킹은 테스트로 고정.

## 22. Findings

### P0 — 없음

### P1
**P1-1 (감사 중 수정·배포, `8c3d0c5`) — MOLIT 공유 게이트 FIFO가 상세 조회를 통계 대기 뒤에 묶음**
- 원인: V1에서 모든 MOLIT 호출이 게이트 하나를 공유하게 됐고 대기열이 FIFO였다. 부산 전체 gap-invest 콜드는 384건을
  한꺼번에 줄 세운다 → 같은 인스턴스의 상세 전월세 60m이 그 뒤에서 대기.
- 수정: 대기열 2 lane(interactive 기본 / bulk=통계 집계). 총 동시성 4·페이싱 불변. 둘 다 기다리면 4번째 슬롯마다 bulk(굶지 않음).
  dedup으로 같은 월에 합류한 interactive는 queued bulk 항목을 승격(중복 호출 없음).
- 검증: 신규 4 tests(우선순위/비기아/승격/배선). production: gap-invest 콜드(37.74s) 시작 3초 뒤 보낸 상세 전월세 60m이
  **7.88s**에 60/60 완료(단독 기준선 5.63s). 두 요청이 같은 인스턴스였는지는 확인할 수 없어 "일치하는 결과"로 기록한다.

**P1-2 (미해결) — `/stats/gap-invest` 부산 전체 콜드 34~38초**
- 기본 지역이 부산 전체(`RegionContext` 기본 sidoCode 26)라 GPS로 구가 잡히지 않으면 기본 진입 경로다.
- 라우트가 12개월 매매+전월세를 16개 구 전부 MOLIT로 받는다(384건, 캐시 5분/인스턴스). DB 경로 없음.
- V1 이전 추정 ~21초(6/200)였고 V1의 4/250으로 34~38초가 됐다(다중 인스턴스 키 잠금 방지와의 trade-off).
- 결과 데이터는 완전(partial=false). 웜 0.67s.
- 권장 수정: feed와 같은 **부산 DB-first**(매매 DB + 검증된 전월세 월 DB, 미검증 월만 MOLIT) — 갭 이벤트가 매매·전세 매칭에
  의존하므로 parity 감사 포함 별도 STEP. TTL 연장으로 숨기지 않는다. 게이트 동시성 상향은 키 잠금 위험으로 금지.

### P2
1. `rel="canonical"` 부재, 모든 페이지 `og:url`이 사이트 루트(기존 freeze 문서의 P2).
2. `/community`, `/my`, `/tools` 등의 `<title>`이 "이집" 단일.
3. `/stats` 제목 "전국 시장 통계·분석" — 부산 출시 문구와 불일치(기능은 전국 지원).
4. concentration 3개월 선택 시 부산 전체 콜드 추정 ~9초(96건, 계산값·미측정).
5. next-auth 내부 `url.parse()` DeprecationWarning이 error 레벨로 기록(기능 영향 없음, 로그 잡음).
6. `/api/stats/rankings` UI 호출처 없음(정리 대상).
7. 배포별 `*.vercel.app` URL은 redirect 대상 아님(공유되지 않음, 의도된 범위).

## 23. Known limited — 출시 blocker 재판정

| 항목 | 판정 |
|---|---|
| Naver 모바일 인증/검수 | LIMITED — blocker 아님(Google/Kakao 정상) |
| serverless 인스턴스 로컬 MOLIT limiter | blocker 아님 — 인스턴스 2개까지 실측 0% 제한, 차단기로 피해 제한 |
| 학교 점수 NEIS rebase 대기 | blocker 아님(이번 감사에서 변동 없음) |
| 전월세 recheck/취소 repair | blocker 아님(known freshness limitation, 이번 감사 범위 밖) |
| 관리자 OAuth/cron/sync 로그 미수집 | post-launch P1 — blocker 아님 |
| 커뮤니티 초기 게시글 | 운영 이슈 |
| 실기기 QA 일부 | CONDITION |

## 24. Tests / build

- `molit-rate-guard.test.ts` 26/26 (신규 lane 4)
- src 전체 `npx tsx --test` **1769/1769 pass**
- `npx tsc --noEmit` → FAIL_EXISTING_SCRIPT_ERRORS (25건 전부 `scripts/`·`tmp/`, `src/` 0)
- `npx eslint` (변경 5파일) exit 0
- `npm run build` exit 0

## 30. Device QA remaining

- `/stats/gap-invest` 부산 전체 첫 진입 체감(로더 유지, 오류/빈 화면 아님)
- 로그인 상태 MY 닉네임 편집·재로그인 유지, 최근 본 단지 계정 전환
- 리포트 PNG/PDF 저장, Kakao 공유 말풍선
- 커뮤니티 글쓰기/댓글(로그인), 관리자 화면 모바일
- 390px 모달(로그인)·지도 컨트롤·하단 탭 겹침

## 31~32. Fixes / files

- `src/lib/molit-rate-guard.ts` — 2 lane 대기열 + 승격
- `src/lib/api-molit.ts` — lane/ticket 전달
- `src/lib/molit-stats-helpers.ts` — 통계 집계 bulk lane
- `src/lib/molit-rate-guard.test.ts` — lane tests
- `src/lib/stats/feed-db-source.test.ts` — 스로틀 가드 regex(`acquire(ticket)`) 갱신, 의도 유지

## 34. Busan release recommendation

1. **P1-2를 먼저 해결**: `GAP-INVEST BUSAN DB-FIRST V1`(parity 감사 포함). 해결 후 GO 판정 가능.
2. 해결 전 출시해야 한다면: `/stats/gap-invest`를 LIMITED로 명시적으로 수용(데이터는 정확, 첫 진입 30초대 로딩).
   이 경우 CONDITIONAL GO(조건: 실기기 QA 잔여, Naver LIMITED, 외부 색인 전파).
3. 출시 후 P2 정리: canonical/og:url, 페이지별 title, 관리자 로그 수집.
