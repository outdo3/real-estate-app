/**
 * CANCELLATION_RATCHET_DEFECT_A_REPAIR_AUDIT_V1 — PHASE 2 (원천 대조, STRICT READ ONLY).
 *
 * 취소가 1건 이상 있는 모든 다형제 그룹을 MOLIT 원천과 **순서 무관**으로 대조해
 * 과다 취소를 확정한다. 상한선 추정이 아니라 확정 분류를 만드는 것이 목적이다.
 *
 * - DB: `SET TRANSACTION READ ONLY` 트랜잭션에서 SELECT만. write 0.
 * - MOLIT: 조회(GET)만. 페이지네이션이 적용된 검증된 fetcher(fetchSaleRegionMonth)를 재사용한다
 *   — 1,000건 초과 셀에서 원천을 잘라 읽으면 대조 자체가 틀린다.
 * - PARTIAL/INVALID 셀은 절대 "원천 0건"으로 해석하지 않는다 → SOURCE_UNAVAILABLE로 분류.
 * - 이름/동 fuzzy 매칭 없음. 그룹 키는 (group_key, dealAmount, dealDate, floor)로 고정.
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-cancel-ratchet-defect-a-phase2.ts > out.json
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';

const prisma = new PrismaClient();

interface DbRow {
  id: number;
  lawd_cd: string;
  deal_ymd: string;
  apt_seq: string | null;
  apt_name: string;
  dong: string;
  deal_date: string;
  deal_amount: number;
  exclusive_area: string;
  floor: number | null;
  occurrence_index: number;
  deal_canceled: boolean;
  cancel_date: string | null;
  registry_date: string | null;
  group_key: string;
}

/** DB/원천 양쪽에서 같은 방식으로 만드는 occurrence 그룹 키. */
const gk = (r: { group_key: string; deal_amount: number; deal_date: string; floor: number | null }) =>
  `${r.group_key}|${r.deal_amount}|${r.deal_date}|${r.floor}`;

type Verdict =
  | 'CONFIRMED_FALSE_CANCEL'
  | 'CONFIRMED_CANCEL'
  | 'SIBLING_COUNT_MISMATCH'
  | 'GROUP_ABSENT_IN_SOURCE'
  | 'DB_UNDER_CANCELED'
  | 'SOURCE_UNAVAILABLE';

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-cancel-ratchet-defect-a-phase2.ts');
  const { fetchSaleRegionMonth } = await import('./sale-molit-fetch');

  // ── 1. DB에서 전원 취소 그룹의 행을 모두 읽는다(READ ONLY) ─────────────────
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
      SELECT t.id, t.lawd_cd, t.deal_ymd, t.apt_seq, t.apt_name, t.dong,
             t.deal_date::text AS deal_date, t.deal_amount, t.exclusive_area::text AS exclusive_area,
             t.floor, t.occurrence_index, t.deal_canceled, t.cancel_date, t.registry_date, t.group_key
      FROM apartment_trade_histories t
      JOIN g ON g.group_key = t.group_key AND g.deal_amount = t.deal_amount
            AND g.deal_date = t.deal_date AND g.floor IS NOT DISTINCT FROM t.floor
      WHERE g.siblings > 1 AND g.canceled > 0
      ORDER BY t.lawd_cd, t.deal_ymd, t.group_key, t.occurrence_index`);
  }, { timeout: 600_000 });

  // ── 2. 대상 셀 목록 ───────────────────────────────────────────────────────
  const cells = [...new Set(dbRows.map((r) => `${r.lawd_cd}:${r.deal_ymd}`))].sort();

  // ── 3. 셀마다 원천을 페이지네이션 포함해 읽고 그룹별 취소 수를 센다 ─────────
  const sourceByCell = new Map<string, { status: string; groups: Map<string, { siblings: number; canceled: number; cancelDates: string[] }> }>();
  const cellStatus: Record<string, number> = {};

  for (const cell of cells) {
    const [lawdCd, dealYmd] = cell.split(':');
    const res = await fetchSaleRegionMonth(lawdCd, dealYmd);
    cellStatus[res.status] = (cellStatus[res.status] ?? 0) + 1;

    const groups = new Map<string, { siblings: number; canceled: number; cancelDates: string[] }>();
    if (res.status === 'COMPLETE' || res.status === 'EMPTY_VALID') {
      const { rows } = normalizeMolitItemsToTradeRows(res.items as never, lawdCd, dealYmd);
      for (const r of rows) {
        const k = `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}`;
        const e = groups.get(k) ?? { siblings: 0, canceled: 0, cancelDates: [] };
        e.siblings++;
        if (r.dealCanceled) {
          e.canceled++;
          if (r.cancelDate) e.cancelDates.push(r.cancelDate);
        }
        groups.set(k, e);
      }
    }
    sourceByCell.set(cell, { status: res.status, groups });
  }

  // ── 4. 그룹 단위 판정 ─────────────────────────────────────────────────────
  const byGroup = new Map<string, DbRow[]>();
  for (const r of dbRows) {
    const k = `${r.lawd_cd}:${r.deal_ymd}|${gk(r)}`;
    (byGroup.get(k) ?? byGroup.set(k, []).get(k)!).push(r);
  }

  const findings: Array<{
    cell: string; groupKey: string; verdict: Verdict;
    dbSiblings: number; dbCanceled: number;
    srcSiblings: number | null; srcCanceled: number | null;
    srcCancelDates: string[];
    excessCanceled: number;
    aptName: string; dealDate: string; dealAmount: number; floor: number | null;
    rows: Array<{ id: number; occ: number; cancelDate: string | null; registryDate: string | null }>;
    repairRowIds: number[];
  }> = [];

  for (const [key, rows] of byGroup) {
    const cell = key.split('|')[0];
    const groupKey = key.slice(cell.length + 1);
    const src = sourceByCell.get(cell)!;
    const first = rows[0];
    const dbCanceled = rows.filter((r) => r.deal_canceled).length;

    let verdict: Verdict;
    let excess = 0;
    let repairRowIds: number[] = [];
    const s = src.groups.get(groupKey);

    if (src.status !== 'COMPLETE' && src.status !== 'EMPTY_VALID') {
      verdict = 'SOURCE_UNAVAILABLE';
    } else if (!s) {
      verdict = 'GROUP_ABSENT_IN_SOURCE';
    } else if (s.siblings !== rows.length) {
      verdict = 'SIBLING_COUNT_MISMATCH';
    } else if (s.canceled < dbCanceled) {
      verdict = 'CONFIRMED_FALSE_CANCEL';
      excess = dbCanceled - s.canceled;
      // 형제는 group_key·금액·계약일·층이 모두 같아 서로 구분되지 않는다. 결정적이도록
      // occurrence_index가 **큰 쪽부터** 되돌린다(원천이 알려준 취소 건수만큼만 남긴다).
      repairRowIds = [...rows]
        .filter((r) => r.deal_canceled)
        .sort((a, b) => b.occurrence_index - a.occurrence_index || b.id - a.id)
        .slice(0, excess)
        .map((r) => r.id)
        .sort((a, b) => a - b);
    } else if (s.canceled > dbCanceled) {
      verdict = 'DB_UNDER_CANCELED';
    } else {
      verdict = 'CONFIRMED_CANCEL';
    }

    findings.push({
      cell, groupKey, verdict,
      dbSiblings: rows.length, dbCanceled,
      srcSiblings: s?.siblings ?? null, srcCanceled: s?.canceled ?? null,
      srcCancelDates: s?.cancelDates ?? [],
      excessCanceled: excess,
      aptName: first.apt_name, dealDate: first.deal_date, dealAmount: first.deal_amount, floor: first.floor,
      rows: rows.map((r) => ({ id: r.id, occ: r.occurrence_index, cancelDate: r.cancel_date, registryDate: r.registry_date })),
      repairRowIds,
    });
  }

  const tally: Record<string, { groups: number; rows: number }> = {};
  for (const f of findings) {
    const t = (tally[f.verdict] ??= { groups: 0, rows: 0 });
    t.groups++;
    t.rows += f.verdict === 'CONFIRMED_FALSE_CANCEL' ? f.excessCanceled : f.dbSiblings;
  }

  const repairIds = findings.flatMap((f) => f.repairRowIds).sort((a, b) => a - b);

  console.log(JSON.stringify({
    startedAt: new Date().toISOString(),
    dbRowsInGroupsWithAnyCancel: dbRows.length,
    groupsExamined: byGroup.size,
    cellsFetched: cells.length,
    cellStatus,
    tally,
    repairRowCount: repairIds.length,
    repairRowIds: repairIds,
    findings,
  }, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}

main()
  .catch((e) => { console.error(String(e?.message ?? e).replace(/serviceKey=[^&\s]*/gi, 'serviceKey=[redacted]')); process.exit(1); })
  .finally(() => prisma.$disconnect());
