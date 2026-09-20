/**
 * CANCELLATION_CRON_VALIDATION_AFTER_INSERT_PATH_FIX_V1 — insert-path fix(03abea9,
 * 배포 2026-09-19T02:49Z) 이후 실제 cron 결과 검증 (STRICT READ ONLY).
 *
 * `SET TRANSACTION READ ONLY` 트랜잭션에서 SELECT/집계만. INSERT/UPDATE/DELETE 0. 외부 API 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-cancel-cron-validation-v1.ts [deployIsoUtc]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';

const prisma = new PrismaClient();

/** REPAIR_AUDIT_V1이 확정한 21행. */
const KNOWN21 = [940779, 940906, 949472, 949523, 949532, 949575, 949624, 949692,
  949727, 949910, 949929, 949991, 950026, 950082, 950183, 950194,
  950239, 950382, 950395, 950396, 950451];

/** GATE_V1 §5가 확정한 신규 7그룹(예방 배포 후 insert 경로가 만든 것). 자연키 속성으로 조회. */
const NEW7 = [
  { lawdCd: '26260', dealYmd: '202605', aptName: '동래SKVIEW', dealAmount: 58800, dealDate: '2026-05-01', floor: 3 },
  { lawdCd: '26380', dealYmd: '202609', aptName: '신우림', dealAmount: 13800, dealDate: '2026-09-08', floor: 4 },
  { lawdCd: '26470', dealYmd: '202609', aptName: '시청역SKVIEW', dealAmount: 49500, dealDate: '2026-09-02', floor: 20 },
  { lawdCd: '26380', dealYmd: '202609', aptName: '괴정한신더휴', dealAmount: 37400, dealDate: '2026-09-16', floor: 6 },
  { lawdCd: '26290', dealYmd: '202609', aptName: '대연롯데캐슬레전드1단지', dealAmount: 34000, dealDate: '2026-09-11', floor: 26 },
  { lawdCd: '26290', dealYmd: '202609', aptName: '롯데캐슬인피니엘', dealAmount: 57000, dealDate: '2026-09-10', floor: 24 },
  { lawdCd: '26350', dealYmd: '202608', aptName: '롯데4', dealAmount: 32000, dealDate: '2026-08-23', floor: 3 },
];

const G = `WITH g AS (
  SELECT group_key, deal_amount, deal_date, floor,
         COUNT(*)::int AS siblings, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
  FROM apartment_trade_histories GROUP BY 1,2,3,4)`;

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-cancel-cron-validation-v1.ts');
  const deploy = process.argv[2] ?? '2026-09-19T02:49:00Z';
  const out: Record<string, unknown> = { checkedAt: new Date().toISOString(), deployAtUtc: deploy, readOnly: true };

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '300s'");

    // §1 — 배포 이후 cron 실행별 쓰기량/상태.
    out.runs_since_deploy = await tx.$queryRawUnsafe(
      `SELECT run_id, dataset, COUNT(*)::int AS cells,
              COUNT(*) FILTER (WHERE status = 'COMPLETE')::int AS complete,
              COUNT(*) FILTER (WHERE status <> 'COMPLETE')::int AS not_complete,
              SUM(fetched_count)::int AS fetched, SUM(inserted_count)::int AS inserted,
              SUM(updated_count)::int AS updated,
              MIN(deal_ymd) AS min_ymd, MAX(deal_ymd) AS max_ymd,
              MAX(verified_at) AS ended
       FROM sync_coverage_cells WHERE verified_at > $1::timestamp GROUP BY 1,2 ORDER BY ended DESC`, deploy);
    out.cells_not_complete_since_deploy = await tx.$queryRawUnsafe(
      `SELECT lawd_cd, deal_ymd, status, run_id, verified_at FROM sync_coverage_cells
       WHERE verified_at > $1::timestamp AND status <> 'COMPLETE' ORDER BY verified_at`, deploy);

    // §2 — 배포 이후 실제로 적재/변경된 행.
    out.rows_created_since_deploy = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM apartment_trade_histories WHERE created_at > $1::timestamp`, deploy);
    out.rows_touched_since_deploy = await tx.$queryRawUnsafe(
      `SELECT id, lawd_cd, deal_ymd, apt_name, dong, deal_amount, deal_date, floor, occurrence_index,
              deal_canceled, cancel_date, registry_date IS NOT NULL AS has_registry,
              created_at, updated_at, source_fetched_at
       FROM apartment_trade_histories
       WHERE source_fetched_at > $1::timestamp OR updated_at > $1::timestamp OR created_at > $1::timestamp
       ORDER BY updated_at`, deploy);

    // §3 — 상한/전체 census.
    out.upper_bound = await tx.$queryRawUnsafe(`${G}
      SELECT COUNT(*) FILTER (WHERE siblings > 1)::int AS multi_sibling_groups,
             COUNT(*) FILTER (WHERE siblings > 1 AND canceled = siblings)::int AS all_canceled_groups,
             COALESCE(SUM(siblings - 1) FILTER (WHERE siblings > 1 AND canceled = siblings), 0)::int AS suspect_upper_bound
      FROM g`);
    out.totals = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total_rows,
              COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS active,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled,
              COUNT(DISTINCT lawd_cd)::int AS districts FROM apartment_trade_histories`);
    out.natural_key_duplicates = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM (SELECT group_key, deal_amount, deal_date, floor, occurrence_index
       FROM apartment_trade_histories GROUP BY 1,2,3,4,5 HAVING COUNT(*) > 1) d`);

    // §4 — 전원취소 그룹 중 배포 이후 한 행이라도 생성/변경된 것(신규 false-cancel 후보).
    out.all_canceled_groups_touched_since_deploy = await tx.$queryRawUnsafe(`${G}
      SELECT g.group_key, g.deal_amount, g.deal_date, g.floor, g.siblings, g.canceled,
             MIN(t.apt_name) AS apt, MIN(t.lawd_cd) AS lawd_cd, MIN(t.deal_ymd) AS deal_ymd,
             ARRAY_AGG(t.id ORDER BY t.id) AS ids,
             MAX(t.created_at) AS newest_created, MAX(t.updated_at) AS newest_updated
      FROM g JOIN apartment_trade_histories t
        ON t.group_key = g.group_key AND t.deal_amount = g.deal_amount
       AND t.deal_date = g.deal_date AND t.floor IS NOT DISTINCT FROM g.floor
      WHERE g.siblings > 1 AND g.canceled = g.siblings
      GROUP BY 1,2,3,4,5,6
      HAVING MAX(t.created_at) > $1::timestamp OR MAX(t.updated_at) > $1::timestamp`, deploy);

    // §5 — 형제 수가 배포 이후 늘어난 그룹(insert 경로를 실제로 탄 그룹).
    out.groups_with_sibling_added_since_deploy = await tx.$queryRawUnsafe(
      `SELECT group_key, deal_amount, deal_date, floor,
              COUNT(*)::int AS siblings,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled,
              COUNT(*) FILTER (WHERE created_at > $1::timestamp)::int AS new_siblings,
              COUNT(*) FILTER (WHERE created_at > $1::timestamp AND deal_canceled)::int AS new_canceled,
              MIN(apt_name) AS apt, MIN(lawd_cd) AS lawd_cd, MIN(deal_ymd) AS deal_ymd,
              ARRAY_AGG(id ORDER BY id) AS ids
       FROM apartment_trade_histories
       GROUP BY 1,2,3,4
       HAVING COUNT(*) > 1 AND COUNT(*) FILTER (WHERE created_at > $1::timestamp) > 0`, deploy);

    // §6 — 확정 21행 상태.
    out.known21 = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE deal_canceled)::int AS still_canceled,
              COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS restored,
              MAX(source_fetched_at) AS newest_source_fetch, MAX(updated_at) AS newest_update
       FROM apartment_trade_histories WHERE id IN (${KNOWN21.join(',')})`);

    // §7 — 신규 7그룹 자연키 조회.
    const new7: unknown[] = [];
    for (const n of NEW7) {
      const rows = await tx.$queryRawUnsafe(
        `SELECT id, lawd_cd, deal_ymd, apt_name, dong, deal_amount, deal_date, floor, occurrence_index,
                deal_canceled, cancel_date, created_at, updated_at, source_fetched_at
         FROM apartment_trade_histories
         WHERE lawd_cd = $1 AND deal_ymd = $2 AND apt_name = $3 AND deal_amount = $4
           AND deal_date = $5::date AND floor = $6
         ORDER BY occurrence_index`,
        n.lawdCd, n.dealYmd, n.aptName, n.dealAmount, n.dealDate, n.floor);
      new7.push({ spec: n, rows });
    }
    out.new7_groups = new7;

    // §8 — 취소 행 중 배포 이후 변경된 행(플립 관측 대용).
    out.canceled_rows_updated_since_deploy = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n FROM apartment_trade_histories
       WHERE deal_canceled AND updated_at > $1::timestamp`, deploy);

    // §9 — 오류 로그.
    out.error_logs_since_deploy = await tx.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS n, MAX(created_at) AS newest FROM error_logs WHERE created_at > $1::timestamp`, deploy);
  }, { timeout: 900_000 });

  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); }).finally(() => prisma.$disconnect());
