/**
 * SEOUL_SALE_FULL_HISTORY_MEASUREMENT_COMPLETION_V1 §8 — 기존 서울 매매 행의 drift census (STRICT READ ONLY).
 *
 * 이미 수집해 둔 셀 원천(raw/*.json.gz)과 DB의 기존 서울 행을 운영과 **같은 판정 함수**
 * `planSaleCellWrites()`(순수 함수 — DB·네트워크 접근 없음)에 넣어, 향후 apply가 기존 행에
 * 어떤 변경을 하게 되는지만 센다.
 *
 * 쓰기 경로가 아예 없다: prisma는 SELECT만(`SET TRANSACTION READ ONLY`), 외부 API 호출 0,
 * `syncOneSaleCell`(apply 가능 경로)을 부르지 않는다.
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-seoul-existing-rows-drift.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { mapMolitItems } from '../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows } from './trade-history-logic';
import { planSaleCellWrites, type ExistingTradeRow } from '../src/lib/sync/sale-sync-core';
import { existingRowDrift } from './backfill-seoul-sale-logic';
import { OUT } from './audit-seoul-sale-backfill-plan';

const RAW = path.join(OUT, 'raw');

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { assertProductionDbAccessAllowed } = await import('./_prod-db-guard');
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-seoul-existing-rows-drift.ts');
  const prisma = new PrismaClient();

  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    return tx.$queryRawUnsafe<any[]>(
      `SELECT id, lawd_cd, deal_ymd, group_key, deal_amount, deal_date, floor, occurrence_index,
              deal_canceled, cancel_date, apt_name, dong, registry_date
       FROM apartment_trade_histories WHERE lawd_cd LIKE '11%' ORDER BY lawd_cd, deal_ymd, id`);
  }, { timeout: 120_000 });
  await prisma.$disconnect();

  // 셀(구+연월)별로 묶어, 셀마다 운영과 같은 계획을 세운다.
  const byCell = new Map<string, any[]>();
  for (const r of rows) {
    const k = `${r.lawd_cd}:${r.deal_ymd}`;
    (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(r);
  }

  const cells: unknown[] = [];
  const totals = { existingRows: 0, plannedInserts: 0, cancelFlips: 0, cancelRestores: 0, registrySupplements: 0, reconcileSkipped: 0, insertSkipped: 0, unchanged: 0 };
  const driftDetail: unknown[] = [];

  for (const [cell, dbRows] of [...byCell.entries()].sort()) {
    const [lawdCd, ym] = cell.split(':');
    const gz = path.join(RAW, lawdCd, `${ym}.json.gz`);
    if (!fs.existsSync(gz)) { cells.push({ cell, status: 'NO_CACHED_SOURCE', dbRows: dbRows.length }); continue; }
    const items = JSON.parse(zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8'));
    const { rows: src } = normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', lawdCd, ym) as any, lawdCd, ym);

    const existing: ExistingTradeRow[] = dbRows.map((r) => ({
      id: r.id, groupKeyStr: r.group_key, dealAmount: r.deal_amount, dealDate: new Date(r.deal_date),
      floor: r.floor, occurrenceIndex: r.occurrence_index, dealCanceled: r.deal_canceled,
      cancelDate: r.cancel_date, aptName: r.apt_name, dong: r.dong, registryDate: r.registry_date,
    }));

    const plan = planSaleCellWrites(src, existing);
    const drift = existingRowDrift(plan, existing);
    totals.existingRows += existing.length;
    totals.plannedInserts += plan.inserts.length;
    totals.cancelFlips += plan.cancelFlips.length;
    totals.cancelRestores += plan.cancelRestores.length;
    totals.registrySupplements += plan.registrySupplements.length;
    totals.reconcileSkipped += plan.cancelReconcileSkipped;
    totals.insertSkipped += plan.insertReconcileSkipped;
    totals.unchanged += plan.unchanged;
    cells.push({ cell, status: 'PLANNED', sourceRows: src.length, dbRows: existing.length,
      inserts: plan.inserts.length, cancelFlips: plan.cancelFlips.length, cancelRestores: plan.cancelRestores.length,
      registrySupplements: plan.registrySupplements.length, unchanged: plan.unchanged });
    for (const d of drift) {
      const src0 = dbRows.find((r) => r.id === d.id);
      driftDetail.push({ ...d, cell, aptName: src0?.apt_name, dong: src0?.dong, registryDateBefore: src0?.registry_date });
    }
  }

  const out = {
    at: new Date().toISOString(), readOnly: true, apiCalls: 0,
    note: 'planSaleCellWrites는 순수 함수다. 이 스크립트에는 apply 경로가 없다.',
    totals,
    driftByKind: driftDetail.reduce((m: any, d: any) => ((m[d.kind] = (m[d.kind] ?? 0) + 1), m), {}),
    sameRows: totals.existingRows - driftDetail.length,
    cells, driftDetail,
  };
  fs.writeFileSync(path.join(OUT, 'existing-rows-drift.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, cells: cells.length }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
