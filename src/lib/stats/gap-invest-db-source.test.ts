import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  planGapInvestSources,
  loadGapInvestSidoRaw,
  resolveSidoApiError,
  cellKey,
  type GapInvestSourceDeps,
} from './gap-invest-db-source';
import { computeGapInvestInsights, toGapInputs } from './gap-invest-insights';
import { isFeedDbBackedSido } from './feed-db-source';
import type { MonthTask, MonthTaskResult } from '../molit-stats-helpers';
import type { FeedSaleRow } from '../trade-history-read';
import type { StoredRentTrade } from '../rent-history-read';

/**
 * GAP_INVEST_BUSAN_DB_FIRST_V1 — /api/stats/gap-invest 부산 전체의 DB-first 계약.
 *
 * 고친 문제: 부산 전체(기본 지역) 콜드 요청이 MOLIT을 384회(16구 × 12개월 × 매매/전월세)
 * 호출해 production 34~38초가 걸렸다.
 *
 * 막는 방향:
 *   1) 빨라지려고 검증 안 된 셀(현재월 포함)을 "DB에 있으니까"로 DB에서 읽는 수정
 *   2) 다른 달/다른 구 데이터로 빈 셀을 채우는 수정, 실패를 0건으로 접는 수정
 *   3) 취소 거래가 DB 경로에서 되살아나는 수정, 집계 공식·정렬·응답 모양 변경
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BUSAN_16 = ['26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320', '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710'];
const MONTHS = ['202510', '202511', '202512', '202601', '202602', '202603', '202604', '202605', '202606', '202607', '202608', '202609'];
const CURRENT = '202609';
const RENT_RANGE = { from: '202408', to: '202608' };

function allVerifiedSaleCells(lawdCds: string[], months: string[]): Set<string> {
  const s = new Set<string>();
  for (const d of lawdCds) for (const m of months) s.add(cellKey(d, m));
  return s;
}

// ── fake 원천 ─────────────────────────────────────────────────────────────────

let rowId = 1;
function saleRow(p: Partial<FeedSaleRow> & { lawdCd: string; date: string }): FeedSaleRow {
  return {
    id: rowId++,
    lawdCd: p.lawdCd,
    aptSeq: p.aptSeq ?? `${p.lawdCd}-1`,
    aptName: p.aptName ?? '테스트아파트',
    dong: p.dong ?? '테스트동',
    exclusiveArea: p.exclusiveArea ?? '84.9500',
    dealAmount: p.dealAmount ?? 50000,
    dealDate: new Date(`${p.date}T00:00:00Z`),
    floor: p.floor ?? 5,
    dealCanceled: p.dealCanceled ?? false,
  };
}
function rentRow(p: Partial<StoredRentTrade> & { lawdCd: string; date: string }): StoredRentTrade {
  return {
    lawdCd: p.lawdCd,
    aptSeq: p.aptSeq ?? `${p.lawdCd}-1`,
    aptName: p.aptName ?? '테스트아파트',
    dong: p.dong ?? '테스트동',
    exclusiveArea: p.exclusiveArea ?? '84.9500',
    deposit: p.deposit ?? 40000,
    monthlyRent: p.monthlyRent ?? 0,
    dealType: (p.monthlyRent ?? 0) > 0 ? 'wolse' : 'jeonse',
    dealDate: new Date(`${p.date}T00:00:00Z`),
    dealYmd: p.date.slice(0, 7).replace('-', ''),
    floor: p.floor ?? 5,
    buildYear: 2010,
    jibun: '1',
  };
}
/** MOLIT mapMolitItems()가 만드는 것과 같은 필드의 raw item. */
function molitItem(p: { type: 'apt' | 'rent'; date: string; aptSeq?: string; name?: string; dong?: string; area?: number; amount?: number; monthlyRent?: number; canceled?: boolean }) {
  return {
    id: `${p.type}-x`,
    name: p.name ?? '테스트아파트',
    dealAmount: p.amount ?? 50000,
    monthlyRent: p.monthlyRent ?? 0,
    typeLabel: p.type === 'rent' ? '전월세' : '실거래',
    dong: p.dong ?? '테스트동',
    dealCanceled: p.canceled ?? false,
    aptSeq: p.aptSeq ?? null,
    excluUseArea: p.area ?? 84.95,
    dealDate: p.date,
  };
}

interface FakeWorld {
  saleRows?: FeedSaleRow[];
  rentRows?: StoredRentTrade[];
  molit?: Record<string, MonthTaskResult>;
  verifiedSaleCells?: Set<string>;
  rentRange?: { from: string; to: string };
  coverageThrows?: boolean;
  saleQueryThrows?: boolean;
}

function fakeDeps(world: FakeWorld) {
  const calls = { molitTasks: [] as MonthTask[], saleQueries: [] as { from: Date; to: Date }[], rentMonths: [] as string[][] };
  const deps: GapInvestSourceDeps = {
    loadVerifiedSaleCellKeys: async () => {
      if (world.coverageThrows) throw new Error('coverage down');
      return world.verifiedSaleCells ?? new Set();
    },
    getRentVerifiedRange: async () => world.rentRange ?? RENT_RANGE,
    // 실제 SQL과 같게 lawd_cd IN + 날짜 범위로만 거른다(셀 검증 필터는 loader 책임).
    loadSaleRows: async (lawdCds, from, to) => {
      if (world.saleQueryThrows) throw new Error('db down');
      calls.saleQueries.push({ from, to });
      return (world.saleRows ?? []).filter((r) => lawdCds.includes(r.lawdCd) && r.dealDate >= from && r.dealDate <= to);
    },
    loadRentBuckets: async (lawdCds, months) => {
      calls.rentMonths.push(months);
      const m = new Map<string, StoredRentTrade[]>(months.map((x) => [x, []]));
      for (const r of world.rentRows ?? []) if (lawdCds.includes(r.lawdCd) && m.has(r.dealYmd)) m.get(r.dealYmd)!.push(r);
      return m;
    },
    fetchMolit: async (tasks) => {
      calls.molitTasks.push(...tasks);
      const out: Record<string, MonthTaskResult> = {};
      for (const t of tasks) out[t.key] = world.molit?.[t.key] ?? { items: [], failed: false };
      return out;
    },
  };
  return { deps, calls };
}

const NOW = new Date('2026-09-14T09:00:00Z');
function insightsOf(raw: { aptByMonth: any[][]; rentByMonth: any[][] }, preset: '30d' | '3m' | '6m' | '12m' = '12m') {
  const { saleTrades, pureJeonseTrades } = toGapInputs(raw.aptByMonth.flat(), raw.rentByMonth.flat(), { isSidoAll: true, dong: 'all' });
  return computeGapInvestInsights({
    saleTrades,
    pureJeonseTrades,
    isSidoAll: true,
    dong: 'all',
    preset,
    now: NOW,
    last12Months: MONTHS,
    sigunguNameByLawdCd: new Map([['26140', '서구'], ['26710', '기장군']]),
    sort: 'count',
  });
}

// ── 1. 검증된 월은 DB ───────────────────────────────────────────────────────────

test('1. 검증된 매매 셀과 전월세 검증범위 월은 DB에서 읽고 MOLIT task를 만들지 않는다', async () => {
  const { deps, calls } = fakeDeps({
    verifiedSaleCells: new Set([cellKey('26140', '202608')]),
    saleRows: [saleRow({ lawdCd: '26140', date: '2026-08-10' })],
    rentRows: [rentRow({ lawdCd: '26140', date: '2026-08-05' })],
  });
  const raw = await loadGapInvestSidoRaw({ lawdCds: ['26140'], months: ['202608'], currentMonth: CURRENT, dbBacked: true }, deps);
  assert.equal(calls.molitTasks.length, 0);
  assert.equal(raw.aptByMonth[0].length, 1);
  assert.equal(raw.aptByMonth[0][0].lawdCd, '26140');
  assert.equal(raw.rentByMonth[0].length, 1);
  assert.equal(raw.dataSource.mode, 'DB_FIRST');
  assert.equal(raw.dataSource.sale.dbCells, 1);
  assert.equal(raw.dataSource.rent.dbCells, 1);
  assert.equal(raw.dataSource.molitCalls, 0);
});

// ── 2. 검증 안 된 월은 MOLIT ─────────────────────────────────────────────────────

test('2. 매매 셀이 검증되지 않았거나 전월세 월이 검증범위 밖이면 MOLIT에서 읽는다', () => {
  const plan = planGapInvestSources({
    lawdCds: ['26140', '26710'],
    months: ['202607', '202608'],
    currentMonth: CURRENT,
    dbBacked: true,
    // 26710:202608만 검증 안 됨(PARTIAL/INVALID/셀 없음 → 집합에 없다)
    verifiedSaleCells: new Set([cellKey('26140', '202607'), cellKey('26140', '202608'), cellKey('26710', '202607')]),
    rentVerifiedRange: { from: '202408', to: '202607' },
  });
  const keys = plan.molitTasks.map((t) => t.key).sort();
  assert.deepEqual(keys, ['26140|rent:202608', '26710|apt:202608', '26710|rent:202608']);
  assert.deepEqual(plan.rentDbMonths, ['202607']);
});

// ── 3. 현재월 정책 ──────────────────────────────────────────────────────────────

test('3. 현재월은 coverage 증거가 무엇이든 매매·전월세 모두 MOLIT이다', () => {
  const plan = planGapInvestSources({
    lawdCds: BUSAN_16,
    months: MONTHS,
    currentMonth: CURRENT,
    dbBacked: true,
    // 잘못 기록된 현재월 셀과 현재월까지 뻗은 범위를 일부러 준다
    verifiedSaleCells: allVerifiedSaleCells(BUSAN_16, MONTHS),
    rentVerifiedRange: { from: '202408', to: '202612' },
  });
  for (const d of BUSAN_16) assert.equal(plan.saleDbCells.has(cellKey(d, CURRENT)), false);
  assert.equal(plan.rentDbMonths.includes(CURRENT), false);
  const currentTasks = plan.molitTasks.filter((t) => t.dealYmd === CURRENT);
  assert.equal(currentTasks.length, 32);
  assert.equal(plan.molitTasks.length, 32);
});

// ── 4. 취소 제외 유지 ───────────────────────────────────────────────────────────

test('4. DB 경로도 취소 매매를 그대로 싣고, 제외는 기존과 같은 한 곳(toGapInputs)에서 한다', async () => {
  const { deps } = fakeDeps({
    verifiedSaleCells: new Set([cellKey('26140', '202608')]),
    saleRows: [
      saleRow({ lawdCd: '26140', date: '2026-08-10', dealAmount: 50000, dealCanceled: true }),
      saleRow({ lawdCd: '26140', date: '2026-08-11', dealAmount: 51000 }),
    ],
    rentRows: [rentRow({ lawdCd: '26140', date: '2026-08-05' })],
  });
  const raw = await loadGapInvestSidoRaw({ lawdCds: ['26140'], months: ['202608'], currentMonth: CURRENT, dbBacked: true }, deps);
  // loader는 취소 행을 버리지 않는다(dealCanceled 원값 보존)
  assert.deepEqual(raw.aptByMonth[0].map((t: any) => t.dealCanceled), [true, false]);
  const { saleTrades } = toGapInputs(raw.aptByMonth.flat(), raw.rentByMonth.flat(), { isSidoAll: true, dong: 'all' });
  assert.equal(saleTrades.length, 1);
  assert.equal(saleTrades[0].dealAmount, 51000);
  const ins = insightsOf(raw);
  assert.equal(ins.summary.totalSaleCount, 1);
  assert.equal(ins.summary.gapEventCount, 1);
  assert.equal(ins.apartmentRankingTop[0].saleAmount, 51000);

  const code = codeOf(read('src/lib/stats/gap-invest-insights.ts'));
  assert.ok(/t != null && !t\.dealCanceled\)/.test(code), '매매 취소 제외 필터가 사라졌다');
  assert.ok(/!t\.dealCanceled && \(!t\.monthlyRent \|\| t\.monthlyRent === 0\)/.test(code), '순수 전세 필터가 바뀌었다');
});

// ── 5. 다른 달로 채우지 않는다 ───────────────────────────────────────────────────

test('5. 날짜 범위 쿼리에 걸린 미검증 셀 행은 버리고, 실패한 MOLIT 셀을 다른 달 데이터로 채우지 않는다', async () => {
  const { deps } = fakeDeps({
    // 202607, 202609(현재월) 검증 안 됨. 202606, 202608 검증.
    verifiedSaleCells: new Set([cellKey('26140', '202606'), cellKey('26140', '202608')]),
    saleRows: [
      saleRow({ lawdCd: '26140', date: '2026-06-10', dealAmount: 1 }),
      saleRow({ lawdCd: '26140', date: '2026-07-10', dealAmount: 2 }), // 미검증 셀 행 — 범위엔 걸리지만 버려야 한다
      saleRow({ lawdCd: '26140', date: '2026-08-10', dealAmount: 3 }),
      saleRow({ lawdCd: '26140', date: '2026-09-10', dealAmount: 4 }), // 현재월
    ],
    molit: { '26140|apt:202607': { items: [], failed: true } },
  });
  const months = ['202606', '202607', '202608', '202609'];
  const raw = await loadGapInvestSidoRaw({ lawdCds: ['26140'], months, currentMonth: CURRENT, dbBacked: true }, deps);
  assert.deepEqual(raw.aptByMonth.map((m) => m.map((t: any) => t.dealAmount)), [[1], [], [3], []]);
  assert.deepEqual(raw.failedLawdCds, ['26140']);
  assert.equal(raw.dataSource.sale.dbRows, 2);
});

// ── 6. 다른 구로 채우지 않는다 ───────────────────────────────────────────────────

test('6. 검증 셀은 구 단위다 — 다른 구의 DB 행이나 결과로 빈/실패 구를 채우지 않는다', async () => {
  const { deps, calls } = fakeDeps({
    verifiedSaleCells: new Set([cellKey('26140', '202608')]),
    saleRows: [saleRow({ lawdCd: '26140', date: '2026-08-10' }), saleRow({ lawdCd: '26710', date: '2026-08-10', dealAmount: 777 })],
    molit: { '26710|apt:202608': { items: [], failed: true } },
    rentRange: { from: '202408', to: '202607' },
  });
  const raw = await loadGapInvestSidoRaw({ lawdCds: ['26140', '26710'], months: ['202608'], currentMonth: CURRENT, dbBacked: true }, deps);
  const apt = raw.aptByMonth[0];
  assert.equal(apt.filter((t: any) => t.lawdCd === '26710').length, 0, '미검증 구(26710)에 DB 행이 들어갔다');
  assert.ok(!apt.some((t: any) => t.dealAmount === 777));
  assert.deepEqual(raw.failedLawdCds, ['26710']);
  assert.ok(calls.molitTasks.some((t) => t.key === '26710|apt:202608'));
  assert.ok(!calls.molitTasks.some((t) => t.key === '26140|apt:202608'));
});

// ── 7. DB 증거가 없으면 명시적으로 MOLIT/partial ─────────────────────────────────

test('7. SALE coverage를 읽지 못하면 매매 전 셀을 MOLIT으로 좁히고, MOLIT 실패는 partial로 드러난다', async () => {
  const errors: string[] = [];
  const { deps, calls } = fakeDeps({ coverageThrows: true, molit: { '26140|apt:202608': { items: [], failed: true } } });
  deps.logError = (m) => errors.push(m);
  const raw = await loadGapInvestSidoRaw({ lawdCds: ['26140', '26710'], months: ['202607', '202608'], currentMonth: CURRENT, dbBacked: true }, deps);
  assert.equal(calls.molitTasks.filter((t) => t.type === 'apt').length, 4);
  assert.equal(calls.saleQueries.length, 0, '검증 증거 없이 매매 DB를 읽었다');
  assert.equal(raw.dataSource.sale.dbCells, 0);
  assert.equal(errors.length, 1);
  assert.deepEqual(raw.failedLawdCds, ['26140']);
  // 전월세 DB 셀이 있으므로 총 실패가 아니라 partial
  assert.equal(resolveSidoApiError(raw, 2), false);
});

// ── 8. 응답 모양 불변 ───────────────────────────────────────────────────────────

test('8. 라우트 응답은 기존 필드를 전부 유지하고 dataSource만 추가한다', () => {
  const code = codeOf(read('src/app/api/stats/gap-invest/route.ts'));
  const body = code.slice(code.indexOf("status: 'OK'"));
  for (const key of ["status: 'OK'", 'region:', 'scope: regionScope', 'period: { preset, from: period.from, to: period.to }', 'previousPeriod: previousRange', 'maxDayGap: 90', 'summary,', 'regionRanking,', 'apartmentRanking,', 'monthlyTrend,', 'apiError,', 'partial,', 'failedDistricts: failedLawdCds', 'dataSource,']) {
    assert.ok(body.includes(key), `응답 필드 누락: ${key}`);
  }
  const ins = insightsOf({ aptByMonth: [[]], rentByMonth: [[]] }, '3m');
  assert.deepEqual(Object.keys(ins.summary), ['totalSaleCount', 'gapEventCount', 'ratioPct', 'previousGapEventCount', 'previousTotalSaleCount', 'changeCount', 'medianGap']);
  assert.equal(ins.monthlyTrend.length, 12);
});

// ── 9. 같은 거래면 같은 순위 ────────────────────────────────────────────────────

test('9. 같은 거래를 MOLIT-shape로 받든 DB 행으로 받든 집계·순위가 완전히 같다', async () => {
  const lawdCds = ['26140', '26710'];
  const months = ['202607', '202608'];
  const saleSpec = [
    { lawdCd: '26140', date: '2026-07-03', aptSeq: '26140-1', area: '84.9500', amount: 50000, canceled: false },
    { lawdCd: '26140', date: '2026-08-20', aptSeq: '26140-1', area: '84.9500', amount: 52000, canceled: false },
    { lawdCd: '26140', date: '2026-08-21', aptSeq: '26140-2', area: '59.9900', amount: 30000, canceled: true },
    { lawdCd: '26710', date: '2026-08-01', aptSeq: '26710-9', area: '101.2000', amount: 40000, canceled: false },
  ];
  const rentSpec = [
    { lawdCd: '26140', date: '2026-07-01', aptSeq: '26140-1', area: '84.9500', deposit: 45000, monthlyRent: 0 },
    { lawdCd: '26140', date: '2026-08-15', aptSeq: '26140-1', area: '84.9500', deposit: 47000, monthlyRent: 0 },
    { lawdCd: '26140', date: '2026-08-16', aptSeq: '26140-2', area: '59.9900', deposit: 28000, monthlyRent: 0 },
    { lawdCd: '26710', date: '2026-07-20', aptSeq: '26710-9', area: '101.2000', deposit: 20000, monthlyRent: 50 }, // 반전세 — 제외
    { lawdCd: '26710', date: '2026-08-02', aptSeq: '26710-9', area: '101.2000', deposit: 35000, monthlyRent: 0 },
  ];

  const molit: Record<string, MonthTaskResult> = {};
  for (const d of lawdCds) for (const m of months) {
    molit[`${d}|apt:${m}`] = { failed: false, items: saleSpec.filter((s) => s.lawdCd === d && s.date.replace('-', '').startsWith(m)).map((s) => molitItem({ type: 'apt', date: s.date, aptSeq: s.aptSeq, area: Number(s.area), amount: s.amount, canceled: s.canceled })) };
    molit[`${d}|rent:${m}`] = { failed: false, items: rentSpec.filter((s) => s.lawdCd === d && s.date.replace('-', '').startsWith(m)).map((s) => molitItem({ type: 'rent', date: s.date, aptSeq: s.aptSeq, area: Number(s.area), amount: s.deposit, monthlyRent: s.monthlyRent })) };
  }
  const molitOnly = fakeDeps({ molit });
  const rawMolit = await loadGapInvestSidoRaw({ lawdCds, months, currentMonth: CURRENT, dbBacked: false }, molitOnly.deps);
  assert.equal(molitOnly.calls.molitTasks.length, 8);

  const dbOnly = fakeDeps({
    verifiedSaleCells: allVerifiedSaleCells(lawdCds, months),
    saleRows: saleSpec.map((s) => saleRow({ lawdCd: s.lawdCd, date: s.date, aptSeq: s.aptSeq, exclusiveArea: s.area, dealAmount: s.amount, dealCanceled: s.canceled })),
    rentRows: rentSpec.map((s) => rentRow({ lawdCd: s.lawdCd, date: s.date, aptSeq: s.aptSeq, exclusiveArea: s.area, deposit: s.deposit, monthlyRent: s.monthlyRent })),
  });
  const rawDb = await loadGapInvestSidoRaw({ lawdCds, months, currentMonth: CURRENT, dbBacked: true }, dbOnly.deps);
  assert.equal(dbOnly.calls.molitTasks.length, 0);

  for (const preset of ['30d', '3m', '6m', '12m'] as const) {
    const a = insightsOf(rawMolit, preset);
    const b = insightsOf(rawDb, preset);
    assert.deepEqual(b, a, `preset=${preset} 결과가 소스에 따라 달라졌다`);
  }
  const ins = insightsOf(rawDb, '12m');
  assert.deepEqual(ins.regionRanking.map((r) => [r.code, r.gapCount]), [['26140', 2], ['26710', 1]]);
  assert.deepEqual(ins.apartmentRankingTop.map((r) => r.gap), [5000, 5000]);
});

// ── 10. 빈 결과 ────────────────────────────────────────────────────────────────

test('10. 검증된 0건 셀은 진짜 0건이다 — 빈 요약·빈 순위, apiError/partial 아님', async () => {
  const { deps } = fakeDeps({ verifiedSaleCells: allVerifiedSaleCells(['26140'], ['202608']) });
  const raw = await loadGapInvestSidoRaw({ lawdCds: ['26140'], months: ['202608'], currentMonth: CURRENT, dbBacked: true }, deps);
  assert.deepEqual(raw.failedLawdCds, []);
  assert.equal(resolveSidoApiError(raw, 1), false);
  const ins = insightsOf(raw, '12m');
  assert.equal(ins.summary.totalSaleCount, 0);
  assert.equal(ins.summary.gapEventCount, 0);
  assert.equal(ins.summary.ratioPct, null);
  assert.equal(ins.summary.medianGap, null);
  assert.deepEqual(ins.regionRanking, []);
  assert.deepEqual(ins.apartmentRankingTop, []);
});

// ── 11. 오류 ───────────────────────────────────────────────────────────────────

test('11. 오류: DB 셀 0 + 전 구 실패 = apiError, DB 셀이 있으면 partial, DB 쿼리 실패는 요청 실패', async () => {
  const lawdCds = ['26140', '26710'];
  const allFail: Record<string, MonthTaskResult> = {};
  for (const d of lawdCds) for (const t of ['apt', 'rent']) allFail[`${d}|${t}:202609`] = { items: [], failed: true };

  const nonBusan = fakeDeps({ molit: allFail });
  const rawNon = await loadGapInvestSidoRaw({ lawdCds, months: ['202609'], currentMonth: CURRENT, dbBacked: false }, nonBusan.deps);
  assert.equal(resolveSidoApiError(rawNon, 2), true);

  const busan = fakeDeps({ molit: allFail, verifiedSaleCells: allVerifiedSaleCells(lawdCds, ['202608']) });
  const rawBusan = await loadGapInvestSidoRaw({ lawdCds, months: ['202608', '202609'], currentMonth: CURRENT, dbBacked: true }, busan.deps);
  assert.deepEqual(rawBusan.failedLawdCds.sort(), lawdCds);
  assert.equal(resolveSidoApiError(rawBusan, 2), false, 'DB 결과가 있는데 화면 전체를 에러로 숨긴다');

  const broken = fakeDeps({ saleQueryThrows: true, verifiedSaleCells: allVerifiedSaleCells(lawdCds, ['202608']) });
  await assert.rejects(loadGapInvestSidoRaw({ lawdCds, months: ['202608'], currentMonth: CURRENT, dbBacked: true }, broken.deps), /db down/);
  // 라우트는 그 throw를 catch해 500 ERROR로 만든다(MOLIT 전체로 조용히 되돌아가지 않는다)
  const route = codeOf(read('src/app/api/stats/gap-invest/route.ts'));
  assert.ok(/catch \(error\)[\s\S]*status: 'ERROR'[\s\S]*status: 500/.test(route));
});

// ── 12. 부산 전체 경로 ──────────────────────────────────────────────────────────

test('12. 부산 전체는 DB 경로, 부산 외 시도는 기존 MOLIT 경로 — 라우트가 sidoCode로 판정한다', () => {
  assert.equal(isFeedDbBackedSido('26'), true);
  assert.equal(isFeedDbBackedSido('11'), false);
  const route = codeOf(read('src/app/api/stats/gap-invest/route.ts'));
  assert.ok(/const dbBacked = isFeedDbBackedSido\(sidoCodeParam\)/.test(route));
  assert.ok(/loadGapInvestSidoRaw\(/.test(route));
  assert.ok(/currentMonth: last12Months\[last12Months\.length - 1\]/.test(route), '현재월 기준이 요청 창과 분리됐다');
  // DB 소스 모듈은 MOLIT을 직접 import하지 않는다(타입만) — 호출은 주입된 공유 게이트로만.
  const src = codeOf(read('src/lib/stats/gap-invest-db-source.ts'));
  assert.ok(!/import \{[^}]*\} from '@\/lib\/api-molit'/.test(src));
  assert.ok(!/fetchMolitData/.test(src));
});

// ── 13. 단일 구 회귀 ────────────────────────────────────────────────────────────

test('13. 단일 구 조회 경로는 바뀌지 않았다(24개 MOLIT task, 기존 캐시 키, DB 미사용)', () => {
  const route = codeOf(read('src/app/api/stats/gap-invest/route.ts'));
  const single = route.slice(route.indexOf('} else {', route.indexOf('if (isSidoAll)')), route.indexOf('const { saleTrades, pureJeonseTrades }'));
  assert.ok(single.includes('const cacheKey = `stats-gap-invest:${lawdCd}`'));
  assert.ok(single.includes("...last12Months.map((ym) => ({ key: `apt:${ym}`, lawdCd: lawdCd!, dealYmd: ym, type: 'apt' as const }))"));
  assert.ok(single.includes("...last12Months.map((ym) => ({ key: `rent:${ym}`, lawdCd: lawdCd!, dealYmd: ym, type: 'rent' as const }))"));
  assert.ok(!/loadGapInvestSidoRaw|getRegionalSaleRowsForFeedFromDb|fetchRentMonthBucketsFromDb/.test(single));
  // 단일 구 apiError probe 유지
  assert.ok(/if \(!isSidoAll && saleTrades\.length === 0 && pureJeonseTrades\.length === 0\)/.test(route));
});

// ── 14. 호출 수 감소 ────────────────────────────────────────────────────────────

test('14. 실측 coverage(매매 11개월 16/16 검증, 전월세 ~202608)에서 384 → 32 호출, 부산 외는 384 그대로', () => {
  const completed = MONTHS.slice(0, 11);
  const busan = planGapInvestSources({ lawdCds: BUSAN_16, months: MONTHS, currentMonth: CURRENT, dbBacked: true, verifiedSaleCells: allVerifiedSaleCells(BUSAN_16, completed), rentVerifiedRange: RENT_RANGE });
  assert.equal(busan.molitTasks.length, 32);
  assert.equal(busan.saleDbCells.size, 176);
  assert.deepEqual(busan.rentDbMonths, completed);

  const other = planGapInvestSources({ lawdCds: BUSAN_16, months: MONTHS, currentMonth: CURRENT, dbBacked: false, verifiedSaleCells: allVerifiedSaleCells(BUSAN_16, completed), rentVerifiedRange: RENT_RANGE });
  // 기존 라우트가 만들던 task 목록과 키·순서까지 동일
  const legacy: MonthTask[] = [];
  for (const d of BUSAN_16) for (const ym of MONTHS) {
    legacy.push({ key: `${d}|apt:${ym}`, lawdCd: d, dealYmd: ym, type: 'apt' });
    legacy.push({ key: `${d}|rent:${ym}`, lawdCd: d, dealYmd: ym, type: 'rent' });
  }
  assert.deepEqual(other.molitTasks, legacy);
});

// ── 15. 공유 MOLIT 게이트/우선순위 ──────────────────────────────────────────────

test('15. 남은 MOLIT 호출은 기존 bulk lane 공유 게이트로만 나간다(상세 조회 우선순위 유지)', () => {
  const route = codeOf(read('src/app/api/stats/gap-invest/route.ts'));
  assert.ok(/fetchMolit: fetchMonthsThrottledWithStatus/.test(route));
  const helpers = codeOf(read('src/lib/molit-stats-helpers.ts'));
  assert.ok(/fetchMolitData\(\{ type, lawdCd, dealYmd \}, \{ lane: 'bulk' \}\)/.test(helpers), '통계 sweep이 bulk lane을 떠났다');
  // 동시성/페이싱 상수는 이 STEP에서 올리지 않았다(느림을 동시성 상향으로 숨기지 않는다)
  const guard = codeOf(read('src/lib/molit-rate-guard.ts'));
  assert.ok(/MOLIT_CONCURRENCY\s*=\s*4\b/.test(guard), 'MOLIT 동시성이 바뀌었다');
});
