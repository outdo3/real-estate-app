/**
 * BUSAN_12M_STATS_PERFORMANCE_FIX_V1 §5 — A/B 차이의 **원인 분류**(READ ONLY).
 * 차이 행을 dealType / 월 / 방향으로 쪼개서, 어떤 계열의 차이인지 확정한다.
 */
import { config } from 'dotenv';
config({ path: '.env', quiet: true });
config({ path: '.env.local', quiet: true });

type FeedTrade = import('../src/lib/regional-feed').FeedTrade;

const DISTRICTS = (process.argv[2] || '26230,26290,26350,26500').split(',');

async function main() {
  const rf = await import('../src/lib/regional-feed');
  const { fetchMonthsThrottledWithStatus } = await import('../src/lib/molit-stats-helpers');
  const { loadBusanFeedTradesFromDb } = await import('../src/lib/stats/feed-db-source');
  const { splitVerifiedMonths, getRentVerifiedRange } = await import('../src/lib/rent-history-read');
  const { prisma } = await import('../src/lib/prisma');
  const { resolvePeriodRange, monthsForRange, toFeedTrade, dedupeTrades, groupKey } = rf;

  const periodRange = resolvePeriodRange('12m', new Date());
  const months = monthsForRange(periodRange);
  const rentSplit = splitVerifiedMonths(months, await getRentVerifiedRange());

  const sig = (t: FeedTrade) => `${groupKey(t)}|${t.dealAmount}|${t.dealDate}|${t.floorRaw}|${t.dealCanceled}`;

  const byBucket = new Map<string, number>();
  const bump = (k: string) => byBucket.set(k, (byBucket.get(k) || 0) + 1);
  const examples: string[] = [];

  for (const d of DISTRICTS) {
    const tasks = months.flatMap((m) => [
      { key: `${d}|apt:${m}`, lawdCd: d, dealYmd: m, type: 'apt' as const },
      { key: `${d}|rent:${m}`, lawdCd: d, dealYmd: m, type: 'rent' as const },
    ]);
    const res = await fetchMonthsThrottledWithStatus(tasks);
    const oldTrades: FeedTrade[] = [];
    for (const m of months) {
      for (const raw of res[`${d}|apt:${m}`]?.items || []) { const t = toFeedTrade(raw, 'sale', d); if (t) oldTrades.push(t); }
      for (const raw of res[`${d}|rent:${m}`]?.items || []) { const t = toFeedTrade(raw, raw.monthlyRent > 0 ? 'wolse' : 'jeonse', d); if (t) oldTrades.push(t); }
    }
    const db = await loadBusanFeedTradesFromDb([d], months, rentSplit.verified);
    const newTrades: FeedTrade[] = [...db.trades];
    for (const m of rentSplit.unverified) {
      for (const raw of res[`${d}|rent:${m}`]?.items || []) { const t = toFeedTrade(raw, raw.monthlyRent > 0 ? 'wolse' : 'jeonse', d); if (t) newTrades.push(t); }
    }
    const o = dedupeTrades(oldTrades);
    const n = dedupeTrades(newTrades);
    const mo = new Map<string, FeedTrade[]>(); for (const t of o) { const k = sig(t); (mo.get(k) ?? mo.set(k, []).get(k)!).push(t); }
    const mn = new Map<string, FeedTrade[]>(); for (const t of n) { const k = sig(t); (mn.get(k) ?? mn.set(k, []).get(k)!).push(t); }
    for (const [k, list] of mo) {
      const extra = list.length - (mn.get(k)?.length || 0);
      for (let i = 0; i < extra; i++) {
        const t = list[0];
        const ym = t.dealDate.slice(0, 7).replace('-', '');
        const kind = t.dealType === 'sale' ? 'sale' : 'rent';
        const verified = kind === 'rent' ? (rentSplit.verified.includes(ym) ? 'verifiedMonth' : 'molitMonth') : 'n/a';
        bump(`onlyMOLIT|${kind}|${verified}|${ym}`);
        if (examples.length < 12) examples.push(`onlyMOLIT ${d} ${kind} ${verified} ${k}`);
      }
    }
    for (const [k, list] of mn) {
      const extra = list.length - (mo.get(k)?.length || 0);
      for (let i = 0; i < extra; i++) {
        const t = list[0];
        const ym = t.dealDate.slice(0, 7).replace('-', '');
        const kind = t.dealType === 'sale' ? 'sale' : 'rent';
        const verified = kind === 'rent' ? (rentSplit.verified.includes(ym) ? 'verifiedMonth' : 'molitMonth') : 'n/a';
        bump(`onlyDB|${kind}|${verified}|${ym}`);
        if (examples.length < 24) examples.push(`onlyDB    ${d} ${kind} ${verified} ${k}`);
      }
    }
  }

  console.log(`districts ${DISTRICTS.join(',')}  window ${periodRange.from}~${periodRange.to}`);
  console.log('\n=== diff rows grouped by direction / type / month ===');
  const rows = [...byBucket.entries()].sort((a, b) => b[1] - a[1]);
  for (const [k, n] of rows) console.log(`${String(n).padStart(4)}  ${k}`);
  const sum = (pred: (k: string) => boolean) => rows.filter(([k]) => pred(k)).reduce((a, [, n]) => a + n, 0);
  console.log('\n=== totals ===');
  console.log(`onlyMOLIT sale            ${sum((k) => k.startsWith('onlyMOLIT|sale'))}`);
  console.log(`onlyMOLIT rent(verified)  ${sum((k) => k.startsWith('onlyMOLIT|rent|verifiedMonth'))}`);
  console.log(`onlyMOLIT rent(molit mo)  ${sum((k) => k.startsWith('onlyMOLIT|rent|molitMonth'))}`);
  console.log(`onlyDB    sale            ${sum((k) => k.startsWith('onlyDB|sale'))}`);
  console.log(`onlyDB    rent(verified)  ${sum((k) => k.startsWith('onlyDB|rent|verifiedMonth'))}`);
  console.log(`onlyDB    rent(molit mo)  ${sum((k) => k.startsWith('onlyDB|rent|molitMonth'))}`);
  console.log('\n=== examples ===');
  for (const e of examples) console.log(e);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
