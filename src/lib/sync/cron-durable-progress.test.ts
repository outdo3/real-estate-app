import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// CRON_DURABLE_PROGRESS_V1 — 실제 runSaleSync → syncOneSaleCell → fetchSaleRegionMonth → recordCoverageCells를 끝까지 돌린다.
// MOLIT은 fetch 대역(XML), DB는 lib/prisma.ts가 쓰는 globalThis.prisma 자리에 넣은 메모리 대역이다(쓰기 0 · 네트워크 0).
// 시간은 주입한 결정적 시계(deps.clock)로 흐르고, fetch 대역이 "요청이 걸린 시간"만큼 시계를 앞으로 민다.

type TradeRow = {
  id: number; lawdCd: string; dealYmd: string; groupKeyStr: string; dealAmount: number; dealDate: Date; floor: number | null;
  occurrenceIndex: number; dealCanceled: boolean; cancelDate: string | null; aptName: string; dong: string; registryDate: string | null;
};
type CovRow = { dataset: string; lawdCd: string; dealYmd: string; status: string; runId: string; verifiedAt: Date };

const trades: TradeRow[] = [];
const coverage = new Map<string, CovRow>();
/** DB 쓰기와 coverage 기록의 실제 순서. `write:<lawd>:<ymd>` · `coverage:<dataset>:<lawd>:<ymd>` */
const events: string[] = [];
let nextId = 1;
let failWriteFor: string | null = null; // `${lawd}:${ymd}` — 그 셀의 createMany가 throw(트랜잭션 실패)
let failCoverageFor: string | null = null; // 그 셀의 coverage upsert가 throw

const covKey = (d: string, l: string, y: string) => `${d}:${l}:${y}`;
const naturalKey = (x: { groupKeyStr: unknown; dealAmount: unknown; dealDate: unknown; floor: unknown; occurrenceIndex: unknown }) =>
  `${x.groupKeyStr}|${x.dealAmount}|${(x.dealDate as Date).toISOString()}|${x.floor}|${x.occurrenceIndex}`;

function matchIn(v: string, cond: unknown): boolean {
  if (cond == null) return true;
  if (typeof cond === 'string') return v === cond;
  const c = cond as { in?: string[]; gte?: string; lte?: string };
  if (c.in && !c.in.includes(v)) return false;
  if (c.gte && v < c.gte) return false;
  if (c.lte && v > c.lte) return false;
  return true;
}

const fakePrisma = {
  apartmentTradeHistory: {
    findMany: async ({ where }: { where: { lawdCd: string; dealYmd: string } }) =>
      trades.filter((r) => r.lawdCd === where.lawdCd && r.dealYmd === where.dealYmd).map((r) => ({ ...r })),
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      const cell = `${data[0].lawdCd}:${data[0].dealYmd}`;
      if (failWriteFor === cell) throw new Error(`simulated transaction failure ${cell}`);
      let count = 0;
      for (const d of data) {
        if (trades.some((r) => naturalKey(r) === naturalKey(d as never))) continue; // skipDuplicates
        trades.push({
          id: nextId++, lawdCd: d.lawdCd as string, dealYmd: d.dealYmd as string, groupKeyStr: d.groupKeyStr as string,
          dealAmount: d.dealAmount as number, dealDate: d.dealDate as Date, floor: d.floor as number, occurrenceIndex: d.occurrenceIndex as number,
          dealCanceled: d.dealCanceled as boolean, cancelDate: (d.cancelDate as string) || null, aptName: d.aptName as string, dong: d.dong as string,
          registryDate: (d.registryDate as string) || null,
        });
        count++;
      }
      events.push(`write:${cell}`);
      return { count };
    },
    update: async ({ where, data }: { where: { id: number }; data: Partial<TradeRow> }) => {
      const r = trades.find((x) => x.id === where.id)!;
      Object.assign(r, data);
      events.push(`write:${r.lawdCd}:${r.dealYmd}`);
      return r;
    },
  },
  syncCoverageCell: {
    upsert: async ({ where, create }: { where: { sync_coverage_cell_key: { dataset: string; lawdCd: string; dealYmd: string } }; create: CovRow }) => {
      const k = where.sync_coverage_cell_key;
      if (failCoverageFor === `${k.lawdCd}:${k.dealYmd}`) throw new Error('simulated coverage upsert failure');
      coverage.set(covKey(k.dataset, k.lawdCd, k.dealYmd), { ...create });
      events.push(`coverage:${k.dataset}:${k.lawdCd}:${k.dealYmd}`);
      return create;
    },
    findMany: async ({ where }: { where: { dataset: string; lawdCd?: unknown; dealYmd?: unknown } }) =>
      [...coverage.values()].filter((c) => c.dataset === where.dataset && matchIn(c.lawdCd, where.lawdCd) && matchIn(c.dealYmd, where.dealYmd)),
  },
  $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
};

// ---- MOLIT 대역 ----
type Page = { xml?: string; costMs?: number; remaining?: number; throws?: boolean };
type ItemSpec = { canceled?: boolean; rgst?: string };
let clockNow = 0;
const clock = () => clockNow;
let pageFor: (lawd: string, ymd: string, page: number, attempt: number) => Page = (l, y) => ({ xml: cellXml(l, y, [{}, {}]) });
const fetchLog: string[] = [];

function itemXml(lawd: string, ymd: string, i: number, it: ItemSpec): string {
  return `<item><aptNm>테스트${lawd}</aptNm><aptSeq>${lawd}-1</aptSeq><sggCd>${lawd}</sggCd><dealAmount>${(30000 + i * 100).toLocaleString('en-US')}</dealAmount>` +
    `<dealYear>${ymd.slice(0, 4)}</dealYear><dealMonth>${Number(ymd.slice(4, 6))}</dealMonth><dealDay>${10 + i}</dealDay><excluUseAr>59.6</excluUseAr>` +
    `<floor>${3 + i}</floor><umdNm>우동</umdNm><jibun>1</jibun><buildYear>1990</buildYear><cdealType>${it.canceled ? 'O' : ''}</cdealType>` +
    `<cdealDay>${it.canceled ? '26.09.17' : ''}</cdealDay><rgstDate>${it.rgst ?? ''}</rgstDate></item>`;
}
function cellXml(lawd: string, ymd: string, items: ItemSpec[], totalCount = items.length): string {
  return `<response><header><resultCode>00</resultCode><resultMsg>OK</resultMsg></header><body><items>${items.map((it, i) => itemXml(lawd, ymd, i, it)).join('')}</items>` +
    `<numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${totalCount}</totalCount></body></response>`;
}
const ERROR_XML = '<response><header><resultCode>99</resultCode><resultMsg>ERR</resultMsg></header></response>';
const RATE_LIMITED_XML = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED 초당 서비스 요청제한</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>';

const attempts = new Map<string, number>();
const originalFetch = globalThis.fetch;
const g = globalThis as unknown as { prisma?: unknown };
const originalPrisma = g.prisma;
const originalKey = process.env.DATA_GO_KR_API_KEY;
const originalRestore = process.env.SALE_CANCEL_RESTORE_ENABLED;

type Core = typeof import('./sale-sync-core');
type Fetch = typeof import('../../../scripts/sale-molit-fetch');
let core: Core;
let saleFetch: Fetch;

before(async () => {
  process.env.DATA_GO_KR_API_KEY = 'test-key';
  delete process.env.SALE_CANCEL_RESTORE_ENABLED;
  g.prisma = fakePrisma;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    const lawd = u.searchParams.get('LAWD_CD')!;
    const ymd = u.searchParams.get('DEAL_YMD')!;
    const page = Number(u.searchParams.get('pageNo'));
    const k = `${lawd}:${ymd}:${page}`;
    const attempt = (attempts.get(k) ?? 0) + 1;
    attempts.set(k, attempt);
    fetchLog.push(k);
    const p = pageFor(lawd, ymd, page, attempt);
    clockNow += p.costMs ?? 500;
    if (p.throws) throw new Error('simulated network timeout');
    const headers: Record<string, string> = {};
    if (p.remaining != null) headers['x-ratelimit-remaining'] = String(p.remaining);
    return new Response(p.xml ?? ERROR_XML, { status: 200, headers });
  }) as typeof fetch;
  core = await import('./sale-sync-core');
  saleFetch = await import('../../../scripts/sale-molit-fetch');
});

after(() => {
  globalThis.fetch = originalFetch;
  g.prisma = originalPrisma;
  if (originalKey === undefined) delete process.env.DATA_GO_KR_API_KEY; else process.env.DATA_GO_KR_API_KEY = originalKey;
  if (originalRestore !== undefined) process.env.SALE_CANCEL_RESTORE_ENABLED = originalRestore;
});

beforeEach(() => {
  trades.length = 0;
  coverage.clear();
  events.length = 0;
  fetchLog.length = 0;
  attempts.clear();
  nextId = 1;
  failWriteFor = null;
  failCoverageFor = null;
  clockNow = 0;
  lines.length = 0;
  pageFor = (l, y) => ({ xml: cellXml(l, y, [{}, {}]) });
  saleFetch.saleQuotaObserved.remaining = null;
  saleFetch.saleQuotaObserved.at = null;
});

// 2026-09-27 기준 latestComplete = 202608. 명시 범위 202607–202608(둘 다 완료월) × 3구 = 6셀.
const NOW = new Date('2026-09-27T04:30:00+09:00');
const DISTRICTS = ['41111', '41113', '41115'];
const baseOpts = { mode: 'apply' as const, lawdCds: DISTRICTS, from: '202607', to: '202608', now: NOW };
const lines: string[] = [];
const log = (l: string) => lines.push(l);
const covered = (dataset = 'SALE') => [...coverage.values()].filter((c) => c.dataset === dataset).map((c) => `${c.lawdCd}:${c.dealYmd}`).sort();

function injectKillAfter(n: number) {
  let calls = 0;
  return {
    syncCell: async (...args: Parameters<Core['syncOneSaleCell']>) => {
      if (calls === n) throw new Error(`simulated process kill before cell ${n + 1}`);
      calls++;
      return core.syncOneSaleCell(...args);
    },
  };
}

// ---------------------------------------------------------------------------
// 1·2 — 커밋 직후 기록, 커밋 전 기록 없음
// ---------------------------------------------------------------------------

test('1 · 셀 커밋 직후 그 셀의 coverage가 영속화된다(실행 끝까지 기다리지 않는다)', async () => {
  const seen: string[][] = [];
  await core.runSaleSync(baseOpts, log, {
    clock,
    syncCell: async (...args) => {
      seen.push(covered()); // 다음 셀을 시작하는 시점에 이미 영속화된 셀
      return core.syncOneSaleCell(...args);
    },
  });
  assert.deepEqual(seen[0], []);
  assert.deepEqual(seen[1], ['41111:202607'], '두 번째 셀을 시작할 때 첫 셀이 이미 기록돼 있어야 한다');
  assert.equal(seen[5].length, 5);
  assert.equal(covered().length, 6);
});

test('2 · coverage는 그 셀의 모든 DB 쓰기 뒤에만 나온다 · 쓰기가 실패한 셀은 기록되지 않는다', async () => {
  // 등기일 보충(update)과 취소 flip(update)까지 생기게: 먼저 적재한 뒤 원천을 바꿔 다시 돈다.
  await core.runSaleSync(baseOpts, log, { clock });
  events.length = 0;
  coverage.clear();
  pageFor = (l, y) => ({ xml: cellXml(l, y, [{ rgst: '26.09.20' }, { canceled: true }]) });
  await core.runSaleSync(baseOpts, log, { clock });
  for (const cell of ['41111:202607', '41113:202608']) {
    const lastWrite = events.lastIndexOf(`write:${cell}`);
    const cov = events.indexOf(`coverage:SALE:${cell}`);
    assert.ok(lastWrite >= 0, `${cell}: 쓰기가 있어야 하는 시나리오`);
    assert.ok(cov > lastWrite, `${cell}: coverage가 DB 쓰기보다 먼저다`);
  }

  // 트랜잭션 실패 → 예외 전파, 그 셀과 이후 셀 coverage 없음, 앞 셀은 남는다
  trades.length = 0;
  coverage.clear();
  failWriteFor = '41111:202608';
  await assert.rejects(core.runSaleSync(baseOpts, log, { clock }), /simulated transaction failure/);
  assert.deepEqual(covered(), ['41111:202607']);
});

// ---------------------------------------------------------------------------
// 3·4·5 — 비정상 종료 후에도 커밋된 진행은 남는다
// ---------------------------------------------------------------------------

test('3 · 셀 1 뒤 강제 종료 → 셀 1 coverage가 남는다', async () => {
  await assert.rejects(core.runSaleSync(baseOpts, log, { clock, ...injectKillAfter(1) }), /simulated process kill/);
  assert.deepEqual(covered(), ['41111:202607']);
});

test('4 · 구 1 / 구 3 완료 뒤 강제 종료 → 완료된 셀이 전부 남는다', async () => {
  await assert.rejects(core.runSaleSync(baseOpts, log, { clock, ...injectKillAfter(2) }), /simulated process kill/);
  assert.deepEqual(covered(), ['41111:202607', '41111:202608']);
  coverage.clear();
  trades.length = 0;
  // 4구 scope에서 3구 완료 뒤 종료
  const four = { ...baseOpts, lawdCds: [...DISTRICTS, '41117'] };
  await assert.rejects(core.runSaleSync(four, log, { clock, ...injectKillAfter(6) }), /simulated process kill/);
  assert.deepEqual(covered(), ['41111:202607', '41111:202608', '41113:202607', '41113:202608', '41115:202607', '41115:202608']);
});

test('5 · 끝까지 못 읽은 셀(INVALID·PARTIAL)은 기록하지 않는다 — 이전 검증 기록도 덮지 않는다', async () => {
  await core.runSaleSync(baseOpts, log, { clock });
  const before = { ...coverage.get(covKey('SALE', '41113', '202607'))! };
  const beforePartial = { ...coverage.get(covKey('SALE', '41115', '202608'))! };
  await new Promise((r) => setTimeout(r, 5)); // verifiedAt(실시간)이 달라지도록
  // 41113:202607 — 6회 전부 실패(INVALID) · 41115:202608 — totalCount 3인데 2건(PARTIAL)
  pageFor = (l, y) => {
    if (l === '41113' && y === '202607') return { xml: ERROR_XML, costMs: 100 };
    if (l === '41115' && y === '202608') return { xml: cellXml(l, y, [{}, {}], 3) };
    return { xml: cellXml(l, y, [{}, {}]) };
  };
  const s = await core.runSaleSync(baseOpts, log, { clock });
  assert.equal(s.failed, 2);
  assert.equal(s.status, 'PARTIAL');
  assert.deepEqual(coverage.get(covKey('SALE', '41113', '202607')), before, 'INVALID가 이전 COMPLETE 기록을 덮었다');
  assert.deepEqual(coverage.get(covKey('SALE', '41115', '202608')), beforePartial, 'PARTIAL이 이전 기록(상태·verifiedAt)을 덮었다');
  assert.notDeepEqual(coverage.get(covKey('SALE', '41111', '202607')), undefined);
  assert.ok(coverage.get(covKey('SALE', '41111', '202607'))!.verifiedAt.getTime() > beforePartial.verifiedAt.getTime(), '검증된 셀은 새로 기록돼야 한다');
  assert.equal(s.coverageRecorded, 4);
});

test('5b · 진행 중인 현재월은 동기화하되 기록하지 않는다(§15 그대로)', async () => {
  const s = await core.runSaleSync({ mode: 'apply', lawdCds: ['41111'], now: NOW }, log, { clock });
  assert.equal(s.cellsProcessed, 4, '202606–202609 4개월');
  assert.deepEqual(covered(), ['41111:202606', '41111:202607', '41111:202608']);
  assert.ok(trades.some((r) => r.dealYmd === '202609'), '현재월 행은 적재된다');
});

test('5c · dry-run은 coverage를 하나도 쓰지 않는다', async () => {
  const s = await core.runSaleSync({ ...baseOpts, mode: 'dry-run' }, log, { clock });
  assert.equal(s.coverageRecorded, 0);
  assert.equal(coverage.size, 0);
  assert.equal(trades.length, 0);
});

test('5d · coverage 영속화 실패 → COVERAGE_PERSIST_FAILED로 멈춘다(다음 셀을 진행하지 않음, 커밋된 행은 그대로)', async () => {
  failCoverageFor = '41111:202608';
  const s = await core.runSaleSync(baseOpts, log, { clock });
  assert.equal(s.stopReason, 'COVERAGE_PERSIST_FAILED');
  assert.equal(s.status, 'FAILED');
  assert.equal(s.cellsProcessed, 2);
  assert.deepEqual(covered(), ['41111:202607']);
  assert.equal(trades.filter((r) => r.dealYmd === '202608' && r.lawdCd === '41111').length, 2, '커밋된 원천 행을 되돌리지 않는다');
  assert.ok(!fetchLog.some((k) => k.startsWith('41113')), '영속화 실패 뒤에 다음 셀을 요청했다');
});

// ---------------------------------------------------------------------------
// 8·9·10 — 재실행 멱등
// ---------------------------------------------------------------------------

test('8·9·10 · 재실행: insert 0 · 중복 0 · 등기일 재보충 0 · 취소 flip 0 · 복원 0', async () => {
  pageFor = (l, y) => ({ xml: cellXml(l, y, [{ rgst: '26.09.20' }, { canceled: true }, {}]) });
  const first = await core.runSaleSync(baseOpts, log, { clock });
  assert.equal(first.inserted, 18);
  const snapshot = JSON.stringify(trades);
  const again = await core.runSaleSync(baseOpts, log, { clock });
  assert.equal(again.inserted, 0);
  assert.equal(again.updated, 0, '취소 flip');
  assert.equal(again.registryUpdated, 0);
  assert.equal(again.cancelRestored ?? 0, 0);
  assert.equal(again.cancelRestorePending, 0);
  assert.equal(JSON.stringify(trades), snapshot, '재실행이 행을 바꿨다');
  assert.equal(new Set(trades.map(naturalKey)).size, trades.length, '자연키 중복');
  assert.equal(trades.filter((r) => r.dealCanceled).length, 6, '원천 취소 수(셀당 1)와 같아야 한다');
});

test('8b · 부분 실행 뒤 재실행 = 한 번에 끝까지 돈 결과와 같다(등기일 보충 NULL→값 1회뿐)', async () => {
  // 등기일 없는 행이 이미 있다가 원천에 등기일이 생기는 흐름
  await core.runSaleSync(baseOpts, log, { clock });
  pageFor = (l, y) => ({ xml: cellXml(l, y, [{ rgst: '26.09.20' }, {}]) });
  await assert.rejects(core.runSaleSync(baseOpts, log, { clock, ...injectKillAfter(3) }));
  assert.equal(trades.filter((r) => r.registryDate).length, 3, '3셀 × 1행 보충');
  const resumed = await core.runSaleSync(baseOpts, log, { clock });
  assert.equal(resumed.registryUpdated, 3, '남은 3셀만 보충한다(이미 채운 행을 다시 쓰지 않는다)');
  assert.equal(resumed.inserted, 0);
  assert.equal(trades.filter((r) => r.registryDate).length, 6);
  assert.equal(trades.length, 12);
  const final = await core.runSaleSync(baseOpts, log, { clock });
  assert.equal(final.registryUpdated, 0);
});

test('10b · 과다 취소 치유는 여전히 SALE_CANCEL_RESTORE_ENABLED 없이는 쓰지 않는다', async () => {
  pageFor = (l, y) => ({ xml: cellXml(l, y, [{ canceled: true }]) });
  await core.runSaleSync(baseOpts, log, { clock });
  pageFor = (l, y) => ({ xml: cellXml(l, y, [{}]) }); // 원천이 취소를 거둬들임
  const s = await core.runSaleSync(baseOpts, log, { clock });
  assert.equal(s.cancelRestored, 0);
  assert.equal(s.cancelRestorePending, 6);
  assert.equal(trades.filter((r) => r.dealCanceled).length, 6, 'true→false를 썼다');
});

// ---------------------------------------------------------------------------
// 11·12 — 쿼터 예약분
// ---------------------------------------------------------------------------

test('11·12 · 셀 도중 예약분 도달 → 앞 셀 coverage는 남고 멈춘 셀은 쓰지도 기록하지도 않는다', async () => {
  let n = 0;
  pageFor = (l, y, page) => {
    // 셋째 셀 1쪽 응답이 2,000을 알린다(2쪽은 보내지 않아야 한다)
    if (l === '41113' && y === '202607' && page === 1) return { xml: cellXml(l, y, [{}, {}], 1001), remaining: 2000 };
    return { xml: cellXml(l, y, [{}, {}]), remaining: 2010 - n++ };
  };
  const s = await core.runSaleSync(baseOpts, log, { clock });
  assert.equal(s.stopReason, 'QUOTA_RESERVE_REACHED');
  assert.equal(s.quotaReserveReached, true);
  assert.equal(s.deadlineReached, false);
  assert.equal(s.status, 'PARTIAL_RUN');
  assert.deepEqual(covered(), ['41111:202607', '41111:202608']);
  assert.ok(!trades.some((r) => r.lawdCd === '41113'), '예약분에서 멈춘 셀을 썼다');
  assert.ok(!fetchLog.includes('41113:202607:2'), '예약분인데 2쪽을 요청했다');
});

test('11b · 경계: 2,001이면 요청하고 2,000이면 다음 셀을 시작하지 않는다', async () => {
  pageFor = (l, y) => ({ xml: cellXml(l, y, [{}]), remaining: l === '41111' && y === '202607' ? 2001 : 2000 });
  saleFetch.saleQuotaObserved.remaining = 2002;
  saleFetch.saleQuotaObserved.at = Date.now();
  const s = await core.runSaleSync(baseOpts, log, { clock });
  // 2002 → 셀1 요청(응답 2001) → 셀2 요청(응답 2000) → 셀3 시작 안 함
  assert.equal(fetchLog.length, 2);
  assert.equal(s.stopReason, 'QUOTA_RESERVE_REACHED');
  assert.deepEqual(covered(), ['41111:202607', '41111:202608']);
});

// ---------------------------------------------------------------------------
// 13·14·15 — 실행 시간 한도(deadline)
// ---------------------------------------------------------------------------

test('13·14 · 첫 시도가 오래 걸려 재시도할 시간이 없으면 DEADLINE_REACHED — 앞 셀 기록은 남고 그 셀은 미기록(INVALID로 세지 않음)', async () => {
  pageFor = (l, y) => {
    if (l === '41113' && y === '202607') return { xml: ERROR_XML, costMs: 44_000 }; // 걸린 뒤 실패
    return { xml: cellXml(l, y, [{}, {}]), costMs: 1_000 };
  };
  const s = await core.runSaleSync(baseOpts, log, { clock });
  assert.equal(s.stopReason, 'DEADLINE_REACHED');
  assert.equal(s.deadlineReached, true);
  assert.equal(s.quotaReserveReached, false);
  assert.equal(s.status, 'PARTIAL_RUN');
  assert.equal(s.failed, 0, 'DEADLINE 셀을 INVALID로 셌다');
  assert.equal(s.cellsProcessed, 2);
  assert.deepEqual(covered(), ['41111:202607', '41111:202608']);
  assert.equal(attempts.get('41113:202607:1'), 1, '남은 시간이 없는데 재시도했다');
  assert.ok(!trades.some((r) => r.lawdCd === '41113'));
  assert.ok(lines.some((l) => l.startsWith('DEADLINE_REACHED 41113:202607')));
  assert.ok(!lines.some((l) => l.startsWith('INVALID 41113:202607')), 'DEADLINE을 INVALID로 로그했다');
});

test('15 · 재시도는 정책과 남은 시간이 둘 다 허락할 때만 — 시간이 있으면 재시도해 COMPLETE', async () => {
  pageFor = (l, y, _p, attempt) => (attempt === 1 ? { xml: ERROR_XML, costMs: 1_000 } : { xml: cellXml(l, y, [{}]) });
  const s = await core.runSaleSync({ ...baseOpts, lawdCds: ['41111'], to: '202607' }, log, { clock });
  assert.equal(s.status, 'SUCCESS');
  assert.equal(attempts.get('41111:202607:1'), 2);
  assert.deepEqual(covered(), ['41111:202607']);
});

test('15b · backoff가 한도를 넘기지 않는다: 비율제한 backoff(2s) 뒤 시도할 시간이 없으면 잠들지도 않는다', async () => {
  // 셀 시작 시 남은 5.4s — 첫 시도는 허용(5.4 − 0 − 2 ≥ 2), 응답 뒤 남은 5.0s < 2s backoff + 2s + 2s
  clockNow = 0;
  pageFor = () => ({ xml: RATE_LIMITED_XML, costMs: 400 });
  const started = Date.now();
  const s = await core.runSaleSync({ ...baseOpts, lawdCds: ['41111'], to: '202607', budgetMs: 5_400 }, log, { clock });
  const wall = Date.now() - started;
  assert.equal(s.stopReason, 'DEADLINE_REACHED');
  assert.equal(attempts.get('41111:202607:1'), 1);
  assert.ok(wall < 1_900, `backoff로 잠들었다(${wall}ms)`);
});

test('15c · 여러 쪽 셀: 2쪽을 보낼 시간이 없으면 PARTIAL이 아니라 DEADLINE_REACHED(쓰지 않음)', async () => {
  pageFor = (l, y, page) =>
    page === 1 ? { xml: cellXml(l, y, [{}, {}], 1500), costMs: 47_000 } : { xml: cellXml(l, y, [{}]) };
  const s = await core.runSaleSync({ ...baseOpts, lawdCds: ['41111'], to: '202607' }, log, { clock });
  assert.equal(s.stopReason, 'DEADLINE_REACHED');
  assert.equal(s.failed, 0);
  assert.ok(!fetchLog.includes('41111:202607:2'));
  assert.equal(trades.length, 0);
  assert.equal(coverage.size, 0);
});

test('15d · deadline 없이 부른 fetch(CLI backfill 경로)는 예전과 같다 — 10s 시도 · 최대 6회', async () => {
  pageFor = () => ({ xml: ERROR_XML, costMs: 0 });
  const r = await saleFetch.fetchSaleRegionMonth('41111', '202607');
  assert.equal(r.status, 'INVALID');
  assert.equal(r.deadlineReached, false);
  assert.equal(attempts.get('41111:202607:1'), 6);
});
