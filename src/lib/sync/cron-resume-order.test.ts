import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// CRON_DURABLE_PROGRESS_V1 — 재개 순서 · recheck/rent 회귀 · deadline 산술 · scope/스케줄 불변. DB 0 · 네트워크 0.
// 코어는 주입점(deps)으로 돌린다: 셀 처리는 결정적 대역, coverage는 메모리 저장소, 시간은 주입한 시계.

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// 어떤 경로로든 실제 DB에 닿으면 즉시 실패시킨다.
const g = globalThis as unknown as { prisma?: unknown };
const originalPrisma = g.prisma;
const originalFetch = globalThis.fetch;
const originalKey = process.env.DATA_GO_KR_API_KEY;
const noDb = new Proxy({}, { get: (_t, prop) => { throw new Error(`DB에 닿았다: prisma.${String(prop)}`); } });

type SaleCore = typeof import('./sale-sync-core');
type RecheckCore = typeof import('./sale-recheck-core');
type RentCore = typeof import('./rent-sync-core');
type Shared = typeof import('./shared');
type Deadline = typeof import('./run-deadline');
type Scope = typeof import('./sale-sync-scope');
let sale: SaleCore;
let recheck: RecheckCore;
let rent: RentCore;
let shared: Shared;
let dl: Deadline;
let scope: Scope;
let BUSAN_16: readonly string[];
let isVerified: (s: string) => boolean;

before(async () => {
  g.prisma = noDb;
  process.env.DATA_GO_KR_API_KEY = 'test-key';
  sale = await import('./sale-sync-core');
  recheck = await import('./sale-recheck-core');
  rent = await import('./rent-sync-core');
  shared = await import('./shared');
  dl = await import('./run-deadline');
  scope = await import('./sale-sync-scope');
  const rv = await import('../rent-verified-range');
  BUSAN_16 = rv.BUSAN_LAWDCD_16;
  isVerified = rv.isVerifiedCellStatus;
});
after(() => {
  g.prisma = originalPrisma;
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.DATA_GO_KR_API_KEY; else process.env.DATA_GO_KR_API_KEY = originalKey;
});

// ---- 메모리 coverage + 결정적 셀 대역 ----
type CellReport = import('./shared').CellReport;
type Status = CellReport['status'];

function harness(opts: { costMs?: number; statusOf?: (l: string, y: string) => Status; killAfter?: number; deadlineAt?: string; reviewAt?: string } = {}) {
  let now = 0;
  const store = new Map<string, { status: string; verifiedAtMs: number; runId: string }>();
  const processed: string[] = [];
  const recordCalls: number[] = [];
  let calls = 0;
  const report = (lawdCd: string, dealYmd: string): CellReport => ({
    lawdCd, dealYmd, status: opts.statusOf?.(lawdCd, dealYmd) ?? 'COMPLETE', sourceTotalCount: 1, fetched: 1, blocked: 0,
    inserted: 0, updated: 0, unchanged: 1, reviewCandidates: opts.reviewAt === `${lawdCd}:${dealYmd}` ? 1 : 0, registryUpdated: 0, registryAmbiguousSkipped: 0,
  });
  const cell = async (lawdCd: string, dealYmd: string): Promise<CellReport> => {
    if (opts.killAfter != null && calls === opts.killAfter) throw new Error('simulated process kill');
    calls++;
    now += opts.costMs ?? 800;
    if (opts.deadlineAt === `${lawdCd}:${dealYmd}`) return { ...report(lawdCd, dealYmd), status: 'INVALID', deadlineReached: true };
    processed.push(`${lawdCd}:${dealYmd}`);
    return report(lawdCd, dealYmd);
  };
  const h = {
    store,
    processed,
    recordCalls,
    get now() { return now; },
    advance(ms: number) { now += ms; },
    resetCalls() { calls = 0; processed.length = 0; },
    clock: () => now,
    recordCoverage: async (_mode: string, dataset: string, runId: string, cells: import('../sync-coverage').CoverageCellRecord[]) => {
      recordCalls.push(cells.length);
      for (const c of cells) store.set(`${dataset}:${c.lawdCd}:${c.dealYmd}`, { status: c.status, verifiedAtMs: now, runId });
      return { recorded: cells.length };
    },
    loadCoverage: async (lawdCds: readonly string[], months: readonly string[]) =>
      [...store.entries()]
        .map(([k, v]) => { const [, l, y] = k.split(':'); return { lawdCd: l, dealYmd: y, status: v.status, verifiedAtMs: v.verifiedAtMs, dataset: k.split(':')[0] }; })
        .filter((c) => c.dataset === 'SALE' && lawdCds.includes(c.lawdCd) && months.includes(c.dealYmd)),
    loadCells: async (from: string, to: string, lawdCds: string[]) =>
      shared.monthsInRange(from, to).flatMap((y) => lawdCds.map((l) => ({ lawdCd: l, dealYmd: y, lastVerifiedAtMs: store.get(`SALE:${l}:${y}`)?.verifiedAtMs }))),
    saleCell: (l: string, y: string) => cell(l, y),
    rentCell: (l: string, y: string) => cell(l, y),
  };
  return h;
}
const quiet = () => undefined;
const NOW = new Date('2026-09-27T04:30:00+09:00'); // latestComplete 202608 · sale 202606–202609 · recheck band 202508–202605
const GG = () => [...scope.GYEONGGI_SALE_SYNC_LAWDCDS];

// ---------------------------------------------------------------------------
// 6·7 — sale 재개 순서
// ---------------------------------------------------------------------------

test('6 · 구 순서: 미검증 → 오래된 검증 → 최근 검증, 현재월은 판정에서 제외, INVALID 기록은 미검증, 동률은 scope 순서', () => {
  const months = ['202606', '202607', '202608'];
  const cov = [
    ...months.map((m) => ({ lawdCd: 'A', dealYmd: m, status: 'COMPLETE', verifiedAtMs: 300 })),
    ...months.map((m) => ({ lawdCd: 'B', dealYmd: m, status: 'COMPLETE', verifiedAtMs: 100 })),
    ...months.map((m) => ({ lawdCd: 'C', dealYmd: m, status: m === '202607' ? 'INVALID' : 'COMPLETE', verifiedAtMs: 500 })),
    ...months.map((m) => ({ lawdCd: 'D', dealYmd: m, status: 'EMPTY_VALID', verifiedAtMs: 100 })),
    { lawdCd: 'A', dealYmd: '202609', status: 'COMPLETE', verifiedAtMs: 1 }, // 현재월 — 판정에 쓰이지 않는다
  ];
  const input = ['A', 'B', 'C', 'D', 'E'];
  const out = shared.orderSaleDistrictsByStaleness(input, months, cov, isVerified);
  // E: 검증 기록 없음(가장 앞) · C: 완료월 하나가 INVALID(미검증) · B·D 동률(100)은 scope 순서 · A 최근
  assert.deepEqual(out, ['E', 'C', 'B', 'D', 'A']);
  assert.deepEqual(input, ['A', 'B', 'C', 'D', 'E'], '입력을 변형했다');
  // 기록이 하나도 없으면 scope 순서 그대로(기존 동작과 같다)
  assert.deepEqual(shared.orderSaleDistrictsByStaleness(GG(), months, [], isVerified), GG());
});

test('6b · 중단된 실행 뒤 다음 실행은 처리 못 한 구부터 시작한다(처리한 셀은 미검증으로 보지 않는다)', async () => {
  const h = harness({ killAfter: 10 });
  // 어제 전 셀이 검증돼 있었다
  for (const l of GG()) for (const y of ['202606', '202607', '202608']) h.store.set(`SALE:${l}:${y}`, { status: 'COMPLETE', verifiedAtMs: -86_400_000, runId: 'y' });
  h.advance(1);
  await assert.rejects(sale.runSaleSync({ mode: 'apply', lawdCds: GG(), now: NOW }, quiet, { clock: h.clock, syncCell: h.saleCell, recordCoverage: h.recordCoverage, loadCoverage: h.loadCoverage }));
  assert.deepEqual(h.processed.slice(0, 4), ['41111:202606', '41111:202607', '41111:202608', '41111:202609']);
  // 41111·41113 완료, 41115는 06·07만
  const lines: string[] = [];
  h.resetCalls();
  await assert.rejects(sale.runSaleSync({ mode: 'apply', lawdCds: GG(), now: NOW }, (l) => lines.push(l), { clock: h.clock, syncCell: h.saleCell, recordCoverage: h.recordCoverage, loadCoverage: h.loadCoverage }));
  const order = lines.find((l) => l.startsWith('ORDER sale '))!.slice('ORDER sale '.length).split(',');
  assert.deepEqual(order, ['41115', '41117', '41131', '41133', '41150', '41210', '41111', '41113']);
  assert.equal(h.processed[0], '41115:202606', '다음 실행이 또 첫 구부터 시작했다');
});

test('7 · 느린 아침이 반복돼도 경기 8구를 모두 돈다(매번 41111부터 다시 시작하지 않는다)', async () => {
  // 셀당 3s(평소의 ~4배) → 실행당 16셀 = 4구. 매일 같은 속도.
  const h = harness({ costMs: 3_000 });
  const firstDistrictByRun: string[] = [];
  const touched = new Set<string>();
  for (let day = 0; day < 4; day++) {
    h.resetCalls();
    h.advance(86_400_000);
    const s = await sale.runSaleSync({ mode: 'apply', lawdCds: GG(), now: NOW }, quiet, { clock: h.clock, syncCell: h.saleCell, recordCoverage: h.recordCoverage, loadCoverage: h.loadCoverage });
    assert.equal(s.stopReason, 'BUDGET_EXHAUSTED');
    assert.equal(s.cellsProcessed, 16);
    firstDistrictByRun.push(h.processed[0].split(':')[0]);
    for (const c of h.processed) touched.add(c.split(':')[0]);
    if (day === 1) assert.equal(touched.size, 8, '이틀 안에 8구 전부를 한 번씩 돌아야 한다');
  }
  // 예전(항상 scope 순서)이라면 매일 41111부터 16셀 = 41111–41117만 돌고 41131·41133·41150·41210은 한 번도 처리되지 않는다.
  assert.deepEqual(firstDistrictByRun, ['41111', '41131', '41111', '41131']);
});

test('7b · 중단이 반복돼도(매번 10셀 뒤 종료) 4번 안에 8구의 완료월 셀이 전부 새로 검증된다', async () => {
  const h = harness({ killAfter: 10 });
  for (const l of GG()) for (const y of ['202606', '202607', '202608']) h.store.set(`SALE:${l}:${y}`, { status: 'COMPLETE', verifiedAtMs: 0, runId: 'y' });
  h.advance(1);
  const start = h.now;
  let runs = 0;
  while (runs < 8) {
    runs++;
    h.resetCalls();
    await assert.rejects(sale.runSaleSync({ mode: 'apply', lawdCds: GG(), now: NOW }, quiet, { clock: h.clock, syncCell: h.saleCell, recordCoverage: h.recordCoverage, loadCoverage: h.loadCoverage }));
    const fresh = [...h.store.values()].filter((v) => v.verifiedAtMs > start).length;
    if (fresh === 24) break;
  }
  assert.ok(runs <= 4, `8구 24셀을 새로 검증하는 데 ${runs}번 걸렸다`);
});

test('7c · coverage 조회가 실패해도 실행은 scope 순서로 진행한다(ORDER_FALLBACK)', async () => {
  const h = harness();
  const lines: string[] = [];
  const s = await sale.runSaleSync({ mode: 'apply', lawdCds: GG(), now: NOW }, (l) => lines.push(l), {
    clock: h.clock, syncCell: h.saleCell, recordCoverage: h.recordCoverage,
    loadCoverage: async () => { throw new Error('db down'); },
  });
  assert.ok(lines.some((l) => l.startsWith('ORDER_FALLBACK')));
  assert.equal(h.processed[0], '41111:202606');
  assert.equal(s.cellsProcessed, 32);
  assert.equal(s.coverageRecorded, 24);
});

test('7d · districtOffset/Limit chunk는 그대로 — 자른 뒤 그 안에서만 정렬한다', async () => {
  const h = harness();
  const s = await sale.runSaleSync({ mode: 'apply', lawdCds: GG(), districtOffset: 6, districtLimit: 2, now: NOW }, quiet, { clock: h.clock, syncCell: h.saleCell, recordCoverage: h.recordCoverage, loadCoverage: h.loadCoverage });
  assert.deepEqual([...new Set(h.processed.map((c) => c.split(':')[0]))], ['41150', '41210']);
  assert.equal(s.cells, 8);
});

// ---------------------------------------------------------------------------
// 13·14·16 — deadline 산술 · 정리 예비
// ---------------------------------------------------------------------------

test('16 · 정리 예비: route 60s − 작업 예산(sale 50 · recheck 45 · rent 50) ≥ 10s, 마지막 MOLIT 시도는 예산 − 커밋 예비 전에 끝난다', () => {
  for (const r of ['sale-sync', 'sale-recheck', 'rent-sync']) assert.ok(/export const maxDuration = 60;/.test(code(`src/app/api/cron/${r}/route.ts`)), r);
  assert.ok(/new TimeBudget\(opts\.budgetMs \?\? 50_000, deps\.clock\)/.test(code('src/lib/sync/sale-sync-core.ts')));
  assert.ok(/new TimeBudget\(opts\.budgetMs \?\? 45_000, deps\.clock\)/.test(code('src/lib/sync/sale-recheck-core.ts')));
  assert.ok(/new TimeBudget\(opts\.budgetMs \?\? 50_000, deps\.clock\)/.test(code('src/lib/sync/rent-sync-core.ts')));
  for (const budget of [50_000, 45_000]) assert.ok(60_000 - budget >= 10_000);
  assert.equal(dl.MOLIT_ATTEMPT_TIMEOUT_MS, 10_000);
  assert.equal(dl.MIN_ATTEMPT_TIMEOUT_MS, 2_000);
  assert.equal(dl.CELL_COMMIT_RESERVE_MS, 2_000);
  // 모든 남은 시간·대기 조합에서: 허용되면 대기 + 시도 + 커밋 예비 ≤ 남은 시간, 시도는 2s–10s
  for (let remaining = -5_000; remaining <= 60_000; remaining += 125) {
    for (const wait of [0, 350, 500, 2_000, 10_000]) {
      const p = dl.planRequestAttempt({ remainingMs: () => remaining }, wait);
      if (!p.ok) {
        assert.ok(remaining - wait - dl.CELL_COMMIT_RESERVE_MS < dl.MIN_ATTEMPT_TIMEOUT_MS);
        continue;
      }
      assert.ok(wait + p.timeoutMs + dl.CELL_COMMIT_RESERVE_MS <= remaining, `r=${remaining} w=${wait}`);
      assert.ok(p.timeoutMs >= dl.MIN_ATTEMPT_TIMEOUT_MS && p.timeoutMs <= dl.MOLIT_ATTEMPT_TIMEOUT_MS);
    }
  }
  // 한도가 멀면 예전과 같은 10s, 가까우면 줄어든다
  assert.deepEqual(dl.planRequestAttempt({ remainingMs: () => 40_000 }, 350), { ok: true, timeoutMs: 10_000 });
  assert.deepEqual(dl.planRequestAttempt({ remainingMs: () => 6_000 }, 0), { ok: true, timeoutMs: 4_000 });
  assert.equal(dl.planRequestAttempt({ remainingMs: () => 3_999 }, 0).ok, false);
  assert.deepEqual(dl.planRequestAttempt(undefined, 999_999), { ok: true, timeoutMs: 10_000 }, 'deadline 없는 호출(CLI)은 예전 그대로');
});

test('16b · 셀 경계 정지(요청 0회)가 정상 예산 끝이다 — 셀 시작 조건이 첫 시도 조건을 포함한다', () => {
  const at = (elapsed: number, budgetMs: number) => {
    let now = 0;
    const b = new shared.TimeBudget(budgetMs, () => now);
    now = elapsed;
    return dl.hasRoomForCell(b, 2_500, 350);
  };
  assert.equal(at(45_600, 50_000), true);
  assert.equal(at(45_700, 50_000), false, '첫 시도를 못 할 셀을 시작한다');
  assert.equal(at(40_600, 45_000), true);
  assert.equal(at(40_700, 45_000), false);
});

// ---------------------------------------------------------------------------
// 17 — recheck 회귀
// ---------------------------------------------------------------------------

test('17 · recheck: 셀마다 즉시 기록 · 중단 뒤 남은 셀부터 · staleness 순서 · 80셀 band를 끝까지 돈다', async () => {
  const h = harness({ killAfter: 20 });
  await assert.rejects(recheck.runSaleRecheckSweep({ mode: 'apply', lawdCds: GG(), now: NOW }, quiet, { clock: h.clock, syncCell: h.saleCell, recordCoverage: h.recordCoverage, loadCells: h.loadCells }));
  assert.equal(h.store.size, 20, '중단 전 처리한 20셀이 남아야 한다');
  assert.ok(h.recordCalls.every((n) => n === 1), '셀 하나씩 기록해야 한다');
  const firstRun = new Set(h.processed);
  // 다음 실행(중단 없음): 처리하지 않은 60셀이 먼저 온다
  const run2: string[] = [];
  const s = await recheck.runSaleRecheckSweep({ mode: 'apply', lawdCds: GG(), now: NOW }, quiet, {
    clock: h.clock, recordCoverage: h.recordCoverage, loadCells: h.loadCells,
    syncCell: async (l, y) => { run2.push(`${l}:${y}`); h.advance(800); return { lawdCd: l, dealYmd: y, status: 'COMPLETE', sourceTotalCount: 1, fetched: 1, blocked: 0, inserted: 0, updated: 0, unchanged: 1, reviewCandidates: 0, registryUpdated: 0, registryAmbiguousSkipped: 0 }; },
  });
  assert.ok(run2.slice(0, 60).every((c) => !firstRun.has(c)), '이미 처리한 셀이 미처리 셀보다 먼저 왔다');
  assert.equal(s.stopReason, 'BUDGET_EXHAUSTED');
  assert.equal(s.status, 'SUCCESS', '예산 정지는 이 sweep에서 정상이다(기존 의미 그대로)');
  assert.equal(s.sweepComplete, false);
  // 0.8s/셀 모델: 예전 셀 경계 규칙(elapsed + 2.5s < 45s)이면 54셀, 새 규칙(첫 시도 여유 포함)이면 51셀.
  assert.equal(s.cellsProcessed, 51);
  assert.equal(h.store.size, 71);
});

test('17b · recheck: 시작한 셀이 시간 한도에 잘리면 PARTIAL_RUN, 그 셀은 미기록으로 대기열 앞에 남는다', async () => {
  const h = harness({ deadlineAt: '41111:202605' }); // band 최신 달의 첫 구 — 미검증이라 맨 앞
  const s = await recheck.runSaleRecheckSweep({ mode: 'apply', lawdCds: GG(), now: NOW }, quiet, { clock: h.clock, syncCell: h.saleCell, recordCoverage: h.recordCoverage, loadCells: h.loadCells });
  assert.equal(s.stopReason, 'DEADLINE_REACHED');
  assert.equal(s.deadlineReached, true);
  assert.equal(s.status, 'PARTIAL_RUN');
  assert.equal(s.failed, 0);
  assert.ok(!h.store.has('SALE:41111:202605'));
  const next = shared.orderRecheckCellsByStaleness(await h.loadCells('202508', '202605', GG()));
  assert.equal(`${next[0].lawdCd}:${next[0].dealYmd}`, '41111:202605');
});

test('17c · recheck: INVALID 셀은 기록하지 않아 verifiedAt이 밀리지 않는다', async () => {
  const h = harness({ statusOf: (l, y) => (l === '41113' && y === '202605' ? 'INVALID' : 'COMPLETE') });
  const s = await recheck.runSaleRecheckSweep({ mode: 'apply', lawdCds: GG(), now: NOW, maxCells: 8 }, quiet, { clock: h.clock, syncCell: h.saleCell, recordCoverage: h.recordCoverage, loadCells: h.loadCells });
  assert.equal(s.cellsProcessed, 8);
  assert.equal(s.failed, 1);
  assert.equal(s.coverageRecorded, 7);
  assert.ok(!h.store.has('SALE:41113:202605'));
});

test('17d · recheck는 여전히 syncOneSaleCell 하나로 쓴다(취소 판정 동일)', () => {
  const c = code('src/lib/sync/sale-recheck-core.ts');
  assert.ok(/const syncCell = deps\.syncCell \?\? syncOneSaleCell;/.test(c));
  assert.ok(!/reconcileGroupCancellation|planSaleCellWrites|createMany|\.update\(/.test(c), 'recheck에 별도 쓰기 판정이 생겼다');
});

// ---------------------------------------------------------------------------
// 18 — rent 회귀
// ---------------------------------------------------------------------------

test('18 · rent: 셀마다 즉시 기록 · 중단 뒤 커밋된 셀 유지 · review 후보/INVALID 셀은 미기록', async () => {
  const [a, b, c] = BUSAN_16;
  const h = harness({ killAfter: 5, reviewAt: `${a}:202608`, statusOf: (l, y) => (l === b && y === '202607' ? 'INVALID' : 'COMPLETE') });
  await assert.rejects(rent.runRentSync({ mode: 'apply', now: NOW }, quiet, { clock: h.clock, syncCell: h.rentCell, recordCoverage: h.recordCoverage }));
  // 부산 16구 × 2개월(202607–202608), scope 순서(rent 순서는 바꾸지 않았다)
  assert.deepEqual(h.processed, [`${a}:202607`, `${a}:202608`, `${b}:202607`, `${b}:202608`, `${c}:202607`]);
  assert.deepEqual([...h.store.keys()].sort(), [`RENT:${a}:202607`, `RENT:${b}:202608`, `RENT:${c}:202607`].sort());
  assert.ok(h.recordCalls.every((n) => n === 1));
});

test('18b · rent: 시간 한도 정지 → PARTIAL_RUN(DEADLINE_REACHED), 앞 셀 기록 유지, NEEDS_REVIEW 우선순위 그대로', async () => {
  const [a, b] = BUSAN_16;
  const h = harness({ deadlineAt: `${b}:202607` });
  const s = await rent.runRentSync({ mode: 'apply', now: NOW }, quiet, { clock: h.clock, syncCell: h.rentCell, recordCoverage: h.recordCoverage });
  assert.equal(s.stopReason, 'DEADLINE_REACHED');
  assert.equal(s.status, 'PARTIAL_RUN');
  assert.equal(s.failed, 0);
  assert.deepEqual([...h.store.keys()].sort(), [`RENT:${a}:202607`, `RENT:${a}:202608`]);
  // 다음 실행은 예전처럼 처음부터 다시 돌고(멱등), 끝까지 간다
  h.resetCalls();
  const again = await rent.runRentSync({ mode: 'apply', now: NOW }, quiet, { clock: h.clock, syncCell: h.rentCell, recordCoverage: h.recordCoverage });
  assert.equal(again.stopReason, 'DEADLINE_REACHED', '대역이 같은 셀에서 다시 멈춘다(정상)');
  const noStop = harness();
  const full = await rent.runRentSync({ mode: 'apply', now: NOW }, quiet, { clock: noStop.clock, syncCell: noStop.rentCell, recordCoverage: noStop.recordCoverage });
  assert.equal(full.status, 'SUCCESS');
  assert.equal(full.coverageRecorded, 32);
  assert.equal(full.stopReason, null);
});

test('18c · rent fetcher: 재시도할 시간이 없으면 deadlineReached(INVALID 판정이 아님), 시간이 있으면 예전처럼 재시도', async () => {
  const { fetchRentRegionMonth } = await import('../../../scripts/rent-trade-history/rent-molit-fetch');
  const ERR = '<response><header><resultCode>99</resultCode></header></response>';
  const EMPTY = '<response><header><resultCode>00</resultCode></header><body><items></items><totalCount>0</totalCount></body></response>';
  let calls = 0;
  let remaining = 0;
  globalThis.fetch = (async () => {
    calls++;
    remaining -= 1_000; // 시도 하나가 1s 걸렸다
    return new Response(calls === 1 ? ERR : EMPTY); // 첫 시도만 실패
  }) as typeof fetch;
  try {
    // 남은 4.5s: 첫 시도 허용(4.5 − 2 ≥ 2) → 실패 뒤 3.5s < backoff 0.5 + 2 + 2 → 재시도 없음
    remaining = 4_500;
    const r = await fetchRentRegionMonth('26110', '202608', { deadline: { remainingMs: () => remaining } });
    assert.equal(calls, 1);
    assert.equal(r.deadlineReached, true);
    // 남은 시간 0 → 요청 자체를 보내지 않는다
    remaining = 0;
    calls = 0;
    const none = await fetchRentRegionMonth('26110', '202608', { deadline: { remainingMs: () => remaining } });
    assert.equal(calls, 0, '시간이 없는데 요청했다');
    assert.equal(none.deadlineReached, true);
    // 시간이 넉넉하면 예전처럼 재시도해 성공한다
    remaining = 40_000;
    calls = 0;
    const ok = await fetchRentRegionMonth('26110', '202608', { deadline: { remainingMs: () => remaining } });
    assert.equal(calls, 2);
    assert.equal(ok.status, 'EMPTY_VALID');
    assert.equal(ok.deadlineReached, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('18d · rent 비즈니스 규칙 불변: COMPLETE만 쓰고, review 후보 셀은 기록하지 않고, 범위는 완료월만', () => {
  const c = code('src/lib/sync/rent-sync-core.ts');
  assert.ok(/if \(!shouldPersistCellRows\(fetchResult\.status\) \|\| rows\.length === 0\)/.test(c));
  assert.ok(/if \(report\.reviewCandidates === 0 && isVerifiedCellStatus\(report\.status\)\)/.test(c));
  assert.ok(/const lawdCds = opts\.lawdCds \?\? BUSAN_LAWDCD_16;/.test(c));
  assert.ok(!/saleQuotaDecision|orderSaleDistrictsByStaleness/.test(c), 'rent에 요청하지 않은 정책이 들어왔다');
});

// ---------------------------------------------------------------------------
// 19–24 — scope · 공개 · 스케줄 불변
// ---------------------------------------------------------------------------

test('19–22 · scope: 부산 16 · 서울 승인 8 · 경기 정확히 8 · 41135 없음', () => {
  assert.equal(BUSAN_16.length, 16);
  assert.deepEqual(scope.resolveSaleSyncScope(null), { ok: true, scope: 'busan', lawdCds: undefined });
  assert.deepEqual([...scope.SEOUL_SALE_SYNC_LAWDCDS], ['11110', '11140', '11170', '11440', '11410', '11230', '11215', '11545']);
  assert.deepEqual(GG(), ['41111', '41113', '41115', '41117', '41131', '41133', '41150', '41210']);
  for (const list of [BUSAN_16, scope.SEOUL_SALE_SYNC_LAWDCDS, scope.GYEONGGI_SALE_SYNC_LAWDCDS]) assert.ok(!(list as readonly string[]).includes('41135'));
  // 코어가 구를 더하지 않는다 — 정렬은 받은 목록의 순열이다
  const months = ['202606', '202607', '202608'];
  assert.deepEqual(shared.orderSaleDistrictsByStaleness(GG(), months, [], isVerified).sort(), GG().sort());
});

test('23 · 공개 enablement 불변(서울 beta on · 경기 beta off), 동기화 코드는 enablement를 읽지 않는다', () => {
  const en = code('src/lib/region/enablement.ts');
  assert.ok(/export const SEOUL_BETA_ENABLED = true;/.test(en));
  assert.ok(/export const GYEONGGI_BETA_ENABLED = false;/.test(en));
  for (const p of ['src/lib/sync/sale-sync-core.ts', 'src/lib/sync/sale-recheck-core.ts', 'src/lib/sync/rent-sync-core.ts', 'src/lib/sync/shared.ts', 'src/lib/sync/run-deadline.ts']) {
    assert.ok(!/enablement/.test(code(p)), p);
  }
});

test('24 · cron 스케줄 불변(11개 · 경로·시각 정확히)', () => {
  const crons = JSON.parse(read('vercel.json')).crons;
  assert.deepEqual(crons, [
    { path: '/api/cron/sale-sync?mode=apply', schedule: '0 19 * * *' },
    { path: '/api/cron/rent-sync?mode=apply', schedule: '0 21 * * *' },
    { path: '/api/cron/sale-recheck?mode=apply', schedule: '0 23 * * *' },
    { path: '/api/cron/sale-sync?mode=apply&scope=seoul', schedule: '15 19 * * *' },
    { path: '/api/cron/sale-recheck?mode=apply&scope=seoul', schedule: '15 23 * * *' },
    { path: '/api/cron/sale-sync?mode=apply&scope=gyeonggi', schedule: '30 19 * * *' },
    { path: '/api/cron/sale-recheck?mode=apply&scope=gyeonggi', schedule: '30 23 * * *' },
    // SEOUL_17_CRON_EXPANSION_V1 — 서울 나머지 17구(seoul-b 9 · seoul-c 8), 경기 뒤 15분 간격
    { path: '/api/cron/sale-sync?mode=apply&scope=seoul-b', schedule: '45 19 * * *' },
    { path: '/api/cron/sale-sync?mode=apply&scope=seoul-c', schedule: '0 20 * * *' },
    { path: '/api/cron/sale-recheck?mode=apply&scope=seoul-b', schedule: '45 23 * * *' },
    { path: '/api/cron/sale-recheck?mode=apply&scope=seoul-c', schedule: '0 0 * * *' },
  ]);
});

// ---------------------------------------------------------------------------
// 14 — 셀당 coverage 쓰기 수(성능 비용): 예전과 같은 수, 시점만 셀 커밋 직후로 옮겼다
// ---------------------------------------------------------------------------

test('14p · 실행당 coverage 쓰기 수 = 검증된 완료월 셀 수(예전 실행 끝 일괄 기록과 같은 수)', async () => {
  const cases: Array<[string, () => Promise<{ coverageRecorded: number }>, number]> = [];
  for (const [name, list] of [['busan', [...BUSAN_16]], ['seoul', [...scope.SEOUL_SALE_SYNC_LAWDCDS]], ['gyeonggi', GG()]] as const) {
    const h = harness({ costMs: 100 });
    cases.push([`sale ${name}`, () => sale.runSaleSync({ mode: 'apply', lawdCds: [...list], now: NOW }, quiet, { clock: h.clock, syncCell: h.saleCell, recordCoverage: h.recordCoverage, loadCoverage: h.loadCoverage }), list.length * 3]);
  }
  const hr = harness({ costMs: 100 });
  cases.push(['recheck gyeonggi (band 80)', () => recheck.runSaleRecheckSweep({ mode: 'apply', lawdCds: GG(), now: NOW }, quiet, { clock: hr.clock, syncCell: hr.saleCell, recordCoverage: hr.recordCoverage, loadCells: hr.loadCells }), 80]);
  const hn = harness({ costMs: 100 });
  cases.push(['rent busan', () => rent.runRentSync({ mode: 'apply', now: NOW }, quiet, { clock: hn.clock, syncCell: hn.rentCell, recordCoverage: hn.recordCoverage }), 32]);
  for (const [name, run, expected] of cases) {
    const s = await run();
    assert.equal(s.coverageRecorded, expected, name);
    console.log(`[perf] ${name}: coverage writes/run = ${s.coverageRecorded}`);
  }
});
