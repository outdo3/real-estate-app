/**
 * BUSAN_12M_STATS_PERFORMANCE_FIX_V1 §2 — 단계별 시간 분해(READ ONLY).
 * "22초 중 몇 초가 어디서 쓰였는지" / "고친 뒤 몇 초가 어디서 쓰이는지"를 숫자로 남긴다.
 */
import { config } from 'dotenv';
config({ path: '.env', quiet: true });
config({ path: '.env.local', quiet: true });

async function main() {
  const rf = await import('../src/lib/regional-feed');
  const { getSigunguListForSido } = await import('../src/lib/region-utils');
  const { fetchMonthsThrottledWithStatus } = await import('../src/lib/molit-stats-helpers');
  const { loadBusanFeedTradesFromDb } = await import('../src/lib/stats/feed-db-source');
  const { splitVerifiedMonths, getRentVerifiedRange } = await import('../src/lib/rent-history-read');
  const { resolveApartmentContextBatch } = await import('../src/lib/statistics-pyeong-resolver');
  const { prisma } = await import('../src/lib/prisma');

  const T: Array<[string, number]> = [];
  let t0 = Date.now();
  const lap = (name: string) => { const n = Date.now(); T.push([name, n - t0]); t0 = n; };

  const periodRange = rf.resolvePeriodRange('12m', new Date());
  const months = rf.monthsForRange(periodRange);

  const districts = await getSigunguListForSido('26');
  const lawdCds = districts.map((d) => d.code.substring(0, 5));
  lap('getSigunguListForSido (regcode proxy, 외부 HTTP 1회)');

  const rentSplit = splitVerifiedMonths(months, await getRentVerifiedRange());
  lap('getRentVerifiedRange (sync_coverage_cells 1 query, 5분 캐시)');

  const tasks = lawdCds.flatMap((d) => rentSplit.unverified.map((m) => ({ key: `${d}|rent:${m}`, lawdCd: d, dealYmd: m, type: 'rent' as const })));
  const tMolit = Date.now();
  const tDb = Date.now();
  const [results, db] = await Promise.all([
    fetchMonthsThrottledWithStatus(tasks).then((r) => { T.push([`  └ MOLIT ${tasks.length} tasks (검증 안 된 월의 전월세만)`, Date.now() - tMolit]); return r; }),
    loadBusanFeedTradesFromDb(lawdCds, months, rentSplit.verified).then((r) => { T.push([`  └ DB sale ${r.saleRowCount} + rent ${r.rentRowCount} rows (2 queries, 병렬)`, Date.now() - tDb]); return r; }),
  ]);
  lap('fetch 단계 전체(위 둘의 병렬 벽시계)');

  const trades = [...db.trades];
  for (const d of lawdCds) for (const m of months) for (const raw of results[`${d}|rent:${m}`]?.items || []) {
    const t = rf.toFeedTrade(raw, raw.monthlyRent > 0 ? 'wolse' : 'jeonse', d);
    if (t) trades.push(t);
  }
  lap(`toFeedTrade 조립 (${trades.length} trades)`);

  const all = rf.dedupeTrades(trades);
  lap(`dedupeTrades (-> ${all.length})`);
  const annotations = rf.annotateTrades(all);
  lap('annotateTrades (신고가/직전거래)');
  const period = all.filter((t) => rf.isDateInRange(t.dealDate, periodRange));
  const summary = rf.buildRegionSummary(period, annotations);
  lap(`buildRegionSummary (totalCount ${summary.totalCount})`);
  const verified = rf.filterVerifiedTrades(period);
  const dongCounts: Record<string, number> = {};
  const areaBandCounts: Record<string, number> = {};
  for (const t of verified) { if (t.dong) dongCounts[t.dong] = (dongCounts[t.dong] || 0) + 1; const b = rf.areaBandLabel(t.excluUseArea); if (b) areaBandCounts[b] = (areaBandCounts[b] || 0) + 1; }
  rf.buildMarketInterpretation({
    periodLabel: '최근 12개월', periodDays: 347, summary,
    lookbackVerifiedCount: verified.length, lookbackDays: 347, dongCounts, areaBandCounts,
    recordHighCoverageLabel: rf.windowCoverageLabel(periodRange.from, periodRange.to),
  });
  lap('해석문+동/면적 집계');

  const sorted = [...period].sort((a, b) => (b.dealDate === a.dealDate ? b.dealAmount - a.dealAmount : b.dealDate.localeCompare(a.dealDate)));
  const page = sorted.slice(0, 50);
  lap('정렬 + 페이지 슬라이스');

  const keys = new Map<string, any>();
  for (const t of page) keys.set(rf.identityKey(t), { name: t.name, dong: t.dong, aptSeq: t.aptSeq, rawAreaM2: 0 });
  await resolveApartmentContextBatch(prisma, Array.from(keys.values()));
  lap(`resolveApartmentContextBatch (페이지 ${page.length}건 단지 identity)`);

  const total = T.filter(([n]) => !n.startsWith('  └')).reduce((a, [, v]) => a + v, 0);
  console.log('stage                                                                 ms');
  for (const [n, v] of T) console.log(`${n.padEnd(66)} ${String(v).padStart(6)}`);
  console.log(`${'TOTAL (병렬 구간은 한 번만 계산)'.padEnd(66)} ${String(total).padStart(6)}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
