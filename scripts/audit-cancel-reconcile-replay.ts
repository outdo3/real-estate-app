/**
 * CANCELLATION_RATCHET_PREVENTION_FIX_V1 §11/§12 — 새 정책 replay (STRICT READ ONLY).
 *
 * 실제 Production 스냅샷(DB) + MOLIT 원천으로 새 reconcileGroupCancellation()을 돌려보고,
 * 적용했다면 어떤 결과가 나왔을지 계산한다. **아무것도 쓰지 않는다.**
 *
 * 목표 두 가지:
 *   §11 확정 false-cancel 21건이 전부 치유되는가 (= 남은 false-cancel 0)
 *   §12 진짜 취소(7,907그룹)를 하나라도 잘못 되돌리지 않는가 (= false positive 0)
 *
 * - DB: `SET TRANSACTION READ ONLY` 트랜잭션에서 SELECT만.
 * - MOLIT: 조회(GET)만. 페이지네이션 적용된 fetchSaleRegionMonth 재사용.
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-cancel-reconcile-replay.ts > out.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';
import { reconcileGroupCancellation, occurrenceGroupKey } from './write-policy-logic';

const prisma = new PrismaClient();

interface DbRow {
  id: number; lawd_cd: string; deal_ymd: string; group_key: string;
  deal_amount: number; deal_date: string; floor: number | null;
  occurrence_index: number; deal_canceled: boolean;
  cancel_date: string | null; registry_date: string | null; apt_name: string; dong: string;
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-cancel-reconcile-replay.ts');
  const { fetchSaleRegionMonth } = await import('./sale-molit-fetch');

  let dbRows: DbRow[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '180s'");
    dbRows = await tx.$queryRawUnsafe<DbRow[]>(`
      WITH g AS (
        SELECT group_key, deal_amount, deal_date, floor,
               COUNT(*)::int AS siblings, COUNT(*) FILTER (WHERE deal_canceled)::int AS canceled
        FROM apartment_trade_histories GROUP BY 1,2,3,4
      )
      SELECT t.id, t.lawd_cd, t.deal_ymd, t.group_key, t.deal_amount,
             t.deal_date::text AS deal_date, t.floor, t.occurrence_index,
             t.deal_canceled, t.cancel_date, t.registry_date, t.apt_name, t.dong
      FROM apartment_trade_histories t
      JOIN g ON g.group_key = t.group_key AND g.deal_amount = t.deal_amount
            AND g.deal_date = t.deal_date AND g.floor IS NOT DISTINCT FROM t.floor
      WHERE g.siblings > 1 AND g.canceled > 0
      ORDER BY t.lawd_cd, t.deal_ymd, t.group_key, t.occurrence_index`);
  }, { timeout: 600_000 });

  const cells = [...new Set(dbRows.map((r) => `${r.lawd_cd}:${r.deal_ymd}`))].sort();
  const srcByCell = new Map<string, { ok: boolean; groups: Map<string, { dealCanceled: boolean; cancelDate: string | null }[]> }>();
  const cellStatus: Record<string, number> = {};

  for (const cell of cells) {
    const [lawdCd, dealYmd] = cell.split(':');
    const res = await fetchSaleRegionMonth(lawdCd, dealYmd);
    cellStatus[res.status] = (cellStatus[res.status] ?? 0) + 1;
    const groups = new Map<string, { dealCanceled: boolean; cancelDate: string | null }[]>();
    const ok = res.status === 'COMPLETE' || res.status === 'EMPTY_VALID';
    if (ok) {
      const { rows } = normalizeMolitItemsToTradeRows(res.items as never, lawdCd, dealYmd);
      for (const r of rows) {
        const k = occurrenceGroupKey(r);
        const list = groups.get(k);
        const entry = { dealCanceled: r.dealCanceled, cancelDate: r.cancelDate };
        if (list) list.push(entry);
        else groups.set(k, [entry]);
      }
    }
    srcByCell.set(cell, { ok, groups });
  }

  const byGroup = new Map<string, DbRow[]>();
  for (const r of dbRows) {
    const k = `${r.lawd_cd}:${r.deal_ymd}|${r.group_key}|${r.deal_amount}|${r.deal_date}|${r.floor}`;
    (byGroup.get(k) ?? byGroup.set(k, []).get(k)!).push(r);
  }

  const tally: Record<string, number> = {};
  const restores: Array<{ cell: string; apt: string; dealDate: string; ids: number[] }> = [];
  const cancels: Array<{ cell: string; apt: string; dealDate: string; ids: number[] }> = [];
  let residualFalseCancelRows = 0;
  let trueCancelGroupsTouched = 0;

  for (const [key, rows] of byGroup) {
    const cell = key.split('|')[0];
    const groupKey = key.slice(cell.length + 1);
    const src = srcByCell.get(cell)!;
    if (!src.ok) { tally.SOURCE_UNAVAILABLE = (tally.SOURCE_UNAVAILABLE ?? 0) + 1; continue; }
    const s = src.groups.get(groupKey);
    if (!s) { tally.GROUP_ABSENT_IN_SOURCE = (tally.GROUP_ABSENT_IN_SOURCE ?? 0) + 1; continue; }

    const dbCanceled = rows.filter((r) => r.deal_canceled).length;
    const srcCanceled = s.filter((r) => r.dealCanceled).length;
    const wasOverCanceled = s.length === rows.length && dbCanceled > srcCanceled;

    const result = reconcileGroupCancellation(
      s,
      rows.map((r) => ({
        id: r.id, dealCanceled: r.deal_canceled, cancelDate: r.cancel_date,
        registryDate: r.registry_date, occurrenceIndex: r.occurrence_index,
      }))
    );

    tally[result.kind === 'skipped' ? `skipped:${result.reason}` : result.kind] =
      (tally[result.kind === 'skipped' ? `skipped:${result.reason}` : result.kind] ?? 0) + 1;

    if (result.kind === 'reconcile') {
      if (result.toRestore.length) restores.push({ cell, apt: rows[0].apt_name, dealDate: rows[0].deal_date, ids: result.toRestore.map((r) => r.id) });
      if (result.toCancel.length) cancels.push({ cell, apt: rows[0].apt_name, dealDate: rows[0].deal_date, ids: result.toCancel.map((c) => c.id) });
      // §12 false positive: 과다 취소가 아니었는데 되돌리려 하면 위험 신호.
      if (!wasOverCanceled && result.toRestore.length > 0) trueCancelGroupsTouched++;
    }
    // §11 residual: 과다 취소였는데 새 정책이 고치지 못하고 남긴 행.
    if (wasOverCanceled) {
      const healed = result.kind === 'reconcile' ? result.toRestore.length : 0;
      residualFalseCancelRows += (dbCanceled - srcCanceled) - healed;
    }
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    readOnly: true,
    groupsExamined: byGroup.size,
    cellsFetched: cells.length,
    cellStatus,
    decisionTally: tally,
    wouldRestoreGroups: restores.length,
    wouldRestoreRows: restores.reduce((a, r) => a + r.ids.length, 0),
    wouldCancelGroups: cancels.length,
    wouldCancelRows: cancels.reduce((a, r) => a + r.ids.length, 0),
    residualFalseCancelRows,
    trueCancelGroupsWronglyTouched: trueCancelGroupsTouched,
    restores,
    cancels,
  }, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main()
  .catch((e) => { console.error(String(e?.message ?? e).replace(/serviceKey=[^&\s]*/gi, 'serviceKey=[redacted]')); process.exit(1); })
  .finally(() => prisma.$disconnect());
