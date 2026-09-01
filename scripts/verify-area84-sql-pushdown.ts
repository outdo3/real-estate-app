// PERFORMANCE_V1_1_B — verifies getArea84RowsFromDb() (SQL pushdown,
// trade-history-read.ts) against buildArea84RankingRows() (the pre-existing
// JS reference implementation, price-ranking.ts) using real production data.
// Read-only. Run this again after touching either implementation to prove
// zero regression before shipping.
//
// Usage: npx ts-node --transpile-only --compiler-options '{"module":"commonjs","moduleResolution":"node"}' -r ./scripts/_register-paths.js scripts/verify-area84-sql-pushdown.ts
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/lib/prisma';
import { getArea84RowsFromDb } from '../src/lib/trade-history-read';
import { queryTrades } from '../src/lib/trade-history-read';
import { buildArea84RankingRows, resolvePriceRankingPeriod, HISTORICAL_LOOKBACK_MONTHS, dedupeTrades, type FeedTrade } from '../src/lib/price-ranking';

const BUSAN_LAWD_CDS = ['26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320', '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710'];

function storedTradeToFeedTrade(t: Awaited<ReturnType<typeof queryTrades>>['trades'][number]): FeedTrade {
  return {
    uid: String(t.id),
    aptSeq: t.aptSeq,
    name: t.aptName,
    dong: t.dong,
    lawdCd: t.lawdCd,
    dealType: 'sale',
    dealAmount: t.dealAmount,
    excluUseArea: Number(t.exclusiveArea),
    floorRaw: t.floor,
    dealDate: t.dealDate.toISOString().slice(0, 10),
    dealCanceled: t.dealCanceled,
  };
}

function sqlRowToOracleShape(r: Awaited<ReturnType<typeof getArea84RowsFromDb>>[number]) {
  const priorHighAmount = r.priorHighAmount;
  const recent2yHighAmount = priorHighAmount != null && priorHighAmount > r.currentAmount ? priorHighAmount : r.currentAmount;
  const isRecent2yHigh = recent2yHighAmount === r.currentAmount;
  return {
    aptSeq: r.aptSeq,
    name: r.aptName,
    dong: r.dong,
    lawdCd: r.lawdCd,
    excluUseArea: Number(r.exclusiveArea),
    floorRaw: r.floor,
    currentAmount: r.currentAmount,
    currentDate: r.currentDate.toISOString().slice(0, 10),
    previousAmount: r.previousAmount,
    previousDate: r.previousDate ? new Date(r.previousDate).toISOString().slice(0, 10) : null,
    changeAmount: r.previousAmount != null ? r.currentAmount - r.previousAmount : null,
    changePct: r.previousAmount != null && r.previousAmount > 0 ? Math.round(((r.currentAmount - r.previousAmount) / r.previousAmount) * 1000) / 10 : null,
    recent2yHighAmount,
    isRecent2yHigh,
    recent2yHighDeltaPct: isRecent2yHigh ? null : Math.round(((r.currentAmount - recent2yHighAmount) / recent2yHighAmount) * 1000) / 10,
    trailing12moSampleCount: r.trailingSampleCount,
  };
}

const FIELDS = ['excluUseArea', 'floorRaw', 'currentAmount', 'currentDate', 'previousAmount', 'previousDate', 'changeAmount', 'changePct', 'recent2yHighAmount', 'isRecent2yHigh', 'recent2yHighDeltaPct', 'trailing12moSampleCount'] as const;

async function runCase(label: string, lawdCds: string[], period: { from: string; to: string }) {
  const from = new Date();
  from.setMonth(from.getMonth() - HISTORICAL_LOOKBACK_MONTHS);
  const { trades } = await queryTrades({ lawdCd: lawdCds, from, exclusiveAreaRange: { gte: 84, lt: 85 } });
  const allTrades = dedupeTrades(trades.map(storedTradeToFeedTrade));
  const oldRows = buildArea84RankingRows(allTrades, period);
  const sqlRows = await getArea84RowsFromDb(lawdCds, period.from, period.to);
  const newRows = sqlRows.map(sqlRowToOracleShape);

  const keyOf = (r: { aptSeq: string | null; name: string; dong: string }) => (r.aptSeq ? `id:${r.aptSeq}` : `nd:${r.name}|${r.dong}`);
  const oldMap = new Map(oldRows.map((r) => [keyOf(r), r]));
  const newMap = new Map(newRows.map((r) => [keyOf(r), r]));

  let mismatches = 0;
  const details: string[] = [];
  for (const k of oldMap.keys()) if (!newMap.has(k)) { mismatches++; details.push(`MISSING in NEW: ${k}`); }
  for (const k of newMap.keys()) if (!oldMap.has(k)) { mismatches++; details.push(`EXTRA in NEW: ${k}`); }
  for (const [k, o] of oldMap) {
    const n = newMap.get(k);
    if (!n) continue;
    for (const f of FIELDS) {
      const ov = (o as any)[f];
      const nv = (n as any)[f];
      if (ov !== nv) { mismatches++; details.push(`FIELD MISMATCH ${k}.${f}: old=${JSON.stringify(ov)} new=${JSON.stringify(nv)}`); }
    }
  }
  return { label, oldCount: oldRows.length, newCount: newRows.length, mismatches, details };
}

async function main() {
  const now = new Date();
  const periods: Array<[string, ReturnType<typeof resolvePriceRankingPeriod>]> = [
    ['30d', resolvePriceRankingPeriod('30d', now)],
    ['3m', resolvePriceRankingPeriod('3m', now)],
    ['12m', resolvePriceRankingPeriod('12m', now)],
  ];
  const districts: Record<string, string[]> = Object.fromEntries(BUSAN_LAWD_CDS.map((c) => [c, [c]]));

  const results = [];
  for (const [pname, period] of periods) results.push(await runCase(`Busan-wide/${pname}`, BUSAN_LAWD_CDS, period));
  for (const [dname, codes] of Object.entries(districts)) {
    for (const [pname, period] of periods) results.push(await runCase(`${dname}/${pname}`, codes, period));
  }

  const totalMismatches = results.reduce((s, r) => s + r.mismatches, 0);
  const totalRows = results.reduce((s, r) => s + r.oldCount, 0);
  for (const r of results) {
    console.log(`[${r.label}] old=${r.oldCount} new=${r.newCount} mismatches=${r.mismatches}`);
    if (r.mismatches > 0) console.log(r.details.slice(0, 20).join('\n'));
  }
  console.log(`\nTOTAL: ${results.length} cases, ${totalRows} rows compared, ${totalMismatches} mismatches`);

  const outPath = path.resolve(__dirname, 'area84-sql-pushdown-verify.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), totalCases: results.length, totalRows, totalMismatches, results }, null, 2));
  console.log(`결과 저장: ${outPath}`);

  await prisma.$disconnect();
  if (totalMismatches > 0) process.exit(1);
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
