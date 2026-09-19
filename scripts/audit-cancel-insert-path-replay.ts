/**
 * CANCELLATION_INSERT_PATH_FIX_V1 §9/§10 — insert 경로 replay (STRICT READ ONLY).
 *
 * "형제가 나중에 늘어난" 그룹(형제 row의 created_at이 5분 넘게 벌어진 그룹 = 실제로 insert 경로를
 * 두 번 이상 탄 그룹)만 모아, 그 셀의 **현재 원천**으로 두 정책을 비교한다:
 *   legacy — 수정 전: 자연키(occurrenceIndex = 원천 순서)가 비는 원천 행을 그대로 insert
 *   new    — planGroupInserts(): 그룹 개수로 부족분과 그중 취소 수를 정함
 * 삽입 전 DB 상태 = 그룹의 첫 적재 시각부터 5분 안에 들어온 형제들.
 *
 * DB: `SET TRANSACTION READ ONLY` SELECT만. MOLIT: 해당 셀만 GET. 쓰기 0.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-cancel-insert-path-replay.ts [snapshotOut.json]
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { writeFileSync } from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';
import { classifyRow, occurrenceGroupKey, planGroupInserts } from './write-policy-logic';

const prisma = new PrismaClient();

interface DbRow {
  id: number; lawd_cd: string; deal_ymd: string; group_key: string; deal_amount: number; deal_date: string; floor: number;
  occurrence_index: number; deal_canceled: boolean; cancel_date: string | null; registry_date: string | null;
  apt_name: string; dong: string; created_at: Date; first_created: Date;
}

/** 수정 이후 7건(CANCELLATION_PREVENTION_CRON_VALIDATION_GATE_V1 §5)의 기존 행 id — 결과표에서 따로 보인다. */
const NEW7_EXISTING_IDS = new Set([266077, 949965, 949449, 950562, 950421, 950105, 551526]);

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-cancel-insert-path-replay.ts');
  const { fetchSaleRegionMonth } = await import('./sale-molit-fetch');

  let rows: DbRow[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '180s'");
    rows = await tx.$queryRawUnsafe<DbRow[]>(`
      WITH g AS (
        SELECT group_key, deal_amount, deal_date, floor, MIN(created_at) AS first_c, MAX(created_at) AS last_c
        FROM apartment_trade_histories GROUP BY 1,2,3,4 HAVING COUNT(*) > 1)
      SELECT t.id, t.lawd_cd, t.deal_ymd, t.group_key, t.deal_amount, t.deal_date::text AS deal_date, t.floor,
             t.occurrence_index, t.deal_canceled, t.cancel_date, t.registry_date, t.apt_name, t.dong,
             t.created_at, g.first_c AS first_created
      FROM apartment_trade_histories t
      JOIN g ON g.group_key = t.group_key AND g.deal_amount = t.deal_amount AND g.deal_date = t.deal_date
            AND g.floor IS NOT DISTINCT FROM t.floor
      WHERE g.last_c - g.first_c > interval '5 minutes'
      ORDER BY t.lawd_cd, t.deal_ymd, t.id`);
  }, { timeout: 600_000 });

  const key = (r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number }) => occurrenceGroupKey(r);
  const groups = new Map<string, DbRow[]>();
  for (const r of rows) {
    const k = `${r.lawd_cd}:${r.deal_ymd}#${key({ groupKeyStr: r.group_key, dealAmount: r.deal_amount, dealDate: r.deal_date, floor: r.floor })}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const cells = [...new Set(rows.map((r) => `${r.lawd_cd}:${r.deal_ymd}`))].sort();

  const snapshot: Record<string, unknown> = {};
  const tally = {
    groups: groups.size, cells: cells.length, cellFetchNotComplete: 0,
    sourceAbsent: 0, sourceNotMoreThanPre: 0,
    newInserted: 0, newSkipped: {} as Record<string, number>,
    legacyParity: 0, newParity: 0,
    legacyOverCancel: 0, newOverCancel: 0,
    legacyUnderCancel: 0, newUnderCancel: 0,
    newCanceledInsertsExceedDeficit: 0,
    preAlreadyOverCanceled: 0,
  };
  const detail: unknown[] = [];

  for (const cell of cells) {
    const [lawdCd, dealYmd] = cell.split(':');
    const fr = await fetchSaleRegionMonth(lawdCd, dealYmd);
    if (fr.status !== 'COMPLETE' && fr.status !== 'EMPTY_VALID') { tally.cellFetchNotComplete++; continue; }
    const { rows: src } = normalizeMolitItemsToTradeRows(fr.items, lawdCd, dealYmd);
    snapshot[cell] = src.map((r) => ({ k: key(r), i: r.occurrenceIndex, c: r.dealCanceled, cd: r.cancelDate, rg: r.registryDate, s: r.aptSeq, n: r.aptName, d: r.dong }));
    const srcByGroup = new Map<string, typeof src>();
    for (const r of src) (srcByGroup.get(key(r)) ?? srcByGroup.set(key(r), []).get(key(r))!).push(r);

    for (const [gk, dbRows] of groups) {
      if (!gk.startsWith(`${cell}#`)) continue;
      const sg = srcByGroup.get(gk.slice(cell.length + 1)) ?? [];
      const first = dbRows[0].first_created.getTime();
      const pre = dbRows.filter((r) => r.created_at.getTime() - first <= 5 * 60 * 1000);
      const preRows = pre.map((r) => ({ occurrenceIndex: r.occurrence_index, dealCanceled: r.deal_canceled, cancelDate: r.cancel_date, registryDate: r.registry_date, aptName: r.apt_name, dong: r.dong }));
      if (sg.length === 0) { tally.sourceAbsent++; continue; }
      if (sg.length <= pre.length) { tally.sourceNotMoreThanPre++; continue; }

      const srcCanceled = sg.filter((r) => r.dealCanceled).length;
      const preCanceled = preRows.filter((r) => r.dealCanceled).length;
      if (preCanceled > srcCanceled) tally.preAlreadyOverCanceled++;

      // legacy: 자연키 자리가 비는 원천 행을 그대로 insert(classifyRow가 'insert'를 준 행).
      const taken = new Set(preRows.map((r) => r.occurrenceIndex));
      const legacyIns = sg.filter((r) => !taken.has(r.occurrenceIndex) && classifyRow(r, undefined) === 'insert');
      const legacyTotal = pre.length + legacyIns.length;
      const legacyCanceled = preCanceled + legacyIns.filter((r) => r.dealCanceled).length;

      const plan = planGroupInserts(sg, preRows);
      let newTotal = pre.length;
      let newCanceled = preCanceled;
      if (plan.kind === 'insert') {
        tally.newInserted++;
        newTotal += plan.rows.length;
        newCanceled += plan.canceledInserts;
        if (plan.canceledInserts > Math.max(0, srcCanceled - preCanceled)) tally.newCanceledInsertsExceedDeficit++;
      } else if (plan.kind === 'skipped') {
        tally.newSkipped[plan.reason] = (tally.newSkipped[plan.reason] ?? 0) + 1;
      }

      // 기준: 삽입 전 DB가 이미 과다 취소였다면 insert가 그것을 고칠 책임은 없다(치유는 reconcile/게이트 담당).
      const target = Math.max(srcCanceled, preCanceled);
      const legacyOk = legacyTotal === sg.length && legacyCanceled === target;
      const newOk = plan.kind === 'insert' && newTotal === sg.length && newCanceled === target;
      if (legacyOk) tally.legacyParity++;
      if (newOk) tally.newParity++;
      if (legacyCanceled > target) tally.legacyOverCancel++;
      if (newCanceled > target) tally.newOverCancel++;
      if (legacyTotal === sg.length && legacyCanceled < srcCanceled) tally.legacyUnderCancel++;
      if (plan.kind === 'insert' && newCanceled < srcCanceled) tally.newUnderCancel++;

      const isNew7 = dbRows.some((r) => NEW7_EXISTING_IDS.has(r.id));
      if (isNew7 || !legacyOk || !newOk) {
        detail.push({
          cell, apt: dbRows[0].apt_name, amount: dbRows[0].deal_amount, date: dbRows[0].deal_date, floor: dbRows[0].floor, new7: isNew7,
          source: `${srcCanceled}/${sg.length}`, pre: `${preCanceled}/${pre.length}`, currentDb: `${dbRows.filter((r) => r.deal_canceled).length}/${dbRows.length}`,
          legacy: `${legacyCanceled}/${legacyTotal}`, next: plan.kind === 'insert' ? `${newCanceled}/${newTotal}` : plan.kind === 'skipped' ? `skip:${plan.reason}` : 'none',
        });
      }
    }
  }

  const snapshotPath = process.argv[2];
  if (snapshotPath) writeFileSync(snapshotPath, JSON.stringify(snapshot));
  console.log(JSON.stringify({ tally, detail }, null, 2));
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); }).finally(() => prisma.$disconnect());
