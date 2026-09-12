/**
 * BUSAN_12M_STATS_PERFORMANCE_FIX_V1 §1~§3 — READ ONLY 계측 스크립트.
 *
 * `GET /api/stats/feed?sidoCode=26&period=12m`의 22~25초가 어디서 쓰이는지 숫자로
 * 확정한다. DB는 SELECT만, MOLIT은 GET만 한다. write 0회.
 */
import 'dotenv/config';
import { resolvePeriodRange, monthsForRange, dedupeTrades, annotateTrades, buildRegionSummary, filterVerifiedTrades, toFeedTrade, type FeedTrade } from '../src/lib/regional-feed';
import { getSigunguListForSido } from '../src/lib/region-utils';
import { fetchMolitData } from '../src/lib/api-molit';
import { prisma } from '../src/lib/prisma';
import { getRentVerifiedRange, splitVerifiedMonths } from '../src/lib/rent-history-read';

const ms = (t: bigint) => Number(process.hrtime.bigint() - t) / 1e6;
const mark = () => process.hrtime.bigint();
const fmt = (n: number) => `${n.toFixed(0)}ms`;

async function main() {
  const now = new Date();
  const periodRange = resolvePeriodRange('12m', now);
  const months = monthsForRange(periodRange);

  console.log('=== §1 REQUEST SHAPE ===');
  console.log('now              ', now.toISOString());
  console.log('periodRange      ', periodRange.from, '~', periodRange.to);
  console.log('months           ', months.length, months.join(','));

  let t = mark();
  const districts = await getSigunguListForSido('26');
  const regcodeMs = ms(t);
  const lawdCds = districts.map((d) => d.code.substring(0, 5));
  console.log('districts        ', lawdCds.length, `(regcode proxy ${fmt(regcodeMs)})`);
  console.log('MOLIT tasks      ', lawdCds.length * months.length * 2, `= ${lawdCds.length} x ${months.length} x 2`);

  console.log('\n=== §2 MOLIT SINGLE CALL COST (sample) ===');
  const samples: number[] = [];
  for (const [lawd, ym, type] of [['26350', months[0], 'apt'], ['26350', months[0], 'rent'], ['26110', months[1], 'apt']] as const) {
    t = mark();
    const items = await fetchMolitData({ type: type as 'apt' | 'rent', lawdCd: lawd, dealYmd: ym });
    const d = ms(t);
    samples.push(d);
    console.log(`  ${type} ${lawd}:${ym} -> ${items.length} rows, ${fmt(d)}`);
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  const tasks = lawdCds.length * months.length * 2;
  const CONCURRENCY = 6;
  const PACE = 200;
  console.log(`  avg per call     ${fmt(avg)}`);
  console.log(`  projected wall   ${(((avg + PACE) * tasks) / CONCURRENCY / 1000).toFixed(1)}s  (= (avg + ${PACE}ms pace) x ${tasks} / concurrency ${CONCURRENCY})`);

  console.log('\n=== §3 DB COVERAGE (read only) ===');
  const from = new Date(`${periodRange.from}T00:00:00Z`);
  const to = new Date(`${periodRange.to}T23:59:59Z`);

  t = mark();
  const saleCount = await prisma.$queryRaw<{ all: bigint; canceled: bigint; districts: bigint }[]>`
    SELECT COUNT(*) AS all, COUNT(*) FILTER (WHERE deal_canceled) AS canceled,
           COUNT(DISTINCT lawd_cd) AS districts
    FROM apartment_trade_histories
    WHERE lawd_cd = ANY(${lawdCds}) AND deal_type = 'sale' AND deal_date >= ${from} AND deal_date <= ${to}`;
  console.log('sale 12m rows    ', Number(saleCount[0].all), `(canceled ${Number(saleCount[0].canceled)}, districts ${Number(saleCount[0].districts)}/16)  count query ${fmt(ms(t))}`);

  t = mark();
  const range = await getRentVerifiedRange();
  const rangeMs = ms(t);
  const split = splitVerifiedMonths(months, range);
  console.log('rent verified    ', `${range.from}~${range.to}  (lookup ${fmt(rangeMs)})`);
  console.log('rent verified mo ', split.verified.length, split.verified.join(','));
  console.log('rent UNverified  ', split.unverified.length, split.unverified.join(','), `-> MOLIT tasks ${split.unverified.length * lawdCds.length}`);

  t = mark();
  const rentCount = await prisma.$queryRaw<{ all: bigint; districts: bigint }[]>`
    SELECT COUNT(*) AS all, COUNT(DISTINCT lawd_cd) AS districts
    FROM apartment_rent_histories
    WHERE lawd_cd = ANY(${lawdCds}) AND deal_ymd = ANY(${split.verified}) AND deal_date >= ${from} AND deal_date <= ${to}`;
  console.log('rent verified rows', Number(rentCount[0].all), `(districts ${Number(rentCount[0].districts)}/16)  count query ${fmt(ms(t))}`);

  console.log('\n=== §3b DB-ONLY FETCH LATENCY (the proposed hot path) ===');
  t = mark();
  const saleRows = await prisma.$queryRaw<any[]>`
    SELECT id, lawd_cd as "lawdCd", apt_seq as "aptSeq", apt_name as "aptName", dong,
           exclusive_area::float8 as "area", deal_amount as "dealAmount",
           to_char(deal_date, 'YYYY-MM-DD') as "dealDate", floor, deal_canceled as "dealCanceled"
    FROM apartment_trade_histories
    WHERE lawd_cd = ANY(${lawdCds}) AND deal_type = 'sale' AND deal_date >= ${from} AND deal_date <= ${to}`;
  const saleMs = ms(t);
  console.log(`sale rows        ${saleRows.length} in ${fmt(saleMs)}`);

  t = mark();
  const rentRows = await prisma.$queryRaw<any[]>`
    SELECT lawd_cd as "lawdCd", apt_seq as "aptSeq", apt_name as "aptName", dong,
           exclusive_area::float8 as "area", deposit, monthly_rent as "monthlyRent", deal_type as "dealType",
           to_char(deal_date, 'YYYY-MM-DD') as "dealDate", floor
    FROM apartment_rent_histories
    WHERE lawd_cd = ANY(${lawdCds}) AND deal_ymd = ANY(${split.verified}) AND deal_date >= ${from} AND deal_date <= ${to}`;
  const rentMs = ms(t);
  console.log(`rent rows        ${rentRows.length} in ${fmt(rentMs)}`);

  console.log('\n=== §3c POST-PROCESSING COST (same JS as the route) ===');
  t = mark();
  let all: FeedTrade[] = [];
  for (const r of saleRows) {
    const ft = toFeedTrade({ id: `db-sale-${r.id}`, name: r.aptName, dealAmount: r.dealAmount, typeLabel: '실거래', dong: r.dong, dealCanceled: r.dealCanceled, aptSeq: r.aptSeq, excluUseArea: r.area, dealDate: r.dealDate, floorRaw: r.floor }, 'sale', r.lawdCd);
    if (ft) all.push(ft);
  }
  for (const r of rentRows) {
    const ft = toFeedTrade({ id: `db-rent-${r.lawdCd}-${r.dealDate}-${r.aptSeq}-${r.deposit}-${r.floor}-${r.area}`, name: r.aptName, dealAmount: r.deposit, typeLabel: '전월세', dong: r.dong, dealCanceled: false, aptSeq: r.aptSeq, excluUseArea: r.area, dealDate: r.dealDate, floorRaw: r.floor }, r.monthlyRent > 0 ? 'wolse' : 'jeonse', r.lawdCd);
    if (ft) all.push(ft);
  }
  console.log(`toFeedTrade      ${all.length} trades in ${fmt(ms(t))}`);

  t = mark();
  all = dedupeTrades(all);
  console.log(`dedupeTrades     -> ${all.length} in ${fmt(ms(t))}`);

  t = mark();
  const annotations = annotateTrades(all);
  console.log(`annotateTrades   ${annotations.size} in ${fmt(ms(t))}`);

  t = mark();
  const summary = buildRegionSummary(all, annotations);
  const verified = filterVerifiedTrades(all);
  console.log(`summary+verified ${verified.length} verified in ${fmt(ms(t))}  (totalCount ${summary.totalCount})`);

  t = mark();
  const sorted = [...all].sort((a, b) => (b.dealDate === a.dealDate ? b.dealAmount - a.dealAmount : b.dealDate.localeCompare(a.dealDate)));
  console.log(`sort             ${sorted.length} in ${fmt(ms(t))}`);
  console.log(`page[0]          ${sorted[0]?.dealDate} ${sorted[0]?.name} ${sorted[0]?.dealType}`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
