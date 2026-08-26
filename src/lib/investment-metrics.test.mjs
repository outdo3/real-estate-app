import assert from 'node:assert/strict';
import test from 'node:test';
import { computeInvestmentMetrics } from './investment-metrics.ts';

const saleA = { price: 5, priceStr: '5억', area: '84.79', tradeDate: '2026-08-01' };
const saleAOlder = { price: 4.5, priceStr: '4억 5,000만', area: '84.79', tradeDate: '2026-01-01' };
const rentA = { price: 3, priceStr: '3억', area: '84.79', tradeDate: '2026-07-01', monthlyRent: 0 };
const rentB = { price: 2, priceStr: '2억', area: '129.72', tradeDate: '2026-07-01', monthlyRent: 0 };
const rentAMixed = { price: 1, priceStr: '1,000만/50만', area: '84.79', tradeDate: '2026-08-10', monthlyRent: 50 };

test('same raw area sale+rent yields matched latest sale/rent, ratio, and gap', () => {
  const result = computeInvestmentMetrics([saleA, saleAOlder], [rentA], '84.79');
  assert.equal(result.latestSale, saleA);
  assert.equal(result.matchedRent, rentA);
  assert.equal(result.gap, 2);
  assert.equal(Math.round((result.jeonseRate ?? 0) * 10) / 10, 60);
});

test('different raw area sale vs rent leaves ratio/gap unavailable (no cross-unit fallback)', () => {
  const result = computeInvestmentMetrics([saleA], [rentB], '84.79');
  assert.equal(result.latestSale, saleA);
  assert.equal(result.matchedRent, null);
  assert.equal(result.jeonseRate, null);
  assert.equal(result.gap, null);
});

test('sale-only area leaves rent/ratio/gap unavailable', () => {
  const result = computeInvestmentMetrics([saleA], [], '84.79');
  assert.equal(result.latestSale, saleA);
  assert.equal(result.matchedRent, null);
  assert.equal(result.jeonseRate, null);
  assert.equal(result.gap, null);
});

test('rent-only area leaves sale/ratio/gap unavailable', () => {
  const result = computeInvestmentMetrics([], [rentA], '84.79');
  assert.equal(result.latestSale, null);
  assert.equal(result.matchedRent, null);
  assert.equal(result.jeonseRate, null);
  assert.equal(result.gap, null);
});

test('excludes mixed 전세/반전세 (monthlyRent > 0) from the matched rent', () => {
  const result = computeInvestmentMetrics([saleA], [rentAMixed], '84.79');
  assert.equal(result.matchedRent, null);
  assert.equal(result.jeonseRate, null);
});

test('no area selected (전체 or undefined) returns all-unavailable, not a silent cross-area guess', () => {
  assert.deepEqual(computeInvestmentMetrics([saleA], [rentA], '전체'), { latestSale: null, matchedRent: null, jeonseRate: null, gap: null });
  assert.deepEqual(computeInvestmentMetrics([saleA], [rentA], undefined), { latestSale: null, matchedRent: null, jeonseRate: null, gap: null });
});
