-- PERFORMANCE_V1_1_A — CONCURRENTLY avoids taking a SHARE lock on this
-- 855k+ row production table, which would otherwise block concurrent
-- writes (the incremental trade sync) for the duration of the index build.
-- Prisma Migrate detects CONCURRENTLY and runs this migration outside a
-- transaction (required — CREATE INDEX CONCURRENTLY cannot run inside one).
-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "apartment_trade_histories_lawd_cd_exclusive_area_deal_date_idx" ON "apartment_trade_histories"("lawd_cd", "exclusive_area", "deal_date");
