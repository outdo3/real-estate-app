/**
 * RECORD_HIGH_TRUST_V3 — HISTORICAL CANCELLATION RESYNC APPLY (승인된 Production UPDATE).
 *
 * 승인 범위(엄격):
 *   - 대상: 부산 16개 구 × 2020-02~2024-08 = 880 cells
 *   - apartment_trade_histories UPDATE 최대 10,852행
 *   - 허용 변경: dealCanceled false->true, cancelDate, registryDate (+ sourceFetchedAt)
 *   - INSERT / DELETE / true->false / identity·금액·일자·면적·층 변경: 전부 금지
 *
 * INSERT 불가능성은 코드 구조로 보장한다 — 이 파일에는 create/createMany/upsert/delete
 * 호출이 **존재하지 않는다**. 유일한 write는 prisma.apartmentTradeHistory.update 이며
 * data 절에 취소 3개 필드 + sourceFetchedAt 외에는 아무것도 넣지 않는다.
 *
 * legacy upsertRows()(backfill-trade-history.ts)는 사용하지 않는다 — §8.
 *
 * 사용법:
 *   ALLOW_PROD_DB_WRITE=1 npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/record-high-trust/historical-cancellation-apply.ts --apply
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { normalizeMolitItemsToTradeRows } from '../trade-history-logic';
import { fetchSaleRegionMonth } from '../sale-molit-fetch';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const BUSAN_16 = ['26110','26140','26170','26200','26230','26260','26290','26320','26350','26380','26410','26440','26470','26500','26530','26710'];
const FROM = '202002';
const TO = '202408';

/** 승인 상한 — 초과 시 절대 write하지 않는다. */
const APPROVED_MAX_UPDATES = 10852;
/** 예상치에서 이만큼 넘게 벗어나면 "의미 있는 변동"으로 보고 STOP. */
const DRIFT_TOLERANCE = 20;
/** 승인상 INSERT는 0건이어야 한다. */
const APPROVED_MAX_INSERTS = 0;

/** DRY-RUN에서 확인된 원천 소멸 거래 — UPDATE 대상 아님, 보존(삭제 금지). */
const KNOWN_DB_ONLY = 'id:26350-2109::137.32::sale|75000|2021-04-02|7|0';

const CHUNK_SIZE = 500;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const nk = (r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null; occurrenceIndex: number }) =>
  `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}|${r.occurrenceIndex}`;

function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let y = parseInt(from.slice(0, 4), 10), m = parseInt(from.slice(4), 10);
  const ey = parseInt(to.slice(0, 4), 10), em = parseInt(to.slice(4), 10);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

interface Flip { dbId: number; cancelDate: string | null; registryDate: string | null; cell: string; }

async function main() {
  assertProductionDbAccessAllowed(APPLY ? 'BACKFILL' : 'DIAGNOSTIC', 'record-high-trust/historical-cancellation-apply.ts');
  const t0 = Date.now();
  const months = monthsInRange(FROM, TO);
  const cells: { lawdCd: string; dealYmd: string }[] = [];
  for (const m of months) for (const l of BUSAN_16) cells.push({ lawdCd: l, dealYmd: m });

  console.log(`RECORD HIGH TRUST V3 — HISTORICAL CANCELLATION ${APPLY ? 'APPLY' : 'REVALIDATION (no write)'}`);
  console.log(`range ${FROM}~${TO} = ${cells.length} cells\n`);

  // ---------- §2 PRE-APPLY REVALIDATION ----------
  let cellsComplete = 0, srcFetched = 0, dbMatched = 0, apiCalls = 0;
  let alreadyCanceled = 0, unchangedValid = 0, noCancelDate = 0;
  const flips: Flip[] = [];
  const insertCandidates: any[] = [];   // source-only (자연키 미매칭) — 승인상 0이어야 함
  const reverse: any[] = [];
  const otherMutation: any[] = [];
  const dbOnly: string[] = [];
  const blocked: { cell: string; reason: string }[] = [];
  const affectedCells = new Set<string>();

  let i = 0;
  for (const c of cells) {
    i++;
    const label = `${c.lawdCd}/${c.dealYmd}`;
    const f = await fetchSaleRegionMonth(c.lawdCd, c.dealYmd);
    apiCalls += Math.max(1, f.pagesFetched);
    if (f.status !== 'COMPLETE' || f.totalCount === null || f.collectedCount !== f.totalCount) {
      blocked.push({ cell: label, reason: `status=${f.status} collected=${f.collectedCount} total=${f.totalCount}` });
      continue;
    }
    cellsComplete++; srcFetched += f.collectedCount;

    const { rows: srcRows, invalid } = normalizeMolitItemsToTradeRows(f.items, c.lawdCd, c.dealYmd);
    if (invalid.length) blocked.push({ cell: label, reason: `invalid=${invalid.length}` });

    const dbRows = await prisma.apartmentTradeHistory.findMany({
      where: { lawdCd: c.lawdCd, dealYmd: c.dealYmd, dealType: 'sale' },
      select: { id: true, groupKeyStr: true, dealAmount: true, dealDate: true, floor: true, occurrenceIndex: true, aptName: true, dong: true, aptSeq: true, exclusiveArea: true, dealCanceled: true, cancelDate: true },
    });
    const dbMap = new Map(dbRows.map((d) => [nk({ ...d, dealDate: ymd(d.dealDate) }), d]));
    const seen = new Set<string>();

    for (const s of srcRows) {
      const key = nk(s);
      const d = dbMap.get(key);
      if (!d) { insertCandidates.push({ cell: label, nk: key }); continue; }
      seen.add(key); dbMatched++;

      if (d.aptName !== s.aptName || d.dong !== s.dong || Number(d.exclusiveArea) !== Number(s.exclusiveArea) || (d.aptSeq ?? null) !== (s.aptSeq ?? null)) {
        otherMutation.push({ cell: label, nk: key });
      }

      if (!d.dealCanceled && !s.dealCanceled) { unchangedValid++; continue; }
      if (d.dealCanceled && s.dealCanceled) { alreadyCanceled++; continue; }
      if (!d.dealCanceled && s.dealCanceled) {
        if (!s.cancelDate) noCancelDate++;
        flips.push({ dbId: d.id, cancelDate: s.cancelDate, registryDate: s.registryDate, cell: label });
        affectedCells.add(label);
        continue;
      }
      reverse.push({ cell: label, nk: key });
    }
    for (const d of dbRows) {
      const k = nk({ ...d, dealDate: ymd(d.dealDate) });
      if (!seen.has(k)) dbOnly.push(k);
    }
    if (i % 80 === 0 || i === cells.length) {
      console.log(`[${i}/${cells.length}] complete=${cellsComplete} flips=${flips.length} reverse=${reverse.length} insertCand=${insertCandidates.length} elapsed=${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }

  console.log('\n--- §2 PRE-APPLY REVALIDATION SUMMARY ---');
  console.log('COMPLETE cells         :', cellsComplete, '/', cells.length);
  console.log('blocked cells          :', blocked.length);
  console.log('source rows fetched    :', srcFetched);
  console.log('DB rows matched        :', dbMatched);
  console.log('false->true candidates :', flips.length, `(기대 ${APPROVED_MAX_UPDATES})`);
  console.log('already canceled       :', alreadyCanceled);
  console.log('unchanged valid        :', unchangedValid);
  console.log('reverse true->false    :', reverse.length);
  console.log('INSERT candidates      :', insertCandidates.length, '(승인상 0이어야 함)');
  console.log('DB-only                :', dbOnly.length, dbOnly.length === 1 && dbOnly[0] === KNOWN_DB_ONLY ? '(기존 알려진 1건 — 보존)' : JSON.stringify(dbOnly.slice(0, 5)));
  console.log('other mutation         :', otherMutation.length);
  console.log('candidates w/o cancelDate:', noCancelDate);
  console.log('affected cells         :', affectedCells.size);

  // ---------- §1 HARD WRITE GATE ----------
  const gate: string[] = [];
  if (cellsComplete !== cells.length) gate.push(`COMPLETE ${cellsComplete} != ${cells.length}`);
  if (blocked.length !== 0) gate.push(`blocked cells ${blocked.length} != 0`);
  if (insertCandidates.length > APPROVED_MAX_INSERTS) gate.push(`INSERT candidates ${insertCandidates.length} > ${APPROVED_MAX_INSERTS} — 즉시 STOP`);
  if (reverse.length !== 0) gate.push(`reverse true->false ${reverse.length} != 0`);
  if (otherMutation.length !== 0) gate.push(`other mutation ${otherMutation.length} != 0`);
  if (noCancelDate !== 0) gate.push(`cancelDate 누락 ${noCancelDate} != 0`);
  if (flips.length > APPROVED_MAX_UPDATES) gate.push(`flips ${flips.length} > 승인 상한 ${APPROVED_MAX_UPDATES}`);
  if (Math.abs(flips.length - APPROVED_MAX_UPDATES) > DRIFT_TOLERANCE) gate.push(`flips ${flips.length}이 예상 ${APPROVED_MAX_UPDATES}에서 ${DRIFT_TOLERANCE} 초과 이탈`);
  if (dbOnly.length > 1 || (dbOnly.length === 1 && dbOnly[0] !== KNOWN_DB_ONLY)) gate.push(`DB-only가 알려진 1건과 다름: ${JSON.stringify(dbOnly.slice(0, 5))}`);

  if (gate.length) {
    console.log('\n*** STOP — 승인 조건과 다릅니다. 아무것도 쓰지 않았습니다. ***');
    gate.forEach((g) => console.log('  -', g));
    await prisma.$disconnect();
    process.exit(2);
  }
  console.log('\nGATE PASS — 승인 범위와 일치. INSERT 0 강제 확인.');

  if (!APPLY) {
    console.log('(--apply 없음: 여기서 종료. Production write 0건)');
    await prisma.$disconnect();
    return;
  }

  // ---------- §3 APPLY (UPDATE ONLY) ----------
  console.log('\n=== §3 APPLY (UPDATE ONLY) ===');
  let updated = 0;
  for (let k = 0; k < flips.length; k += CHUNK_SIZE) {
    const chunk = flips.slice(k, k + CHUNK_SIZE);
    // 승인된 유일한 write. data 절에 취소 3필드 + sourceFetchedAt 외에는 없다 —
    // identity/금액/일자/면적/층은 구조적으로 변경 불가.
    const res = await prisma.$transaction(
      chunk.map((f) =>
        prisma.apartmentTradeHistory.update({
          where: { id: f.dbId },
          data: { dealCanceled: true, cancelDate: f.cancelDate, registryDate: f.registryDate, sourceFetchedAt: new Date() },
        })
      )
    );
    updated += res.length;
    if ((k / CHUNK_SIZE) % 4 === 0 || k + CHUNK_SIZE >= flips.length) console.log(`  updated ${updated}/${flips.length}`);
  }
  console.log('\nTOTAL UPDATED:', updated);

  // ---------- §4 POST-APPLY VERIFICATION ----------
  console.log('\n=== §4 POST-APPLY VERIFICATION ===');
  const post: any[] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int total, count(*) FILTER (WHERE deal_canceled)::int canceled,
            count(*) FILTER (WHERE deal_canceled AND cancel_date IS NULL)::int canceled_no_date
     FROM apartment_trade_histories
     WHERE deal_type='sale' AND deal_ymd BETWEEN '${FROM}' AND '${TO}'`
  );
  console.log('B구간 total rows      :', post[0].total, '(변하지 않아야 함: 177,981)');
  console.log('B구간 canceled        :', post[0].canceled, `(기대 ${alreadyCanceled + flips.length})`);
  console.log('canceled w/o date     :', post[0].canceled_no_date, '(0이어야 함)');

  fs.writeFileSync(
    process.env.V3_APPLY_OUT || path.resolve(__dirname, '../../tmp-v3-apply.json'),
    JSON.stringify({ updated, flips: flips.length, alreadyCanceled, unchangedValid, affectedCells: affectedCells.size, apiCalls, runtimeSec: Math.round((Date.now() - t0) / 1000), post: post[0] }, null, 2)
  );
  console.log(`\nruntime ${((Date.now() - t0) / 1000).toFixed(0)}s  apiCalls ${apiCalls}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
