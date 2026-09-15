-- PERSONALIZED_SCORE_V1 P2-A — user_preferences.fit_importance (nullable JSONB, no default).
-- docs/development/PERSONALIZED_SCORE_V1.md
--
-- Additive only: one nullable column. Existing rows keep their purposes and get NULL (= not configured).
-- No default, no backfill, no change to purposes, grants, RLS or policies. Adding a column does not grant
-- any privilege: the table keeps the Batch A state (no API-role privileges, RLS on, no policies).
-- lock_timeout is transaction-local so a busy table aborts the statement instead of queueing behind it.
DO $$
BEGIN
    PERFORM set_config('lock_timeout', '3s', true);
    ALTER TABLE "user_preferences" ADD COLUMN "fit_importance" JSONB;
END
$$;
