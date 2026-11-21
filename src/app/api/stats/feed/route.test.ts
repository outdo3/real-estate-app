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
    splitVerifiedMonths: (months: string[]) => ({ verified: months, unverified: [] }),
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
      return { trades: [asTrade(sale, 'sale'), asTrade(jeonse, 'jeonse'), asTrade(wolse, 'wolse')] };
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
