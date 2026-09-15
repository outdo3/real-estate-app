# BUSAN LAUNCH FINAL RELEASE GATE V1

**판정: GO_WITH_KNOWN_LIMITATIONS** — P0 0건, P1 1건 발견 → 최소 수정·Production 재검증 완료(`2ca0a64`), 남은 항목은 P2/KNOWN LIMITED/실기기 체크리스트.

- 일시: 2026-09-15 (KST 저녁)
- 감사 시작 HEAD: `32d27b4` (main = origin/main) · 감사 종료 코드 HEAD: `2ca0a64`
- 방식: Production(`https://e-jip.com`) HTTP·브라우저 실측 + 읽기 전용 DB/Storage 감사 스크립트 + 로컬 테스트·빌드. 새 기능·schema·Production write 0건. 브라우저는 운영자 계정으로 로그인된 상태였고 **읽기만** 했다(선호·관심·게시글 저장/수정 없음).

## 1. Baseline / 배포

| 항목 | 결과 |
|---|---|
| 브랜치 / HEAD | `main`, `32d27b4` = `origin/main` (사용자 파일 `package.json`·`package-lock.json`·untracked 24개 보존) |
| 마이그레이션 | `prisma migrate status`: 20개, **Database schema is up to date** (pending 0) |
| 배포 | Vercel Production Ready, 최신 배포 생성 18:42:09 KST(= `32d27b4` 커밋 18:42:04 직후), alias `e-jip.com`·`www.e-jip.com`. 수정 후 `2ca0a64` 배포 Ready 확인 |
| Supabase 연결 | Prisma direct ok (posts 1, apartment masters 3,438, 589ms) |
| Data API | `/rest/v1/*` 503, graphql 503, 키 없는 root 401 → **OFF 유지** |

## 2. Domain / SEO

| 항목 | 결과 |
|---|---|
| canonical | `https://e-jip.com` 200 |
| www / http / legacy vercel 호스트 | `www.e-jip.com/map?x=1` → 308 `https://e-jip.com/map?x=1`, `http://e-jip.com/` → 308, `real-estate-app-park11.vercel.app/stats` → 308 canonical |
| robots.txt | 200 — `/api/`·`/admin`·`/my`·`/community/write` Disallow, Sitemap = canonical |
| sitemap.xml | 200, 37 URL(부산 범위: `/`, `/stats`, `/community`, `/school` 구별 등) |
| Google | DNS TXT `google-site-verification` 존재 |
| Naver / Yandex | meta verification 존재 |
| IndexNow(Bing) | 키 파일 200 |
| 알려진 postlaunch | Yandex sitemap 후속, Daum 검수, `/stats` title "전국 시장 통계·분석"(화면은 부산) 등 SEO P2 |

## 3. Home / Navigation (HTTP)

`/` `/map` `/stats` `/community` `/my` `/report` `/presales` `/redevelopment` `/stats/compare` `/finance-fit` `/tools` `/ai-search` `/school` `/privacy` `/terms` `/manifest.webmanifest` 모두 200(0.17~0.9s). stats 메뉴 19개 slug 전부 200. 없는 경로 404. `/officetel` 인덱스는 존재하지 않는 경로(404)이며 링크·sitemap 어디에도 없다(상세 `/officetel/[id]`만 사용).

## 4. Map (같은 날 `d03ea36` Production QA 결과가 유지되는 코드 — 이후 커밋은 리포트 파일만 변경)

| 게이트 | 결과 |
|---|---|
| A 일반 지도 | 헤더 "지도"·홈 "지도에서 찾기" → 일반 흐름(이 환경 GPS 없음 → IP → 안내), 학교 상세에서도 이전 좌표 상속 없음 |
| B 단지 | 연산자이 `26470-1066`, 롯데 `26350-9`: 중심·aptSeq·선택 카드 유지, 안내·IP 조회 없음 |
| C 지역 | 홈 연산동(26470)·화명동(26320), 빠른 검색 우동(26350)·화명동(26320): lat/lng/lawdCd·해당 구 마커 |
| D 딥링크 | 명시 진입은 모두 같은 URL 전체 로드 = 공유 링크 경로 |
| E 뒤로가기 | 지도 ↔ 상세/검색/학교 1회 복귀, 하단 카드 상세 → back 복원 |

## 5. Apt detail (서로 다른 구 3단지)

| 단지 | 거래(API) | 식별 | 점수 | 화면 |
|---|---|---|---|---|
| 연산자이 `26470-1066` 연제구(풍부) | 223건, 전부 `26470-1066` | OK | V2 표시 | 교통·학교·브리핑·추이·지도·비교·예산·법무사 카드·리포트 카드 |
| 롯데 `26350-9` 우동(풍부) | 67건, 전부 `26350-9` | OK | 51 (V2) | 위와 같음, 리포트 카드 약 59% 지점, 가로 넘침 0 |
| 하이츠빌리지-1 `26170-58` 초량동(부족, 12세대) | 36개월 1건(2025-08-13) | OK | 49 (V2 overall 48.99, 도메인 52/61/51/32 = 화면 일치) | 기본 1년 창에 거래 없음 → "선택한 조건의 실거래가 없습니다"(정직), 리포트 카드 미노출(§14 P2) |

- `/score`의 최상위 `score`(V2_1 필드)와 화면 점수(V2 `overallScore`)가 다른 것은 기존 계약 — 화면은 V2 도메인 값과 정확히 일치.
- 중개사 카드는 영업 구역(서구 검증 동) 밖이라 미노출(정상), 법무사 카드 노출.
- API 상세 첫 호출 3.0~4.0s(콜드), 반복 0.18~0.28s.

## 6. Report — **P1 발견·수정**

| 항목 | 결과 |
|---|---|
| 렌더 | `/report/apt/26350-9` "롯데 단지 리포트", 가격·거래·학교·교통·단지·점수 섹션, undefined/NaN 0, 가로 넘침 0 |
| 액션 | 공유하기 · 리포트 이미지 저장 · 리포트 PDF 저장 · 단지로 돌아가기 (PNG/PDF 파일 저장은 다운로드라 실행하지 않음 → 실기기 기준선) |
| 지도 shortcut | 리포트에 `/map` 링크 없음 |
| 진입 | 상세 중후반 카드만 |
| **돌아가기 식별** | **FAIL → FIXED** (아래) |

### P1 — 리포트 → 상세 링크가 동명 다른 단지를 열었다

- 재현(수정 전): 우동 롯데 리포트 "단지로 돌아가기" → `/apt/롯데?aptSeq=26350-9` → 상세가 **12건·우동 아님·리포트 카드 `/report/apt/11710-5589`**(다른 롯데). `/apt/삼익?aptSeq=26470-78`(연산동 삼익) → "경기도 연천군 · 1984년 준공 · 3,060세대".
- 원인: 리포트(단지·비교·지역) 링크가 이름+aptSeq만 실었고, 상세는 lawdCd+dong으로 거래를 찾으므로 둘이 없으면 이름으로 다른 단지를 해석.
- 수정(`2ca0a64`): `report-links.aptDetailHref`(lawdCd 5자리 + dong + aptSeq 모두 있을 때만, 없으면 링크 없음) — 단지 리포트(master sggCd/umdName), 비교 리포트(side에 lawdCd/dong 추가), 지역 리포트 대표 단지·최근 거래(거래 행의 lawdCd/dong). 점수·집계·표시 로직 무변경.
- 재검증(Production): 롯데 → `/apt/롯데?lawdCd=26350&dong=우동&aptSeq=26350-9` 37건·우동·리포트 `26350-9`; 삼익 → "부산광역시 연제구 578-1 · 1979년 준공 · 305세대"·리포트 `26470-78`. HTML 링크 전수: 비교 2/2, 구 10/10, 동 10/10, 시 10/10 canonical.

## 7. Personalized score

| 항목 | 결과 |
|---|---|
| P2-A 저장/API | 비로그인 GET/PUT `/api/my/preferences` 401, 로그인 GET 200(`purposes`,`fitImportance`) |
| P2-B 엔진 | 테스트 스위트 통과(동등성·임계값·주차 중립 제외·missing≠0) |
| P2-C 상세 | 실제 계정(중요도 미설정) → "내 중요도 설정하기" CTA만, **가짜 점수 없음** |
| P2-D 비교 | 연산자이 vs 롯데: 이집 분석 막대 아래 설정 CTA, 점수 없음 |
| P2-E MY | 5축(교통·생활편의·신축·주차·초등학교 접근성), 기본값 "선택 안 함", "5개 항목을 모두 선택하면 저장", 학군 표현 0 |
| P2-F analytics | 이벤트·payload 계약 테스트 통과(값·점수 미전송) |
| 불변식 | 공통 점수 무변경, URL에 중요도 없음, 사용자 캐시 격리 — 테스트 통과. 실제 저장/변화는 실기기 |

## 8. Auth

| 항목 | 결과 |
|---|---|
| providers | google·kakao·naver, callback 모두 `https://e-jip.com/api/auth/callback/*` |
| csrf / session | csrf 64자, 비로그인 session `{}` |
| OAuth 시작(POST signin) | google → `accounts.google.com`, kakao → `kauth.kakao.com`, naver → `nid.naver.com` 302, `redirect_uri` 모두 canonical, state 포함 |
| signout | 200 |
| Naver | KNOWN LIMITED(모바일 state-cookie/검수) — blocker 아님 |

## 9. MY

`/my` 로그인 렌더: 닉네임·관심·최근 본·관심 목적·나에게 맞는 점수 설정·로그아웃, 단지 링크 6/6 canonical. 비로그인 API: favorites GET/POST, recent GET/sync, preferences GET/PUT, profile PUT 모두 401. 실제 데이터 변경 0.

## 10. Community / image / storage

| 항목 | 결과 |
|---|---|
| 목록·상세(익명 HTTP) | 200, API 200 |
| 상세(로그인 렌더) | 제목·본문·댓글 영역, 작성자 액션(수정/삭제) 노출, 이미지 2장: 공개 경로 `/storage/v1/object/public/community-images/…` 200 `image/webp`, 1200px 디코드 OK(자동화 탭이 background라 lazy 이미지는 화면에서 로드되지 않았을 뿐) |
| 작성 화면 | 사진 추가 0/5, accept jpeg/png/webp, 등록하기 — 제출하지 않음 |
| 쓰기 API(비로그인) | posts POST/PATCH/DELETE, images POST, comments POST/DELETE, pin POST 모두 401 |
| orphan 감사(dry-run) | objects 2 / PostImage refs 2 / 참조 2 / 고아 후보 0 / 누락 0 → **CLEAN** |
| rate limit | 테스트 스위트 통과(코드 live). 한도 초과 실측은 쓰기 필요 → 실시하지 않음 |

## 11. Supabase security

| 항목 | 결과 |
|---|---|
| Batch A 7테이블 | users·accounts·sessions·verification_tokens·favorites·recent_views·user_preferences: **RLS ON · FORCE OFF · policies 0 · anon/authenticated/service_role 권한 0** |
| 그 밖의 테이블 | 36개 중 RLS ON 2, anon SELECT 권한 보유 34 — **Batch B/C 미적용(KNOWN)**, Data API OFF라 외부 경로 없음 → 출시 blocker 아님 |
| Data API | OFF(503) |

## 12. Stats / 13. Compare / 14. Officetel / 15. Presales·Redevelopment

- Stats: `/stats` "부산광역시 전체", 로딩 잔류 없음. API cold→warm: feed 26470 3.5s→0.18s, rankings 1.5s→0.20s, gap-invest 26470 2.4s→0.26s, gap-invest 시 기본 2.6s→0.31s(브라우저 첫 요청 5.6s). DB-first 이전 콜드 34~38s 대비 유지. `/stats/gap-invest` 화면: 최근 3개월 매매 6,713건 중 갭 형태 4,371건(65.1%), 12개월 차트.
- Compare: A(연산자이) 딥링크 → `?a=26470-1066`, B(롯데 우동) 추가 → `?a=…&b=26350-9`(compact), 두 단지·이집 분석·실거래·학교·교통, B 제거 → `?a=` 복귀, 넘침 0.
- Officetel: `/officetel/2413` 렌더(주소·호 단위·거래 요약·실거래 기간), API·transactions 200, markers(26470) 446건.
- Presales `/presales`·`/presales/1`·nearby-market 200, Redevelopment `/redevelopment`·`/redevelopment/1798` 200.

## 16. Performance (Production, 이 환경 네트워크)

| 흐름 | 측정 |
|---|---|
| HTML | 홈 0.24s, 지도 0.21s, 상세 0.19s, stats 0.9s, community 0.37s, 리포트 허브 0.21s, 시 리포트 1.9s(첫 요청) |
| 상세 API | cold 3.0~4.0s / warm 0.18~0.28s |
| 통계 API | cold 1.5~3.5s(갭 브라우저 5.6s) / warm 0.2~0.4s |
| 반복 >3s 코어 회귀 | 없음(모두 첫 요청 콜드에서만, 반복 시 해소) — KNOWN cold limit |

## 17. Error / log

- Vercel runtime logs(Production): CLI가 돌려준 범위는 최근 약 22분(2,950건) — status 5xx 0, level error/warning/fatal 0. 보존 창이 짧아 24시간 판단에는 아래 앱 로그를 쓴다(관측성 P2).
- `error_logs`(앱 기록, 읽기 전용): **최근 24시간 0건**. 최근 7일 85건 전부 `[MOLIT_PARTIAL]`(외부 API 부분 실패 알림, 마지막 09-11) — KNOWN noise.
- auth/permission/Prisma/Supabase/community image 오류 기록 없음.

## 18. Tests / build (수정 후)

| 명령 | 결과 |
|---|---|
| 리포트 테스트 | 186/186 + 신규 `report-detail-link.test.ts` 3/3 |
| src 전체 | **2079/2079** |
| `npx tsc --noEmit` | FAIL_EXISTING_SCRIPT_ERRORS(scripts/·tmp/ 기존 25건, src 0) |
| eslint(변경 11개) | exit 0 |
| `npm run build` | exit 0 |

## 19. 실기기 체크리스트

완료(기준선, 사용자 실기기 PASS — `FINAL_PRELAUNCH_REGRESSION_AUDIT_V2.md`): 지도 첫 현재위치, 로드뷰, 리포트, 최근 본 단지, 커뮤니티 진입, Google/Kakao 로그인(canonical 수정 후), PWA 재설치.

남은 것(10개 이내):

1. GPS ON 지도 — 지도 탭(현재 위치), 학교 상세 → 지도 탭이 학교가 아닌 현재 위치로 열리는지
2. Google 로그인 → 로그아웃 → 재로그인(오늘 배포 기준 재확인)
3. Kakao 로그인 → 로그아웃 → 재로그인
4. MY 관심/최근 본 → 단지 이동이 같은 단지인지
5. 나에게 맞는 점수: MY에서 5개 저장 → 상세 카드 FULL/LIMITED 표시·설정 변경 시 점수 변화
6. 비교 A/B에서 개인화 블록(두 단지 모두 점수)
7. 커뮤니티 사진 1~2장 작성 → 수정(사진 추가/삭제) → 삭제 후 목록 복귀
8. 지도 pill/마커 터치·정렬(360/390px)
9. 리포트 PNG/PDF 저장·공유 → "단지로 돌아가기"가 **같은 단지**(오늘 수정)
10. 로그아웃 후 다른 계정 로그인 시 이전 사용자 중요도·관심이 보이지 않는지

## 20. 분류

**P0 BLOCKER**: 없음.

**P1 BEFORE LAUNCH**: 리포트 → 상세 동명 다른 단지 연결 — **FIXED `2ca0a64`, Production 재검증 PASS → CLOSED**.

**P2 POSTLAUNCH**
- 상세가 `lawdCd`/`dong` 없는 URL(`/apt/{name}?aptSeq=…`)을 aptSeq로 해석하지 않는다 — 앱 안의 생성처는 이번에 모두 제거(테스트로 고정). 이미 밖으로 복사된 옛 링크는 다른 단지를 열 수 있으므로 상세에서 aptSeq → master 식별 보강 권장.
- 기본 1년 창에 거래가 없는 단지는 canonical aptSeq 미확정 → 리포트 카드 미노출(데이터 부족 단지).
- 단지 리포트에서 master 식별이 불완전하면 액션 바가 일반 "지도 보기"로 대체(부산 master는 sggCd/umdName 보유).
- 학교 상세의 단지 링크는 `lawdCd`가 없으면 이름만으로 이동하는 기존 분기.
- 지역/일일 리포트 "지도 보기"는 일반 지도(제품 결정 필요).
- `/stats` 등 title의 "전국" 표현, SEO canonical/og 정리.
- Vercel runtime log 보존 창이 짧음(24h 5xx 판단은 앱 `error_logs` 의존) — 외부 로그 drain 검토.
- 빠른 검색 history 항목, 지도 이전 쿼리 lawdCd 마커 프리패치 1건 낭비.

**KNOWN LIMITED**
- Naver 로그인(모바일 state-cookie/검수).
- Supabase Batch B/C 미적용(Data API OFF 유지 조건).
- 콜드 스타트 첫 요청 2.5~5.6s(상세·통계·갭투자), warm 정상.
- `[MOLIT_PARTIAL]` 외부 API 부분 실패 로그.
- 개인화 FULL/LIMITED·비교 개인화·커뮤니티 사진 흐름의 실기기 확인.

**CLOSED (재개하지 않음, 회귀 없음 확인)**: map performance V2, report engine(링크 식별만 수정), gap-invest DB-first, OAuth canonical, delete navigation cleanup, orphan audit(CLEAN), upload rate limit, Batch A, personalized score engine, 지도 진입 컨텍스트 3건(상세·검색·일반 탭).

## 21. 판정 근거

- P0 = 0.
- launch-blocking P1 = 0(발견된 1건은 최소 수정 후 Production에서 2개 단지 + 리포트 4종 링크 전수 재검증).
- 자동 core smoke PASS: 도메인·리다이렉트, 핵심 라우트·API, auth 3사 시작 흐름, 권한 401, 지도 5게이트, 상세 3단지, 리포트, 비교, 통계, 오피스텔, 분양/재개발, 커뮤니티, Storage CLEAN, Batch A, Data API OFF, 24h 앱 오류 0.
- 남은 실기기 항목은 이미 구조·자동 검증이 끝난 흐름의 기기 확인 수준.

→ **GO_WITH_KNOWN_LIMITATIONS**.

## 22. 출시 후 다음 STEP

1. 실기기 체크리스트 §19 10개(특히 5·6·7·9).
2. 출시 후 1주 관측: `error_logs` 일일 확인, Vercel 5xx, 로그인 실패(State cookie) 추이.
3. P2 1순위: 상세의 aptSeq 단독 URL 식별 보강(옛 링크 방어).
4. Supabase Batch B/C 계획 재개(Data API OFF 유지 전제로 일정 조정).
5. SEO P2(title "전국" 정리, Yandex/Daum 후속).

---

## 23. 재실행 — 통계 기간 변경(`56e372d`) 배포 후 (2026-09-15 22:05~22:30 KST)

**판정: GO_WITH_KNOWN_LIMITATIONS 유지** — 새 P0/P1 0건, 코드 수정 없음.

| 항목 | 결과 |
|---|---|
| 기준 | main HEAD `e64ae93`(문서만, 코드 = `56e372d`), live Production `56e372d` Ready(21:42:31 KST, e-jip.com/www), 사용자 파일 보존 |
| 1차 게이트 이후 코드 변경 | `aeeb4de..56e372d` = 통계(dashboard·concentration·feed API, 거래량/거래집중/피드 화면, lib/stats) + 테스트 1개뿐. 지도·상세·리포트·커뮤니티·MY·비교·오피스텔·인증 코드는 1차 게이트와 동일 |
| 마이그레이션 / Data API | 20개 up to date / 503(OFF), Prisma ok |
| Batch A | 7테이블 RLS ON·FORCE OFF·policies 0·anon/authenticated/service_role 0 유지. 기타 36개 중 RLS ON 2·anon SELECT 34(Batch B/C 미적용 KNOWN) |
| Storage | orphan 감사 objects 2 / refs 2 / 후보 0 / 누락 0 CLEAN |
| 라우트 | 핵심 30개 200, 없는 경로 404, www/http/legacy 호스트 308 canonical |
| SEO | robots·sitemap(37)·Naver/Yandex meta·Google DNS TXT·IndexNow 키 200 |
| 인증 | providers 3종 canonical callback, csrf·익명 session `{}`, google/kakao/naver signin 302 + canonical redirect_uri + state, signout 200 |
| 권한 | 보호 API 16개 비로그인 401 |
| 상세 데이터 | 연산자이 223건·롯데 67건·하이츠빌리지-1 1건, 각각 자기 aptSeq만, 점수 V2 OK·브리핑·학교 OK |
| 리포트 링크 | 단지 2·비교 2·구 10·시 10 전부 lawdCd+dong+aptSeq |
| 지도(브라우저) | 롯데 상세 → 지도: 전체 로드·canonical 좌표·26350·aptSeq·선택 카드·안내/ipinfo 없음·리포트 shortcut 없음, back → 상세. 홈 화명동 → 26320 좌표·마커 26320·안내 없음. 학교 상세 → "지도" → 일반 흐름(IP 26110, 학교 좌표 아님) |
| 상세(브라우저) | 롯데: 37건·점수 51·개인화 설정 CTA(가짜 점수 없음)·브리핑·학교·교통·지도·비교·예산·법무사 카드·리포트 `26350-9`, 넘침 0 |
| 통계 | 거래량 기간 Production QA(같은 날, `STATISTICS_PERIOD_TRADE_UX_V1.md` §4) PASS — 5개 기간 = 독립 SQL. 신고가·84㎡·갭투자·rankings·yearly API 200 |
| 로그 | Vercel(조회 창 약 25분, 1,550건) 5xx 0. level error 1건 = 게이트 로그인 프로브의 Node `url.parse` DeprecationWarning(stderr, 기능 영향 없음). 4xx는 게이트 401 프로브(CLI가 같은 로그 id를 중복 반환). `error_logs` 24h 0건, 7일 84건 전부 `[MOLIT_PARTIAL]`(마지막 09-11). sync coverage 마지막 검증 SALE 09-15 08:30 KST·RENT 09-15 06:57 KST |
| 테스트/빌드 | src 2089/2089, tsc FAIL_EXISTING_SCRIPT_ERRORS(src 0), eslint(변경 영역) 0, build 0 |

### 추가 분류

- **P2 POSTLAUNCH**
  - `/api/stats/yearly`(구·군 연도별 표) 콜드 11.2~12.1s / warm 0.18s — PERFORMANCE_V2 기록(콜드 6.7s)보다 느림. 보조 뷰(버튼 탭 시)라 blocker 아님. 라우트는 이번 게이트 기간 무변경.
  - 실거래 피드 오늘/어제 빈 상태·해석 문장이 신고 시차를 언급하지 않음.
  - 신고가·상승·하락·84㎡·갭투자 기간의 한국 새벽 하루 밀림(KST 기간 lib로 이전).
  - Node `url.parse` DeprecationWarning(인증 라이브러리 경로) — 의존성 업데이트 시 정리.
- **KNOWN LIMITED 추가**: 전월세 현재월은 MOLIT 실시간이라 거래량이 조회 시점마다 변할 수 있음(카드·단지 목록은 같은 시점에 일치).
- **CLOSED 추가**: 통계 거래량 기간 Master Filter(`56e372d`, Production QA PASS).

### 실기기 체크리스트(갱신, 10개)

1. GPS ON 지도 — 지도 탭 현재 위치, 학교 상세 → 지도 탭이 현재 위치로
2. Google 로그인 → 로그아웃 → 재로그인
3. Kakao 로그인 → 로그아웃 → 재로그인
4. MY 관심/최근 본 → 같은 단지로 이동
5. 개인화 점수: 5개 중요도 저장 → 상세 FULL/LIMITED·변경 시 점수 변화
6. 비교 A/B 개인화 블록
7. 커뮤니티 사진 작성 → 수정 → 삭제 후 목록 복귀
8. 지도 pill/마커 터치·정렬(360/390px)
9. 리포트 PNG/PDF/공유 → "단지로 돌아가기" 같은 단지
10. 로그아웃 후 다른 계정 로그인 시 이전 사용자 중요도·관심 미노출(+ 통계 거래량 칩 가로 스크롤 터치 함께 확인)

완료(기준선, 사용자 실기기 PASS): 지도 첫 현재위치, 로드뷰, 리포트, 최근 본 단지, 커뮤니티 진입, Google/Kakao 로그인(canonical 수정 후), PWA 재설치.
