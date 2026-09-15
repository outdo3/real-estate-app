-- USER_FEEDBACK_V1 — user_feedback 테이블 추가(additive only). docs/development/USER_FEEDBACK_V1.md
--
-- 기존 테이블·데이터·권한은 바꾸지 않는다. users FK 없음.
-- category/status는 PG enum이 아니라 TEXT + CHECK(허용 값은 src/lib/feedback/feedback-rules.ts와 같다).
--
-- 보안: Supabase public 스키마의 기본 권한(default ACL)은 새 테이블에 anon/authenticated/service_role 권한을 준다.
-- 같은 트랜잭션에서 그 권한을 전부 회수하고 RLS를 켠다(정책 0, FORCE OFF) — Batch A / post_images와 같은 상태.
-- 앱은 Prisma(테이블 소유자, BYPASSRLS)로만 접근하므로 동작 영향 없음. Data API는 OFF 유지.
--
-- 하나의 DO 블록: 전부 적용되거나 전혀 적용되지 않는다. lock_timeout은 트랜잭션 로컬.
-- API role이 없는 로컬/비-Supabase Postgres에서는 role revoke를 건너뛰고 RLS만 켠다.
DO $$
DECLARE
    api_roles CONSTANT TEXT[] := ARRAY['anon', 'authenticated', 'service_role'];
    r TEXT;
BEGIN
    PERFORM set_config('lock_timeout', '3s', true);

    CREATE TABLE "user_feedback" (
        "id" TEXT NOT NULL,
        "category" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'NEW',
        "user_id" TEXT,
        "page_path" TEXT,
        "page_query" TEXT,
        "apt_seq" TEXT,
        "apartment_name" TEXT,
        "lawd_cd" TEXT,
        "user_agent" TEXT,
        "ip_hash" TEXT,
        "notified_at" TIMESTAMP(3),
        "admin_note" TEXT,
        "resolved_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "user_feedback_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "user_feedback_category_check" CHECK ("category" IN ('BUG', 'DATA_ERROR', 'FEATURE_REQUEST', 'USABILITY', 'OTHER')),
        CONSTRAINT "user_feedback_status_check" CHECK ("status" IN ('NEW', 'REVIEWING', 'DONE'))
    );

    CREATE INDEX "user_feedback_status_created_at_idx" ON "user_feedback"("status", "created_at");
    CREATE INDEX "user_feedback_category_created_at_idx" ON "user_feedback"("category", "created_at");
    CREATE INDEX "user_feedback_user_id_created_at_idx" ON "user_feedback"("user_id", "created_at");
    CREATE INDEX "user_feedback_ip_hash_created_at_idx" ON "user_feedback"("ip_hash", "created_at");

    FOREACH r IN ARRAY api_roles LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('REVOKE ALL ON TABLE "user_feedback" FROM %I', r);
        END IF;
    END LOOP;

    ALTER TABLE "user_feedback" ENABLE ROW LEVEL SECURITY;
END
$$;
