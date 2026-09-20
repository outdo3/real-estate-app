/**
 * POST_CANCELLATION_VALIDATION_PUSH_DEPLOY_V1 §11·§12·§13 — 배포 후 안전 확인 (STRICT READ ONLY).
 *
 * `SET TRANSACTION READ ONLY` 트랜잭션에서 SELECT/집계만. INSERT/UPDATE/DELETE 0. 외부 API 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-post-deploy-safety-v1.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';

const prisma = new PrismaClient();

/** 확정 false-cancel 28행 = REPAIR_AUDIT_V1 21 + GATE_V1 §5 신규 7. */
const KNOWN28 = [940779, 940906, 949472, 949523, 949532, 949575, 949624, 949692,
  949727, 949910, 949929, 949991, 950026, 950082, 950183, 950194,
  950239, 950382, 950395, 950396, 950451,
  950598, 950570, 950590, 950664, 950722, 950723, 950736];

const G = `WITH g AS (
  SELECT group_key, deal_amount, deal_date, floor,
         COUNT(*)::int AS siblings, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
  FROM apartment_trade_histories GROUP BY 1,2,3,4)`;

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-post-deploy-safety-v1.ts');
  const out: Record<string, unknown> = { checkedAt: new Date().toISOString(), readOnly: true };

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '300s'");

    // §15 — 시도별 ApartmentMaster 수.
    out.master_by_sido = await tx.$queryRawUnsafe(
      `SELECT sido, COUNT(*)::int AS n FROM apartment_masters GROUP BY 1 ORDER BY n DESC`);

    // §11 — 서울 실거래가 한 건이라도 적재됐는가(Seoul sale apply = 0이어야 한다).
    out.seoul_trade_rows = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM apartment_trade_histories WHERE lawd_cd LIKE '11%'`);
    out.trade_rows_by_sido_prefix = await tx.$queryRawUnsafe(
      `SELECT LEFT(lawd_cd, 2) AS sido, COUNT(*)::int AS n
       FROM apartment_trade_histories GROUP BY 1 ORDER BY n DESC`);

    // §11 — 서울 coverage cell(= cron이 서울을 수집했는가).
    out.seoul_coverage_cells = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM sync_coverage_cells WHERE lawd_cd LIKE '11%'`);

    // §12·§17 — 확정 28행 불변.
    out.known28 = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS still_canceled,
              COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS restored,
              MAX(updated_at) AS newest_update, MAX(source_fetched_at) AS newest_source_fetch
       FROM apartment_trade_histories WHERE id IN (${KNOWN28.join(',')})`);

    // §13 — 다음 cron 검증용 baseline.
    out.baseline = await tx.$queryRawUnsafe(`${G}
      SELECT COUNT(*) FILTER (WHERE siblings > 1 AND canceled = siblings)::int AS all_canceled_groups,
             COALESCE(SUM(siblings - 1) FILTER (WHERE siblings > 1 AND canceled = siblings), 0)::int AS suspect_upper_bound
      FROM g`);
    out.totals = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total_rows,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled,
              COUNT(DISTINCT lawd_cd)::int AS districts FROM apartment_trade_histories`);

    // §13 — 최신 cron 실행(다음 실행이 이 배포 이후인지 비교할 기준).
    out.latest_runs = await tx.$queryRawUnsafe(
      `SELECT run_id, dataset, COUNT(*)::int AS cells, MAX(verified_at) AS ended
       FROM sync_coverage_cells GROUP BY 1,2 ORDER BY ended DESC LIMIT 4`);

    // §14 — 배포 시각 이후 쓰기가 없어야 한다.
    out.rows_written_since_deploy = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM apartment_trade_histories
       WHERE source_fetched_at > $1::timestamp OR created_at > $1::timestamp`, '2026-09-20T01:25:52Z');
    out.error_logs_since_deploy = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM error_logs WHERE created_at > $1::timestamp`, '2026-09-20T01:25:52Z');
  }, { timeout: 600_000 });

  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); }).finally(() => prisma.$disconnect());
