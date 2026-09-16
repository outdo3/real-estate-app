/** CANCELLATION_RATCHET_PREVENTION_FIX_V1 — cron 활성 여부 확인 (STRICT READ ONLY). */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
const prisma = new PrismaClient();
async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-cancel-reconcile-cronstate.ts');
  const out: Record<string, unknown> = {};
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
    out.coverage_recency = await tx.$queryRawUnsafe(`SELECT dataset, COUNT(*)::int AS cells, MAX(verified_at) AS newest, MIN(verified_at) AS oldest FROM sync_coverage_cells GROUP BY 1`);
    out.recent_runs = await tx.$queryRawUnsafe(`SELECT run_id, dataset, COUNT(*)::int AS cells, MAX(verified_at) AS at FROM sync_coverage_cells GROUP BY 1,2 ORDER BY at DESC LIMIT 8`);
    out.rows_touched_recently = await tx.$queryRawUnsafe(`SELECT DATE(source_fetched_at) AS day, COUNT(*)::int AS rows FROM apartment_trade_histories WHERE source_fetched_at >= NOW() - INTERVAL '10 days' GROUP BY 1 ORDER BY 1 DESC`);
  }, { timeout: 120_000 });
  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); }).finally(() => prisma.$disconnect());
