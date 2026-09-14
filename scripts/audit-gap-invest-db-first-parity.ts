/**
 * GAP_INVEST_BUSAN_DB_FIRST_V1 §3/§7 — MOLIT(기존 경로) vs DB-first(신규 경로) parity 감사.
 *
 * DB: STRICT READ ONLY(write 0). MOLIT: 기존 부산 전체 콜드 요청 1회와 같은 384 월 조회를
 * 공유 게이트(bulk lane)로 **한 번만** 보낸다. DB-first 실행의 현재월 MOLIT task는 그 결과를
 * 재생(replay)해 추가 호출 없이 쓴다 — 그래서 두 결과의 차이는 "완료월에서 DB vs MOLIT"만 남는다.
 *
 * 두 경로 모두 라우트와 **같은 함수**(loadGapInvestSidoRaw → toGapInputs → computeGapInvestInsights)
 * 로 계산한다. 이 스크립트는 집계 로직을 복제하지 않는다.
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-gap-invest-db-first-parity.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { assertProductionDbAccessAllowed } from './_prod-db-guard';

type Preset = '30d' | '3m' | '6m' | '12m';
const PRESETS: Preset[] = ['30d', '3m', '6m', '12m'];
const SAMPLE_DISTRICTS: Record<string, string> = { '26140': '서구', '26710': '기장군', '26350': '해운대구', '26440': '강서구' };

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-gap-invest-db-first-parity');

  const { prisma, warmupConnections } = await import('../src/lib/prisma');
  const { fetchMonthsThrottledWithStatus } = await import('../src/lib/molit-stats-helpers');
  const { getSigunguListForSido } = await import('../src/lib/region-utils');
  const { getRegionalSaleRowsForFeedFromDb } = await import('../src/lib/trade-history-read');
  const { fetchRentMonthBucketsFromDb, getRentVerifiedRange } = await import('../src/lib/rent-history-read');
  const { loadVerifiedSaleCellKeys } = await import('../src/lib/sync-coverage');
  const { loadGapInvestSidoRaw, resolveSidoApiError } = await import('../src/lib/stats/gap-invest-db-source');
  const { toGapInputs, computeGapInvestInsights } = await import('../src/lib/stats/gap-invest-insights');
  type MonthTaskResult = import('../src/lib/molit-stats-helpers').MonthTaskResult;
  type MonthTask = import('../src/lib/molit-stats-helpers').MonthTask;

  const now = new Date();
  const last12Months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const currentMonth = last12Months[11];
  const districts = await getSigunguListForSido('26');
  const lawdCds = districts.map((d) => d.code.substring(0, 5));
  const nameBy = new Map<string, string>();
  for (const d of districts) nameBy.set(d.code.substring(0, 5), d.name.split(' ').slice(1).join(' '));

  const out: string[] = [];
  const log = (s = '') => { console.log(s); out.push(s); };
  log('# GAP INVEST DB-FIRST PARITY AUDIT');
  log(`now=${now.toISOString()} months=${last12Months.join(',')} current=${currentMonth}`);
  log(`districts(${lawdCds.length})=${lawdCds.join(',')}`);

  // ── 0. deal_ymd == deal_date 월 일치(셀 버킷팅 근거) ──
  const mismatch = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) as n FROM apartment_trade_histories
    WHERE lawd_cd = ANY(${lawdCds}) AND deal_type = 'sale' AND deal_ymd = ANY(${last12Months})
      AND deal_ymd <> to_char(deal_date, 'YYYYMM')`;
  log(`sale rows with deal_ymd != month(deal_date) in window: ${Number(mismatch[0].n)}`);

  // ── 1. MOLIT 기준선(기존 경로, 384 호출) ──
  let molitResults: Record<string, MonthTaskResult> = {};
  const t0 = Date.now();
  const rawMolit = await loadGapInvestSidoRaw(
    { lawdCds, months: last12Months, currentMonth, dbBacked: false },
    {
      loadVerifiedSaleCellKeys, getRentVerifiedRange, loadSaleRows: getRegionalSaleRowsForFeedFromDb, loadRentBuckets: fetchRentMonthBucketsFromDb,
      fetchMolit: async (tasks: MonthTask[]) => {
        const cache = process.env.PARITY_MOLIT_CACHE;
        if (cache && fs.existsSync(cache)) { molitResults = JSON.parse(fs.readFileSync(cache, 'utf8')); log(`(MOLIT snapshot loaded from cache — 0 calls this run)`); return molitResults; }
        molitResults = await fetchMonthsThrottledWithStatus(tasks);
        if (cache) fs.writeFileSync(cache, JSON.stringify(molitResults));
        return molitResults;
      },
    }
  );
  const molitMs = Date.now() - t0;
  const molitFailedCells = Object.entries(molitResults).filter(([, v]) => v.failed).map(([k]) => k);
  log(`\n## MOLIT baseline: calls=${rawMolit.dataSource.molitCalls} wall=${molitMs}ms failedCells=${molitFailedCells.length} ${molitFailedCells.slice(0, 10).join(' ')}`);

  // ── 2. DB-first(현재월 MOLIT은 재생) ──
  let replayCalls = 0;
  const t1 = Date.now();
  const rawDb = await loadGapInvestSidoRaw(
    { lawdCds, months: last12Months, currentMonth, dbBacked: true },
    {
      loadVerifiedSaleCellKeys, getRentVerifiedRange, loadSaleRows: getRegionalSaleRowsForFeedFromDb, loadRentBuckets: fetchRentMonthBucketsFromDb,
      warmup: () => warmupConnections(2),
      fetchMolit: async (tasks: MonthTask[]) => {
        replayCalls = tasks.length;
        const r: Record<string, MonthTaskResult> = {};
        for (const t of tasks) r[t.key] = molitResults[t.key];
        return r;
      },
    }
  );
  const dbMs = Date.now() - t1;
  log(`## DB-first: molitCalls=${rawDb.dataSource.molitCalls} (replayed ${replayCalls}) dbWall=${dbMs}ms`);
  log(`   dataSource=${JSON.stringify(rawDb.dataSource)}`);
  log(`   failedLawdCds molit=${JSON.stringify(rawMolit.failedLawdCds)} db=${JSON.stringify(rawDb.failedLawdCds)} apiError molit=${resolveSidoApiError(rawMolit, 16)} db=${resolveSidoApiError(rawDb, 16)}`);

  // ── 3. 셀 단위 거래 수 ──
  log('\n## CELL COUNTS (only cells with a delta; month index aligned)');
  log('cell         | sale all M/D | canceled M/D | active M/D | rent all M/D | pureJeonse M/D');
  const cellStats = (raw: typeof rawDb, mi: number, d: string) => {
    const apt = raw.aptByMonth[mi].filter((t: any) => t.lawdCd === d);
    const rent = raw.rentByMonth[mi].filter((t: any) => t.lawdCd === d);
    const { saleTrades, pureJeonseTrades } = toGapInputs(apt, rent, { isSidoAll: true, dong: 'all' });
    return { all: apt.length, canceled: apt.filter((t: any) => t.dealCanceled).length, active: saleTrades.length, rent: rent.length, jeonse: pureJeonseTrades.length };
  };
  const totals = { M: { all: 0, canceled: 0, active: 0, rent: 0, jeonse: 0 }, D: { all: 0, canceled: 0, active: 0, rent: 0, jeonse: 0 } };
  let deltaCells = 0;
  for (let mi = 0; mi < 12; mi++) for (const d of lawdCds) {
    const m = cellStats(rawMolit, mi, d); const b = cellStats(rawDb, mi, d);
    for (const k of Object.keys(totals.M) as (keyof typeof m)[]) { totals.M[k] += m[k]; totals.D[k] += b[k]; }
    if (JSON.stringify(m) !== JSON.stringify(b)) {
      deltaCells++;
      log(`${d}:${last12Months[mi]} | ${m.all}/${b.all} | ${m.canceled}/${b.canceled} | ${m.active}/${b.active} | ${m.rent}/${b.rent} | ${m.jeonse}/${b.jeonse}`);
    }
  }
  log(`delta cells: ${deltaCells}/192`);
  log(`TOTAL molit=${JSON.stringify(totals.M)}`);
  log(`TOTAL db   =${JSON.stringify(totals.D)}`);

  // ── 4. 행 multiset 차이(원인 분류) ──
  const saleKey = (t: any) => `${t.lawdCd}|${t.aptSeq}|${t.excluUseArea}|${t.dealDate}|${t.dealAmount}`;
  const rentKey = (t: any) => `${t.lawdCd}|${t.aptSeq}|${t.excluUseArea}|${t.dealDate}|${t.dealAmount}|${t.monthlyRent}`;
  const multiset = (arr: any[], key: (t: any) => string) => { const m = new Map<string, number>(); for (const t of arr) m.set(key(t), (m.get(key(t)) || 0) + 1); return m; };
  const diffMs = (a: Map<string, number>, b: Map<string, number>) => {
    const onlyA: string[] = []; const onlyB: string[] = [];
    for (const [k, v] of a) { const w = b.get(k) || 0; for (let i = w; i < v; i++) onlyA.push(k); }
    for (const [k, v] of b) { const w = a.get(k) || 0; for (let i = w; i < v; i++) onlyB.push(k); }
    return { onlyA, onlyB };
  };
  const allAptM = rawMolit.aptByMonth.flat(); const allAptD = rawDb.aptByMonth.flat();
  const activeM = allAptM.filter((t: any) => !t.dealCanceled && t.dealAmount > 0);
  const activeD = allAptD.filter((t: any) => !t.dealCanceled && t.dealAmount > 0);
  const saleDiff = diffMs(multiset(activeM, saleKey), multiset(activeD, saleKey));
  // 분류: MOLIT엔 활성인데 DB엔 같은 키가 취소로만 있음 = 취소 래칫(DB 과다취소)
  const canceledD = multiset(allAptD.filter((t: any) => t.dealCanceled), saleKey);
  const canceledM = multiset(allAptM.filter((t: any) => t.dealCanceled), saleKey);
  const allKeysM = multiset(allAptM, saleKey);
  log(`\n## ACTIVE SALE ROW DIFF: onlyMolit=${saleDiff.onlyA.length} onlyDb=${saleDiff.onlyB.length}`);
  for (const k of saleDiff.onlyA) log(`  onlyMolit ${k}  ${canceledD.has(k) ? '[DB has same key CANCELED → ratchet over-cancel]' : '[absent in DB]'}`);
  for (const k of saleDiff.onlyB) log(`  onlyDb    ${k}  ${canceledM.has(k) ? '[MOLIT has same key CANCELED → DB not yet flipped]' : allKeysM.has(k) ? '[MOLIT has key]' : '[absent in MOLIT → ghost/retracted]'}`);

  const pureM = rawMolit.rentByMonth.flat().filter((t: any) => t.dealAmount > 0 && !t.monthlyRent);
  const pureD = rawDb.rentByMonth.flat().filter((t: any) => t.dealAmount > 0 && !t.monthlyRent);
  const rentDiff = diffMs(multiset(pureM, rentKey), multiset(pureD, rentKey));
  log(`\n## PURE JEONSE ROW DIFF: onlyMolit=${rentDiff.onlyA.length} onlyDb=${rentDiff.onlyB.length}`);
  for (const k of rentDiff.onlyA.slice(0, 40)) log(`  onlyMolit ${k}`);
  for (const k of rentDiff.onlyB.slice(0, 40)) log(`  onlyDb    ${k}`);

  // ── 5. 결과 parity ──
  const insights = (raw: typeof rawDb, preset: Preset, scope: { isSidoAll: boolean; lawdCd?: string }) => {
    const apt = scope.lawdCd ? raw.aptByMonth.flat().filter((t: any) => t.lawdCd === scope.lawdCd) : raw.aptByMonth.flat();
    const rent = scope.lawdCd ? raw.rentByMonth.flat().filter((t: any) => t.lawdCd === scope.lawdCd) : raw.rentByMonth.flat();
    const { saleTrades, pureJeonseTrades } = toGapInputs(apt, rent, { isSidoAll: scope.isSidoAll, dong: 'all' });
    return computeGapInvestInsights({ saleTrades, pureJeonseTrades, isSidoAll: scope.isSidoAll, dong: 'all', preset, now, last12Months, sigunguNameByLawdCd: nameBy, sort: 'count' });
  };
  const compare = (label: string, a: ReturnType<typeof insights>, b: ReturnType<typeof insights>) => {
    const sameSummary = JSON.stringify(a.summary) === JSON.stringify(b.summary);
    const regionOrderA = a.regionRanking.map((r) => `${r.code}:${r.gapCount}`).join(',');
    const regionOrderB = b.regionRanking.map((r) => `${r.code}:${r.gapCount}`).join(',');
    const sameRegion = JSON.stringify(a.regionRanking) === JSON.stringify(b.regionRanking);
    const aptA = a.apartmentRankingTop.map((r) => r.groupKey); const aptB = b.apartmentRankingTop.map((r) => r.groupKey);
    const sameAptOrder = JSON.stringify(aptA) === JSON.stringify(aptB);
    const sameAptFull = JSON.stringify(a.apartmentRankingTop) === JSON.stringify(b.apartmentRankingTop);
    const sameTrend = JSON.stringify(a.monthlyTrend) === JSON.stringify(b.monthlyTrend);
    log(`\n### ${label}: summary=${sameSummary ? 'SAME' : 'DIFF'} region=${sameRegion ? 'SAME' : 'DIFF'} aptOrder=${sameAptOrder ? 'SAME' : 'DIFF'} aptFields=${sameAptFull ? 'SAME' : 'DIFF'} trend=${sameTrend ? 'SAME' : 'DIFF'} events M/D=${a.allEventCount}/${b.allEventCount}`);
    if (!sameSummary) { log(`  summary M ${JSON.stringify(a.summary)}`); log(`  summary D ${JSON.stringify(b.summary)}`); }
    if (!sameRegion) { log(`  region M ${regionOrderA}`); log(`  region D ${regionOrderB}`);
      for (const ra of a.regionRanking) { const rb = b.regionRanking.find((x) => x.code === ra.code); if (JSON.stringify(ra) !== JSON.stringify(rb)) log(`    ${ra.code} M ${JSON.stringify(ra)} D ${JSON.stringify(rb)}`); } }
    if (!sameAptFull) {
      const n = Math.max(aptA.length, aptB.length);
      for (let i = 0; i < n; i++) {
        const ra = a.apartmentRankingTop[i]; const rb = b.apartmentRankingTop[i];
        if (JSON.stringify(ra) !== JSON.stringify(rb)) log(`  #${i + 1} M ${ra ? `${ra.groupKey} ${ra.name} sale=${ra.saleAmount}@${ra.saleDate} jeonse=${ra.jeonseAmount}@${ra.jeonseDate} gap=${ra.gap} med=${ra.medianGap} n=${ra.dealCount}` : '-'}\n       D ${rb ? `${rb.groupKey} ${rb.name} sale=${rb.saleAmount}@${rb.saleDate} jeonse=${rb.jeonseAmount}@${rb.jeonseDate} gap=${rb.gap} med=${rb.medianGap} n=${rb.dealCount}` : '-'}`);
      }
    }
    if (!sameTrend) { log(`  trend M ${a.monthlyTrend.map((x) => x.count).join(',')}`); log(`  trend D ${b.monthlyTrend.map((x) => x.count).join(',')}`); }
    return sameSummary && sameRegion && sameAptFull && sameTrend;
  };

  log('\n## RESULT PARITY');
  const verdicts: Record<string, boolean> = {};
  for (const preset of PRESETS) verdicts[`busan-all ${preset}`] = compare(`부산 전체 ${preset}`, insights(rawMolit, preset, { isSidoAll: true }), insights(rawDb, preset, { isSidoAll: true }));
  for (const [code, name] of Object.entries(SAMPLE_DISTRICTS)) for (const preset of PRESETS) {
    verdicts[`${name} ${preset}`] = compare(`${name}(${code}) ${preset}`, insights(rawMolit, preset, { isSidoAll: false, lawdCd: code }), insights(rawDb, preset, { isSidoAll: false, lawdCd: code }));
  }
  // ── 6. 원인 분리: 같은 결정적 순서로 정렬하면 남는 차이는 "행 내용" 차이뿐이다 ──
  // 정렬 키가 집계가 읽는 모든 필드를 포함하므로, 키가 같은 두 행은 집계상 완전히 같다.
  const canonKey = (t: any) => [t.lawdCd, t.dealDate, t.aptSeq, String(t.excluUseArea).padStart(12, '0'), String(t.dealAmount).padStart(10, '0'), String(t.monthlyRent ?? ''), t.dealCanceled ? '1' : '0', t.name, t.dong].join('|');
  const byCanon = (a: any, b: any) => { const ka = canonKey(a); const kb = canonKey(b); return ka < kb ? -1 : ka > kb ? 1 : 0; };
  const canon = (raw: typeof rawDb) => ({ ...raw, aptByMonth: raw.aptByMonth.map((m) => [...m].sort(byCanon)), rentByMonth: raw.rentByMonth.map((m) => [...m].sort(byCanon)) });
  const cM = canon(rawMolit);
  const cD = canon(rawDb);
  log('\n## ORDER-ONLY NOISE (MOLIT original order vs MOLIT canonical order — identical rows)');
  for (const preset of PRESETS) verdicts[`order-noise busan-all ${preset}`] = compare(`MOLIT vs MOLIT(reordered) 부산 전체 ${preset}`, insights(rawMolit, preset, { isSidoAll: true }), insights(cM, preset, { isSidoAll: true }));
  log('\n## ROW-CONTENT DELTA (both canonical order)');
  for (const preset of PRESETS) verdicts[`row-delta busan-all ${preset}`] = compare(`canonical MOLIT vs canonical DB 부산 전체 ${preset}`, insights(cM, preset, { isSidoAll: true }), insights(cD, preset, { isSidoAll: true }));
  for (const [code, name] of Object.entries(SAMPLE_DISTRICTS)) for (const preset of PRESETS) {
    verdicts[`row-delta ${name} ${preset}`] = compare(`canonical MOLIT vs canonical DB ${name}(${code}) ${preset}`, insights(cM, preset, { isSidoAll: false, lawdCd: code }), insights(cD, preset, { isSidoAll: false, lawdCd: code }));
  }

  // ── 7. name/dong 불일치(같은 거래 키, 다른 표시 필드) ──
  const fullKey = (t: any) => `${saleKey(t)}|${t.name}|${t.dong}`;
  const nameDiff = diffMs(multiset(activeM, fullKey), multiset(activeD, fullKey));
  log(`\n## ACTIVE SALE name/dong-sensitive diff: onlyMolit=${nameDiff.onlyA.length} onlyDb=${nameDiff.onlyB.length} (key-only ${saleDiff.onlyA.length}/${saleDiff.onlyB.length})`);
  const rentFullKey = (t: any) => `${rentKey(t)}|${t.name}|${t.dong}`;
  const rentNameDiff = diffMs(multiset(pureM, rentFullKey), multiset(pureD, rentFullKey));
  log(`## PURE JEONSE name/dong-sensitive diff: onlyMolit=${rentNameDiff.onlyA.length} onlyDb=${rentNameDiff.onlyB.length} (key-only ${rentDiff.onlyA.length}/${rentDiff.onlyB.length})`);

  // ── 8. DB 전용 활성 매매(ghost 후보) — MOLIT의 같은 단지·면적 행과 대조 ──
  log('\n## DB-ONLY ACTIVE SALE — MOLIT rows for same lawdCd+aptSeq+area within ±45d');
  for (const k of saleDiff.onlyB) {
    const [lc, seq, area, date] = k.split('|');
    const near = allAptM.filter((t: any) => t.lawdCd === lc && t.aptSeq === seq && String(t.excluUseArea) === area && Math.abs(new Date(t.dealDate).getTime() - new Date(date).getTime()) <= 45 * 86400000);
    const dbRow = allAptD.filter((t: any) => saleKey(t) === k);
    log(`  DB ${k} floor=${dbRow.map((r: any) => r.floorRaw).join('/')}`);
    for (const t of near) log(`     MOLIT ${t.dealDate} ${t.dealAmount} floor=${t.floorRaw} canceled=${t.dealCanceled}`);
    if (near.length === 0) log('     MOLIT (no row within ±45d for this aptSeq+area)');
  }

  log('\n## VERDICT TABLE');
  for (const [k, v] of Object.entries(verdicts)) log(`  ${v ? 'SAME' : 'DIFF'}  ${k}`);

  if (process.env.PARITY_OUT) fs.writeFileSync(process.env.PARITY_OUT, out.join('\n'));
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
