/**
 * CANCELLATION_RATCHET_DEFECT_A_REPAIR_AUDIT_V1 — 영향 시뮬레이션 (STRICT READ ONLY).
 *
 * 확정된 false-cancel 행 21개를 되돌렸을 때 읽기 경로 수치가 얼마나 바뀌는지
 * **쓰지 않고** 계산한다. `SET TRANSACTION READ ONLY` 트랜잭션 + SELECT만.
 *
 * repair 대상 id는 PHASE 2 결과(JSON)에서 받는다 — 이 스크립트가 다시 추정하지 않는다.
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-cancel-ratchet-defect-a-impact.ts <phase2.json>
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';

const prisma = new PrismaClient();

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-cancel-ratchet-defect-a-impact.ts');
  const p2 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const ids: number[] = p2.repairRowIds;
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('repairRowIds가 비어 있다');
  const idList = ids.join(',');

  const out: Record<string, unknown> = { repairRowCount: ids.length };

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '180s'");

    // 0. 사전 조건 재확인 — 대상 행이 정말 지금 취소 상태이고 등기일이 없는가.
    out.precondition = await tx.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE deal_canceled)::int AS currently_canceled,
             COUNT(*) FILTER (WHERE cancel_date IS NOT NULL)::int AS has_cancel_date,
             COUNT(*) FILTER (WHERE registry_date IS NOT NULL)::int AS has_registry_date,
             COUNT(DISTINCT apt_seq)::int AS distinct_apt_seq,
             COUNT(*) FILTER (WHERE apt_seq IS NULL)::int AS null_apt_seq
      FROM apartment_trade_histories WHERE id IN (${idList})`);

    // 1. 전체 활성 거래 수 변화.
    out.global_counts = await tx.$queryRawUnsafe(`
      SELECT COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS active_now,
             COUNT(*) FILTER (WHERE NOT deal_canceled)::int + ${ids.length} AS active_after,
             COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled_now
      FROM apartment_trade_histories`);

    // 2. 지역별 / 월별 영향.
    out.by_district = await tx.$queryRawUnsafe(`
      SELECT lawd_cd, COUNT(*)::int AS restored_rows FROM apartment_trade_histories
      WHERE id IN (${idList}) GROUP BY 1 ORDER BY 2 DESC, 1`);
    out.by_month = await tx.$queryRawUnsafe(`
      SELECT deal_ymd, COUNT(*)::int AS restored_rows FROM apartment_trade_histories
      WHERE id IN (${idList}) GROUP BY 1 ORDER BY 1`);

    // 3. 영향 단지의 활성 거래 수 — 복구 전/후.
    out.affected_apartments = await tx.$queryRawUnsafe(`
      WITH tgt AS (SELECT DISTINCT group_key, apt_seq, apt_name FROM apartment_trade_histories WHERE id IN (${idList}))
      SELECT tgt.apt_name, tgt.apt_seq,
             COUNT(*) FILTER (WHERE NOT t.deal_canceled)::int AS active_now,
             COUNT(*) FILTER (WHERE t.id IN (${idList}))::int AS restored,
             COUNT(*) FILTER (WHERE NOT t.deal_canceled)::int + COUNT(*) FILTER (WHERE t.id IN (${idList}))::int AS active_after
      FROM tgt JOIN apartment_trade_histories t ON t.group_key = tgt.group_key
      GROUP BY 1,2 ORDER BY restored DESC, 1`);

    // 4. 최신 거래(latest trade)가 바뀌는 단지 — 복구 행이 그 group_key의 최신이 되는가.
    out.latest_trade_changes = await tx.$queryRawUnsafe(`
      WITH tgt AS (SELECT id, group_key, deal_date, apt_name, deal_amount FROM apartment_trade_histories WHERE id IN (${idList})),
      cur AS (SELECT t.group_key, MAX(t.deal_date) AS latest_active
              FROM apartment_trade_histories t WHERE NOT t.deal_canceled
                AND t.group_key IN (SELECT group_key FROM tgt) GROUP BY 1)
      SELECT tgt.apt_name, tgt.deal_date::text AS restored_date, cur.latest_active::text AS current_latest_active,
             (cur.latest_active IS NULL OR tgt.deal_date > cur.latest_active) AS becomes_new_latest
      FROM tgt LEFT JOIN cur ON cur.group_key = tgt.group_key ORDER BY 1`);

    // 5. 신고가(최고가)가 바뀌는 단지.
    out.price_high_changes = await tx.$queryRawUnsafe(`
      WITH tgt AS (SELECT id, group_key, deal_amount, apt_name FROM apartment_trade_histories WHERE id IN (${idList})),
      cur AS (SELECT t.group_key, MAX(t.deal_amount) AS max_active
              FROM apartment_trade_histories t WHERE NOT t.deal_canceled
                AND t.group_key IN (SELECT group_key FROM tgt) GROUP BY 1)
      SELECT tgt.apt_name, tgt.deal_amount AS restored_amount, cur.max_active AS current_max_active,
             (cur.max_active IS NULL OR tgt.deal_amount > cur.max_active) AS becomes_new_high
      FROM tgt LEFT JOIN cur ON cur.group_key = tgt.group_key ORDER BY 1`);

    // 6. 최근 12개월 거래량(통계/랭킹 영향) — 복구 전/후.
    out.last_12m_volume = await tx.$queryRawUnsafe(`
      SELECT COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS active_now,
             COUNT(*) FILTER (WHERE id IN (${idList}))::int AS restored,
             COUNT(*) FILTER (WHERE NOT deal_canceled)::int + COUNT(*) FILTER (WHERE id IN (${idList}))::int AS active_after
      FROM apartment_trade_histories WHERE deal_date >= CURRENT_DATE - INTERVAL '12 months'`);

    // 7. 월별 거래량 변화율(최근 12개월) — 통계 그래프가 눈에 띄게 흔들리는지.
    out.monthly_volume_delta = await tx.$queryRawUnsafe(`
      SELECT deal_ymd,
             COUNT(*) FILTER (WHERE NOT deal_canceled)::int AS active_now,
             COUNT(*) FILTER (WHERE id IN (${idList}))::int AS restored,
             ROUND(100.0 * COUNT(*) FILTER (WHERE id IN (${idList})) / NULLIF(COUNT(*) FILTER (WHERE NOT deal_canceled), 0), 3) AS pct_change
      FROM apartment_trade_histories
      WHERE deal_ymd IN (SELECT DISTINCT deal_ymd FROM apartment_trade_histories WHERE id IN (${idList}))
      GROUP BY 1 ORDER BY 1`);
  }, { timeout: 600_000 });

  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main()
  .catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); })
  .finally(() => prisma.$disconnect());
