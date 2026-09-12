/**
 * BUSAN_12M_STATS_PERFORMANCE_FIX_V1 §5 DATA TRUST GATE — A/B 대조(READ ONLY).
 *
 * 같은 12개월 창을 두 경로로 만들어 **응답에 실제로 실리는 숫자**가 같은지 본다.
 *   OLD = MOLIT 384 호출 (구 × 12개월 × 매매/전월세)
 *   NEW = DB(매매 전체 + 검증범위 안 전월세) + MOLIT(검증 안 된 월의 전월세)
 * 두 경로 모두 이후 파이프라인(dedupe → annotate → summary → 정렬)은 라우트와
 * **완전히 같은 함수**를 쓴다 — 감사 전용 로직을 새로 만들지 않는다.
 *
 * 구 단위로 먼저 비교한다(RENT PHASE D §8 교훈: 부산 전체 동시 버스트는 MOLIT 응답을
 * 일시적으로 과소 반환하게 만들어 대조 자체를 오염시킨다). DB SELECT만, MOLIT GET만.
 */
import { config } from 'dotenv';
config({ path: '.env', quiet: true });
config({ path: '.env.local', quiet: true });

type FeedTrade = import('../src/lib/regional-feed').FeedTrade;

async function main() {
  const rf = await import('../src/lib/regional-feed');
  const { fetchMonthsThrottledWithStatus } = await import('../src/lib/molit-stats-helpers');
  const { loadBusanFeedTradesFromDb } = await import('../src/lib/stats/feed-db-source');
  const { splitVerifiedMonths, getRentVerifiedRange } = await import('../src/lib/rent-history-read');
  const { prisma } = await import('../src/lib/prisma');

  const { resolvePeriodRange, monthsForRange, toFeedTrade, dedupeTrades, annotateTrades, buildRegionSummary, groupKey } = rf;

  const now = new Date();
  const periodRange = resolvePeriodRange('12m', now);
  const months = monthsForRange(periodRange);
  const range = await getRentVerifiedRange();
  const rentSplit = splitVerifiedMonths(months, range);
  const BUSAN = ['26110','26140','26170','26200','26230','26260','26290','26320','26350','26380','26410','26440','26470','26500','26530','26710'];

  console.log(`window     ${periodRange.from} ~ ${periodRange.to}  (${months.length} months)`);
  console.log(`rent verified ${range.from}~${range.to}  -> DB months ${rentSplit.verified.length}, MOLIT months ${rentSplit.unverified.length}`);
  console.log();

  const sig = (t: FeedTrade) => `${groupKey(t)}|${t.dealAmount}|${t.dealDate}|${t.floorRaw}`;
  const sigC = (t: FeedTrade) => `${sig(t)}|${t.dealCanceled}`;
  const diff = (a: FeedTrade[], b: FeedTrade[], key: (t: FeedTrade) => string) => {
    const cnt = (xs: FeedTrade[]) => { const m = new Map<string, number>(); for (const x of xs) m.set(key(x), (m.get(key(x)) || 0) + 1); return m; };
    const ma = cnt(a), mb = cnt(b);
    let onlyA = 0, onlyB = 0;
    for (const [k, n] of ma) onlyA += Math.max(0, n - (mb.get(k) || 0));
    for (const [k, n] of mb) onlyB += Math.max(0, n - (ma.get(k) || 0));
    return { onlyA, onlyB };
  };

  const oldAll: FeedTrade[] = [];
  const newAll: FeedTrade[] = [];

  console.log('district | OLD(MOLIT) | NEW(DB+) | onlyOLD | onlyNEW | onlyOLD(+취소플래그) | onlyNEW(+취소플래그)');
  for (const d of BUSAN) {
    // OLD — 그 구의 12개월 × 2타입을 MOLIT으로.
    const tasks = months.flatMap((m) => [
      { key: `${d}|apt:${m}`, lawdCd: d, dealYmd: m, type: 'apt' as const },
      { key: `${d}|rent:${m}`, lawdCd: d, dealYmd: m, type: 'rent' as const },
    ]);
    const res = await fetchMonthsThrottledWithStatus(tasks);
    const failed = Object.values(res).filter((r) => r.failed).length;
    const oldTrades: FeedTrade[] = [];
    for (const m of months) {
      for (const raw of res[`${d}|apt:${m}`]?.items || []) { const t = toFeedTrade(raw, 'sale', d); if (t) oldTrades.push(t); }
      for (const raw of res[`${d}|rent:${m}`]?.items || []) { const t = toFeedTrade(raw, raw.monthlyRent > 0 ? 'wolse' : 'jeonse', d); if (t) oldTrades.push(t); }
    }

    // NEW — DB(매매 전체 + 검증 전월세) + MOLIT(검증 안 된 월 전월세).
    const db = await loadBusanFeedTradesFromDb([d], months, rentSplit.verified);
    const newTrades: FeedTrade[] = [...db.trades];
    for (const m of rentSplit.unverified) {
      for (const raw of res[`${d}|rent:${m}`]?.items || []) { const t = toFeedTrade(raw, raw.monthlyRent > 0 ? 'wolse' : 'jeonse', d); if (t) newTrades.push(t); }
    }

    const o = dedupeTrades(oldTrades);
    const n = dedupeTrades(newTrades);
    const dIgnoreCancel = diff(o, n, sig);
    const dWithCancel = diff(o, n, sigC);
    oldAll.push(...o);
    newAll.push(...n);
    console.log(`${d}    | ${String(o.length).padStart(10)} | ${String(n.length).padStart(8)} | ${String(dIgnoreCancel.onlyA).padStart(7)} | ${String(dIgnoreCancel.onlyB).padStart(7)} | ${String(dWithCancel.onlyA).padStart(19)} | ${String(dWithCancel.onlyB).padStart(19)}${failed ? `   (MOLIT failed tasks: ${failed})` : ''}`);
  }

  console.log('\n=== BUSAN-WIDE RESPONSE FIELDS ===');
  const run = (trades: FeedTrade[]) => {
    const all = dedupeTrades(trades);
    const annotations = annotateTrades(all);
    const period = all.filter((t) => rf.isDateInRange(t.dealDate, periodRange));
    const summary = buildRegionSummary(period, annotations);
    const sorted = [...period].sort((a, b) => (b.dealDate === a.dealDate ? b.dealAmount - a.dealAmount : b.dealDate.localeCompare(a.dealDate)));
    const verified = rf.filterVerifiedTrades(period);
    const dongCounts: Record<string, number> = {};
    for (const t of verified) if (t.dong) dongCounts[t.dong] = (dongCounts[t.dong] || 0) + 1;
    return { summary, total: sorted.length, page: sorted.slice(0, 10), topDongs: Object.entries(dongCounts).sort((a, b) => b[1] - a[1]).slice(0, 5) };
  };
  const A = run(oldAll);
  const B = run(newAll);
  const fields = ['totalCount', 'verifiedCount', 'cancelledCount', 'recordHighCount', 'riseCount', 'fallCount'] as const;
  console.log('field           |        OLD |        NEW | delta');
  for (const f of fields) {
    const a = (A.summary as any)[f];
    const b = (B.summary as any)[f];
    console.log(`${f.padEnd(15)} | ${String(a).padStart(10)} | ${String(b).padStart(10)} | ${b - a}`);
  }
  console.log(`${'pagination.total'.padEnd(15)} | ${String(A.total).padStart(10)} | ${String(B.total).padStart(10)} | ${B.total - A.total}`);
  console.log('\ntopDongs OLD:', JSON.stringify(A.topDongs));
  console.log('topDongs NEW:', JSON.stringify(B.topDongs));
  console.log('\nfirst page (10) identical:', JSON.stringify(A.page.map(sigC)) === JSON.stringify(B.page.map(sigC)));
  for (let i = 0; i < 10; i++) {
    const a = A.page[i] ? sigC(A.page[i]) : '-';
    const b = B.page[i] ? sigC(B.page[i]) : '-';
    console.log(`  ${i} ${a === b ? 'SAME' : 'DIFF'}\n     OLD ${a}\n     NEW ${b}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
