/**
 * NATIONAL_FIRST_BATCH_APPLY_V1 — apply 후 원천(raw 캐시) ↔ Production 정밀 대조 (STRICT READ ONLY).
 *
 * 구·월 셀마다 원천 정규화 행(운영 cron과 같은 normalizeMolitItemsToTradeRows)과 DB 행을 비교한다:
 *   행 수 · 자연키 다중집합 · 취소 수 · (자연키, 취소일) 다중집합 · DB 자연키 중복.
 * MOLIT 호출 0 · write 0(`SET TRANSACTION READ ONLY`).
 *
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/national-backfill/audit-first-batch-parity.ts 41111,41113,...
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';
import { mapMolitItems } from '../../src/lib/api-molit';
import { normalizeMolitItemsToTradeRows } from '../trade-history-logic';
import { naturalKeyOf } from '../backfill-seoul-sale-logic';

const ROOT = path.resolve(__dirname, '../../tmp/national-backfill/districts');

function multisetDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const m = new Map<string, number>();
  for (const x of a) m.set(x, (m.get(x) ?? 0) + 1);
  for (const x of b) m.set(x, (m.get(x) ?? 0) - 1);
  const onlyA: string[] = [];
  const onlyB: string[] = [];
  for (const [k, v] of m) { for (let i = 0; i < v; i++) onlyA.push(k); for (let i = 0; i < -v; i++) onlyB.push(k); }
  return { onlyA, onlyB };
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-first-batch-parity.ts');
  const districts = (process.argv[2] ?? '').split(',').filter(Boolean);
  if (!districts.length) throw new Error('districts 필요');
  const prisma = new PrismaClient();
  const report: Record<string, unknown> = {};
  for (const d of districts) {
    const db = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return tx.$queryRawUnsafe(
        `SELECT deal_ymd, group_key AS group_key_str, deal_amount, to_char(deal_date,'YYYY-MM-DD') AS deal_date, floor, occurrence_index, deal_canceled, cancel_date, apt_seq
         FROM apartment_trade_histories WHERE lawd_cd = $1`, d) as Promise<{ deal_ymd: string; group_key_str: string; deal_amount: number; deal_date: string; floor: number | null; occurrence_index: number; deal_canceled: boolean; cancel_date: string | null; apt_seq: string | null }[]>;
    }, { timeout: 180_000 });
    const dbBy = new Map<string, typeof db>();
    for (const r of db) { if (!dbBy.has(r.deal_ymd)) dbBy.set(r.deal_ymd, []); dbBy.get(r.deal_ymd)!.push(r); }
    const rawDir = path.join(ROOT, d, 'raw', d);
    let src = 0, srcCanceled = 0, dbN = 0, dbCanceled = 0, missing = 0, extra = 0, cancelMismatch = 0, cancelDateMismatch = 0, dbDupKeys = 0, aptSeqPrefixMismatch = 0;
    const mismatchCells: unknown[] = [];
    const seenYm = new Set<string>();
    for (const f of fs.readdirSync(rawDir).sort()) {
      const ym = f.slice(0, 6);
      seenYm.add(ym);
      const items = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(rawDir, f))).toString('utf8'));
      const { rows } = normalizeMolitItemsToTradeRows(mapMolitItems(items, 'apt', d, ym) as any, d, ym);
      const dbr = dbBy.get(ym) ?? [];
      const sKeys = rows.map((r) => naturalKeyOf(r));
      const dKeys = dbr.map((r) => naturalKeyOf({ groupKeyStr: r.group_key_str, dealAmount: r.deal_amount, dealDate: r.deal_date, floor: r.floor, occurrenceIndex: r.occurrence_index }));
      const keyDiff = multisetDiff(sKeys, dKeys);
      const sCancel = rows.map((r, i) => `${sKeys[i]}|${r.dealCanceled}|${r.dealCanceled ? r.cancelDate : ''}`);
      const dCancel = dbr.map((r, i) => `${dKeys[i]}|${r.deal_canceled}|${r.deal_canceled ? r.cancel_date : ''}`);
      const cDiff = multisetDiff(sCancel, dCancel);
      const sc = rows.filter((r) => r.dealCanceled).length;
      const dc = dbr.filter((r) => r.deal_canceled).length;
      dbDupKeys += dKeys.length - new Set(dKeys).size;
      aptSeqPrefixMismatch += dbr.filter((r) => r.apt_seq && r.apt_seq.slice(0, 5) !== d).length;
      src += rows.length; srcCanceled += sc; dbN += dbr.length; dbCanceled += dc;
      missing += keyDiff.onlyA.length; extra += keyDiff.onlyB.length;
      if (sc !== dc) cancelMismatch++;
      if (cDiff.onlyA.length || cDiff.onlyB.length) cancelDateMismatch++;
      if (keyDiff.onlyA.length || keyDiff.onlyB.length || sc !== dc || cDiff.onlyA.length) {
        mismatchCells.push({ ym, source: rows.length, db: dbr.length, sourceCanceled: sc, dbCanceled: dc, missing: keyDiff.onlyA.slice(0, 3), extra: keyDiff.onlyB.slice(0, 3) });
      }
    }
    // raw 셀 밖의 DB 행(다른 달로 들어간 행)
    const outside = [...dbBy.keys()].filter((ym) => !seenYm.has(ym)).reduce((s, ym) => s + dbBy.get(ym)!.length, 0);
    report[d] = {
      source: src, db: dbN, sourceCanceled: srcCanceled, dbCanceled, missing, extra, dbRowsOutsideRawMonths: outside,
      cellsWithCountOrKeyMismatch: mismatchCells.length, cellsWithCancelMismatch: cancelMismatch, cellsWithCancelDateMismatch: cancelDateMismatch,
      dbDuplicateNaturalKeys: dbDupKeys, aptSeqPrefixMismatch, mismatchCells: mismatchCells.slice(0, 10),
      parityExact: src === dbN && missing === 0 && extra === 0 && outside === 0 && cancelMismatch === 0 && cancelDateMismatch === 0 && dbDupKeys === 0,
    };
    console.error(`${d} done`);
  }
  await prisma.$disconnect();
  console.log(JSON.stringify({ at: new Date().toISOString(), mode: 'READ_ONLY_PARITY', report }, null, 1));
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
