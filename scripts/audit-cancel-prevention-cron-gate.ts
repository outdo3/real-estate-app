/**
 * CANCELLATION_PREVENTION_CRON_VALIDATION_GATE_V1 — 배포 후 cron 검증 (STRICT READ ONLY).
 *
 * `SET TRANSACTION READ ONLY` 트랜잭션에서 SELECT/집계만. INSERT/UPDATE/DELETE 0.
 * 외부 API 0(원천 대조는 별도 스크립트가 맡는다).
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-cancel-prevention-cron-gate.ts <deployIsoUtc>
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
         COUNT(*)::int AS siblings, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
  FROM apartment_trade_histories GROUP BY 1,2,3,4)`;

/** REPAIR_AUDIT_V1이 확정한 21행. 이 STEP에서 변해 있으면 안 된다. */
const TARGET_IDS = [940779, 940906, 949472, 949523, 949532, 949575, 949624, 949692,
  949727, 949910, 949929, 949991, 950026, 950082, 950183, 950194,
  950239, 950382, 950395, 950396, 950451];

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-cancel-prevention-cron-gate.ts');
  const deploy = process.argv[2] ?? '2026-09-16T03:28:00Z';
  const out: Record<string, unknown> = { checkedAt: new Date().toISOString(), deployAtUtc: deploy, readOnly: true };

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '180s'");

    // §2 — 배포 이후 cron이 돌았는가.
    out.runs_since_deploy = await tx.$queryRawUnsafe(
      `SELECT run_id, dataset, COUNT(*)::int AS cells, MIN(verified_at) AS started, MAX(verified_at) AS ended
       FROM sync_coverage_cells WHERE verified_at > $1::timestamp GROUP BY 1,2 ORDER BY ended DESC`, deploy);
    out.latest_runs_any = await tx.$queryRawUnsafe(
      `SELECT run_id, dataset, COUNT(*)::int AS cells, MAX(verified_at) AS ended
       FROM sync_coverage_cells GROUP BY 1,2 ORDER BY ended DESC LIMIT 6`);
    out.rows_written_since_deploy = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS rows FROM apartment_trade_histories WHERE source_fetched_at > $1::timestamp`, deploy);

    // §5 — 확정 21행 상태.
    out.target_rows = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS still_canceled,
              COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS restored,
              COUNT(*) FILTER (WHERE cancel_date IS NOT NULL)::int AS has_cancel_date,
              COUNT(*) FILTER (WHERE registry_date IS NOT NULL)::int AS has_registry_date,
              MAX(source_fetched_at) AS newest_source_fetch,
              MAX(updated_at) AS newest_update
       FROM apartment_trade_histories WHERE id IN (${TARGET_IDS.join(',')})`);

    // §6 — 상한선 추세 + §10 totals.
    out.upper_bound = await tx.$queryRawUnsafe(`${G}
      SELECT COUNT(*) FILTER (WHERE siblings > 1)::int AS multi_sibling_groups,
             COUNT(*) FILTER (WHERE siblings > 1 AND canceled = siblings)::int AS all_canceled_groups,
             COALESCE(SUM(siblings - 1) FILTER (WHERE siblings > 1 AND canceled = siblings), 0)::int AS suspect_upper_bound
      FROM g`);
    out.totals = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total_rows,
              COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS active,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled,
              COUNT(DISTINCT lawd_cd)::int AS districts
       FROM apartment_trade_histories`);
    out.natural_key_duplicates = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM (SELECT group_key, deal_amount, deal_date, floor, occurrence_index
       FROM apartment_trade_histories GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1) d`);

    // §6 — 배포 이후 새로 생긴 전원취소 그룹(신규 false-cancel 후보)이 있는가.
    out.all_canceled_groups_touched_since_deploy = await tx.$queryRawUnsafe(`${G}
      SELECT COUNT(*)::int AS groups
      FROM g JOIN apartment_trade_histories t
        ON t.group_key = g.group_key AND t.deal_amount = g.deal_amount
       AND t.deal_date = g.deal_date AND t.floor IS NOT DISTINCT FROM g.floor
      WHERE g.siblings > 1 AND g.canceled = g.siblings AND t.source_fetched_at > $1::timestamp`, deploy);

    // §9 — 오류 로그.
    out.error_logs = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n, MAX(created_at) AS newest FROM error_logs WHERE created_at > $1::timestamp`, deploy);
    out.error_logs_recent_any = await tx.$queryRawUnsafe(
      `SELECT created_at, LEFT(message, 90) AS msg FROM error_logs ORDER BY created_at DESC LIMIT 3`);
  }, { timeout: 600_000 });

  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); }).finally(() => prisma.$disconnect());
