/**
 * SALE_CANCELLATION_COVERAGE_V1 — RECHECK BAND SCAN (READ ONLY).
 *
 * 제안된 recheck band(= latestComplete-12 ~ latestComplete-3, 부산 16개 구)를 원천과
 * 전수 대조해 다음을 실측한다:
 *
 *   1. DB=false / source=true  — daily 3개월 overlap이 놓친 **late cancellation**
 *   2. DB=true  / source=false — 원천 un-cancel(역전 위험의 실재 여부)
 *   3. source-only rows        — 이 band에서 insert가 발생할 여지
 *   4. cell completeness       — pagination 검증 통과 여부
 *   5. per-cell runtime        — 60초 Function 예산 설계 근거
 *
 * **Production write 없음** — 이 파일에는 create/createMany/update/upsert/delete 호출이
 * 존재하지 않는다. prisma는 findMany로만 쓴다.
 *
 * 매칭은 기존 검증된 자연키만 사용한다:
 *   (groupKeyStr, dealAmount, dealDate, floor, occurrenceIndex)
 * name-only fallback / loose substring / dong fallback / first-match 는 쓰지 않는다.
 *
 * 사용법:
 *   ALLOW_PROD_DB_READ=1 npx ts-node --transpile-only \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     -r ./scripts/_register-paths.js scripts/sale-cancellation-coverage/band-scan.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { normalizeMolitItemsToTradeRows } from '../trade-history-logic';
import { fetchSaleRegionMonth } from '../sale-molit-fetch';
import { classifyRow } from '../write-policy-logic';
import { latestCompleteMonth, subtractMonths } from '../rent-trade-history/incremental-sync-completed-month-logic';
import { assertProductionDbAccessAllowed } from '../_prod-db-guard';

const prisma = new PrismaClient();

const BUSAN_16 = ['26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320', '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710'];

/** 설계값과 동일하게 유지한다 — 이 스캔이 곧 구현 대상 band다. */
const RECHECK_MIN_MONTHS_BACK = 3;
const RECHECK_MAX_MONTHS_BACK = 12;

const OUT = process.env.SCC_OUT || path.resolve(__dirname, '../../tmp/scc-v1-band-scan.json');

function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let y = parseInt(from.slice(0, 4), 10);
  let m = parseInt(from.slice(4), 10);
  const ey = parseInt(to.slice(0, 4), 10);
  const em = parseInt(to.slice(4), 10);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const nk = (r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null; occurrenceIndex: number }) =>
  `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}|${r.occurrenceIndex}`;

/** cancelDate("YY.MM.DD") - dealDate 를 개월로. 원천 형식은 api-molit.ts와 동일 가정. */
function lagMonths(dealDate: string, cancelDate: string | null): number | null {
  if (!cancelDate) return null;
  const m = cancelDate.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return null;
  const cd = new Date(Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dd = new Date(`${dealDate}T00:00:00.000Z`);
  if (Number.isNaN(cd.getTime()) || Number.isNaN(dd.getTime())) return null;
  return (cd.getTime() - dd.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

interface LateCancellation {
  lawdCd: string; dealYmd: string; aptSeq: string | null; aptName: string;
  dealDate: string; dealAmount: number; floor: number | null;
  sourceCancelDate: string | null; lagMonths: number | null; dbId: number;
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'sale-cancellation-coverage/band-scan.ts');
  const t0 = Date.now();
  const now = new Date();
  const latestComplete = latestCompleteMonth(now);
  const from = subtractMonths(latestComplete, RECHECK_MAX_MONTHS_BACK);
  const to = subtractMonths(latestComplete, RECHECK_MIN_MONTHS_BACK);
  const months = monthsInRange(from, to);

  console.log('SALE CANCELLATION COVERAGE V1 — RECHECK BAND SCAN (READ ONLY)');
  console.log(`now=${ymd(now)} latestComplete=${latestComplete}`);
  console.log(`band [${from},${to}] = ${months.length} months x ${BUSAN_16.length} districts = ${months.length * BUSAN_16.length} cells\n`);

  const cellTimings: { lawdCd: string; dealYmd: string; ms: number; status: string; fetched: number }[] = [];
  const statusCounts: Record<string, number> = {};
  const lateCancellations: LateCancellation[] = [];
  const reverse: unknown[] = [];
  const conflicts: unknown[] = [];
  const reviewRequired: unknown[] = [];
  let srcFetched = 0, dbMatched = 0, sourceOnly = 0, alreadyCanceled = 0, noop = 0;

  for (const dealYmd of months) {
    for (const lawdCd of BUSAN_16) {
      const cellStart = Date.now();
      const fetchResult = await fetchSaleRegionMonth(lawdCd, dealYmd);
      statusCounts[fetchResult.status] = (statusCounts[fetchResult.status] ?? 0) + 1;

      if (fetchResult.status === 'INVALID' || fetchResult.status === 'PARTIAL') {
        cellTimings.push({ lawdCd, dealYmd, ms: Date.now() - cellStart, status: fetchResult.status, fetched: fetchResult.collectedCount });
        console.log(`${fetchResult.status} ${lawdCd}:${dealYmd} fetched=${fetchResult.collectedCount}/${fetchResult.totalCount ?? '?'} — 쓰기 대상 아님`);
        continue;
      }

      const { rows } = normalizeMolitItemsToTradeRows(fetchResult.items, lawdCd, dealYmd);
      srcFetched += rows.length;

      const existing = await prisma.apartmentTradeHistory.findMany({
        where: { lawdCd, dealYmd },
        select: { id: true, groupKeyStr: true, dealAmount: true, dealDate: true, floor: true, occurrenceIndex: true, dealCanceled: true, aptName: true, dong: true, aptSeq: true },
      });
      const map = new Map<string, (typeof existing)[number]>();
      for (const e of existing) {
        if (e.floor == null) continue;
        map.set(nk({ groupKeyStr: e.groupKeyStr, dealAmount: e.dealAmount, dealDate: ymd(e.dealDate), floor: e.floor, occurrenceIndex: e.occurrenceIndex }), e);
      }

      let cellLate = 0;
      for (const row of rows) {
        const match = map.get(nk(row));
        const kind = classifyRow(row, match);
        if (match) dbMatched++;
        if (kind === 'insert') { sourceOnly++; continue; }
        if (kind === 'reviewRequired') { reviewRequired.push({ lawdCd, dealYmd, aptName: row.aptName, dealDate: row.dealDate }); continue; }
        if (kind === 'conflict') { conflicts.push({ lawdCd, dealYmd, aptName: row.aptName, dealDate: row.dealDate }); continue; }
        if (kind === 'updateTrueToFalseSkipped') { reverse.push({ lawdCd, dealYmd, aptName: row.aptName, dealDate: row.dealDate, dbId: match!.id }); continue; }
        if (kind === 'updateFalseToTrue') {
          cellLate++;
          lateCancellations.push({
            lawdCd, dealYmd, aptSeq: match!.aptSeq, aptName: row.aptName,
            dealDate: row.dealDate, dealAmount: row.dealAmount, floor: row.floor,
            sourceCancelDate: row.cancelDate, lagMonths: lagMonths(row.dealDate, row.cancelDate), dbId: match!.id,
          });
          continue;
        }
        // noop
        if (match!.dealCanceled) alreadyCanceled++;
        noop++;
      }

      const ms = Date.now() - cellStart;
      cellTimings.push({ lawdCd, dealYmd, ms, status: fetchResult.status, fetched: rows.length });
      console.log(`${fetchResult.status} ${lawdCd}:${dealYmd} src=${rows.length} db=${existing.length} late=${cellLate} ${ms}ms`);
    }
  }

  const durMs = Date.now() - t0;
  const times = cellTimings.map((c) => c.ms).sort((a, b) => a - b);
  const pct = (p: number) => (times.length ? times[Math.min(times.length - 1, Math.floor((times.length * p) / 100))] : 0);
  const lags = lateCancellations.map((c) => c.lagMonths).filter((v): v is number => v != null).sort((a, b) => a - b);
  const lagPct = (p: number) => (lags.length ? lags[Math.min(lags.length - 1, Math.floor((lags.length * p) / 100))] : null);

  const summary = {
    generatedAt: new Date().toISOString(),
    now: ymd(now),
    latestComplete,
    band: { from, to, months: months.length, districts: BUSAN_16.length, cells: months.length * BUSAN_16.length },
    cellStatusCounts: statusCounts,
    sourceRowsFetched: srcFetched,
    dbRowsMatched: dbMatched,
    lateCancellations: lateCancellations.length,
    alreadyCanceled,
    noop,
    sourceOnlyInsertCandidates: sourceOnly,
    reverseTrueToFalse: reverse.length,
    conflicts: conflicts.length,
    reviewRequired: reviewRequired.length,
    runtime: {
      totalMs: durMs,
      cells: cellTimings.length,
      meanCellMs: cellTimings.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
      p50CellMs: pct(50), p90CellMs: pct(90), p99CellMs: pct(99), maxCellMs: times[times.length - 1] ?? 0,
    },
    lateCancellationLagMonths: { p50: lagPct(50), p90: lagPct(90), p99: lagPct(99), max: lags[lags.length - 1] ?? null },
    perMonth: months.map((m) => ({
      dealYmd: m,
      late: lateCancellations.filter((c) => c.dealYmd === m).length,
      cells: cellTimings.filter((c) => c.dealYmd === m).length,
    })),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ summary, lateCancellations, reverse, conflicts, reviewRequired, cellTimings }, null, 2));

  console.log('\n================ SUMMARY ================');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nwrote ${OUT}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
