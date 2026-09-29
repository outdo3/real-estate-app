# REALTOR PRO — Migration 적용 계획 (Phase 20)

> **PRODUCTION_MIGRATION_APPLIED = NO.** 이 문서는 계획이다. 실행은 사용자 승인 후에만.
> 로컬 검증: 실제 migration 파일을 **메모리 내장 Postgres(PGlite 0.2.17, 네트워크·실DB 없음)**에 적용해 확인(아래 §6).

## 1. 대상 파일

| 파일 | 내용 |
|---|---|
| `prisma/migrations/20260930090000_realtor_pro_mvp_v1/migration.sql` | 한 DO 블록: 전제(10개 테이블 모두 없어야 함) → CREATE TABLE 10 · INDEX 18 · UNIQUE INDEX 3 · FK 13 → CHECK 26 → API role REVOKE → RLS ENABLE → 소유자 정책 30 |
| `prisma/schema.prisma` | Pro 모델 10개 + `User.realtorProfile` relation(컬럼 변경 없음) |

## 2. 생성 테이블

`realtor_profiles`, `realtor_subscriptions`, `realtor_listings`, `realtor_listing_notes`, `realtor_customers`, `realtor_customer_preferences`, `realtor_matches`, `realtor_followups`, `realtor_briefings`, `realtor_audit_logs`.

주요 인덱스: 전부 `(realtor_id, …)` 선두 복합(`realtor_listings(realtor_id, is_active, updated_at desc)`, `realtor_customers(realtor_id, status, priority)`, `realtor_followups(realtor_id, status, due_at)` 등), `realtor_profiles.user_id` unique, `realtor_briefings.token_hash` unique, `realtor_matches(preference_id, listing_id)` unique.

FK: `realtor_profiles.user_id → users.id ON DELETE CASCADE`(기존 `users` 컬럼 변경 없음), 나머지는 `realtor_*` 사이(cascade, 브리핑의 고객/매물 참조는 SET NULL).

## 3. RLS

- 10개 테이블 모두 `ENABLE ROW LEVEL SECURITY`(FORCE 없음 — 앱의 Prisma 소유자 접속은 기존처럼 RLS 우회).
- anon/authenticated/service_role: `REVOKE ALL`(Supabase role이 없는 Postgres에서는 건너뜀).
- 소유자 정책(심층 방어): 7개 소유 테이블 × SELECT/INSERT/UPDATE/DELETE = 28 + profiles SELECT + subscriptions SELECT. 조건 `realtor_id = current_setting('app.realtor_id', true)`, 쓰기는 해당 중개사 `status = 'VERIFIED'`일 때만. `realtor_audit_logs`에는 정책 없음(비소유자 전면 거부).
- **1차 통제는 앱 레이어**(`repo-prisma.ts`의 모든 where에 realtorId) — 테스트로 고정.

## 4. 적용 전 점검 (Preflight, 읽기 전용)

```sql
-- 1) 대상 테이블이 없어야 한다(있으면 migration이 스스로 중단한다)
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'realtor_%';
-- 2) migration 역할이 RLS 우회 가능(앱과 같은 소유자)
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user;
-- 3) users.id 타입(text) 확인
SELECT data_type FROM information_schema.columns WHERE table_name='users' AND column_name='id';
-- 4) 적용 이력에 같은 이름이 없는지
SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name LIKE '20260930090000%';
-- 5) DB 건강: 대기·idle in tx·장시간 쿼리 없음, 연결 여유
SELECT count(*) total, count(*) FILTER (WHERE state LIKE 'idle in transaction%') idle_tx,
       count(*) FILTER (WHERE wait_event IS NOT NULL AND state='active') waiting FROM pg_stat_activity;
```

준비 확인: Supabase 대시보드 백업(PITR/일일 백업) 시점 확인, 크론 시간대(19:00Z–01:00Z) 회피, 동시 배포 없음.

## 5. 적용 절차 (승인 후)

1. 브랜치 `realtor-pro-mvp-overnight-v1`를 main에 병합하기 **전에** DB migration만 먼저 적용해도 앱 영향 없음(기존 read path는 `realtor_*`를 읽지 않음). 단 main 배포 후에도 `REALTOR_PRO_ENABLED`가 꺼져 있으면 Pro는 비공개.
2. 명령(사용자 터미널 `!`로 실행 — DATABASE_URL은 출력하지 않음):
   ```
   npx prisma migrate deploy
   ```
   (이 저장소는 `migrate deploy` 관행 — build가 migration을 자동 적용하지 않음)
3. 적용 실패 시 DO 블록 전체가 롤백되어 부분 적용이 남지 않는다(`lock_timeout 3s` 포함).

## 6. 적용 후 검증

```sql
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'realtor_%' ORDER BY 1;         -- 10행, 전부 true
SELECT count(*) FROM pg_policies WHERE tablename LIKE 'realtor_%';                              -- 30
SELECT count(*) FROM pg_constraint WHERE contype='c' AND conrelid::regclass::text LIKE 'realtor_%'; -- 26
SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid::regclass::text LIKE 'realtor_%'; -- 13
SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_name LIKE 'realtor_%' AND grantee IN ('anon','authenticated','service_role');      -- 0행
```

로컬 사전 검증 결과(2026-09-30, PGlite 메모리 DB, 실제 migration 파일):

| 항목 | 결과 |
|---|---|
| 적용 | 성공 · 10개 테이블 전부 RLS |
| 정책 / CHECK / FK | 30 / 26 / 13 |
| 재실행 | 중단("already exists") — 부분 변경 없음 |
| CHECK | 잘못된 거래유형·우선순위·감사 action·대상 없는 팔로업 거부 |
| cascade | users 삭제 → 해당 중개사 고객 삭제 |
| 비소유자 역할(설정 없음) | 0행 |
| 중개사 A 설정 | 자기 매물·고객만 보임, B 행 수정·삭제 0행, B로 insert 거부, 자기 insert 성공 |
| 정지 중개사 | 자기 행 읽기 가능, insert 거부, update 0행 |
| 감사로그 | 비소유자 읽기 0행, insert 거부 |

## 7. 스모크 테스트 (적용 후, Preview에서 먼저)

1. Preview에 `REALTOR_PRO_ENABLED=true`, `REALTOR_PRO_PII_KEY`, `REALTOR_PRO_LOOKUP_PEPPER`(Preview 전용 값) 설정 — **별도 승인**.
2. 테스트 계정으로 `/pro` 신청 → 관리자 `/admin/pro` 승인 → 매물 1 · 고객 1(합성 연락처) · 매칭 · 브리핑 생성 → `/b/<token>` 열람 → 회수 후 재열람 거부.
3. DB 읽기 확인: `realtor_customers.phone_enc`가 `pii.v1.`로 시작하고 평문 없음, `realtor_audit_logs`에 연락처·메모 없음.
4. Production은 `REALTOR_PRO_ENABLED` 꺼진 상태 유지(별도 승인 전까지).

## 8. 롤백

- 데이터가 없을 때: 아래를 한 트랜잭션으로(승인 후).
  ```sql
  BEGIN;
  DROP TABLE realtor_audit_logs, realtor_briefings, realtor_followups, realtor_matches, realtor_customer_preferences,
             realtor_customers, realtor_listing_notes, realtor_listings, realtor_subscriptions, realtor_profiles;
  DELETE FROM _prisma_migrations WHERE migration_name = '20260930090000_realtor_pro_mvp_v1';
  COMMIT;
  ```
- 데이터가 있을 때: 먼저 기능 스위치(`REALTOR_PRO_ENABLED=false`)로 차단 → 필요 시 내보내기 → drop. 기존 테이블·데이터는 영향 없음(신규 테이블만).
- 코드 롤백은 revert 커밋(히스토리 보존).
