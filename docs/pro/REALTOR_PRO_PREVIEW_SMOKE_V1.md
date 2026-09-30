# REALTOR PRO — PREVIEW DB + MIGRATION + END-TO-END SMOKE V1 (2026-09-30)

## 결론

- **Preview(Vercel) 단계는 보류** — 격리된 쓰기 가능 Preview/Test DB를 만들 수단이 이 환경에 없다(아래 §1). Production으로 대체하지 않았다.
- 같은 검증을 **로컬 격리 DB**(Supabase 공식 Postgres 17.6 이미지, Docker, 127.0.0.1 전용)에서 전부 수행했다: migration 적용 · 객체 검증 · 실 RLS 음성 테스트 · 실제 Prisma 저장소 기반 end-to-end · 실제 API 라우트·UI(LIVE 모드) · 모바일 375/390 · 공개 화면 회귀.
- 그 과정에서 **실제 버그 3건**을 찾아 고쳤다(§8).
- push·Preview 배포·Preview 암호화 키 설정은 하지 않았다(DB가 준비되면 한 번에).

## 1. DB 선택 (Phase 1–2)

| 항목 | 값 |
|---|---|
| PRODUCTION_DB_PROJECT | 기존 Supabase 프로젝트(Production) — **읽기·쓰기 0**(이번 작업에서 연결 자체를 하지 않음) |
| 기존 Preview DB 연결 | `PREVIEW_DATABASE_URL`은 `seoul-25-public-beta-prep-v2` 브랜치 전용 + **Production DB의 읽기 전용 역할** → 쓰기 불가·격리 아님 |
| 이 브랜치의 Preview env | `DATABASE_URL`·`PREVIEW_DATABASE_URL` 없음. 반면 `DATA_GO_KR_API_KEY`는 모든 Preview에 있음 → DB 없는 Preview에서 공개 상세 화면이 MOLIT를 부를 수 있어 공개 회귀 QA도 Preview에서 하지 않았다 |
| 새 Supabase 프로젝트 | 이 PC에 Supabase CLI·액세스 토큰 없음(로그인 대행 불가). 조직이 유료 컴퓨트(Micro 업그레이드)라 추가 프로젝트는 월 과금 가능성 → 승인 범위 밖 |
| 사용한 DB | **로컬 Docker `ejip-pro-test-db`**(`public.ecr.aws/supabase/postgres:17.6.1.167`, 127.0.0.1:55433, 무작위 비밀번호, 빈 DB에서 시작, Production 데이터 복사 0). `anon`/`authenticated`/`service_role` 역할이 호스팅 Supabase와 같다 |

PREVIEW_TEST_DB_BLOCKER — 해제 방법(택1, 사용자 작업 필요):

1. Supabase **무료 조직**에 새 프로젝트 `ejip-pro-preview` 생성(과금 없음) → 연결 문자열을 Vercel Preview env `PRO_PREVIEW_DATABASE_URL`(브랜치 `realtor-pro-mvp-overnight-v1` 한정)로 직접 등록
2. 또는 Neon 무료 DB를 Vercel Marketplace로 연결(약관 동의 필요)

그 다음 이 문서 §2 절차를 그 DB에 그대로 반복하면 된다(migration은 `npx prisma migrate deploy`, 빈 DB 기준 baseline + 24개).

## 2. Migration (Phase 4–6) — 로컬 격리 DB

- 사전 점검: public 테이블 0, 확장 `plpgsql, uuid-ossp, pgcrypto, pg_stat_statements, supabase_vault`
- `npx prisma migrate deploy`: baseline 포함 **24개 전부 적용**(마지막 `20260930090000_realtor_pro_mvp_v1`)
- `prisma migrate diff --from-url <test db> --to-schema-datamodel prisma/schema.prisma` → **No difference detected**(스키마 드리프트 0)

| 검증 | 결과(설계와 일치) |
|---|---|
| Pro 테이블 | 10 (`realtor_audit_logs, realtor_briefings, realtor_customer_preferences, realtor_customers, realtor_followups, realtor_listing_notes, realtor_listings, realtor_matches, realtor_profiles, realtor_subscriptions`) |
| RLS enabled | 10/10 (FORCE 0 — 설계대로 소유자 역할은 우회, 앱 계층이 1차 통제) |
| 정책 | 30 |
| CHECK | 26 |
| FK | 13 (users 참조 1) |
| UNIQUE 인덱스 | 3 · 일반 인덱스 18 |
| API 역할(anon/authenticated/service_role) 권한 | 0 |

## 3. 실 RLS 음성 테스트 (Phase 7)

비소유자·비BYPASSRLS 역할 `pro_rls_probe`에 **일부러 테이블 권한을 준 최악 조건**에서(테스트 후 삭제):

| # | 시나리오 | 결과 |
|---|---|---|
| T1 | 중개사 A 컨텍스트로 A 매물·고객 | 1, 1 |
| T2 | 중개사 B 컨텍스트로 A 데이터 | 0, 0 |
| T3 | 컨텍스트 없음 | 0, 0 |
| T4 | anon / authenticated / service_role | permission denied ×3 |
| T5 | 정지(SUSPENDED) 중개사 INSERT | RLS 위반 |
| T6 | B가 A 소유로 INSERT | RLS 위반 |
| T7 | A가 자기 매물을 B 소유로 변경(mass assignment) | RLS 위반 |
| T8 | B가 A 행 UPDATE/DELETE | 0행 |
| T9 | 감사로그 읽기/쓰기 | 0 / RLS 위반 |
| T10 | 정지 중개사가 자기 status를 VERIFIED로 | 0행 |
| T11 | 모든 시도 후 데이터 | 변경 없음 |

LIVE_RLS = **PASS**

## 4. 서비스 end-to-end (실제 Prisma 저장소 + 로컬 격리 DB) — 38/38 PASS

API 라우트가 부르는 서비스 함수를 그대로 호출(`scratchpad smoke.ts`, 실행마다 임시 키, 합성 데이터만):

- 신청 → `PENDING_REVIEW` → 쓰기 403 `NOT_VERIFIED_REALTOR` → 관리자 승인 → `VERIFIED / FREE`
- 매물: 생성·조회(소유자 이름·전화 DTO 없음)·가격 수정·보관/복원·비공개 노트·B 조회/수정 404·`realtorId` 본문 무시·소유자 전화 암호문(`pii.v1.<keyId>.…`) + 64자 해시
- 고객: 생성·전화/이메일 암호문 + 조회 해시·행 어디에도 평문 없음·DTO에 연락처/암호문 없음·권한 있는 조회만 복호화·B 조회 404·수정·조건 세트·팔로업·대시보드 반영
- 매칭: 점수 93(신뢰도 SUFFICIENT) — 사유 `budget:MATCH, area:MATCH, moveIn:MATCH, commute:UNKNOWN, floor:MISS, parking:MATCH` (좌표 없는 통근 = 확인 필요, 분모 제외)
- 브리핑: 43자 토큰·DB에는 해시만·공개 뷰 OK·스냅샷에 메모/노트/연락처/소유자/전체 이름/예산 없음·공공 실거래 = `UNRESOLVED_IDENTITY`(가짜 거래 0)·한 글자 다른 토큰 NOT_FOUND·7일 만료 후 EXPIRED
- 회수: 즉시 REVOKED·B는 회수 불가(404)
- Free 한도: 활성 매물 10 허용·11번째 `PLAN_LIMIT` / 고객 5 허용·6번째 `PLAN_LIMIT` / 브리핑 하루 3·4번째 `PLAN_LIMIT`(회수된 것도 셈)
- 감사로그: 신청·상태변경·매물·고객·연락처 복호화·브리핑 생성/회수 전부 기록, 평문 전화/이메일·토큰·암호문 0
- Pro 테이블 전체 평문 스캔: 0행

## 5. 실제 앱(LIVE 모드) — API 라우트 + UI

로컬 `next dev`를 **`REALTOR_PRO_ENABLED=true` + 로컬 격리 DB + 로컬 전용 NEXTAUTH_SECRET·PII 키**로 실행. OAuth 대신 로컬 비밀로 서명한 테스트 세션 쿠키(중개사 A/B, 관리자) — 코드 우회 없음, 쿠키·비밀은 끝나고 삭제. `DATA_GO_KR_API_KEY` 미설정(MOLIT 0).

| 흐름 | 결과 |
|---|---|
| 익명 `/api/pro/me`, `/api/pro/listings` | 401 |
| 신청(API) → 승인 전 쓰기 | 403 `NOT_VERIFIED_REALTOR` |
| 비관리자 `/api/admin/pro/applications` | 403 · 관리자 목록·승인(PATCH) 성공 → A `VERIFIED/FREE` |
| UI: 매물 등록(단지 정보 미연결 배지) → 노트 → **연락처 보기**(이름·전화 복호화) | 성공 |
| UI: 고객 등록 → 조건 세트 → **맞는 매물 보기** → 일치도 82%(주차 필수가 hard 조건이라 93과 다름), 사유·"확인 필요" 통근·"단지 평가 점수가 아닙니다" 문구 | 성공 |
| UI: 팔로업 추가(10:00 KST → 01:00Z 저장) | 성공 |
| UI: 매칭 카드에서 **브리핑 만들기** → 링크 1회 표시 | 성공 |
| 익명(쿠키 삭제)으로 브리핑 열기 | 표시됨 · 외부 스크립트 0 · API 호출 0 · `noindex, nofollow, nocache` · `no-referrer` · canonical 없음 · 비공개 문자열 11종 0 |
| UI: 목록에서 **회수**(인라인 확인) → 같은 링크 | "만료되었거나 더 이상 볼 수 없는 브리핑입니다" |
| B 쿠키로 A의 매물 GET/PATCH/DELETE/연락처, 고객 GET/연락처/매칭, 브리핑 회수 | 전부 404 · B 목록 0건 |
| 교차 출처 / Origin 없음 / text/plain 쓰기 | 403 / 403 / 415 |
| A가 `realtorId·ownerPhoneEnc·deletedAt` 주입 | 무시(DB 확인: 소유자·암호문·삭제 상태 그대로) |
| A가 profile `status·plan·userId` 주입 | 400, 플랜 FREE 유지 |
| DB 확인(UI로 만든 데이터) | 고객 전화·이메일·소유자 전화 `pii.v1.localtest1.` + 해시 64 · 평문 0 · 브리핑 토큰 컬럼 없음(해시만) · 감사 meta는 필드 이름·상태 전이만 |

## 6. 모바일 (LIVE 모드, 실제 데이터 화면)

8개 경로 × 375/390 = 16회 측정(`/pro`, `/pro/dashboard`, `/pro/listings`, `/pro/listings/new`, `/pro/customers`, `/pro/customers/[id]`, `/pro/matches`, `/pro/briefings`): 가로 넘침 0 · 오류 0 · 하단 탭 가림 0 · 32px 미만 터치 목표 0(헤더 제외). 고객 상세 390px: 연락처 보기 버튼 302×44, 복호화 표시, 팔로업 완료/취소 노출.

측정 방법: Pro 응답은 frame 차단 헤더가 있어 iframe 측정을 위해 **측정 중에만** `next.config.ts`의 `/pro` 헤더 두 줄을 로컬에서 주석 처리하고 즉시 복원(diff 0 확인). 헤더는 레이아웃에 영향 없음.

## 7. 공개 화면 회귀 (route group 재구성 후) — 로컬

- `/`, `/map`, `/apt/[name]`, `/community`, `/privacy`, `/terms`, `/stats`, `/presales`, `/redevelopment`, `/ai-search`, `/my`, `/school`, `/report`, `/feedback`, `/tools`, `/api/search`: 200 · 모르는 URL 404 · `sitemap.xml`·`robots.txt`·`manifest.webmanifest`·`ads.txt` 200
- 홈(익명): AdSense 로드 · 방문 로그·하트비트 전송 · GA·위치 조회 코드 포함 · 네이버 소유확인 메타 · Kakao preconnect · 로그인 버튼 — Pro 전용 robots/referrer 메타 없음
- 빌드 라우트 표: 재구성 직후 빌드와 동일(ROUTES_IDENTICAL)
- **Preview에서의 공개 회귀는 미실시**(§1 사유)

## 8. 이번에 찾아 고친 것

| 문제 | 영향 | 수정 |
|---|---|---|
| 좌표 없는 통근지(현재 UI가 만드는 유일한 형태)가 매칭 사유에서 **조용히 사라짐** | "확인 필요"가 보이지 않음 | `matching.ts` — 이름만 있으면 `commute: UNKNOWN`(분모 제외, 점수 불변) + 테스트 |
| 브리핑 날짜가 **하루 앞당겨짐**(입력 KST 자정을 UTC로 잘라 표시: 12/1 → 11/30) | 고객에게 틀린 입주일 | `briefing.ts` — KST 달력으로 포맷(`ymdKst`) + 테스트 |
| 허용 필드 없는 매물 PATCH가 **소유자 본인에게 404** | 잘못된 오류(변경은 없었음) | `listing-service.ts` — 변경 없음이면 현재 행 반환 + 테스트 |

## 9. 알려진 한계 (현재 상태)

- **통근 조건 입력**: 이름만 입력 가능(지오코딩 없음) → 항상 "확인 필요"(점수 분모 제외)
- **학교 조건 입력**: UI에서 새로 지정 불가(기존 schoolIds 유지만) · 지정돼도 V1 매칭은 "확인 필요"(학교 거리 데이터 미연결)
- **결제**: 없음(관리자 수동 베타 Pro 부여만)
- **실제 중개사 인증**: 관리자 수동 확인만(자격번호 대조·공공 API 없음)
- **고객 메시지 발송**: 없음(문자·카카오·메일 0, 링크는 중개사가 직접 복사해 전달)
- 공공 데이터 연결: 테스트 DB에 단지 데이터가 없어 aptSeq 연결·실거래 표시는 로컬에서 검증 못 함(`UNRESOLVED_IDENTITY` 경로만 확인)
- 매칭 UI의 통근 사유가 "(확인 필요)"를 두 번 표시(문구 중복, 기능 영향 없음)
- 한도 경쟁 조건(동시 요청 시 1건 초과 가능)·복합 FK 보류·연락처 조회 속도 제한 인스턴스 로컬 — 이전 문서와 같음
- 모르는 URL의 404는 Next 기본 루트로 렌더(광고·GA 없음)

## 10. Production 승인 전 필요한 것

1. 격리 Preview DB 생성(§1) → 이 문서 §2–§7을 Preview에서 반복(push·Preview 배포·Preview 전용 키 `REALTOR_PRO_PII_KEY`·`REALTOR_PRO_PII_KEY_ID`·`REALTOR_PRO_LOOKUP_PEPPER`, 서버 전용)
2. Preview에서 공개 회귀(특히 DB·MOLIT 경로가 있는 화면은 Preview DB 연결 후)
3. Production migration 승인 — `REALTOR_PRO_MIGRATION_APPLY_PLAN.md`(기존 테이블 SQL 변경 0, 신규 10개)
4. Production 키 생성·보관·회전 책임자 지정
5. 법률 검토(약관·처리위탁·동의·브리핑 고지)
6. 기능 스위치 `REALTOR_PRO_ENABLED`는 Production에서 마지막에만

## 재현

- DB: `docker start ejip-pro-test-db`(데이터 보존) — 스크래치 `protest/`에 `rls-live.sql`, `smoke.ts`, `live-setup.mjs`, `call.sh`
- 테스트 데이터(로컬 DB에 남김): 중개사 A `테스트중개사`(VERIFIED/FREE), B, 관리자, 매물 1·고객 1·조건 1·팔로업 1·브리핑 2(1건 회수)
