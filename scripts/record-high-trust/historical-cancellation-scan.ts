/**
 * RECORD_HIGH_TRUST_V3 — HISTORICAL CANCELLATION RESYNC DRY-RUN (READ ONLY).
 *
 * B구간(2020-02 ~ 2024-08) 부산 16개 구를 원천과 전수 대조해, DB에 아직 false로 남아
 * 있는 실제 취소 거래를 정확히 산출한다. **Production write 없음** — 이 파일에는
 * create/update/upsert/delete 호출이 존재하지 않는다.
 *
 * 매칭은 기존 검증된 자연키만 사용한다:
 *   (groupKeyStr, dealAmount, dealDate, floor, occurrenceIndex)
 * name-only fallback / loose substring / dong fallback / first-match 는 쓰지 않는다.
 *
 * 사용법:
 *   ALLOW_PROD_DB_READ=1 npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/record-high-trust/historical-cancellation-scan.ts
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

const BUSAN_16 = ['26110','26140','26170','26200','26230','26260','26290','26320','26350','26380','26410','26440','26470','26500','26530','26710'];
const FROM = '202002';
const TO = '202408';
const OUT = process.env.V3_OUT || path.resolve(__dirname, '../../tmp-v3-scan.json');

function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let y = parseInt(from.slice(0, 4), 10), m = parseInt(from.slice(4), 10);
  const ey = parseInt(to.slice(0, 4), 10), em = parseInt(to.slice(4), 10);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const nk = (r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null; occurrenceIndex: number }) =>
  `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}|${r.occurrenceIndex}`;

interface Candidate {
  lawdCd: string; dealYmd: string; aptSeq: string | null; aptName: string; dong: string;
  dealDate: string; dealAmount: number; floor: number | null; exclusiveArea: string;
  groupKeyStr: string; sourceCancelDate: string | null; dbId: number;
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'record-high-trust/historical-cancellation-scan.ts');
  const t0 = Date.now();
  const months = monthsInRange(FROM, TO);
  const cells: { lawdCd: string; dealYmd: string }[] = [];
  for (const m of months) for (const l of BUSAN_16) cells.push({ lawdCd: l, dealYmd: m });

  console.log(`RECORD HIGH TRUST V3 — HISTORICAL CANCELLATION SCAN (READ ONLY)`);
  console.log(`range ${FROM}~${TO} = ${months.length} months x ${BUSAN_16.length} districts = ${cells.length} cells\n`);

  let apiCalls = 0, srcFetched = 0, dbMatched = 0;
  let cA = 0, cC = 0;
  const candidates: Candidate[] = [];
  const reverse: any[] = [];
  const otherMutation: any[] = [];
  const unmatchedSrc: any[] = [];   // source에 있는데 DB에 없음(자연키 기준)
  const unmatchedDb: any[] = [];    // DB에 있는데 source에 없음
  const blockedCells: { cell: string; reason: string }[] = [];
  const affectedCells = new Set<string>();
  let cellsComplete = 0;
  let noCancelDate = 0;

  let i = 0;
  for (const c of cells) {
    i++;
    const label = `${c.lawdCd}/${c.dealYmd}`;
    let f;
    try {
      f = await fetchSaleRegionMonth(c.lawdCd, c.dealYmd);
    } catch (e: any) {
      blockedCells.push({ cell: label, reason: `fetch throw: ${e?.message ?? e}` });
      continue;
    }
    apiCalls += Math.max(1, f.pagesFetched);

    if (f.status !== 'COMPLETE' || f.totalCount === null || f.collectedCount !== f.totalCount) {
      blockedCells.push({ cell: label, reason: `status=${f.status} collected=${f.collectedCount} total=${f.totalCount}` });
      continue;
    }
    cellsComplete++;
    srcFetched += f.collectedCount;

    const { rows: srcRows, invalid } = normalizeMolitItemsToTradeRows(f.items, c.lawdCd, c.dealYmd);
    if (invalid.length) blockedCells.push({ cell: label, reason: `invalid rows=${invalid.length}` });

    const dbRows = await prisma.apartmentTradeHistory.findMany({
      where: { lawdCd: c.lawdCd, dealYmd: c.dealYmd, dealType: 'sale' },
      select: {
        id: true, groupKeyStr: true, dealAmount: true, dealDate: true, floor: true, occurrenceIndex: true,
        aptName: true, dong: true, aptSeq: true, exclusiveArea: true, dealCanceled: true, cancelDate: true,
      },
    });

    const dbMap = new Map(dbRows.map((d) => [nk({ ...d, dealDate: ymd(d.dealDate) }), d]));
    const seen = new Set<string>();

    for (const s of srcRows) {
      const key = nk(s);
      const d = dbMap.get(key);
      if (!d) { unmatchedSrc.push({ cell: label, nk: key, aptName: s.aptName, canceled: s.dealCanceled }); continue; }
      seen.add(key);
      dbMatched++;

      // §6 cancellation 외 필드 변화 확인 (자연키에 포함되지 않는 필드)
      const bad: string[] = [];
      if (d.aptName !== s.aptName) bad.push('aptName');
      if (d.dong !== s.dong) bad.push('dong');
      if (Number(d.exclusiveArea) !== Number(s.exclusiveArea)) bad.push('exclusiveArea');
      if ((d.aptSeq ?? null) !== (s.aptSeq ?? null)) bad.push('aptSeq');
      if (bad.length) otherMutation.push({ cell: label, nk: key, fields: bad, db: { aptName: d.aptName, dong: d.dong, area: String(d.exclusiveArea), aptSeq: d.aptSeq }, src: { aptName: s.aptName, dong: s.dong, area: String(s.exclusiveArea), aptSeq: s.aptSeq } });

      // §3 분류
      if (!d.dealCanceled && !s.dealCanceled) { cA++; continue; }
      if (d.dealCanceled && s.dealCanceled) { cC++; continue; }
      if (!d.dealCanceled && s.dealCanceled) {
        if (!s.cancelDate) noCancelDate++;
        candidates.push({
          lawdCd: c.lawdCd, dealYmd: c.dealYmd, aptSeq: s.aptSeq, aptName: s.aptName, dong: s.dong,
          dealDate: s.dealDate, dealAmount: s.dealAmount, floor: s.floor, exclusiveArea: String(s.exclusiveArea),
          groupKeyStr: s.groupKeyStr, sourceCancelDate: s.cancelDate, dbId: d.id,
        });
        affectedCells.add(label);
        continue;
      }
      // d.dealCanceled && !s.dealCanceled
      reverse.push({ cell: label, nk: key, aptName: d.aptName, dbCancelDate: d.cancelDate });
    }

    for (const d of dbRows) {
      const k = nk({ ...d, dealDate: ymd(d.dealDate) });
      if (!seen.has(k)) unmatchedDb.push({ cell: label, nk: k, aptName: d.aptName, canceled: d.dealCanceled });
    }

    if (i % 40 === 0 || i === cells.length) {
      console.log(`[${i}/${cells.length}] complete=${cellsComplete} blocked=${blockedCells.length} candidates=${candidates.length} reverse=${reverse.length} elapsed=${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }

  // ---------- §11 장기 최고가 영향 분석 ----------
  console.log('\n§11 장기 최고가 영향 분석 중...');
  const byGroup = new Map<string, Candidate[]>();
  for (const c of candidates) (byGroup.get(c.groupKeyStr) ?? byGroup.set(c.groupKeyStr, []).get(c.groupKeyStr)!).push(c);
  const groupKeys = [...byGroup.keys()];
  const maxValid = new Map<string, number>();
  const CH = 400;
  for (let k = 0; k < groupKeys.length; k += CH) {
    const chunk = groupKeys.slice(k, k + CH);
    const rows: { group_key: string; mx: number }[] = await prisma.$queryRawUnsafe(
      `SELECT group_key, max(deal_amount)::int mx FROM apartment_trade_histories
       WHERE deal_type='sale' AND deal_canceled=false AND deal_date >= DATE '2020-02-01'
         AND group_key = ANY($1::text[]) GROUP BY 1`, chunk
    );
    for (const r of rows) maxValid.set(r.group_key, r.mx);
  }
  // 후보를 제외한 나머지 유효거래의 최고가와 비교해야 하므로, 후보 자신이 최고가인 경우를 찾는다.
  let wouldBeFalseHigh = 0;
  const falseHighSamples: any[] = [];
  for (const c of candidates) {
    const mx = maxValid.get(c.groupKeyStr);
    if (mx != null && c.dealAmount >= mx) {
      wouldBeFalseHigh++;
      if (falseHighSamples.length < 15) falseHighSamples.push({ apt: c.aptName, area: c.exclusiveArea, date: c.dealDate, amount: c.dealAmount, groupMaxValid: mx, cancelDate: c.sourceCancelDate });
    }
  }

  // rolling 24개월 침범 확인
  const cut = new Date(); cut.setMonth(cut.getMonth() - 24);
  const inRolling = candidates.filter((c) => new Date(c.dealDate) >= cut).length;

  const report = {
    range: { from: FROM, to: TO, months: months.length, districts: BUSAN_16.length },
    cellsTotal: cells.length, cellsComplete, blockedCells,
    srcFetched, dbMatched,
    classification: { A_unchanged_valid: cA, B_flip_candidates: candidates.length, C_already_canceled: cC, D_reverse: reverse.length, E_unmatched_src: unmatchedSrc.length, E_unmatched_db: unmatchedDb.length },
    affectedCells: affectedCells.size,
    candidatesWithoutCancelDate: noCancelDate,
    otherMutation: otherMutation.length,
    inRolling24m: inRolling,
    longTermHighImpact: { wouldBeFalseHigh, samples: falseHighSamples },
    perf: { apiCalls, runtimeSec: Math.round((Date.now() - t0) / 1000) },
    candidatesSample: candidates.slice(0, 25),
    reverseSample: reverse.slice(0, 25),
    otherMutationSample: otherMutation.slice(0, 25),
    unmatchedSrcSample: unmatchedSrc.slice(0, 25),
    unmatchedDbSample: unmatchedDb.slice(0, 25),
    byCell: [...affectedCells].sort(),
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n================ V3 SCAN SUMMARY ================');
  console.log('target range              :', FROM, '~', TO, `(${months.length} months x 16 = ${cells.length} cells)`);
  console.log('cells COMPLETE            :', cellsComplete, '/', cells.length);
  console.log('cells BLOCKED             :', blockedCells.length);
  console.log('source rows fetched       :', srcFetched);
  console.log('DB rows matched (자연키)   :', dbMatched);
  console.log('--- classification ---');
  console.log('A unchanged valid         :', cA);
  console.log('B false->true candidates  :', candidates.length);
  console.log('C already canceled        :', cC);
  console.log('D reverse true->false     :', reverse.length);
  console.log('E unmatched (source only) :', unmatchedSrc.length);
  console.log('E unmatched (DB only)     :', unmatchedDb.length);
  console.log('other field mutation      :', otherMutation.length);
  console.log('affected cells            :', affectedCells.size);
  console.log('candidates w/o cancelDate :', noCancelDate);
  console.log('--- impact ---');
  console.log('rolling 24m 침범 후보      :', inRolling, '(0이어야 함)');
  console.log('장기 최고가 왜곡 후보      :', wouldBeFalseHigh);
  console.log('--- perf ---');
  console.log('API calls                 :', apiCalls);
  console.log('runtime                   :', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  console.log('\nreport written to:', OUT);
  console.log('Production writes performed: 0');
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
