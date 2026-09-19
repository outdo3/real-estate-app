import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// CANCELLATION_INSERT_PATH_FIX_V1 — 실제 syncOneSaleCell()을 끝까지 돌리는 통합 테스트.
// MOLIT은 fetch 대역(XML), DB는 lib/prisma.ts가 쓰는 globalThis.prisma 싱글턴 자리에 넣은 메모리 대역이다.
// 운영 흐름 그대로: 1차 sync는 취소 1줄만 보고, 이후 원천이 재신고 정상 1줄을 더 줄 때 무엇이 들어가는가.

type Row = {
  id: number; lawdCd: string; dealYmd: string; groupKeyStr: string; dealAmount: number; dealDate: Date; floor: number | null;
  occurrenceIndex: number; dealCanceled: boolean; cancelDate: string | null; aptName: string; dong: string; registryDate: string | null;
};

const store: Row[] = [];
const writes = { createMany: 0, update: 0 };
let nextId = 1;

const fakePrisma = {
  apartmentTradeHistory: {
    findMany: async ({ where }: { where: { lawdCd: string; dealYmd: string } }) =>
      store.filter((r) => r.lawdCd === where.lawdCd && r.dealYmd === where.dealYmd).map((r) => ({ ...r })),
    createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
      writes.createMany++;
      let count = 0;
      for (const d of data) {
        const key = (x: { groupKeyStr: unknown; dealAmount: unknown; dealDate: unknown; floor: unknown; occurrenceIndex: unknown }) =>
          `${x.groupKeyStr}|${x.dealAmount}|${(x.dealDate as Date).toISOString()}|${x.floor}|${x.occurrenceIndex}`;
        if (store.some((r) => key(r) === key(d as never))) continue; // skipDuplicates
        store.push({
          id: nextId++, lawdCd: d.lawdCd as string, dealYmd: d.dealYmd as string, groupKeyStr: d.groupKeyStr as string,
          dealAmount: d.dealAmount as number, dealDate: d.dealDate as Date, floor: d.floor as number, occurrenceIndex: d.occurrenceIndex as number,
          dealCanceled: d.dealCanceled as boolean, cancelDate: (d.cancelDate as string) || null, aptName: d.aptName as string, dong: d.dong as string,
          registryDate: (d.registryDate as string) || null,
        });
        count++;
      }
      return { count };
    },
    update: async ({ where, data }: { where: { id: number }; data: Partial<Row> }) => {
      writes.update++;
      const r = store.find((x) => x.id === where.id)!;
      Object.assign(r, data);
      return r;
    },
  },
  $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
};

type Item = { state: 'A' | 'C'; cancelDate?: string; aptSeq?: string; name?: string; amount?: string; day?: number; floor?: number };
type Scenario = { items: Item[]; totalCount?: number; failPage?: number };
let scenario: Scenario = { items: [] };
const fetchCalls: string[] = [];

function itemXml(it: Item): string {
  return `<item><aptNm>${it.name ?? '롯데4'}</aptNm><aptSeq>${it.aptSeq ?? '26350-124'}</aptSeq><dealAmount>${it.amount ?? '32,000'}</dealAmount>` +
    `<dealYear>2026</dealYear><dealMonth>8</dealMonth><dealDay>${it.day ?? 23}</dealDay><excluUseAr>59.6</excluUseAr><floor>${it.floor ?? 3}</floor>` +
    `<umdNm>우동</umdNm><jibun>1</jibun><buildYear>1990</buildYear><cdealType>${it.state === 'C' ? 'O' : ''}</cdealType>` +
    `<cdealDay>${it.state === 'C' ? (it.cancelDate ?? '26.09.17') : ''}</cdealDay><rgstDate></rgstDate></item>`;
}

function responseXml(s: Scenario, pageNo: number): string {
  if (s.failPage === pageNo) return '<response><header><resultCode>99</resultCode><resultMsg>ERR</resultMsg></header></response>';
  const items = pageNo === 1 ? s.items : [];
  return `<response><header><resultCode>00</resultCode><resultMsg>OK</resultMsg></header><body><items>${items.map(itemXml).join('')}</items>` +
    `<numOfRows>1000</numOfRows><pageNo>${pageNo}</pageNo><totalCount>${s.totalCount ?? s.items.length}</totalCount></body></response>`;
}

const originalFetch = globalThis.fetch;
const g = globalThis as unknown as { prisma?: unknown };
const originalPrisma = g.prisma;
const originalKey = process.env.DATA_GO_KR_API_KEY;
const originalRestore = process.env.SALE_CANCEL_RESTORE_ENABLED;
let syncOneSaleCell: typeof import('./sale-sync-core').syncOneSaleCell;

before(async () => {
  process.env.DATA_GO_KR_API_KEY = 'test-key';
  delete process.env.SALE_CANCEL_RESTORE_ENABLED;
  g.prisma = fakePrisma;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    const pageNo = Number(new URL(url).searchParams.get('pageNo'));
    return new Response(responseXml(scenario, pageNo), { status: 200 });
  }) as typeof fetch;
  ({ syncOneSaleCell } = await import('./sale-sync-core'));
});

after(() => {
  globalThis.fetch = originalFetch;
  g.prisma = originalPrisma;
  if (originalKey === undefined) delete process.env.DATA_GO_KR_API_KEY; else process.env.DATA_GO_KR_API_KEY = originalKey;
  if (originalRestore !== undefined) process.env.SALE_CANCEL_RESTORE_ENABLED = originalRestore;
});

beforeEach(() => {
  store.length = 0;
  writes.createMany = 0;
  writes.update = 0;
  fetchCalls.length = 0;
});

async function sync(items: Item[], mode: 'apply' | 'dry-run' = 'apply', extra: Partial<Scenario> = {}) {
  scenario = { items, ...extra };
  const lines: string[] = [];
  const report = await syncOneSaleCell('26350', '202608', mode, (l) => lines.push(l));
  return { report, lines };
}

const counts = () => ({ total: store.length, canceled: store.filter((r) => r.dealCanceled).length });

test('E1 · 신규 7건 흐름 — 1차 취소 1줄, 이후 원천 [정상, 취소] → DB 1/2 취소(수정 전: 2/2)', async () => {
  await sync([{ state: 'C' }]);
  assert.deepEqual(counts(), { total: 1, canceled: 1 });
  const { report } = await sync([{ state: 'A' }, { state: 'C' }]);
  assert.deepEqual(counts(), { total: 2, canceled: 1 }, '원천 1/2 취소 — DB도 1/2여야 한다');
  assert.equal(report.status, 'COMPLETE');
  assert.equal(report.inserted, 1);
  assert.equal(report.insertCanceled, 0, '새로 넣은 행은 정상이어야 한다');
  assert.equal(report.insertReconcileSkipped, 0);
  assert.equal(new Set(store.map((r) => r.occurrenceIndex)).size, 2, '자연키 자리가 겹치지 않는다');
});

test('E2 · 원천 순서가 반대여도 결과가 같다 · 반복 sync는 멱등', async () => {
  await sync([{ state: 'C' }]);
  await sync([{ state: 'C' }, { state: 'A' }]);
  assert.deepEqual(counts(), { total: 2, canceled: 1 });
  const before = JSON.stringify(store);
  for (const order of [[{ state: 'A' }, { state: 'C' }], [{ state: 'C' }, { state: 'A' }]] as Item[][]) {
    const { report } = await sync(order);
    assert.equal(report.inserted, 0);
    assert.equal(report.updated, 0);
    assert.equal(report.cancelRestorePending ?? 0, 0);
  }
  assert.equal(JSON.stringify(store), before, '반복 실행이 아무것도 바꾸지 않아야 한다');
});

test('E3 · 1차 정상 1줄, 이후 원천 [취소, 정상] → 취소 1건 insert (진짜 취소 보존)', async () => {
  await sync([{ state: 'A' }]);
  const { report } = await sync([{ state: 'C', cancelDate: '26.09.18' }, { state: 'A' }]);
  assert.deepEqual(counts(), { total: 2, canceled: 1 }, '원천의 진짜 취소가 DB에 있어야 한다');
  assert.equal(report.inserted, 1);
  assert.equal(report.insertCanceled, 1);
  assert.equal(store.find((r) => r.dealCanceled)?.cancelDate, '26.09.18');
});

test('E4 · 신규 그룹(DB 0)은 원천 행 그대로 — 기존 동작', async () => {
  const { report } = await sync([{ state: 'A' }, { state: 'C' }, { state: 'A', floor: 7 }]);
  assert.equal(report.inserted, 3);
  assert.equal(report.insertCanceled, 1);
  assert.deepEqual(counts(), { total: 3, canceled: 1 });
});

test('E5 · 원천이 DB보다 적은 그룹(결함 B) — 삭제·insert·취소 변경 없음', async () => {
  await sync([{ state: 'A' }, { state: 'C' }]);
  const before = JSON.stringify(store);
  const { report } = await sync([{ state: 'A' }]);
  assert.equal(report.inserted, 0);
  assert.equal(report.updated, 0);
  assert.equal(report.cancelReconcileSkipped, 1, '형제 수 불일치로 대조를 건너뛴다');
  assert.equal(JSON.stringify(store), before);
});

test('E6 · 부족분이 넣을 수보다 많으면 보류(추측 없음) — 기존 정상 행을 취소로 바꾸지 않는다', async () => {
  await sync([{ state: 'A' }]);
  const { report, lines } = await sync([{ state: 'C' }, { state: 'C' }]);
  assert.equal(report.inserted, 0);
  assert.equal(report.updated, 0);
  assert.equal(report.insertReconcileSkipped, 1);
  assert.ok(lines.some((l) => l.includes('INSERT_RECONCILE_SKIPPED') && l.includes('CANCELED_DEFICIT_EXCEEDS_MISSING')));
  assert.deepEqual(counts(), { total: 1, canceled: 0 });
});

test('E7 · dry-run은 쓰지 않고, 예상 insert·취소 insert 수를 부족분대로 보고한다', async () => {
  await sync([{ state: 'C' }]);
  writes.createMany = 0;
  writes.update = 0;
  const { report } = await sync([{ state: 'A' }, { state: 'C' }, { state: 'C' }], 'dry-run');
  assert.equal(report.inserted, 2);
  assert.equal(report.insertCanceled, 1, '원천 취소 2 − DB 취소 1 = 1');
  assert.deepEqual(writes, { createMany: 0, update: 0 });
  assert.deepEqual(counts(), { total: 1, canceled: 1 });
});

test('E8 · 복구 게이트는 여전히 꺼짐 — 형제 수가 같은 과다 취소는 pending으로만 남는다', async () => {
  // 수정 전 버그가 이미 만든 상태(원천 1/2 ↔ DB 2/2)를 재현한 뒤 sync.
  await sync([{ state: 'C' }, { state: 'C' }]);
  const { report } = await sync([{ state: 'A' }, { state: 'C' }]);
  assert.equal(report.cancelRestorePending, 1);
  assert.equal(report.cancelRestored ?? 0, 0);
  assert.deepEqual(counts(), { total: 2, canceled: 2 }, '이번 STEP은 repair하지 않는다');
});

test('E9 · 페이지 누락(PARTIAL) 셀은 아무것도 쓰지 않는다', async () => {
  await sync([{ state: 'C' }]);
  writes.createMany = 0;
  const before = JSON.stringify(store);
  const { report } = await sync([{ state: 'A' }, { state: 'C' }], 'apply', { totalCount: 1500, failPage: 2 });
  assert.equal(report.status, 'PARTIAL');
  assert.deepEqual(writes, { createMany: 0, update: 0 });
  assert.equal(JSON.stringify(store), before);
});

test('E10 · 첫 페이지 실패(INVALID) 셀은 아무것도 쓰지 않는다', async () => {
  await sync([{ state: 'C' }]);
  writes.createMany = 0;
  const before = JSON.stringify(store);
  const { report } = await sync([{ state: 'A' }, { state: 'C' }], 'apply', { failPage: 1 });
  assert.equal(report.status, 'INVALID');
  assert.deepEqual(writes, { createMany: 0, update: 0 });
  assert.equal(JSON.stringify(store), before);
});
