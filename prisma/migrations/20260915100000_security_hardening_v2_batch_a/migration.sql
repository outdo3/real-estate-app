-- SUPABASE_DB_SECURITY_HARDENING_V2 — PHASE 2 BATCH A (CRITICAL 7 tables only)
-- docs/development/SUPABASE_DB_SECURITY_HARDENING_V2.md
--
-- Scope: users, accounts, sessions, verification_tokens, favorites, recent_views, user_preferences.
-- For each: revoke every table privilege from anon / authenticated / service_role, then ENABLE ROW LEVEL SECURITY.
-- No policies, no FORCE ROW LEVEL SECURITY, no sequence / default-privilege / column / data changes.
--
-- Why this does not affect the app: every runtime path (Next.js, NextAuth PrismaAdapter, cron, scripts) connects
-- through Prisma as the table owner, which also has BYPASSRLS. The API roles cannot log in; only the (disabled)
-- Data API uses them. post_images / post_content_blocks already run in this state.
--
-- One statement: all checks and changes happen inside a single DO block, so it either fully applies or not at all.
-- lock_timeout is transaction-local (set_config(..., true)) and does not leak to pooled sessions; a busy table aborts the whole block.
-- Local / non-Supabase Postgres without the API roles: role revokes are skipped, RLS is still enabled.
DO $$
DECLARE
    target_tables CONSTANT TEXT[] := ARRAY['users', 'accounts', 'sessions', 'verification_tokens', 'favorites', 'recent_views', 'user_preferences'];
    api_roles CONSTANT TEXT[] := ARRAY['anon', 'authenticated', 'service_role'];
    t TEXT;
    r TEXT;
    tbl_owner TEXT;
BEGIN
    PERFORM set_config('lock_timeout', '3s', true);

    -- Preconditions: stop (and change nothing) if the ownership / bypass assumptions no longer hold.
    IF NOT (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION 'batch A aborted: migration role % cannot bypass RLS', current_user;
    END IF;
    FOREACH t IN ARRAY target_tables LOOP
        SELECT pg_get_userbyid(c.relowner) INTO tbl_owner
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r';
        IF tbl_owner IS NULL THEN
            RAISE EXCEPTION 'batch A aborted: table public.% not found', t;
        END IF;
        IF tbl_owner <> current_user THEN
            RAISE EXCEPTION 'batch A aborted: public.% is owned by %, not %', t, tbl_owner, current_user;
        END IF;
    END LOOP;

    FOREACH t IN ARRAY target_tables LOOP
        FOREACH r IN ARRAY api_roles LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
                EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', t, r);
            END IF;
        END LOOP;
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END
$$;
