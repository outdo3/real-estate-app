import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPriceTrendPoints, filterTradesForArea, latestTrade } from './price-trend-data.ts';

const sale = [
  { price: 5, priceStr: '5억', area: '84.7855', tradeDate: '2026-07-02' },
  { price: 5.2, priceStr: '5억 2,000만', area: '84.7855', tradeDate: '2026-07-02' },
  { price: 6, priceStr: '6억', area: '59.9', tradeDate: '2026-08-01' },
];
const rent = [{ price: 3, priceStr: '3억', area: '84.7855', tradeDate: '2026-07-02', monthlyRent: 0 }];

test('filters by the exact canonical area string without rounded matching', () => {
  assert.deepEqual(filterTradesForArea(sale, '84.7855'), sale.slice(0, 2));
  assert.deepEqual(filterTradesForArea(sale, '84.79'), []);
});

test('preserves each raw price trade while counting same-day volume once', () => {
  const points = buildPriceTrendPoints(sale, rent);
  assert.equal(points.length, 4);
  assert.equal(points.filter((point) => point.salePrice !== null).length, 3);
  assert.deepEqual(points[0].dailySaleCount, 2);
  assert.deepEqual(points[0].dailyRentCount, 1);
  assert.equal(points.filter((point) => point.saleVolume !== null).length, 2);
});

test('keeps no-trade data empty and finds the latest raw trade', () => {
  assert.deepEqual(buildPriceTrendPoints([], []), []);
  assert.equal(latestTrade(sale)?.priceStr, '6억');
});
