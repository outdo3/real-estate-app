// PRODUCTION QA P0-B — regression coverage that PriceTrendChart's summary
// ("최근 전세") and InvestmentMetrics ("전세가") can never disagree about which
// trade is the most recent pure-jeonse one for the same selectedTradeArea,
// given the same underlying trades. The real production contradiction was a
// period/window mismatch (period=6 vs up to period=60), not a logic mismatch —
// this test locks down that the two components' *logic* has always agreed
// (same monthlyRent===0 pure-jeonse definition, same exact-area match), so a
// future regression can only be a window/fetch-scope bug, not a filter-logic one.
import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTradesForArea, latestTrade } from './price-trend-data.ts';
import { computeInvestmentMetrics } from './investment-metrics.ts';

const AREA = '84.7855m²';
const OTHER_AREA = '59.88m²';

// A trade older than any fixed short window (e.g. 6 months) would previously
// have been invisible to InvestmentMetrics while still visible to
// PriceTrendChart's wider window — this is same-shape real data as the
// 대신롯데캐슬 84.7855㎡ reproduction (see docs).
const rentTrades = [
  { price: 2.31, priceStr: '보 2억 3,100만', area: AREA, tradeDate: '2026-01-20', monthlyRent: 0 },
  { price: 0.3, priceStr: '보 3,000만 / 월세 150만', area: AREA, tradeDate: '2026-07-10', monthlyRent: 150 },
  { price: 1.8, priceStr: '보 1억 8,000만', area: OTHER_AREA, tradeDate: '2026-08-01', monthlyRent: 0 },
];
const saleTrades = [
  { price: 3.87, priceStr: '3억 8,700만', area: AREA, tradeDate: '2026-08-21', monthlyRent: 0 },
];

test('PriceTrendChart-style (filterTradesForArea + latestTrade) and InvestmentMetrics-style (computeInvestmentMetrics) agree on the same latest pure-jeonse trade', () => {
  // PriceTrendChart pre-filters rent to pure-jeonse at fetch time, then narrows by area.
  const chartPureJeonse = rentTrades.filter((t) => (t.monthlyRent ?? 0) === 0);
  const chartAreaRent = filterTradesForArea(chartPureJeonse, AREA);
  const chartLatestRent = latestTrade(chartAreaRent ?? []);

  const metricsResult = computeInvestmentMetrics(saleTrades, rentTrades, AREA);

  assert.equal(chartLatestRent?.tradeDate, '2026-01-20');
  assert.equal(metricsResult.matchedRent?.tradeDate, '2026-01-20');
  assert.equal(chartLatestRent?.priceStr, metricsResult.matchedRent?.priceStr);
});

test('both agree a monthlyRent-mixed trade is excluded from pure-jeonse, not treated as the "recent rent"', () => {
  const chartPureJeonse = rentTrades.filter((t) => (t.monthlyRent ?? 0) === 0);
  const chartAreaRent = filterTradesForArea(chartPureJeonse, AREA);
  assert.ok(!chartAreaRent?.some((t) => t.tradeDate === '2026-07-10'));

  const metricsResult = computeInvestmentMetrics(saleTrades, rentTrades, AREA);
  assert.notEqual(metricsResult.matchedRent?.tradeDate, '2026-07-10');
});

test('both agree a different-area rent trade never substitutes for the selected area', () => {
  const chartPureJeonse = rentTrades.filter((t) => (t.monthlyRent ?? 0) === 0);
  const chartAreaRent = filterTradesForArea(chartPureJeonse, AREA);
  assert.ok(!chartAreaRent?.some((t) => t.area === OTHER_AREA));

  const metricsResult = computeInvestmentMetrics(saleTrades, rentTrades, AREA);
  assert.notEqual(metricsResult.matchedRent?.area, OTHER_AREA);
});
