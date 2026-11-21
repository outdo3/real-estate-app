// Run with Node's --experimental-test-module-mocks and the project's TypeScript loader.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { FeedTrade } from '@/lib/regional-feed';

const sale = { id: 'sale', name: '표본', dong: '광안동', dealDate: '2026-07-01', dealAmount: 70000 };
const jeonse = { ...sale, id: 'jeonse', dealAmount: 30000, monthlyRent: 0 };
const wolse = { ...sale, id: 'wolse', dealAmount: 5000, monthlyRent: 30 };
const districtCalls: string[] = [];
const dbCalls: string[] = [];

mock.module(require.resolve('@/lib/api-molit'), {
  namedExports: {
    formatKoreanPrice: String,
    fetchMolitData: async ({ type, lawdCd, dealYmd }: { type: string; lawdCd: string; dealYmd: string }) => {
      districtCalls.push(`${lawdCd}:${type}:${dealYmd}`);
      if (type === 'apt') return dealYmd === '202607' ? [sale] : [];
      if (dealYmd === '202608' || (dealYmd === '202609' && lawdCd === '26350')) {
        return [{ typeLabel: '에러' }];
      }
      if (dealYmd === '202609' && lawdCd === '26500') {
        return [{ ...wolse, id: 'live-wolse', dealDate: '2026-09-01' }];
      }
      if ((lawdCd === '26500' && dealYmd === '202606') ||
          (lawdCd === '26350' && dealYmd === '202607') ||
          (lawdCd === '26230' && dealYmd === '202506')) return [{ typeLabel: '에러' }];
      if (lawdCd === '26500' && dealYmd === '202607') return [jeonse, wolse];
      return [];
    },
  },
});
mock.module(require.resolve('@/lib/prisma'), { namedExports: { prisma: {} } });
mock.module(require.resolve('@/lib/statistics-pyeong-resolver'), {
  namedExports: { resolveApartmentContextBatch: async () => new Map() },
});
mock.module(require.resolve('@/lib/rent-history-read'), {
  namedExports: {
    getRentVerifiedRange: async () => ({}),
    splitVerifiedMonths: (months: string[]) => ({
      verified: months.filter((month) => month === '202607'),
      unverified: months.filter((month) => month !== '202607'),
    }),
  },
});
mock.module(require.resolve('@/lib/stats/feed-db-source'), {
  namedExports: {
    isFeedDbBackedSido: (code: string) => code === '26',
    loadBusanFeedTradesFromDb: async (districts: string[], months: string[], rentMonths: string[]) => {
      dbCalls.push(...districts, ...months, ...rentMonths);
      const asTrade = (record: typeof sale, dealType: FeedTrade['dealType']): FeedTrade => ({
        ...record, uid: record.id, aptSeq: null, lawdCd: '26500', dealType, excluUseArea: 84.9, floorRaw: 10,
        dealCanceled: false, ...(dealType === 'wolse' ? { monthlyRent: 30 } : {}),
      });
      const sales = months.filter((month) => month === '202607' || month === '202608').map((month) =>
        asTrade({ ...sale, id: `db-sale-${month}`, dealDate: `${month.slice(0, 4)}-${month.slice(4)}-01` }, 'sale'));
      const rents = rentMonths.includes('202607') ? [asTrade(jeonse, 'jeonse'), asTrade(wolse, 'wolse')] : [];
      return { trades: [...sales, ...rents] };
    },
  },
});
const { GET } = require('./route') as typeof import('./route');

async function feed(dealType: string, lawdCd: string | null, from = '2026-07-01', to = '2026-07-31') {
  const params = new URLSearchParams({
    ...(lawdCd ? { lawdCd } : { sidoCode: '26' }),
    from, to, period: 'custom', dealType,
  });
  const response = await GET(new Request(`http://localhost/api/stats/feed?${params}`));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'OK');
  return body;
}

test('district success preserves sale, jeonse, and monthly rent and shares the cache across filters', async () => {
  const sales = await feed('sale', '26500');
  const calls = districtCalls.length;
  const leases = await feed('jeonse', '26500');
  const monthly = await feed('wolse', '26500');
  assert.ok(calls > 0);
  assert.equal(districtCalls.length, calls);
  assert.equal(sales.groups[0].trades[0].dealAmount, 70000);
  assert.equal(leases.groups[0].trades[0].dealAmount, 30000);
  assert.equal(leases.groups[0].trades[0].monthlyRent, undefined);
  assert.equal(monthly.groups[0].trades[0].dealAmount, 5000);
  assert.equal(monthly.groups[0].trades[0].monthlyRent, 30);
  for (const body of [sales, leases, monthly]) {
    assert.equal(body.apiError, false);
    assert.equal(body.partial, false);
  }
});

test('full lease outage sets apiError on both lease filters while sales stay visible', async () => {
  for (const dealType of ['jeonse', 'wolse']) {
    const body = await feed(dealType, '26350');
    assert.equal(body.apiError, true);
    assert.equal(body.partial, false);
    assert.deepEqual(body.groups, []);
  }
  const sales = await feed('sale', '26350');
  assert.equal(sales.apiError, false);
  assert.equal(sales.partial, false);
  assert.equal(sales.pagination.total, 1);
  const combined = await feed('', '26350');
  assert.equal(combined.apiError, false);
  assert.equal(combined.partial, true);
  assert.equal(combined.pagination.total, 1);
});

test('one failed lease month sets partial and keeps the other month’s transaction', async () => {
  for (const dealType of ['jeonse', 'wolse']) {
    const body = await feed(dealType, '26500', '2026-06-01');
    assert.equal(body.apiError, false);
    assert.equal(body.partial, true);
    assert.deepEqual(body.failedDistricts, ['26500']);
    assert.equal(body.pagination.total, 1);
  }
  const noRows = await feed('wolse', '26500', '2026-05-01', '2026-06-30');
  assert.equal(noRows.pagination.total, 0);
  assert.equal(noRows.partial, true);
  assert.equal(noRows.apiError, false);
});

test('a successful empty month stays a true zero even when the lookback failed', async () => {
  const body = await feed('wolse', '26230');
  assert.equal(body.pagination.total, 0);
  assert.equal(body.apiError, false);
  assert.equal(body.partial, false);
});

test('verified Busan-wide months continue to use DB sales and leases without MOLIT', async () => {
  const before = districtCalls.length;
  for (const dealType of ['sale', 'jeonse', 'wolse']) {
    const body = await feed(dealType, null);
    assert.equal(body.region.sidoAll, true);
    assert.equal(body.apiError, false);
    assert.equal(body.partial, false);
    assert.equal(body.pagination.total, 1);
    assert.equal(body.groups[0].trades[0].dealType, dealType);
  }
  assert.ok(dbCalls.includes('26500'));
  assert.equal(dbCalls.filter((entry) => entry === '202607').length, 2);
  assert.equal(districtCalls.length, before);
});

test('Busan-wide successful empty rent does not set failure flags', async () => {
  const body = await feed('wolse', null, '2026-10-01', '2026-10-31');
  assert.equal(body.summary.totalCount, 0);
  assert.equal(body.partial, false);
  assert.equal(body.apiError, false);
});

test('Busan-wide lease outage is incomplete for both lease filters and retains DB sales', async () => {
  for (const dealType of ['jeonse', 'wolse']) {
    const body = await feed(dealType, null, '2026-08-01', '2026-08-31');
    assert.equal(body.summary.totalCount, 0);
    assert.equal(body.partial, true);
    assert.equal(body.apiError, false);
    assert.equal(body.failedDistricts.length, 16);
  }
  const sales = await feed('sale', null, '2026-08-01', '2026-08-31');
  assert.equal(sales.summary.totalCount, 1);
  assert.equal(sales.groups[0].trades[0].dealType, 'sale');
  assert.equal(sales.apiError, false);
});

test('Busan-wide partial district failure retains the available monthly rent', async () => {
  const body = await feed('wolse', null, '2026-09-01', '2026-09-30');
  assert.equal(body.partial, true);
  assert.equal(body.apiError, false);
  assert.deepEqual(body.failedDistricts, ['26350']);
  assert.equal(body.summary.totalCount, 1);
  assert.equal(body.groups[0].trades[0].dealAmount, 5000);
  assert.equal(body.groups[0].trades[0].monthlyRent, 30);
});

test('Busan-wide mixed DB and unavailable MOLIT months retain verified leases', async () => {
  for (const dealType of ['jeonse', 'wolse']) {
    const body = await feed(dealType, null, '2026-07-01', '2026-08-31');
    assert.equal(body.partial, true);
    assert.equal(body.apiError, false);
    assert.equal(body.summary.totalCount, 1);
    assert.equal(body.groups[0].trades[0].dealDate, '2026-07-01');
    assert.equal(body.groups[0].trades[0].dealType, dealType);
  }
});

test('Suyeong distinguishes complete empty leases from a lease outage', async () => {
  for (const dealType of ['jeonse', 'wolse']) {
    const empty = await feed(dealType, '26500', '2026-10-01', '2026-10-31');
    const incomplete = await feed(dealType, '26500', '2026-08-01', '2026-08-31');
    assert.equal(empty.summary.totalCount, 0);
    assert.equal(empty.partial, false);
    assert.equal(empty.apiError, false);
    assert.equal(incomplete.summary.totalCount, 0);
    assert.equal(incomplete.apiError, true);
  }
});
