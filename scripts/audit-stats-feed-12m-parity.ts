/**
 * BUSAN_12M_STATS_PERFORMANCE_FIX_V1 §5 DATA TRUST GATE — READ ONLY 대조 스크립트.
 *
 * "DB-first로 바꿔도 화면의 숫자가 같은가"를 셀 단위로 확인한다. 판정은 라우트가
 * 실제로 쓰는 함수(fetchMolitData / toFeedTrade / dedupeTrades / groupKey)를 그대로
 * 호출해서 한다 — 감사 전용 규칙을 새로 만들지 않는다.
 *
 * DB SELECT만, MOLIT GET만. write 0회.
 */
import { config } from 'dotenv';
// .env(DATABASE_URL) + .env.local(MOLIT key) 둘 다 필요하고, api-molit.ts는 module load
// 시점에 키를 상수로 읽는다 — 그래서 env를 먼저 채운 뒤 동적 import한다.
config({ path: '.env', quiet: true });
config({ path: '.env.local', quiet: true });

type FeedTrade = import('../src/lib/regional-feed').FeedTrade;

// 매매 / 전월세 각각을 다른 구·다른 달로 고른다(거래량 최대/최소 구, 창의 첫 달 포함).
const CELLS: Array<{ lawdCd: string; ym: string }> = [
  { lawdCd: '26350', ym: '202608' }, // 해운대구 — 거래량 최대
  { lawdCd: '26110', ym: '202603' }, // 중구 — 거래량 최소
  { lawdCd: '26440', ym: '202512' }, // 강서구
  { lawdCd: '26710', ym: '202510' }, // 기장군 — 창의 첫 달
];

async function main() {
  const { fetchMolitData } = await import('../src/lib/api-molit');
  const { toFeedTrade, dedupeTrades, groupKey } = await import('../src/lib/regional-feed');
  const { prisma } = await import('../src/lib/prisma');

  const sig = (t: FeedTrade) => `${groupKey(t)}|${t.dealAmount}|${t.dealDate}|${t.floorRaw}|${t.dealCanceled}`;

  const diffMultiset = (a: FeedTrade[], b: FeedTrade[]) => {
    const count = (xs: FeedTrade[]) => {
      const m = new Map<string, number>();
      for (const x of xs) m.set(sig(x), (m.get(sig(x)) || 0) + 1);
      return m;
    };
    const ma = count(a);
    const mb = count(b);
    const onlyA: string[] = [];
    const onlyB: string[] = [];
    for (const [k, n] of ma) { const d = n - (mb.get(k) || 0); for (let i = 0; i < d; i++) onlyA.push(k); }
    for (const [k, n] of mb) { const d = n - (ma.get(k) || 0); for (let i = 0; i < d; i++) onlyB.push(k); }
    return { onlyA, onlyB };
  };

  const dbSale = async (lawdCd: string, ym: string): Promise<FeedTrade[]> => {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT id, apt_seq as "aptSeq", apt_name as "aptName", dong, exclusive_area::float8 as area,
             deal_amount as "dealAmount", to_char(deal_date, 'YYYY-MM-DD') as "dealDate",
             floor, deal_canceled as "dealCanceled"
      FROM apartment_trade_histories
      WHERE lawd_cd = ${lawdCd} AND deal_type = 'sale' AND deal_ymd = ${ym}`;
    return rows
      .map((r) => toFeedTrade({
        id: `db-sale-${r.id}`, name: r.aptName, dealAmount: r.dealAmount, typeLabel: '실거래', dong: r.dong,
        dealCanceled: r.dealCanceled, aptSeq: r.aptSeq, excluUseArea: r.area, dealDate: r.dealDate, floorRaw: r.floor,
      }, 'sale', lawdCd))
      .filter((t): t is FeedTrade => !!t);
  };

  const dbRent = async (lawdCd: string, ym: string): Promise<FeedTrade[]> => {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT id, apt_seq as "aptSeq", apt_name as "aptName", dong, exclusive_area::float8 as area,
             deposit, monthly_rent as "monthlyRent", to_char(deal_date, 'YYYY-MM-DD') as "dealDate", floor
      FROM apartment_rent_histories
      WHERE lawd_cd = ${lawdCd} AND deal_ymd = ${ym}`;
    return rows
      .map((r) => toFeedTrade({
        id: `db-rent-${r.id}`, name: r.aptName, dealAmount: r.deposit, monthlyRent: r.monthlyRent, typeLabel: '전월세',
        dong: r.dong, dealCanceled: false, aptSeq: r.aptSeq, excluUseArea: r.area, dealDate: r.dealDate, floorRaw: r.floor,
      }, r.monthlyRent > 0 ? 'wolse' : 'jeonse', lawdCd))
      .filter((t): t is FeedTrade => !!t);
  };

  const molit = async (type: 'apt' | 'rent', lawdCd: string, ym: string): Promise<FeedTrade[]> => {
    // fetchMolitData의 반환 타입은 매매/전월세 union이라 전월세 전용 필드 접근을 좁혀준다.
    const items = (await fetchMolitData({ type, lawdCd, dealYmd: ym })) as any[];
    if (items.length === 1 && items[0]?.typeLabel === '에러') throw new Error(`MOLIT error cell ${type} ${lawdCd}:${ym}`);
    const out: FeedTrade[] = [];
    for (const raw of items) {
      const t = type === 'apt' ? toFeedTrade(raw, 'sale', lawdCd) : toFeedTrade(raw, raw.monthlyRent > 0 ? 'wolse' : 'jeonse', lawdCd);
      if (t) out.push(t);
    }
    return out;
  };

  let totalMolit = 0, totalDb = 0, mismatchCells = 0;
  console.log('cell          | type | MOLIT |    DB | onlyMOLIT | onlyDB | canceled(DB/MOLIT)');
  console.log('--------------+------+-------+-------+-----------+--------+-------------------');
  for (const { lawdCd, ym } of CELLS) {
    for (const kind of ['sale', 'rent'] as const) {
      const m = await molit(kind === 'sale' ? 'apt' : 'rent', lawdCd, ym);
      const d = kind === 'sale' ? await dbSale(lawdCd, ym) : await dbRent(lawdCd, ym);
      const md = dedupeTrades(m);
      const dd = dedupeTrades(d);
      const { onlyA, onlyB } = diffMultiset(md, dd);
      totalMolit += md.length; totalDb += dd.length;
      if (onlyA.length || onlyB.length) mismatchCells++;
      const cM = md.filter((t) => t.dealCanceled).length;
      const cD = dd.filter((t) => t.dealCanceled).length;
      console.log(`${lawdCd}:${ym} | ${kind.padEnd(4)} | ${String(md.length).padStart(5)} | ${String(dd.length).padStart(5)} | ${String(onlyA.length).padStart(9)} | ${String(onlyB.length).padStart(6)} | ${cD}/${cM}`);
      for (const k of onlyA.slice(0, 4)) console.log(`    onlyMOLIT  ${k}`);
      for (const k of onlyB.slice(0, 4)) console.log(`    onlyDB     ${k}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  console.log('---');
  console.log(`deduped totals  MOLIT ${totalMolit}  DB ${totalDb}  delta ${totalDb - totalMolit}`);
  console.log(`cells with any difference: ${mismatchCells} / ${CELLS.length * 2}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
