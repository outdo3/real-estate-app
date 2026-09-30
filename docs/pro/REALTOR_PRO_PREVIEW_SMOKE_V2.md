# REALTOR PRO HOSTED PREVIEW FOUNDATION + DEPLOY V2 (2026-09-30)

## 결론

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

## 다음 단계 (hosted DB가 생긴 뒤)

1. Pro 브랜치 한정 Preview env: `PREVIEW_DATABASE_URL`(Pro DB) · `NEXTAUTH_SECRET`(Preview 전용) · `REALTOR_PRO_ENABLED=true` · `REALTOR_PRO_PII_KEY`·`_KEY_ID`·`_LOOKUP_PEPPER`(새로 생성, Production 재사용 금지)
2. `SUPABASE_SERVICE_ROLE_KEY` 대상을 production만으로
3. hosted DB에 필요한 기반 스키마 + Pro migration `20260930090000_realtor_pro_mvp_v1` → 10 테이블 · RLS 30 · CHECK 26 · FK 13 확인, DB 수준 RLS 테스트
4. Pro Preview MOLIT 차단: Pro DB에는 공개 거래 데이터가 없어 공개 페이지가 DB 미스 → live MOLIT로 갈 수 있다. Preview 전용 차단(코드 또는 브랜치 env) 필요
5. 브랜치 push → Preview 배포 → 공개 라우트 회귀 · /pro 격리 · E2E · 모바일 · 보안 점검
