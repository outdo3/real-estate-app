/**
 * CANCELLATION_RATCHET_DEFECT_A_REPAIR_AUDIT_V1 — 대조 범위 산정 (STRICT READ ONLY).
 * 취소가 1건 이상 있는 다형제 그룹 전체(전원취소 + 혼합)가 몇 개 셀에 걸쳐 있는지 센다.
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-cancel-ratchet-defect-a-scope.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
const prisma = new PrismaClient();
const G = `WITH g AS (
  SELECT group_key, deal_amount, deal_date, floor,
         COUNT(*)::int AS siblings, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled,
         MIN(lawd_cd) AS lawd_cd, MIN(deal_ymd) AS deal_ymd
  FROM apartment_trade_histories GROUP BY 1,2,3,4)`;
async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-cancel-ratchet-defect-a-scope.ts');
  const out: Record<string, unknown> = {};
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '180s'");
    out.any_canceled_multi = await tx.$queryRawUnsafe(`${G}
      SELECT COUNT(*)::int AS groups, SUM(siblings)::int AS rows,
             COUNT(DISTINCT lawd_cd || ':' || deal_ymd)::int AS cells
      FROM g WHERE siblings > 1 AND canceled > 0`);
    out.mixed_only = await tx.$queryRawUnsafe(`${G}
      SELECT COUNT(*)::int AS groups, SUM(siblings)::int AS rows,
             COUNT(DISTINCT lawd_cd || ':' || deal_ymd)::int AS cells
      FROM g WHERE siblings > 1 AND canceled > 0 AND canceled < siblings`);
    out.mixed_by_recency = await tx.$queryRawUnsafe(`${G}
      SELECT CASE WHEN deal_date >= CURRENT_DATE - INTERVAL '12 months' THEN 'last_12m'
                  WHEN deal_date >= CURRENT_DATE - INTERVAL '36 months' THEN 'm13_36' ELSE 'older' END AS bucket,
             COUNT(*)::int AS groups, COUNT(DISTINCT lawd_cd || ':' || deal_ymd)::int AS cells
      FROM g WHERE siblings > 1 AND canceled > 0 AND canceled < siblings GROUP BY 1 ORDER BY 1`);
  }, { timeout: 600_000 });
  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); }).finally(() => prisma.$disconnect());
