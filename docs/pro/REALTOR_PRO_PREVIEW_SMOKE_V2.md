# REALTOR PRO HOSTED PREVIEW FOUNDATION + DEPLOY V2 (2026-09-30)

## 결론

> **REALTOR PRO PREVIEW 최종 — PASS (2026-10-01).** Preview `dpl_H2zNLNDvZMsrPPaYgLuc6D3joPbc`(코드 `ccbae25`) · 테스트 DB `ejip-pro-preview`.
> · hosted E2E(관리자·신청·매물·고객·매칭·브리핑·Free 한도·보안) PASS — "Hosted E2E V2"
> · 정책 3개 결정·구현: 자기 승인 409 · 취소/만료 브리핑 410 · Pro 하단 공개 메뉴 숨김 — "POLICY HARDENING V1"
> · 모바일 375×812 · 390×844 PASS — 하단 메뉴 숨김 **전**(모바일 QA V3)과 **후**(POLICY HARDENING V1) 모두 사용자 DevTools 수동 확인
> · 남은 한계: 자기 승인 차단은 hosted에서 차단 코드까지 실측하지 않음(사용자 VERIFIED 유지) → 단위 테스트로 확인
> · Production · main(`b78c0c4`) 변경 0. Production 반영은 별도 승인(migration·PII 키·env·배포) 대상
> 이 절 아래의 HOLD 문단은 로그인 전(2026-09-30) 기록이다.

**HOLD — 사용자 작업 필요.** 로컬 준비(현재 main 통합 · 테스트 · 빌드)는 끝났다. hosted Preview는 아래 세 가지가 먼저 필요하다:
① Preview 환경 변수 쓰기(에이전트 권한에서 차단됨), ② 쓰기 가능한 격리 hosted DB(계정 작업 필요), ③ Preview 전용 `NEXTAUTH_SECRET`(새로 찾은 보안 문제).
Production 변경 0 · push 0 · 배포 0.

## 작업 공간

- worktree `.worktrees/realtor-pro-mvp`, 브랜치 `realtor-pro-mvp-overnight-v1`
- 사용자 로컬 main 체크아웃(작업 파일 42개) 건드리지 않음

## 현재 main 통합 (로컬 병합 커밋, push 안 함)

- 기준 `377acf7` → origin/main `b78c0c4`(서울25·경기8 공개) 병합 = `fc4b8af`. main은 바뀌지 않았다.
- 충돌 2개: CHANGELOG(양쪽 유지), `sitemap-scope.test.ts`(main의 UnsupportedRegionNotice + Pro의 `(public)` 경로)
- main의 새 서울25·경기8 테스트가 읽는 페이지 경로 6곳을 `(public)` 경로로 옮김. map/page·apt-client·school-client는 git이 rename을 따라가 깨끗이 병합됨
- **통합이 필요했던 이유**: Pro 브랜치에는 main의 Preview DB 정책(`db-url-policy.ts`, Preview는 `DATABASE_URL`로 떨어지지 않고 닫힘)이 없었다
- 결과: src 테스트 2845 중 2838 pass(fail 2 = 기존 worktree CRLF, Pro 79 포함) · tsc src 0(scripts 21 기존) · eslint 0 · `npm run build` PASS

## Vercel env 감사 (이름·범위만)

| 변수 | Production | Preview | 브랜치 | Pro 필요 |
|---|---|---|---|---|
| DATABASE_URL | O | - | - | 아니오(Preview는 정책상 안 씀) |
| PREVIEW_DATABASE_URL | - | O | gyeonggi-8-public-beta-preview-v1 | 아키텍처상 같은 역할 — Pro 브랜치용은 **없음** |
| SUPABASE_SERVICE_ROLE_KEY | O | **O** | 전체 | 아니오 — **문제: Preview에 Production 키** |
| NEXTAUTH_SECRET | O | **O** | 전체 | 예 — **문제: Preview와 Production이 같은 키** |
| NEXTAUTH_URL | O | - | - | Preview는 배포 URL 사용 |
| DATA_GO_KR_API_KEY | O | O | 전체 | 아니오(MOLIT) |
| REALTOR_PRO_* | - | - | - | 예 — 아직 없음 |
| NEXT_PUBLIC_SUPABASE_URL / ANON_KEY | - | - | - | 아니오 |

→ PREVIEW_ENV_AUDIT = ISSUE

## 보안 문제

1. **Production service-role 키가 Preview에 있다.** 런타임에서 이 키를 읽는 곳은 `src/lib/supabase/server-storage.ts`(커뮤니티 이미지) 하나이고,
   키가 없으면 저장소가 `null`로 닫힌다(폴백 없음). 지금 Preview들은 read-only DB라 커뮤니티 쓰기가 원래 안 되므로 **끊기는 Preview 흐름 없음**.
   조치: 대상에서 Preview 제거(Production 값 그대로). 에이전트의 Vercel env 쓰기가 권한 정책에서 차단돼 **실행되지 않았다**(현재도 production+preview).
   이미 만들어진 Preview 배포는 배포 시점 env를 계속 가지므로, 범위를 바꾼 뒤에도 옛 Preview 배포에는 남는다.
2. **NEXTAUTH_SECRET 공유 → Preview에서 만든 관리자 세션이 Production에서 통한다.** 세션은 JWT이고 `role`·`email`이 토큰에 구워지며
   (`src/lib/auth.ts` jwt 콜백), 관리자 판정은 세션의 `role === 'ADMIN'`을 본다(`admin-access.ts`). 쓰기 가능한 Pro Preview DB에는
   승인용 ADMIN 사용자가 생기므로, 같은 비밀키로 서명된 `role=ADMIN` 토큰을 e-jip.com에 넣으면 유효하다.
   조치: **Pro 브랜치 한정 Preview 전용 `NEXTAUTH_SECRET`**(브랜치 변수가 일반 Preview 변수보다 우선). 쓰기 가능한 Preview DB를 만들기 **전에** 필요.

## hosted DB

- 격리된 쓰기 가능 hosted DB: **없음**. Supabase CLI·Neon CLI 없음, Vercel 연결 스토어 없음.
- Production DB 안의 새 스키마, Production 쓰기 역할, 서울/경기용 read-only 역할(`ejip_preview_ro`)은 쓰지 않는다(요구사항).
- 무료로 가능한 선택지(사용자 계정 작업 필요): Supabase 새 무료 프로젝트(조직의 무료 프로젝트 2개 한도 안일 때) 또는 Neon 무료 프로젝트.

## 로그인 (hosted E2E 전제)

- 로그인은 Kakao·Naver·Google OAuth뿐(자격증명 로그인 없음). Preview 도메인이 각 제공자에 redirect URI로 등록돼야 하고, 실제 OAuth 계정이 필요하다.
- 합성 "테스트중개사"는 OAuth로 만들 수 없다 → 선택: (a) 사용자가 본인 계정으로 Preview에 로그인(그 계정 이름·이메일이 Preview DB에 저장) 또는
  (b) Preview 전용 테스트 로그인 추가(인증 동작 변경 = 별도 승인).

## hosted 테스트 DB migration (2026-09-30, 사용자 승인)

- 대상: Supabase `ejip-pro-preview`(ref `xzfd…`, Postgres 17.6) — Production(`ztln…`)과 다른 프로젝트. 연결은 로컬 `.env.pro-preview.local`(git 제외)에서만, 값 출력 0
- 안전장치: 적용 직전 offline guard(ref 일치 · Production ref와 다름 · 5432/6543 · sslmode·pgbouncer·connection_limit) PASS → read-only probe(빈 DB 확인) PASS
- 개수 정정: migration은 **23개**(`0_baseline` + 22). V1 문서의 "24개"는 잘못 센 값
- `prisma migrate deploy`: 23개 전부 적용 · `migrate status` up to date · `migrate diff` No difference
- Pro 객체: 테이블 10 · RLS 활성 10(FORCE 0) · 정책 30 · CHECK 26 · FK 13 · anon/authenticated/service_role 권한 0
- 계정 테이블 7개 API 권한 0 · anon/authenticated 권한이 있으면서 RLS 꺼진 public 테이블 0
- 실 RLS 음성 테스트 15/15 PASS(A 자기 것만 · B→A 0 · 문맥 없음 0 · anon/authenticated/service_role 거부 · 정지 중개사 쓰기 거부 · 남의 소유 삽입 거부 · 소유권 이전 거부 · 남의 행 수정/삭제 0 · 감사로그 쓰기 거부 · 정지 상태 자기 승격 0 · 데이터 불변). 전부 한 트랜잭션 안에서 실행 후 ROLLBACK — 남은 행 0, probe 역할 0
- Production DB 접속·변경 0 · Vercel 배포 0 · MOLIT 호출 0

## Preview 외부 데이터 관문 (REALTOR_PRO_PREVIEW_EXTERNAL_GUARD_V1)

- 조건: `VERCEL_ENV=preview` **그리고** `REALTOR_PRO_ENABLED=true` — Production·로컬·다른 Preview는 꺼짐(테스트 고정)
- 방식: `src/instrumentation.ts`의 `register()`가 서버 시작 때 전역 fetch를 한 번 감싼다 → 아래 호스트는 네트워크 없이 `PreviewExternalBlockedError`(오류에 URL·서비스키 없음). MOLIT 거래는 `api-molit.ts` 단일 관문에서도 페이지 요청 0으로 실패 플레이스홀더(0건으로 위장하지 않음)
- 막음: `apis.data.go.kr`(MOLIT·건축물대장·TAGO·준공연도) · `api.odcloud.kr`(청약홈) · `open.neis.go.kr` · `www.schoolinfo.go.kr` · `generativelanguage.googleapis.com`(Gemini) · `api.resend.com`(메일) · `api.indexnow.org`
- 열어 둠(화면 동작에 필요): Kakao 지도 SDK·로컬 검색, OAuth, 지역코드 프록시, 브라우저 쪽 요청
- 테스트 `src/lib/preview-external-guard.test.ts` 7/7(조건 진리표 · 호스트 판정 · 네트워크 0 · 설치 1회 · MOLIT 관문 · 설치 지점 · Preview DB가 DATABASE_URL로 떨어지지 않음)

## Preview 배포 + hosted 검증 (2026-09-30, 사용자 승인)

| 항목 | 결과 |
|---|---|
| 배포 | 브랜치 `realtor-pro-mvp-overnight-v1` `1e3a162` push(main 불변 `b78c0c4`) → `dpl_GZVh1F7peu68uqDwDTMs69Ua5dX5` READY · 브랜치 URL이 이 배포를 가리킴 |
| env(이름·범위) | Pro 6개 모두 브랜치 값이 적용 · `SUPABASE_SERVICE_ROLE_KEY`·`SUPABASE_KEY`·`DATABASE_URL`·`NEXTAUTH_URL`은 Production 전용 → Pro Preview에 없음 |
| DB 대상 | **ejip-pro-preview 확인(DB 쪽 증거)**: pg_stat_statements 기준, 대기 중 스냅샷 2회 변화 0 → Preview 검색 2회 뒤 아파트 테이블 쿼리 +6(첫 회 3회 검색 +10). Preview 검색 "은마" 0건(Production에는 있음) → Production 아님. Prisma(transaction pooler) 오류 없음. migration 23. 진단 경로 추가 없음 |
| Pro 스위치 | `/api/pro/*` → `LOGIN_REQUIRED`(꺼져 있으면 `PRO_DISABLED`) → `REALTOR_PRO_ENABLED=true` 런타임 확인. `/api/auth/providers` 200 → 브랜치 `NEXTAUTH_SECRET` 존재 |
| 외부 API 관문 | 런타임 로그 `preview external data blocked`: apis.data.go.kr 4(건축물대장·TAGO) · Gemini 2 · NEIS 2. MOLIT는 api-molit 관문에서 요청 전 차단(상세 `apiError` = Preview 차단 문구, 거래 목록 `failedMonths` 3/3 — 0건 위장 없음). 로그에 URL·서비스키 0. Resend 키는 Production 전용이라 Preview 발송 불가 · IndexNow는 런타임 경로 없음(스크립트 전용) |
| 익명 접근 | Pro API 전 라우트·전 메서드 401(없는 메서드 405) · `/admin/pro` → `/my` · `/pro/*`는 빈 껍데기(데이터는 API 401) |
| 브리핑 위조 토큰 | 404 · `Referrer-Policy: no-referrer` · `X-Robots-Tag: noindex, nofollow, noarchive` · `no-store` · 엄격 CSP · AdSense·GA·Kakao·ipinfo·canonical 0 |
| /pro 페이지 | `noindex, nofollow` · no-referrer · CSP(`connect-src 'self'`, `frame-ancestors 'none'`) · 광고·GA·Kakao·ipinfo 0 |
| 공개 라우트 회귀 | `/`·`/map`·상세·`/community`·`/privacy`·`/terms` 200(공개 레이아웃, AdSense 그대로, Pro 메타 섞임 0) · robots·sitemap·ads.txt 200 · 없는 URL 404. GA는 Production과 같이 클라이언트 로드 |
| Production(읽기) | e-jip.com 200 · 서울25 은마 · 경기8 매교역 검색 정상 · 41115 마커 107 |
| 테스트 DB 쓰기 | 0(users 0 · profiles 0) |

**중단 지점 — 로그인 필요(STEP 8~13, 15):** Preview 로그인은 OAuth뿐이고 Preview에 자격이 있는 제공자는 Google 하나(Kakao·Naver 키는 Production 전용). Google OAuth 클라이언트에 이 Preview 콜백이 등록돼야 한다. 계정·권한은 임의로 만들지 않았다.

## 다음 단계 (hosted DB가 생긴 뒤)

1. Pro 브랜치 한정 Preview env: `PREVIEW_DATABASE_URL`(Pro DB) · `NEXTAUTH_SECRET`(Preview 전용) · `REALTOR_PRO_ENABLED=true` · `REALTOR_PRO_PII_KEY`·`_KEY_ID`·`_LOOKUP_PEPPER`(새로 생성, Production 재사용 금지)
2. `SUPABASE_SERVICE_ROLE_KEY` 대상을 production만으로
3. hosted DB에 필요한 기반 스키마 + Pro migration `20260930090000_realtor_pro_mvp_v1` → 10 테이블 · RLS 30 · CHECK 26 · FK 13 확인, DB 수준 RLS 테스트
4. Pro Preview MOLIT 차단: Pro DB에는 공개 거래 데이터가 없어 공개 페이지가 DB 미스 → live MOLIT로 갈 수 있다. Preview 전용 차단(코드 또는 브랜치 env) 필요
5. 브랜치 push → Preview 배포 → 공개 라우트 회귀 · /pro 격리 · E2E · 모바일 · 보안 점검

## Hosted E2E V2 — 로그인 후 실제 Preview 검증 (2026-09-30 23:17~23:30 KST, 사용자 승인)

대상: 배포 `dpl_GZVh1F7peu68uqDwDTMs69Ua5dX5`(코드 `1e3a162`) · 테스트 DB `ejip-pro-preview`만. 요청은 사용자가 직접 로그인한 실제 Preview 세션에서
같은 출처 `fetch`로 보냈다(CSRF 규칙 그대로 통과). DB 확인은 guard(ref 일치·Production ref와 다름) 통과 후에만, 값이 아니라 개수·참거짓만 출력.

| 항목 | 결과 | 근거(실측) |
|---|---|---|
| 작업 환경 | PASS | 브랜치 `realtor-pro-mvp-overnight-v1` `8e714b4`, 변경 0 · 브랜치 별칭 → 위 배포 · guard PASS · migration up to date |
| Google 로그인 계정 | PASS | 테스트 DB 사용자 1명 · google 계정 1개 · 브라우저 세션 ID 접두와 일치. 이메일·토큰 출력 0 |
| Preview ADMIN | PASS | 그 1명만 `ADMIN`(1행). 합성 사용자 3명은 `USER`. JWT에 역할이 구워져 있어 사용자 재로그인 후 세션 `role: ADMIN` 확인 |
| 일반 사용자 관리자 차단 | PASS | 승격 전 `/api/admin/pro/applications` 403 · `/admin/pro` 리다이렉트 |
| 중개사 신청 | PASS | 신청 전 쓰기 403 `NOT_VERIFIED_REALTOR` → 신청 201 `PENDING_REVIEW`(플랜 FREE) · 재신청 409 `ALREADY_APPLIED` · 대기 중 매물·고객 쓰기 403 |
| 관리자 승인/반려 | PASS | 목록 200(자격번호는 `hasLicenseNumber` 등 불리언만) · 합성 C 승인 200 · 합성 D 반려 200(사유 저장) · 잘못된 전이 409 `BAD_TRANSITION` · 없는 상태 400 · 없는 ID 404 · 비 JSON 415 · 사용자 신청 승인 → `VERIFIED`/`FREE` |
| 매물 | PASS | 생성 201 · aptSeq `11680-218`·lawdCd 정확히 저장 · DTO에 소유자 이름·전화·암호문 0 · 목록에 B 매물 없음 · 상세·수정(가격)·보관/복원·메모·소유자 연락처 열람 200 · `realtorId` 바꿔치기 무시 · B 매물 6개 경로 전부 404 |
| 공개 단지 정보 | PASS(데이터 없음) | 테스트 DB에 공개 단지 데이터가 없어 `data: null` — 다른 단지로 대체하지 않음 |
| 고객 | PASS | 생성 201 · 응답·목록·상세에 전화·이메일·암호문 0 · 이름 검색은 자기 고객만 · 수정 · 연락처 열람 · 조건 등록 · 팔로업 생성→일정 변경→오늘 대시보드 표시→완료 · B 고객 7개 경로 404. 같은 고객 두 번째 진행 중 팔로업은 Free 규칙대로 403 `PLAN_LIMIT` |
| 매칭 | PASS | 점수 93 · 신뢰도 SUFFICIENT · 이유 6개(예산·면적·입주·주차 MATCH, 층 MISS, **통근 UNKNOWN "확인 필요(통근지 좌표 없음)"**) · 학교 항목은 점수 없음 · B 매물 결과 0 |
| 브리핑 | PASS | 생성 201 · 토큰 43자 · 목록에 원문 토큰 없음 · 익명 요청(쿠키 제외) 200 · 비공개 문자열 11종 노출 0 · 헤더 `noindex, nofollow` · `no-referrer` · `no-store` · CSP · AdSense·GA·Kakao·ipinfo·위치 조회·canonical 0 |
| 브리핑 취소/만료 | PASS | 취소 200 → 같은 링크는 "만료되었거나 더 이상 볼 수 없는" 안내만(매물·고객 내용 0) · 합성 브리핑 1건 만료 처리 후 같은 안내 · 한 글자 다른 토큰 404 |
| Free 한도 | PASS | 활성 매물 10 허용·11번째 403 `PLAN_LIMIT` · 고객 5 허용·6번째 403 · 브리핑 하루 3 허용·4번째 403 · 매물 보관 후 새 매물 201 |
| 정지 중개사 | PASS | 정지 → 쓰기 3종 403 `SUSPENDED` · 읽기 200 · 대시보드 정지 표시 · 재개 → `VERIFIED` |
| Mass assignment | PASS | 고객 `realtorId`, 프로필 `status`·`userId` 입력 무시(소유·상태 그대로) |
| XSS | PASS | `<img src=x onerror>` 메모 저장 후 상세 화면에서 글자로만 표시 · 실행 0 · 삽입된 img 0 |
| 개인정보 암호화(DB) | PASS | Pro 테이블 10개 평문 연락처 0 · 고객 전화/이메일·소유자 전화 암호문+해시 존재 · 키 ID `pv1` 아닌 암호문 0 |
| 토큰 저장(DB) | PASS | 브리핑 3건 모두 `token_hash`만(HMAC) · 원문 토큰 형태 값 0 |
| 감사 로그(DB) | PASS | 신청·상태 변경·매물·고객·연락처 열람·브리핑 생성/취소 기록 · 민감 문자열 0 |
| Hosted RLS | PASS(재실행 안 함) | 2026-09-30 15/15 결과 유지 — 이번 라운드는 API 계층 격리를 실측 |

익명·CSRF·브리핑 위조 토큰 검사는 위 "Preview 배포 + hosted 검증" 결과를 그대로 쓴다(이번에 다시 돌리지 않음).

### 테스트 데이터 (ejip-pro-preview에만 있음 · 삭제하지 않음)

- 사용자 계정 1(실제 Google 로그인, Preview ADMIN 유지) · 합성 사용자 3(`qa-syn-` ID, `[TEST]` 이름, 연락처 없음: 중개사 B·신청자 C 승인·신청자 D 반려)
- 사용자 중개사 A 소유 합성 데이터: 매물 11건 생성(`[TEST]` 이름, 일부 보관) · 고객 5명(가짜 번호 `010-0000-xxxx`, `example.com` 메일) · 브리핑 3건(취소 1·만료 1) · 팔로업 1건(완료) · XSS 메모 1건
- 정리가 필요하면 범위를 따로 보고하고 승인 후에만 지운다.

## 모바일 QA V3 (2026-10-01) — PASS (사용자 수동 확인)

- **상태: PASS.** 사용자가 일반 Chrome의 정상 로그인 세션에서 DevTools device mode로 **375×812 · 390×844** 두 크기를 직접 확인했다.

| 화면 | 375×812 | 390×844 |
|---|---|---|
| `/pro/dashboard` | PASS | PASS |
| `/pro/listings` | PASS | PASS |
| `/pro/listings/new` | PASS | PASS |
| `/pro/customers` | PASS | PASS |
| `/pro/customers/[id]` | PASS | PASS |
| `/pro/matches` | PASS | PASS |
| `/pro/briefings` | PASS | PASS |

- 사용자 확인 항목: 가로 스크롤 없음 · 버튼 가림 없음 · 글자 겹침 없음 · 드롭다운 잘림 없음.
- 별도로 보고되지 않은 항목(이번 기록에서 따로 판정하지 않음): 터치 대상 크기 수치 측정 · 360px · 실제 기기(iOS/Android) 확인.
- 증거 성격: 사용자 수동 확인 결과이며, 에이전트 자동 측정값·스크린샷은 없다.
- 자동화 시도 기록(결과 없음):
  1. 일반 Chrome 창을 375px로 줄이기 → Chrome 최소 너비 때문에 innerWidth 767px. 사용자 지시로 이 방식은 쓰지 않는다.
  2. Playwright(시스템 Chrome·별도 프로필·실제 기기 뷰포트 375×812 / 390×844) → 에이전트가 띄운 창은 사용자 화면에 보이지 않았고,
     사용자가 직접 띄운 창에서는 **Google이 자동화 브라우저 로그인을 "안전하지 않을 수 있음"으로 차단**. 로그인 우회·쿠키 복사는 하지 않았다(사용자 지시).
     자동화 프로세스는 종료했고 임시 프로필은 삭제했다. 측정 결과는 0건 — 이 방식으로 얻은 PASS/FAIL 없음.
- 사용자 확인 절차(일반 Chrome, 정상 로그인 세션): F12 → `Ctrl+Shift+M` → Dimensions `Responsive` 375×812, 이어서 390×844 →
  `/pro/dashboard` · `/pro/listings` · `/pro/listings/new` · `/pro/customers` · 고객 상세 1건 · `/pro/matches` · `/pro/briefings`에서
  가로 스크롤 · 맨 아래까지 내렸을 때 마지막 버튼이 하단 메뉴 위에 완전히 보이는지 · 글자 겹침/잘림 · 입력 가능 여부 ·
  `/pro/listings/new` 단지 검색(2글자 이상) 결과 목록이 화면 폭 안에 있는지 · `/pro/matches`·고객 상세의 선택 상자 표시를 본다.
- 코드에서 확인한 것(화면 검증 아님): Pro 셸은 하단 탭바를 피하려고 `padding-bottom: calc(96px + env(safe-area-inset-bottom))`, `overflow-x: hidden`,
  본문 `max-width 960px`·좌우 16px. 모달은 없고 선택 상자는 기본 `<select>`, 단지 검색 결과는 문서 흐름 안의 목록(`role="listbox"`)이다.
- 로컬 격리 DB에서의 모바일 16회 PASS(V1 문서)는 예전 코드 기준이라 hosted 결과를 대신하지 않는다.

## 검토 필요 항목 (정책 결정 전 구현 안 함)

| # | 현재 동작 | 영향 | 선택지 |
|---|---|---|---|
| 1. 관리자 자기 승인 | `adminSetStatus`·`adminGrantBetaPro`는 `requireAdmin()`만 본다. 관리자가 자기 중개사 신청을 승인할 수 있고(이번 E2E에서 실제로 그렇게 승인), 자기에게 베타 Pro도 줄 수 있다. 감사 로그에 `reviewedByUserId` = 신청자 본인으로 남는다 | 관리자가 1명인 지금은 운영상 필요할 수 있다. 다만 자격 확인 없이 스스로 인증 중개사가 될 수 있어, 관리자 계정이 탈취되면 인증 표시를 위조할 수 있다 | (a) 자기 신청은 거부(409) (b) 허용하되 감사 로그에 `SELF_REVIEW` 표시 (c) 2인 승인. Production 전 결정 필요 |
| 2. 취소·만료 브리핑 HTTP 200 | `/b/[token]`: 없는 토큰은 `notFound()`(404), 취소·만료는 200 + "더 이상 볼 수 없는 브리핑" 안내. 내용은 0, 헤더(noindex·no-store·no-referrer)는 그대로 | 개인정보 노출은 없다. 다만 200이라 링크 미리보기·모니터링이 "정상 페이지"로 볼 수 있고, 취소된 토큰과 없는 토큰이 상태 코드로 구분된다(토큰이 한때 유효했다는 사실이 드러남 — 토큰이 43자 무작위라 추측 공격 가치는 낮음) | (a) 그대로 (b) 410 Gone (c) 404로 통일. 안내 문구 유지 여부와 함께 결정 |
| 3. Pro 화면의 공개 하단 메뉴 | Pro 셸이 공개 `Header`를 그대로 써서 모바일에 공개 하단 탭(홈·지도·통계·재개발·분양·MY)이 고정 표시된다. Pro 탭(대시보드·매물·고객·매칭·브리핑·설정)은 본문 위쪽에 따로 있다 | 하단 탭을 누르면 Pro 구역을 떠나 공개 화면으로 전체 문서 이동. 하단 고정 바가 Pro 본문 버튼을 가리지 않음은 모바일 QA에서 확인(셸이 96px+안전영역 여백을 둠). 중개사 업무 화면 하단에 공개 메뉴가 보이는 것이 제품상 맞는지 결정 필요 | (a) 그대로 (b) `Header`의 기존 `hideMobileNav` 옵션으로 Pro에서 숨김 (c) Pro 전용 하단 탭으로 교체. (b)는 코드 한 줄이지만 화면 방향 결정이라 승인 후 진행 |

## POLICY HARDENING V1 (2026-10-01) — 위 "검토 필요 항목" 3개 결정·구현

결정(사용자): ① 관리자 자기 승인 금지 ② 취소·만료 브리핑 410 ③ Pro 화면에서 공개 하단 메뉴 숨김. 코드 `ccbae25` → Preview `dpl_H2zNLNDvZMsrPPaYgLuc6D3joPbc` READY(브랜치 URL이 이 배포를 가리킴). main `b78c0c4` 불변.

```
SELF_APPROVAL          = BLOCKED (409 SELF_APPROVAL_NOT_ALLOWED)
REVOKED_BRIEFING_HTTP  = 410
EXPIRED_BRIEFING_HTTP  = 410
PRO_BOTTOM_NAV         = HIDDEN (모바일)
```

### 구현

| 항목 | 방식 | 범위 밖으로 남긴 것 |
|---|---|---|
| 자기 승인 금지 | `adminSetStatus`(서버 서비스): 대상 프로필 `userId` = 관리자 세션 `userId`이고 목표가 `VERIFIED`(신청 승인·정지 해제 모두)면 409 `SELF_APPROVAL_NOT_ALLOWED`. 상태·감사로그 변화 0. 반려·정지·다른 사용자 승인은 그대로. 기존 VERIFIED 행은 소급 변경 없음 | 차단 시도 감사로그 — `realtor_audit_logs.action` CHECK 제약에 값이 없어 migration 필요 → 값 없는 서버 경고(`[pro-admin] self-approval blocked`)만. 베타 Pro 자기 부여(`adminGrantBetaPro`)는 이번 범위 밖 |
| 브리핑 410 | App Router 페이지는 상태 코드를 410으로 못 정하므로 `src/proxy.ts`가 `/b/:token`을 먼저 판정(`src/lib/pro/briefing-gone.ts`). 취소·만료면 고정 HTML(브리핑·중개사·고객 정보 0, 스크립트·외부 리소스 0) + `/b/*` 보안 헤더(CSP·no-referrer·X-Robots-Tag) + `no-store`. 그 외는 기존 페이지(404·200). proxy는 조회수를 세지 않음. 토큰 해시 구조 불변 | 중개사 정지(UNAVAILABLE)는 기존대로 200 안내. proxy 판정 오류 시 페이지로 넘김(페이지가 같은 판정으로 내용 차단, 상태만 200) |
| 하단 메뉴 숨김 | Pro 셸 `Header`에 기존 `hideMobileNav` 옵션 · 셸 하단 여백 96px→32px(+안전영역) · 폼 고정 저장 바 위치 76px→화면 맨 아래(+안전영역) | `/admin/pro`는 다른 관리자 화면과 같은 공개 레이아웃이라 유지. 데스크톱 상단 메뉴는 그대로. Pro 전용 하단 탭 없음 |

### 로컬 검증

| 항목 | 결과 |
|---|---|
| 새 테스트 `src/lib/pro/pro-policy-hardening.test.ts` | 10/10 PASS |
| src 전체 `npx tsx --test "src/**/*.test.ts"` | 2297 중 2289 pass · fail 3 → 1개는 이번 변경(`feedback.test.ts`가 proxy matcher를 `['/admin/:path*']` 정확히 요구) — 의도(관리자 가드 유지)대로 첫 항목 검사로 수정 후 26/26 PASS. 나머지 2개(`community-launch` §15, `recent-auth-parity` §5)는 **수정 전 HEAD(e5cd66b)에서도 똑같이 실패**(기존 worktree CRLF) |
| `npx tsc --noEmit` | src 오류 0 · scripts 21(기존, FAIL_EXISTING_SCRIPT_ERRORS) |
| eslint(변경 파일) | 0 |
| `npm run build` | PASS(`ƒ Proxy (Middleware)`) |

### Preview 검증 (실제 로그인 세션, 테스트 DB만)

| 항목 | 결과 |
|---|---|
| 세션 | 사용자 계정 `role: ADMIN` · 프로필 `VERIFIED`/`FREE` — 검증 후에도 그대로 |
| 다른 사용자 승인 | 합성 신청자 E(`qa-syn-rp-e`, 이번에 추가한 PENDING_REVIEW 1건) 승인 200 → VERIFIED |
| 자기 승인 | **hosted에서 차단 코드까지는 실측 못 함** — 사용자 프로필이 이미 VERIFIED라 요청이 앞선 전환 검사에서 409 `BAD_TRANSITION`으로 끝난다. `SELF_APPROVAL_NOT_ALLOWED` 경로를 실제로 타려면 사용자 프로필을 PENDING/SUSPENDED로 바꿔야 하는데, 사용자 VERIFIED 유지 원칙 때문에 하지 않았다. 차단 자체는 단위 테스트(신청 승인·정지 해제 둘 다)로 확인 |
| 관리자 기능 | 목록 200 · 승인 후에도 관리자 API 200 |
| 브리핑 valid | 200 · 매물 내용 표시 · 고객·메모·연락처 0 |
| 브리핑 revoked | **410** · 고정 안내 · 비공개 문자열·토큰 0 · 스크립트 0 |
| 브리핑 expired | 테스트 DB에서 이번 합성 브리핑 1건 만료 처리 → **410** · 같은 결과 · 외부 URL 0 |
| unknown / near-miss / 형식 불일치 | 404 / 404 / 404 |
| 헤더(전 상태) | `X-Robots-Tag: noindex, nofollow, noarchive` · `Referrer-Policy: no-referrer` · `Cache-Control` no-store · CSP 있음 · GA·AdSense·Kakao·ipinfo·위치 조회 0 |
| Free 한도 | 오늘 세 번째 브리핑 생성 403 `PLAN_LIMIT`(오늘 이미 1건이 있었음) — 한도 유지 |
| 하단 메뉴(SSR HTML) | Pro 7개 화면 전부 공개 하단 바에 모바일 숨김 클래스 · `/`·`/community`는 그대로 표시 · `/map`은 자체 하단 메뉴라 변경 없음 |
| 테스트 DB 확인(읽기 전용) | Pro 테이블 평문 연락처 0 · 암호문 키 ID `pv1`만 · 브리핑 6건 전부 해시 · 원문 토큰 형태 값 0 · 감사로그 민감 문자열 0 |
| Production(읽기) | e-jip.com `/`·`/map` 200 · `/b/<합성>` 404(Pro 꺼짐) · main `b78c0c4` |

### 모바일 375/390 화면 확인 — PASS (사용자 수동 확인, 2026-10-01)

사용자가 일반 Chrome DevTools device mode, 정상 로그인 세션으로 **375×812 · 390×844**에서 Pro 7개 화면을 확인했다(배포 `ccbae25`).

| 확인 항목 | 375×812 | 390×844 |
|---|---|---|
| Pro 7개 화면에 공개 하단 메뉴 없음 | PASS | PASS |
| 과도한 하단 여백 없음 | PASS | PASS |
| 매물·고객 등록 화면 저장 버튼 바 정상 | PASS | PASS |
| 공개 `/` 하단 메뉴 그대로 표시 | PASS | PASS |

증거 성격: 사용자 수동 확인(에이전트 측정값·스크린샷 없음) + 위 SSR HTML 숨김 클래스 확인.

### 테스트 데이터 추가분 (ejip-pro-preview)

합성 사용자 E + 프로필(`qa-syn-rp-e`, 승인됨) · 사용자 A 브리핑 2건(1건 취소, 1건 만료 처리). 삭제 0 · 사용자 ADMIN 유지.
