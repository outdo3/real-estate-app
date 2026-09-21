/**
 * DEFECT_A_FALSE_CANCEL_28_PRODUCTION_REPAIR_V1 — repair 전/후 28행과 그 sibling group의
 * 전수 검증 (STRICT READ ONLY).
 *
 * repair script(`repair-cancel-ratchet-defect-a`)와 **같은 판정 의미**를 쓰되, 여기서는
 * 쓰기 계획과 그룹 구조를 사람이 읽을 수 있게 펼쳐 보여 준다. 쓰기 0.
 *
 * 원천은 운영 sync와 같은 경로로 읽는다: fetchSaleRegionMonth -> normalizeMolitItemsToTradeRows.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-defect-a-28-repair-verify.ts --label=PRE
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-defect-a-28-repair-verify.ts --label=POST
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';

const prisma = new PrismaClient();

/** CANCELLATION_RATCHET_DEFECT_A_REPAIR_AUDIT_V1이 확정한 21행. */
const KNOWN21 = [940779, 940906, 949472, 949523, 949532, 949575, 949624, 949692,
  949727, 949910, 949929, 949991, 950026, 950082, 950183, 950194,
  950239, 950382, 950395, 950396, 950451];
/** CANCELLATION_PREVENTION_CRON_VALIDATION_GATE_V1 §5가 확정한 신규 7그룹의 형제 행. */
const NEW7_SIBLINGS = [950598, 950570, 950590, 950664, 950722, 950723, 950736];
const KNOWN28 = [...KNOWN21, ...NEW7_SIBLINGS].sort((a, b) => a - b);

interface DbRow {
  id: number; lawd_cd: string; deal_ymd: string; group_key: string;
  deal_amount: number; deal_date: string; floor: number | null;
  occurrence_index: number; deal_canceled: boolean; cancel_date: string | null;
  registry_date: string | null; apt_name: string; apt_seq: string | null; updated_at: string;
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-defect-a-28-repair-verify.ts');
  const label = process.argv.find((a) => a.startsWith('--label='))?.split('=')[1] ?? 'SNAPSHOT';
  const { fetchSaleRegionMonth } = await import('./sale-molit-fetch');

  // 1. 대상 28행.
  const targets = await prisma.$queryRawUnsafe<DbRow[]>(
    `SELECT id, lawd_cd, deal_ymd, group_key, deal_amount, deal_date::text AS deal_date, floor,
            occurrence_index, deal_canceled, cancel_date, registry_date, apt_name, apt_seq,
            updated_at::text AS updated_at
     FROM apartment_trade_histories WHERE id IN (${KNOWN28.join(',')}) ORDER BY id`);

  // 2. 그 28행이 속한 sibling group 전체(DB).
  const groupKeys = [...new Set(targets.map((t) => `${t.group_key}|${t.deal_amount}|${t.deal_date}|${t.floor}`))];
  const siblings = await prisma.$queryRawUnsafe<DbRow[]>(
    `SELECT t.id, t.lawd_cd, t.deal_ymd, t.group_key, t.deal_amount, t.deal_date::text AS deal_date, t.floor,
            t.occurrence_index, t.deal_canceled, t.cancel_date, t.registry_date, t.apt_name, t.apt_seq,
            t.updated_at::text AS updated_at
     FROM apartment_trade_histories t
     JOIN (SELECT UNNEST($1::text[]) AS gk) q
       ON q.gk = t.group_key || '|' || t.deal_amount || '|' || t.deal_date::text || '|' || COALESCE(t.floor::text,'')
     ORDER BY t.occurrence_index, t.id`, groupKeys.map((k) => k.replace(/\|null$/, '|')));

  // fallback: 위 조인이 floor NULL 표기 차이로 비면 id 기반으로 다시 모은다.
  const byGroup = new Map<string, DbRow[]>();
  const src2 = siblings.length ? siblings : await prisma.$queryRawUnsafe<DbRow[]>(
    `SELECT t.id, t.lawd_cd, t.deal_ymd, t.group_key, t.deal_amount, t.deal_date::text AS deal_date, t.floor,
            t.occurrence_index, t.deal_canceled, t.cancel_date, t.registry_date, t.apt_name, t.apt_seq,
            t.updated_at::text AS updated_at
     FROM apartment_trade_histories t
     JOIN apartment_trade_histories k
       ON k.group_key = t.group_key AND k.deal_amount = t.deal_amount
      AND k.deal_date = t.deal_date AND k.floor IS NOT DISTINCT FROM t.floor
     WHERE k.id IN (${KNOWN28.join(',')})
     ORDER BY t.occurrence_index, t.id`);
  for (const r of src2) {
    const k = `${r.lawd_cd}:${r.deal_ymd}|${r.group_key}|${r.deal_amount}|${r.deal_date}|${r.floor}`;
    (byGroup.get(k) ?? byGroup.set(k, []).get(k)!).push(r);
  }

  // 3. 해당 셀의 원천을 운영 경로로 다시 읽는다.
  const cells = [...new Set(src2.map((r) => `${r.lawd_cd}:${r.deal_ymd}`))].sort();
  const srcByCell = new Map<string, { ok: boolean; status: string; groups: Map<string, { siblings: number; canceled: number }> }>();
  for (const cell of cells) {
    const [lawdCd, dealYmd] = cell.split(':');
    const res = await fetchSaleRegionMonth(lawdCd, dealYmd);
    const ok = res.status === 'COMPLETE' || res.status === 'EMPTY_VALID';
    const groups = new Map<string, { siblings: number; canceled: number }>();
    if (ok) {
      const { rows } = normalizeMolitItemsToTradeRows(res.items as never, lawdCd, dealYmd);
      for (const r of rows) {
        const k = `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}`;
        const e = groups.get(k) ?? { siblings: 0, canceled: 0 };
        e.siblings++; if (r.dealCanceled) e.canceled++;
        groups.set(k, e);
      }
    }
    srcByCell.set(cell, { ok, status: res.status, groups });
  }

  // 4. 그룹별 판정 + 쓰기 계획.
  const plan: unknown[] = [];
  const groupReport: unknown[] = [];
  let ambiguous = 0, sourceUnavailable = 0, registryPresent = 0;
  for (const [key, rows] of byGroup) {
    const cell = key.split('|')[0];
    const groupKey = key.slice(cell.length + 1);
    const s = srcByCell.get(cell)!;
    const sg = s.ok ? s.groups.get(groupKey) : undefined;
    const dbCanceled = rows.filter((r) => r.deal_canceled).length;
    const targetsHere = rows.filter((r) => KNOWN28.includes(r.id));
    let verdict = 'OK';
    if (!s.ok) { verdict = 'SOURCE_UNAVAILABLE'; sourceUnavailable++; }
    else if (!sg) { verdict = 'GROUP_ABSENT_IN_SOURCE'; ambiguous++; }
    else if (sg.siblings !== rows.length) { verdict = 'SIBLING_COUNT_MISMATCH'; ambiguous++; }
    else if (sg.canceled >= dbCanceled) verdict = 'NO_EXCESS';
    const excess = sg ? dbCanceled - sg.canceled : null;
    const restorable = rows.filter((r) => r.deal_canceled && r.registry_date == null)
      .sort((a, b) => b.occurrence_index - a.occurrence_index || b.id - a.id);
    if (sg && excess != null && restorable.length < excess) { verdict = 'REGISTRY_DATE_PRESENT'; registryPresent++; }
    const chosen = verdict === 'OK' && excess != null ? restorable.slice(0, excess) : [];

    groupReport.push({
      cell, apt: rows[0].apt_name, aptSeq: rows[0].apt_seq,
      dealAmount: rows[0].deal_amount, dealDate: rows[0].deal_date, floor: rows[0].floor,
      dbSiblings: rows.length, dbCanceled,
      srcSiblings: sg?.siblings ?? null, srcCanceled: sg?.canceled ?? null,
      excess, verdict,
      rows: rows.map((r) => ({ id: r.id, occIdx: r.occurrence_index, canceled: r.deal_canceled,
        cancelDate: r.cancel_date, registryDate: r.registry_date, isKnown28: KNOWN28.includes(r.id) })),
      chosenForRestore: chosen.map((r) => r.id),
      targetsInGroup: targetsHere.map((r) => r.id),
      chosenMatchesKnown28: JSON.stringify(chosen.map((r) => r.id).sort()) === JSON.stringify(targetsHere.map((r) => r.id).sort()),
    });
    for (const r of chosen) {
      plan.push({ id: r.id, apt: r.apt_name, cell, occIdx: r.occurrence_index,
        beforeCanceled: r.deal_canceled, afterCanceled: false,
        beforeCancelDate: r.cancel_date, afterCancelDate: null,
        registryDate: r.registry_date, otherFieldsChanged: 'none (updated_at auto)' });
    }
  }

  const summary = {
    label, checkedAt: new Date().toISOString(), readOnly: true,
    writes: { insert: 0, update: 0, delete: 0 },
    known28Count: KNOWN28.length,
    targetRowsFound: targets.length,
    targetsCanceled: targets.filter((t) => t.deal_canceled).length,
    targetsActive: targets.filter((t) => !t.deal_canceled).length,
    targetsWithCancelDate: targets.filter((t) => t.cancel_date != null).length,
    targetsWithRegistryDate: targets.filter((t) => t.registry_date != null).length,
    targetsWithAptSeq: targets.filter((t) => t.apt_seq != null).length,
    groups: byGroup.size, cellsFetched: cells.length,
    cellsNotOk: [...srcByCell.entries()].filter(([, v]) => !v.ok).map(([k, v]) => ({ cell: k, status: v.status })),
    ambiguousGroups: ambiguous, sourceUnavailableGroups: sourceUnavailable, registryPresentGroups: registryPresent,
    plannedUpdates: plan.length, plannedInserts: 0, plannedDeletes: 0,
    allGroupsChoiceMatchesKnown28: groupReport.every((g) => (g as { chosenMatchesKnown28: boolean; verdict: string }).verdict !== 'OK' || (g as { chosenMatchesKnown28: boolean }).chosenMatchesKnown28),
  };

  console.log(JSON.stringify({ summary, plan, groupReport, targets }, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main().catch((e) => { console.error(String(e?.stack ?? e).replace(/serviceKey=[^&\s]*/gi, 'serviceKey=[redacted]')); process.exit(1); })
  .finally(() => prisma.$disconnect());
