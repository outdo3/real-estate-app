-- REALTOR_PRO_MVP_V1 — 중개사 Pro 테이블 10개 추가(additive only). docs/pro/REALTOR_PRO_MIGRATION_APPLY_PLAN.md
--
-- **이 파일은 적용되지 않았다.** Production 적용은 사용자 승인 후 docs/pro/REALTOR_PRO_MIGRATION_APPLY_PLAN.md 절차로만 한다.
--
-- 기존 테이블·데이터·권한은 바꾸지 않는다(새 FK 하나가 users(id)를 참조할 뿐 users 컬럼 변경 없음).
-- 상태값은 PG enum이 아니라 TEXT + CHECK(허용 값은 src/lib/pro/rules.ts와 같다 — pro-schema.test.ts가 고정).
--
-- 보안(Batch A / USER_FEEDBACK_V1 관행 + 소유자 정책):
--   · 새 테이블 전부 anon/authenticated/service_role 권한 REVOKE ALL + ENABLE ROW LEVEL SECURITY(FORCE 없음).
--   · 앱은 Prisma(테이블 소유자, BYPASSRLS)로만 접근한다 → 1차 통제는 앱 레이어의 realtor_id 조건(src/lib/pro/repo-prisma.ts).
--   · 심층 방어로 소유자 정책을 둔다: 비소유자 역할이 나중에 권한을 받더라도 트랜잭션마다
--     SET LOCAL app.realtor_id = '<realtor_profiles.id>' 로 지정한 중개사 행만 보이고, 쓰기는 VERIFIED 중개사만.
--     설정이 없으면 current_setting(..., true) = NULL → 어떤 행도 통과하지 않는다(익명 거부).
--   · realtor_audit_logs · realtor_profiles/subscriptions 쓰기에는 정책이 없다 = 비소유자 역할 전부 거부.
--
-- 하나의 DO 블록: 전부 적용되거나 전혀 적용되지 않는다. lock_timeout은 트랜잭션 로컬.
-- API role이 없는 로컬/비-Supabase Postgres에서는 role revoke를 건너뛰고 RLS·정책만 만든다.
DO $$
DECLARE
    api_roles CONSTANT TEXT[] := ARRAY['anon', 'authenticated', 'service_role'];
    pro_tables CONSTANT TEXT[] := ARRAY['realtor_profiles', 'realtor_subscriptions', 'realtor_listings', 'realtor_listing_notes', 'realtor_customers', 'realtor_customer_preferences', 'realtor_matches', 'realtor_followups', 'realtor_briefings', 'realtor_audit_logs'];
    r TEXT;
    t TEXT;
BEGIN
    PERFORM set_config('lock_timeout', '3s', true);

    -- 전제: 대상 테이블이 하나도 없어야 한다(재실행·부분 적용 방지). 있으면 아무것도 바꾸지 않고 중단.
    FOREACH t IN ARRAY pro_tables LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            RAISE EXCEPTION 'realtor pro migration aborted: table public.% already exists', t;
        END IF;
    END LOOP;

    -- CreateTable
    CREATE TABLE "realtor_profiles" (
        "id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "display_name" TEXT NOT NULL,
        "office_name" TEXT,
        "office_phone" TEXT,
        "office_address" TEXT,
        "logo_url" TEXT,
        "license_number_enc" TEXT,
        "office_reg_no_enc" TEXT,
        "business_reg_no_enc" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
        "status_reason" TEXT,
        "reviewed_by_user_id" TEXT,
        "reviewed_at" TIMESTAMP(3),
        "terms_agreed_at" TIMESTAMP(3) NOT NULL,
        "terms_version" TEXT NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "realtor_profiles_pkey" PRIMARY KEY ("id")
    );

    -- CreateTable
    CREATE TABLE "realtor_subscriptions" (
        "id" TEXT NOT NULL,
        "realtor_id" TEXT NOT NULL,
        "plan" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "current_period_start" TIMESTAMP(3) NOT NULL,
        "current_period_end" TIMESTAMP(3),
        "provider" TEXT,
        "provider_ref" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "realtor_subscriptions_pkey" PRIMARY KEY ("id")
    );

    -- CreateTable
    CREATE TABLE "realtor_listings" (
        "id" TEXT NOT NULL,
        "realtor_id" TEXT NOT NULL,
        "apt_seq" TEXT,
        "lawd_cd" TEXT,
        "umd_name" TEXT,
        "apt_name_snapshot" TEXT NOT NULL,
        "building_dong" TEXT,
        "unit_ho" TEXT,
        "floor" INTEGER,
        "floor_band" TEXT,
        "exclusive_area_m2" DECIMAL(65,30),
        "unit_type_ref" INTEGER,
        "deal_type" TEXT NOT NULL,
        "asking_price_manwon" INTEGER,
        "deposit_manwon" INTEGER,
        "monthly_rent_manwon" INTEGER,
        "owner_name" TEXT,
        "owner_phone_enc" TEXT,
        "owner_phone_hash" TEXT,
        "tenant_status" TEXT,
        "tenant_lease_ends_at" TIMESTAMP(3),
        "move_in_available_at" TIMESTAMP(3),
        "move_in_negotiable" BOOLEAN NOT NULL DEFAULT false,
        "repair_status" TEXT,
        "repair_note" TEXT,
        "parking_note" TEXT,
        "parking_available" BOOLEAN,
        "pet_allowed" BOOLEAN,
        "viewing_method" TEXT NOT NULL DEFAULT 'CONTACT_REALTOR',
        "viewing_note" TEXT,
        "source" TEXT,
        "memo" TEXT,
        "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "closed_at" TIMESTAMP(3),
        "price_changed_at" TIMESTAMP(3),
        "deleted_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "realtor_listings_pkey" PRIMARY KEY ("id")
    );

    -- CreateTable
    CREATE TABLE "realtor_listing_notes" (
        "id" TEXT NOT NULL,
        "realtor_id" TEXT NOT NULL,
        "listing_id" TEXT NOT NULL,
        "kind" TEXT NOT NULL,
        "body" TEXT,
        "prev_price_manwon" INTEGER,
        "new_price_manwon" INTEGER,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "realtor_listing_notes_pkey" PRIMARY KEY ("id")
    );

    -- CreateTable
    CREATE TABLE "realtor_customers" (
        "id" TEXT NOT NULL,
        "realtor_id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "phone_enc" TEXT,
        "phone_hash" TEXT,
        "email_enc" TEXT,
        "email_hash" TEXT,
        "status" TEXT NOT NULL DEFAULT 'NEW',
        "priority" INTEGER NOT NULL DEFAULT 2,
        "next_follow_up_at" TIMESTAMP(3),
        "memo" TEXT,
        "consent_status" TEXT NOT NULL DEFAULT 'NOT_RECORDED',
        "consent_recorded_at" TIMESTAMP(3),
        "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted_at" TIMESTAMP(3),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "realtor_customers_pkey" PRIMARY KEY ("id")
    );

    -- CreateTable
    CREATE TABLE "realtor_customer_preferences" (
        "id" TEXT NOT NULL,
        "realtor_id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "label" TEXT NOT NULL DEFAULT '기본',
        "deal_types" TEXT[],
        "budget_min_manwon" INTEGER,
        "budget_max_manwon" INTEGER,
        "budget_tolerance_pct" INTEGER NOT NULL DEFAULT 0,
        "monthly_rent_max_manwon" INTEGER,
        "lawd_cds" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "apt_seqs" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "area_min_m2" DECIMAL(65,30),
        "area_max_m2" DECIMAL(65,30),
        "move_in_target_at" TIMESTAMP(3),
        "commute_label" TEXT,
        "commute_lat" DOUBLE PRECISION,
        "commute_lng" DOUBLE PRECISION,
        "school_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
        "prefer_new_build" BOOLEAN,
        "parking_required" BOOLEAN,
        "floor_preference" TEXT,
        "pet_required" BOOLEAN,
        "must_have_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
        "special_conditions" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "realtor_customer_preferences_pkey" PRIMARY KEY ("id")
    );

    -- CreateTable
    CREATE TABLE "realtor_matches" (
        "id" TEXT NOT NULL,
        "realtor_id" TEXT NOT NULL,
        "customer_id" TEXT NOT NULL,
        "preference_id" TEXT NOT NULL,
        "listing_id" TEXT NOT NULL,
        "score" INTEGER,
        "confidence" TEXT NOT NULL,
        "passed_hard" BOOLEAN NOT NULL,
        "reasons" JSONB NOT NULL,
        "engine_version" TEXT NOT NULL,
        "input_hash" TEXT NOT NULL,
        "state" TEXT NOT NULL DEFAULT 'NEW',
        "computed_at" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "realtor_matches_pkey" PRIMARY KEY ("id")
    );

    -- CreateTable
    CREATE TABLE "realtor_followups" (
        "id" TEXT NOT NULL,
        "realtor_id" TEXT NOT NULL,
        "customer_id" TEXT,
        "listing_id" TEXT,
        "kind" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'OPEN',
        "due_at" TIMESTAMP(3) NOT NULL,
        "note" TEXT,
        "done_at" TIMESTAMP(3),
        "repeat_rule" TEXT,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,

        CONSTRAINT "realtor_followups_pkey" PRIMARY KEY ("id")
    );

    -- CreateTable
    CREATE TABLE "realtor_briefings" (
        "id" TEXT NOT NULL,
        "realtor_id" TEXT NOT NULL,
        "customer_id" TEXT,
        "listing_id" TEXT,
        "apt_seq" TEXT,
        "token_hash" TEXT NOT NULL,
        "snapshot" JSONB,
        "data_as_of" TIMESTAMP(3) NOT NULL,
        "expires_at" TIMESTAMP(3) NOT NULL,
        "revoked_at" TIMESTAMP(3),
        "first_viewed_at" TIMESTAMP(3),
        "view_count" INTEGER NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "realtor_briefings_pkey" PRIMARY KEY ("id")
    );

    -- CreateTable
    CREATE TABLE "realtor_audit_logs" (
        "id" TEXT NOT NULL,
        "actor_user_id" TEXT,
        "actor_role" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "target_type" TEXT NOT NULL,
        "target_id" TEXT,
        "realtor_id" TEXT,
        "reason" TEXT,
        "meta" JSONB,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

        CONSTRAINT "realtor_audit_logs_pkey" PRIMARY KEY ("id")
    );

    -- CreateIndex
    CREATE UNIQUE INDEX "realtor_profiles_user_id_key" ON "realtor_profiles"("user_id");

    -- CreateIndex
    CREATE INDEX "realtor_profiles_status_created_at_idx" ON "realtor_profiles"("status", "created_at");

    -- CreateIndex
    CREATE INDEX "realtor_subscriptions_realtor_id_status_idx" ON "realtor_subscriptions"("realtor_id", "status");

    -- CreateIndex
    CREATE INDEX "realtor_listings_realtor_id_is_active_updated_at_idx" ON "realtor_listings"("realtor_id", "is_active", "updated_at" DESC);

    -- CreateIndex
    CREATE INDEX "realtor_listings_realtor_id_apt_seq_idx" ON "realtor_listings"("realtor_id", "apt_seq");

    -- CreateIndex
    CREATE INDEX "realtor_listings_realtor_id_tenant_lease_ends_at_idx" ON "realtor_listings"("realtor_id", "tenant_lease_ends_at");

    -- CreateIndex
    CREATE INDEX "realtor_listing_notes_realtor_id_listing_id_created_at_idx" ON "realtor_listing_notes"("realtor_id", "listing_id", "created_at" DESC);

    -- CreateIndex
    CREATE INDEX "realtor_customers_realtor_id_status_priority_idx" ON "realtor_customers"("realtor_id", "status", "priority");

    -- CreateIndex
    CREATE INDEX "realtor_customers_realtor_id_next_follow_up_at_idx" ON "realtor_customers"("realtor_id", "next_follow_up_at");

    -- CreateIndex
    CREATE INDEX "realtor_customers_realtor_id_phone_hash_idx" ON "realtor_customers"("realtor_id", "phone_hash");

    -- CreateIndex
    CREATE INDEX "realtor_customer_preferences_realtor_id_customer_id_idx" ON "realtor_customer_preferences"("realtor_id", "customer_id");

    -- CreateIndex
    CREATE INDEX "realtor_matches_realtor_id_state_score_idx" ON "realtor_matches"("realtor_id", "state", "score" DESC);

    -- CreateIndex
    CREATE INDEX "realtor_matches_realtor_id_listing_id_idx" ON "realtor_matches"("realtor_id", "listing_id");

    -- CreateIndex
    CREATE UNIQUE INDEX "realtor_matches_preference_id_listing_id_key" ON "realtor_matches"("preference_id", "listing_id");

    -- CreateIndex
    CREATE INDEX "realtor_followups_realtor_id_status_due_at_idx" ON "realtor_followups"("realtor_id", "status", "due_at");

    -- CreateIndex
    CREATE INDEX "realtor_followups_realtor_id_customer_id_idx" ON "realtor_followups"("realtor_id", "customer_id");

    -- CreateIndex
    CREATE UNIQUE INDEX "realtor_briefings_token_hash_key" ON "realtor_briefings"("token_hash");

    -- CreateIndex
    CREATE INDEX "realtor_briefings_realtor_id_created_at_idx" ON "realtor_briefings"("realtor_id", "created_at" DESC);

    -- CreateIndex
    CREATE INDEX "realtor_briefings_expires_at_idx" ON "realtor_briefings"("expires_at");

    -- CreateIndex
    CREATE INDEX "realtor_audit_logs_realtor_id_created_at_idx" ON "realtor_audit_logs"("realtor_id", "created_at" DESC);

    -- CreateIndex
    CREATE INDEX "realtor_audit_logs_action_created_at_idx" ON "realtor_audit_logs"("action", "created_at");

    -- AddForeignKey
    ALTER TABLE "realtor_profiles" ADD CONSTRAINT "realtor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_subscriptions" ADD CONSTRAINT "realtor_subscriptions_realtor_id_fkey" FOREIGN KEY ("realtor_id") REFERENCES "realtor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_listings" ADD CONSTRAINT "realtor_listings_realtor_id_fkey" FOREIGN KEY ("realtor_id") REFERENCES "realtor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_listing_notes" ADD CONSTRAINT "realtor_listing_notes_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "realtor_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_customers" ADD CONSTRAINT "realtor_customers_realtor_id_fkey" FOREIGN KEY ("realtor_id") REFERENCES "realtor_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_customer_preferences" ADD CONSTRAINT "realtor_customer_preferences_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "realtor_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_matches" ADD CONSTRAINT "realtor_matches_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "realtor_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_matches" ADD CONSTRAINT "realtor_matches_preference_id_fkey" FOREIGN KEY ("preference_id") REFERENCES "realtor_customer_preferences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_matches" ADD CONSTRAINT "realtor_matches_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "realtor_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_followups" ADD CONSTRAINT "realtor_followups_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "realtor_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_followups" ADD CONSTRAINT "realtor_followups_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "realtor_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_briefings" ADD CONSTRAINT "realtor_briefings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "realtor_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    -- AddForeignKey
    ALTER TABLE "realtor_briefings" ADD CONSTRAINT "realtor_briefings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "realtor_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

    -- CHECK 제약(허용 값 = src/lib/pro/rules.ts)
    ALTER TABLE "realtor_profiles" ADD CONSTRAINT "realtor_profiles_status_check" CHECK ("status" IN ('PENDING_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'));
    ALTER TABLE "realtor_subscriptions" ADD CONSTRAINT "realtor_subscriptions_plan_check" CHECK ("plan" IN ('FREE', 'PRO'));
    ALTER TABLE "realtor_subscriptions" ADD CONSTRAINT "realtor_subscriptions_status_check" CHECK ("status" IN ('ACTIVE', 'BETA_GRANT', 'GRACE', 'CANCELED', 'EXPIRED'));
    ALTER TABLE "realtor_listings" ADD CONSTRAINT "realtor_listings_deal_type_check" CHECK ("deal_type" IN ('SALE', 'JEONSE', 'MONTHLY'));
    ALTER TABLE "realtor_listings" ADD CONSTRAINT "realtor_listings_floor_band_check" CHECK ("floor_band" IS NULL OR "floor_band" IN ('LOW', 'MID', 'HIGH'));
    ALTER TABLE "realtor_listings" ADD CONSTRAINT "realtor_listings_tenant_status_check" CHECK ("tenant_status" IS NULL OR "tenant_status" IN ('VACANT', 'OWNER_OCCUPIED', 'TENANTED'));
    ALTER TABLE "realtor_listings" ADD CONSTRAINT "realtor_listings_repair_status_check" CHECK ("repair_status" IS NULL OR "repair_status" IN ('ORIGINAL', 'PARTIAL', 'FULL'));
    ALTER TABLE "realtor_listings" ADD CONSTRAINT "realtor_listings_viewing_method_check" CHECK ("viewing_method" IN ('CONTACT_REALTOR', 'OWNER_PRESENT', 'TENANT_COORDINATION', 'VACANT_CONTACT_REALTOR'));
    ALTER TABLE "realtor_listings" ADD CONSTRAINT "realtor_listings_source_check" CHECK ("source" IS NULL OR "source" IN ('OWNER_DIRECT', 'CO_BROKER', 'WALK_IN', 'OTHER'));
    ALTER TABLE "realtor_listings" ADD CONSTRAINT "realtor_listings_prices_check" CHECK (COALESCE("asking_price_manwon", 0) >= 0 AND COALESCE("deposit_manwon", 0) >= 0 AND COALESCE("monthly_rent_manwon", 0) >= 0);
    ALTER TABLE "realtor_listings" ADD CONSTRAINT "realtor_listings_floor_check" CHECK ("floor" IS NULL OR "floor" BETWEEN -5 AND 200);
    ALTER TABLE "realtor_listing_notes" ADD CONSTRAINT "realtor_listing_notes_kind_check" CHECK ("kind" IN ('NOTE', 'PRICE_CHANGE', 'STATUS_CHANGE'));
    ALTER TABLE "realtor_customers" ADD CONSTRAINT "realtor_customers_status_check" CHECK ("status" IN ('NEW', 'ACTIVE', 'ON_HOLD', 'CONTRACTED', 'CLOSED'));
    ALTER TABLE "realtor_customers" ADD CONSTRAINT "realtor_customers_consent_status_check" CHECK ("consent_status" IN ('NOT_RECORDED', 'VERBAL', 'WRITTEN', 'WITHDRAWN'));
    ALTER TABLE "realtor_customers" ADD CONSTRAINT "realtor_customers_priority_check" CHECK ("priority" BETWEEN 1 AND 3);
    ALTER TABLE "realtor_customer_preferences" ADD CONSTRAINT "realtor_customer_preferences_tolerance_check" CHECK ("budget_tolerance_pct" BETWEEN 0 AND 10);
    ALTER TABLE "realtor_customer_preferences" ADD CONSTRAINT "realtor_customer_preferences_floor_check" CHECK ("floor_preference" IS NULL OR "floor_preference" IN ('LOW', 'MID', 'HIGH'));
    ALTER TABLE "realtor_matches" ADD CONSTRAINT "realtor_matches_state_check" CHECK ("state" IN ('NEW', 'SEEN', 'SHORTLISTED', 'DISMISSED'));
    ALTER TABLE "realtor_matches" ADD CONSTRAINT "realtor_matches_confidence_check" CHECK ("confidence" IN ('SUFFICIENT', 'INSUFFICIENT'));
    ALTER TABLE "realtor_matches" ADD CONSTRAINT "realtor_matches_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 100);
    ALTER TABLE "realtor_followups" ADD CONSTRAINT "realtor_followups_kind_check" CHECK ("kind" IN ('CALL', 'VIEWING', 'CONTRACT', 'MOVE_IN', 'OTHER'));
    ALTER TABLE "realtor_followups" ADD CONSTRAINT "realtor_followups_status_check" CHECK ("status" IN ('OPEN', 'DONE', 'CANCELED'));
    ALTER TABLE "realtor_followups" ADD CONSTRAINT "realtor_followups_repeat_rule_check" CHECK ("repeat_rule" IS NULL OR "repeat_rule" IN ('WEEKLY', 'MONTHLY'));
    ALTER TABLE "realtor_followups" ADD CONSTRAINT "realtor_followups_target_check" CHECK ("customer_id" IS NOT NULL OR "listing_id" IS NOT NULL);
    ALTER TABLE "realtor_audit_logs" ADD CONSTRAINT "realtor_audit_logs_actor_role_check" CHECK ("actor_role" IN ('REALTOR', 'ADMIN', 'SYSTEM'));
    ALTER TABLE "realtor_audit_logs" ADD CONSTRAINT "realtor_audit_logs_action_check" CHECK ("action" IN ('PROFILE_APPLIED', 'PROFILE_UPDATED', 'PROFILE_STATUS_CHANGE', 'PLAN_CHANGE', 'LISTING_CREATED', 'LISTING_UPDATED', 'LISTING_ARCHIVED', 'LISTING_DELETED', 'CUSTOMER_CREATED', 'CUSTOMER_VIEWED', 'CUSTOMER_UPDATED', 'CUSTOMER_DELETED', 'CONTACT_DECRYPTED', 'BRIEFING_CREATED', 'BRIEFING_SHARED', 'BRIEFING_REVOKED', 'EXPORT_REQUESTED'));

    -- API role 권한 회수 + RLS
    FOREACH t IN ARRAY pro_tables LOOP
        FOREACH r IN ARRAY api_roles LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', t, r);
            END IF;
        END LOOP;
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;

    -- 소유자 정책(심층 방어 — 앱 소유자 접속은 RLS 우회)
    CREATE POLICY "realtor_profiles_owner_select" ON "realtor_profiles" FOR SELECT USING ("id" = current_setting('app.realtor_id', true));
    CREATE POLICY "realtor_subscriptions_owner_select" ON "realtor_subscriptions" FOR SELECT USING ("realtor_id" = current_setting('app.realtor_id', true));
    CREATE POLICY "realtor_listings_owner_select" ON "realtor_listings" FOR SELECT USING ("realtor_id" = current_setting('app.realtor_id', true));
    CREATE POLICY "realtor_listings_owner_insert" ON "realtor_listings" FOR INSERT WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_listings_owner_update" ON "realtor_listings" FOR UPDATE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED')) WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_listings_owner_delete" ON "realtor_listings" FOR DELETE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_listing_notes_owner_select" ON "realtor_listing_notes" FOR SELECT USING ("realtor_id" = current_setting('app.realtor_id', true));
    CREATE POLICY "realtor_listing_notes_owner_insert" ON "realtor_listing_notes" FOR INSERT WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_listing_notes_owner_update" ON "realtor_listing_notes" FOR UPDATE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED')) WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_listing_notes_owner_delete" ON "realtor_listing_notes" FOR DELETE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_customers_owner_select" ON "realtor_customers" FOR SELECT USING ("realtor_id" = current_setting('app.realtor_id', true));
    CREATE POLICY "realtor_customers_owner_insert" ON "realtor_customers" FOR INSERT WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_customers_owner_update" ON "realtor_customers" FOR UPDATE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED')) WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_customers_owner_delete" ON "realtor_customers" FOR DELETE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_customer_preferences_owner_select" ON "realtor_customer_preferences" FOR SELECT USING ("realtor_id" = current_setting('app.realtor_id', true));
    CREATE POLICY "realtor_customer_preferences_owner_insert" ON "realtor_customer_preferences" FOR INSERT WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_customer_preferences_owner_update" ON "realtor_customer_preferences" FOR UPDATE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED')) WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_customer_preferences_owner_delete" ON "realtor_customer_preferences" FOR DELETE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_matches_owner_select" ON "realtor_matches" FOR SELECT USING ("realtor_id" = current_setting('app.realtor_id', true));
    CREATE POLICY "realtor_matches_owner_insert" ON "realtor_matches" FOR INSERT WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_matches_owner_update" ON "realtor_matches" FOR UPDATE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED')) WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_matches_owner_delete" ON "realtor_matches" FOR DELETE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_followups_owner_select" ON "realtor_followups" FOR SELECT USING ("realtor_id" = current_setting('app.realtor_id', true));
    CREATE POLICY "realtor_followups_owner_insert" ON "realtor_followups" FOR INSERT WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_followups_owner_update" ON "realtor_followups" FOR UPDATE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED')) WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_followups_owner_delete" ON "realtor_followups" FOR DELETE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_briefings_owner_select" ON "realtor_briefings" FOR SELECT USING ("realtor_id" = current_setting('app.realtor_id', true));
    CREATE POLICY "realtor_briefings_owner_insert" ON "realtor_briefings" FOR INSERT WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_briefings_owner_update" ON "realtor_briefings" FOR UPDATE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED')) WITH CHECK ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
    CREATE POLICY "realtor_briefings_owner_delete" ON "realtor_briefings" FOR DELETE USING ("realtor_id" = current_setting('app.realtor_id', true) AND EXISTS (SELECT 1 FROM "realtor_profiles" p WHERE p."id" = "realtor_id" AND p."status" = 'VERIFIED'));
END
$$;
