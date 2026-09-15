# SUPABASE DB SECURITY HARDENING V2 — PHASE 1 (읽기 전용 감사)

- 기준 HEAD: `213cd1d` (main), 감사 시각 2026-09-15T02:02–02:05Z
- 범위: public schema 앱 테이블의 API 역할(anon/authenticated/service_role) 권한·RLS 현황 감사 + PHASE 2 설계.
- **실제 변경 0**: GRANT/REVOKE/RLS/POLICY/migration/Data API/auth/bucket 무변경. 모든 DB 조회는 `SET TRANSACTION READ ONLY`(실측 `transaction_read_only=on`)에서 카탈로그만 읽었다(행 값 조회 없음).
- **판정: READY_FOR_HARDENING** — PHASE 2 적용은 배치별 사용자 승인 후에만.
- **PHASE 2 진행 상황**: Batch A **적용 완료**(2026-09-15 03:58Z, §12). Batch B / C1 / C2 미적용(승인 대기).

> 저장소가 공개(GitHub API 비인증 조회 HTTP 200)이므로, SUPABASE_DATA_API_DISABLE_V1과 같은 원칙으로
> **테이블별 현재 권한 행렬은 이 문서에 싣지 않는다.** 집계와 계획만 기록하고, 상세는 감사 스크립트로 운영자 터미널에서 재현한다.
> `ALLOW_PROD_DB_READ=1 npx tsx scripts/security/audit-db-grants-rls.ts [--json | --snapshot]`

## 1. 기준선(집계)

| 항목 | 결과 |
|---|---|
| Data API | `/rest/v1/` 키 없음 401, 서버 키 **503**, 대표 민감 테이블 6개 HEAD limit=0 **503**, `/graphql/v1` **503** (`pg_graphql` 미설치) |
| PostgREST | `authenticator` 역할 연결 2개가 여전히 붙어 있음 → 서비스는 살아 있고 **노출 schema 설정만 꺼진 상태**. 대시보드에서 다시 켜면 즉시 재노출 |
| public 테이블 | 43 (뷰·물질화 뷰·외부 테이블 0, 함수 0, 시퀀스 28, 정책 0) |
| RLS | 켜짐 2 / 꺼짐 41 / FORCE 0 |
| API 역할 광범위 grant | RLS 꺼진 41개 전부에 anon·authenticated가 SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER(=ALL) 보유 |
| 이미 정리된 테이블 | `post_images`, `post_content_blocks` — API 역할 grant 0 + RLS ON(정책 0) |
| 시퀀스 | 28개 전부 anon·authenticated USAGE/UPDATE |
| 근본 원인 | `pg_default_acl`: `postgres`·`supabase_admin`이 public에 만드는 **새 테이블/시퀀스/함수에 anon·authenticated·service_role 전 권한을 자동 부여**. Prisma migration으로 만든 테이블이 전부 이 기본값을 물려받았다 |
| schema USAGE | anon/authenticated/service_role 모두 public USAGE, CREATE 없음 |
| 다른 schema | auth 23·storage 8·realtime 3·vault 1 테이블 — Supabase 관리 영역, 이번 대상 아님 |

## 2. 앱·스크립트가 쓰는 DB 역할

| 경로 | 역할 | 근거 |
|---|---|---|
| Next.js 런타임(API route, NextAuth PrismaAdapter, admin, analytics, reports, map/stats) | `postgres` | `src/lib/prisma.ts` 단일 PrismaClient(`DATABASE_URL`, Supavisor pooler). 감사 시점 Supavisor 경유 client 연결의 역할이 **전부 `postgres`**(`pg_stat_activity`, 주소·쿼리 미출력) |
| cron(`/api/cron/*` → `src/lib/sync`) | `postgres` | 같은 Prisma 클라이언트 |
| migration(`prisma migrate`) | `postgres` | datasource에 `directUrl` 없음 → `DATABASE_URL` |
| TS scripts | `postgres` | 전부 `new PrismaClient()` + 루트 `.env`(`_prod-db-guard` 대상). 로컬 실행 결과 `current_user=postgres` |
| Storage API | `supabase_storage_admin`(Supabase 내부) | public schema와 무관 |
| Supabase Data API | `authenticator` → `anon`/`authenticated`/`service_role` SET ROLE | 현재 OFF |

`postgres`: 43개 테이블 **전부의 소유자**, `rolbypassrls = true`(superuser 아님).
`anon`·`authenticated`·`service_role`: `rolcanlogin = false` — 직접 DB 연결로는 이 역할을 쓸 수 없고 PostgREST가 SET ROLE할 때만 쓰인다.
→ **API 역할 grant 회수와 RLS(비-FORCE) 활성화는 소유자이자 BYPASSRLS인 `postgres` 연결(앱·cron·migration·scripts)에 영향을 주지 않는다.**
실증: `post_images`/`post_content_blocks`가 이미 이 상태로 Production에서 글 작성·사진·수정·삭제가 동작 중.

한계: Vercel의 `DATABASE_URL` 값 자체는 읽지 않았다(정책상 금지). 역할 판단은 연결 관측 + 코드 근거다. 설령 다른 역할이어도 로그인 가능한 역할이므로 API 역할 grant 회수의 영향 범위 밖이다.

## 3. Data API/REST 의존 스크립트

| 스크립트 | 용도 | 상태 |
|---|---|---|
| `scripts/crawl_facilities.py` | supabase-py로 `apartments` upsert(수동, 스케줄 없음, 서버 키) | **BROKEN**(쓰기 모드 — Data API OFF로 503). `--dry-run`은 DB 미사용이라 동작. 마지막 수정 커밋 `a98f7ba` |
| `scripts/audit-supabase-data-api-exposure.ts` | Data API OFF 확인(status만) | ACTIVE(진단, 데이터 의존 없음) |
| `scripts/community/audit-image-orphans.ts` | Data API status 출력 | ACTIVE(진단) |
| `scripts/security/audit-db-grants-rls.ts` | 이번 감사 | ACTIVE(진단) |

그 외 `@supabase/*` npm 의존성·`NEXT_PUBLIC_SUPABASE*`·Supabase Auth·RPC·Realtime·GraphQL 사용 0. src에 `/rest/v1` 호출 0.

## 4. 테이블 분류와 위험도

위험도 기준(요청 정의): CRITICAL = 인증/세션/사용자 비공개 + 광범위 grant + RLS OFF, HIGH = 사용자·커뮤니티·행동 로그 + 광범위 grant + RLS OFF,
MEDIUM = 앱에서 공개 조회하는 데이터지만 쓰기·TRUNCATE 권한 과다(무결성 위험), LOW = 이미 최소 권한.
Data API OFF는 완화 장치일 뿐 위험도를 낮추는 근거로 쓰지 않았다. "공개 조회"는 **앱 API를 통한** 공개이며 DB API 공개가 필요한 테이블은 없다.

| 위험 | 분류 | 테이블 | 근거 |
|---|---|---|---|
| CRITICAL | C USER_PRIVATE | `users` | 이메일·역할·차단 여부 |
| CRITICAL | B SERVER_ONLY(auth) | `accounts` | OAuth refresh/access/id token 컬럼 |
| CRITICAL | B SERVER_ONLY(auth) | `sessions`, `verification_tokens` | 세션 토큰·검증 토큰(JWT 세션 전략이지만 NextAuth adapter 테이블) |
| CRITICAL | C USER_PRIVATE | `favorites`, `recent_views`, `user_preferences` | 사용자별 관심·열람 이력·선호 |
| HIGH | A PUBLIC_READ(앱 경유) + 쓰기 | `posts`, `comments` | 앱에서 공개 조회, 작성자 id 연결, 변조·삭제 위험 |
| HIGH | D ADMIN_ONLY | `reports` | 신고자 id·사유 |
| HIGH | E SYSTEM(행동 로그) | `page_views`, `search_logs`, `active_sessions` | 세션 id·사용자 id·URL·검색어 |
| HIGH | E SYSTEM(운영 로그) | `error_logs` | 스택·URL(개인정보 포함 가능) |
| MEDIUM | E SYSTEM | `ai_search_cache` | 사용자 검색 원문 |
| MEDIUM | E SYSTEM | `sync_coverage_cells`, `_prisma_migrations` | 동기화 커버리지·migration 이력(TRUNCATE 시 운영 판단·배포 교란) |
| MEDIUM | A PUBLIC_READ(앱 경유) | `apartments`, `apartment_masters`, `apartment_unit_types`, `apartment_location_features`, `apartment_market_features`, `apartment_trade_histories`, `apartment_rent_histories`, `officetel_masters`, `officetel_trade_histories`, `officetel_rent_histories`, `presales`, `presale_house_type_details`, `redevelopment_projects`, `redevelopment_source_records`, `schools`, `school_stats`, `kindergartens`, `kindergarten_stats`, `childcares`, `childcare_stats`, `education_sources`, `properties` | 공공 원천 데이터·Unit Master·Score 입력. 공개 조회는 앱 API로만. 쓰기/TRUNCATE는 무결성(거래 진실성·Score) 위험 |
| MEDIUM | F REVIEW_REQUIRED(legacy) | `TradeHistory` | DB에만 있고 현재 `schema.prisma`에 모델 없음(0_baseline 생성). 코드 참조 0 |
| MEDIUM | F REVIEW_REQUIRED(legacy) | `Transaction` | 모델은 있으나 src 참조 0, 옛 `scripts/fetchData.ts` 등만 사용 |
| LOW | B SERVER_ONLY | `post_images`, `post_content_blocks` | 이미 API 역할 grant 0 + RLS ON |

집계: **CRITICAL 7 · HIGH 7 · MEDIUM 27 · LOW 2** (합 43).
행 수는 공개하지 않는다(`reltuples`는 ANALYZE 전 테이블에서 0으로 보여 실제 수와 다를 수 있음).

## 5. 권장 조치(테이블별 공통 목표 상태)

앱의 모든 DB 접근이 `postgres`(소유자·BYPASSRLS) Prisma 연결이고 API 역할을 쓰는 런타임 경로가 없으므로, 43개 모두 목표 상태가 같다.
다만 **한 번에 적용하지 않고** 배치별로 적용·검증·롤백 가능하게 나눈다(§7).

| 조치 | 대상 | 비고 |
|---|---|---|
| `REVOKE ALL ON TABLE t FROM anon, authenticated` | 41개 | 기존 migration(`post_images`)과 같은 역할 존재 확인 DO 블록 |
| `REVOKE ALL ON TABLE t FROM service_role` | CRITICAL·HIGH·SYSTEM 전부 | service_role은 BYPASSRLS라 grant가 유일한 장벽 |
| service_role 유지 여부 결정 | `apartments` | `crawl_facilities.py` 쓰기 경로를 Prisma로 옮기거나 폐기한다면 회수(권장). 결정 전에는 유지 가능 |
| `ALTER TABLE t ENABLE ROW LEVEL SECURITY` (정책 0, FORCE 안 함) | 41개 | Data API 재활성화 시 anon/authenticated 행 0. FORCE는 불필요(소유자 BYPASSRLS) |
| 정책 생성 | 없음 | NextAuth 사용자라 `auth.uid()` 기반 정책이 의미 없음(AUTH_MY_V1 MY-1A 결정과 동일) |
| `REVOKE ALL ON SEQUENCE s FROM anon, authenticated` | 28개 | UPDATE(setval) 권한 제거 |
| `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES/SEQUENCES/FUNCTIONS FROM anon, authenticated` | 기본 권한 | **재발 방지**. 미래 migration 테이블에만 영향. `supabase_admin` 기본값은 `postgres`가 바꿀 수 없음 → 새 테이블 migration은 계속 명시적 REVOKE + RLS 포함 |
| legacy 테이블 삭제 | 하지 않음 | `TradeHistory`·`Transaction`은 권한만 정리. 삭제는 별도 판단 |

## 6. 깨질 수 있는 경로 분석

| 영역 | DB 접근 경로(코드 근거) | 영향 |
|---|---|---|
| 웹 앱 전체 | `src/lib/prisma.ts` → `postgres` | 없음 |
| 인증 | `src/lib/auth.ts` `PrismaAdapter` + `strategy: 'jwt'` | 없음(같은 Prisma). OAuth 로그인은 수동 확인 필요 |
| 커뮤니티 | `api/community/posts*`, `post-write-db.ts` 트랜잭션 | 없음. 이미 `post_images`/`post_content_blocks`가 목표 상태로 동작 중 |
| 사진 업로드 | Storage REST(`/storage/v1`, service role 키) + `storage.objects` 읽기(`image-upload-usage-db.ts`) | 없음(storage schema·Storage API는 대상 아님) |
| cron/sync | `src/lib/sync/**` Prisma | 없음. 단 `ENABLE RLS`/`REVOKE`는 짧은 테이블 락 → cron 시간(19/21/23 UTC) 피해서 `lock_timeout` 설정 |
| admin/analytics/reports | `admin-analytics/query.ts`, `report/daily-read.ts` 등 `$queryRaw` | 없음(같은 연결) |
| map/stats/detail | `trade-history-read.ts`, `rent-history-read.ts`, `officetel/detail-read.ts`, `statistics-pyeong-resolver.ts` | 없음 |
| 에러 로그 수집 | `api/log/error` → `prisma.errorLog.create` | 없음 |
| TS scripts | PrismaClient(`postgres`) | 없음 |
| `crawl_facilities.py` | Data API(service_role) | 이미 BROKEN. `apartments` service_role 회수 시 Data API를 다시 켜도 계속 불가 |
| Supabase 대시보드 Table Editor/SQL Editor | 대시보드 권한(`postgres`/`supabase_admin`) | 없음 |
| 향후 Realtime/GraphQL/Data API 재사용 | API 역할 | 필요해지면 해당 테이블만 정책과 함께 설계 |

## 7. PHASE 2 변경 설계(배치)

각 배치 = 별도 migration 파일 1개(기존 `post_images` migration의 DO 블록 패턴) → 사용자 승인 → 적용 → smoke → 문제 시 즉시 롤백.
적용 전 스냅샷 SQL을 저장소 밖에 저장한다(§8). cron 시간과 겹치지 않게, `SET lock_timeout = '5s'`.

| 배치 | 테이블 | 이유 |
|---|---|---|
| **A** (가장 민감, 런타임 의존 가장 낮음) | `accounts`, `sessions`, `verification_tokens`, `users`, `favorites`, `recent_views`, `user_preferences` (7) | CRITICAL. 접근은 NextAuth adapter·MY API의 Prisma뿐 |
| **B** (커뮤니티·행동/운영 로그) | `posts`, `comments`, `reports`, `page_views`, `search_logs`, `active_sessions`, `error_logs`, `ai_search_cache` (8) | HIGH + 사용자 입력 원문 |
| **C1** (공개 조회 데이터) | §4 MEDIUM PUBLIC_READ 22개 | 가장 큰 테이블(`apartment_trade_histories` 등) 포함 → 락 시간 관찰. `apartments`의 service_role은 crawl 결정에 따름 |
| **C2** (시스템·legacy·재발 방지) | `_prisma_migrations`, `sync_coverage_cells`, `TradeHistory`, `Transaction` + 시퀀스 28 + 기본 권한 | migration 이력 테이블은 마지막에. 기본 권한 변경 후 다음 migration에서 새 테이블 grant 0 확인 |

## 8. 롤백 전략

- 적용 **직전** `--snapshot` 실행 → 현재 테이블 grant(API 역할)·RLS/FORCE 플래그·정책·시퀀스 grant·기본 권한을 재적용하는 SQL 생성(현재 575줄).
  출력은 `BEGIN; … ROLLBACK;`으로 감싸 실수 실행해도 커밋되지 않게 했다. 저장소 밖(비공개 위치)에 보관.
- 롤백 = 스냅샷에서 해당 배치 테이블 구간만 골라 `ROLLBACK;`을 `COMMIT;`으로 바꿔 실행(사용자 승인).
- `supabase_admin` 기본 권한 줄은 `postgres`로 실행 불가라 주석 처리돼 있다(변경도 하지 않으므로 롤백 불필요).
- 이번 PHASE에서 스냅샷을 **실행하지 않았다**(생성·검토만).

## 9. 적용 후 검증 계획(배치마다)

1. 감사 스크립트 재실행: 해당 테이블 anon/authenticated(필요 시 service_role) 권한 false, RLS true, 나머지 테이블 불변.
2. Prisma: 읽기(count/find) + 쓰기 경로를 **롤백 트랜잭션**으로 확인(`verify-content-block-constraints.ts` 패턴).
3. Production smoke(비로그인): 홈, `/community`, `/api/community/posts`, 게시글 상세 API, 통계, 단지 상세, 지도 마커, 갭투자, 시설, NextAuth providers/csrf/session → 200 유지.
4. 로그인 필요(사용자 수동): OAuth 로그인, MY(관심/최근/선호), 글·댓글 작성·수정·삭제, 사진 업로드, 관리자 대시보드·사용자 목록·신고.
5. cron: 무인증 401 유지 + 다음 정기 실행 결과 정상(sync 로그·커버리지).
6. 리포트·error log 수집(`/api/log/error`).
7. Data API `/rest/v1/`·민감 테이블·`/graphql/v1` 503 유지.
8. Storage: 사진 표시·업로드 한도 조회 정상.

## 10. 알려진 한계

- PostgREST 자체는 연결돼 있어 Data API 토글을 켜면 즉시 재노출된다 — PHASE 2 완료 전에는 켜지 말 것.
- Vercel `DATABASE_URL`의 역할은 직접 확인하지 않았다(§2 근거로 판단).
- `supabase_admin`의 기본 권한은 앱 역할로 바꿀 수 없다.
- `auth`/`storage`/`realtime`/`vault` schema는 감사 범위 밖.

## 11. 산출물

- `scripts/security/audit-db-grants-rls.ts` — 읽기 전용 감사(요약 표 / `--json` / `--snapshot`). `_prod-db-guard` DIAGNOSTIC.
- 검증: `npx eslint` exit 0, `npx tsc --noEmit` FAIL_EXISTING_SCRIPT_ERRORS(기존 25건, 이 파일 0). 앱 코드 변경 없음 → build 생략.

## 12. PHASE 2 — Batch A 적용 결과 (2026-09-15)

- 승인: 사용자 "PHASE 2 — BATCH A … PRODUCTION PERMISSION HARDENING APPROVED" (범위: CRITICAL 7개 테이블만)
- 대상: `users`, `accounts`, `sessions`, `verification_tokens`, `favorites`, `recent_views`, `user_preferences`
- migration: `prisma/migrations/20260915100000_security_hardening_v2_batch_a/migration.sql` — `prisma migrate deploy` 1회(03:58:40Z, exit 0, `applied_steps_count` 1, rolled_back 없음)

### 적용 방식
- 단일 `DO` 블록: 사전 조건(적용 역할이 RLS 우회 가능, 7개 테이블 존재·소유자 = 적용 역할) 불만족 시 예외로 **아무것도 바꾸지 않고** 중단.
- 7개 × anon/authenticated/service_role `REVOKE ALL PRIVILEGES`, `ENABLE ROW LEVEL SECURITY`. 정책·FORCE·GRANT·시퀀스·기본 권한·데이터 변경 없음.
- `lock_timeout` 3s(트랜잭션 로컬). 적용 직전 5초 이상 열린 트랜잭션 0, 대상 테이블 잠금 0, cron 시간대 아님. 대상 테이블 권한 부여자는 전부 소유자(= REVOKE로 제거 가능) 확인.
- 적용 전 migration 대기 목록이 이 1건뿐임을 `migrate status`로 확인.
- 적용 직전 상태 스냅샷(JSON)과 Batch A 롤백 SQL을 **저장소 밖**에 저장(공개 저장소에 커밋하지 않음).

### 검증 (적용 전·후 동일 절차)

| 항목 | 결과 |
|---|---|
| 카탈로그 비교(`verify-hardening-batch.ts --batch=A`) | **PASS** — 대상 7개: API 역할 권한 0, RLS on, FORCE off, 정책 0, 소유자 불변, 소유자 ACL 불변 / 나머지 36개 관계·ACL·정책·시퀀스 ACL·기본 권한 **변화 없음** |
| 집계 | RLS 켜짐 2 → **9** / 43, FORCE 0, 정책 0 |
| Prisma(앱 경로) 읽기 + 롤백 쓰기(`verify-prisma-batch-a.ts`) | 전 10/10 → 후 **10/10** (7개 테이블 count·조회, QA 사용자와 연결 행 생성·수정·upsert·삭제 11단계 후 롤백, count 동일, 잔여 0) |
| Production smoke 34건(홈·지도·통계·커뮤니티 목록/상세·MY·도구·분양·재개발·학교·단지 상세·리포트 3·관리자 페이지, NextAuth session/providers/csrf/signin, 커뮤니티 API, MY API 3(비로그인 401), 관리자 API 3(401), 단지·통계·검색·분양 API, cron 401, 사진 업로드 비로그인 401) | 적용 전후 **상태 코드·응답 크기 전부 동일** |
| 적용 후 error_logs | 적용 이후 0건(권한 오류 0) — 적용 직후 트래픽이 적어 약한 신호 |
| Data API | `/rest/v1/` 503, 민감 테이블 6개 503, `/graphql/v1` 503 |
| migration 상태 | `Database schema is up to date` |

### 롤백
필요 시 저장소 밖에 보관한 Batch A 롤백 SQL(적용 직전 스냅샷에서 생성, `BEGIN … ROLLBACK`으로 감쌈)을 검토 후 `COMMIT`으로 바꿔 실행한다.
추측 SQL로 복구하지 않는다. 현재 롤백 조건(세션/OAuth 오류, 권한 오류, MY 오류, 예상 밖 500, 무관 테이블 변경, 부분 적용) **해당 없음**.

### 사용자 기기 QA 필요
1. Google 로그인 2. Kakao 로그인 3. MY 페이지 4. 관심 단지(추가·삭제) 5. 최근 본 단지 6. 사용자 설정(목적 선택) 7. 커뮤니티 진입(로그인 상태)
Naver 로그인은 별도 LIMITED 상태라 Batch A 판정에 포함하지 않는다.

### 산출물(이번 배치)
- `scripts/security/hardening-batches.ts` — 배치 정의, 적용 전/후 비교, migration 정적 검사(순수 함수)
- `scripts/security/hardening-batches.test.ts` — 7개 테스트
- `scripts/security/verify-hardening-batch.ts` — before/after JSON 비교 CLI
- `scripts/security/verify-prisma-batch-a.ts` — Prisma 읽기 + 롤백 쓰기 확인
- `scripts/security/audit-db-grants-rls.ts` — `--snapshot --tables=` 추가

### Batch B 권고
Batch A와 같은 패턴(단일 DO 블록 + 사전 조건 + 저장소 밖 스냅샷 + 전후 비교 + Prisma 롤백 쓰기 + smoke)으로 진행 가능.
대상 8개 중 `page_views`·`active_sessions`·`search_logs`·`error_logs`는 비로그인 요청마다 쓰이는 로그 테이블이라, 적용 후 `/api/log/*` 쓰기 경로를
롤백 트랜잭션으로 확인하고 적용 직후 error_logs 증가 여부를 관찰하는 항목을 추가한다. Batch A 기기 QA 확인 후 승인 요청 권장.

