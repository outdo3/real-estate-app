import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDifference, buildDifferences, buildTradeoffSummary } from './difference';
import type { CompareMetric } from './types';

function metric(overrides: Partial<CompareMetric>): CompareMetric {
  return {
    key: 'x', label: 'X', value: 0, displayValue: '0', unit: null, period: null, area: null,
    trust: 'SAFE', direction: 'context-only', ...overrides,
  };
}

test('buildDifference: 한쪽이라도 MISSING이면 comparable=false, 자동 승패 없음', () => {
  const a = metric({ key: 'parkingPerHousehold', value: 1.2, trust: 'LIMITED', direction: 'higher-better' });
  const b = metric({ key: 'parkingPerHousehold', value: null, trust: 'MISSING', direction: 'higher-better' });
  const d = buildDifference(a, b);
  assert.equal(d.comparable, false);
  assert.equal(d.favors, null);
  assert.equal(d.differenceValue, null);
});

test('buildDifference: higher-better에서 값이 큰 쪽이 favors', () => {
  const a = metric({ key: 'parkingPerHousehold', value: 1.2, direction: 'higher-better' });
  const b = metric({ key: 'parkingPerHousehold', value: 0.8, direction: 'higher-better' });
  const d = buildDifference(a, b);
  assert.equal(d.comparable, true);
  assert.equal(d.favors, 'a');
});

test('buildDifference: lower-better에서 값이 작은 쪽이 favors', () => {
  const a = metric({ key: 'subwayDistance', value: 800, direction: 'lower-better' });
  const b = metric({ key: 'subwayDistance', value: 300, direction: 'lower-better' });
  const d = buildDifference(a, b);
  assert.equal(d.favors, 'b');
});

test('buildDifference: context-only는 차이가 커도 favors를 절대 정하지 않는다(가격 승패 없음)', () => {
  const a = metric({ key: 'salePrice', value: 9.0, direction: 'context-only' });
  const b = metric({ key: 'salePrice', value: 5.0, direction: 'context-only' });
  const d = buildDifference(a, b);
  assert.equal(d.favors, null);
  assert.notEqual(d.differenceDisplay, null);
});

test('buildDifference: 의미 있는 차이 기준 미만이면 favors가 없다(비슷한 항목)', () => {
  const a = metric({ key: 'buildYear', value: 2021, direction: 'context-only' });
  const b = metric({ key: 'buildYear', value: 2020, direction: 'context-only' });
  const d = buildDifference(a, b);
  assert.equal(d.favors, null);
});

test('buildDifference: 가격 area가 3㎡ 넘게 다르면 comparable=false, "면적이 달라" 사유', () => {
  const a = metric({ key: 'salePrice', value: 6.5, area: { exclusiveAreaM2: 84.94, label: '84.94㎡' } });
  const b = metric({ key: 'salePrice', value: 4.5, area: { exclusiveAreaM2: 59.98, label: '59.98㎡' } });
  const d = buildDifference(a, b);
  assert.equal(d.comparable, false);
  assert.match(d.reason || '', /면적이 달라/);
});

test('buildDifference: 가격 기준일이 90일 넘게 차이나면 caution이 붙지만 값은 숨기지 않는다', () => {
  const a = metric({ key: 'salePrice', value: 6.5, period: { from: '2026-08-01', to: '2026-08-01' } });
  const b = metric({ key: 'salePrice', value: 6.0, period: { from: '2026-01-01', to: '2026-01-01' } });
  const d = buildDifference(a, b);
  assert.equal(d.comparable, true);
  assert.notEqual(d.a.displayValue, null);
  assert.match(d.caution || '', /기준 거래일 차이/);
});

test('buildDifference: 양쪽 모두 "확인된 없음"(예: 지하철 반경 내 없음)이면 comparable=true, 비슷한 항목으로 분류된다', () => {
  const a = metric({ key: 'subwayDistance', value: null, trust: 'SAFE', direction: 'lower-better', displayValue: '반경 내 없음(확인됨)' });
  const b = metric({ key: 'subwayDistance', value: null, trust: 'SAFE', direction: 'lower-better', displayValue: '반경 내 없음(확인됨)' });
  const d = buildDifference(a, b);
  assert.equal(d.comparable, true);
  assert.equal(d.favors, null);
});

test('buildDifference: 한쪽만 "확인된 없음"이고 다른 쪽은 실제 값이 있으면 비교 불가(임의 거리값 만들지 않음)', () => {
  const a = metric({ key: 'subwayDistance', value: null, trust: 'SAFE', direction: 'lower-better' });
  const b = metric({ key: 'subwayDistance', value: 400, trust: 'SAFE', direction: 'lower-better' });
  const d = buildDifference(a, b);
  assert.equal(d.comparable, false);
  assert.match(d.reason || '', /확인된 데이터가 없어/);
});

test('buildTradeoffSummary: comparable=false 항목은 확인 필요로만 분류되고 강점에는 절대 안 들어간다', () => {
  const a = [
    metric({ key: 'parkingPerHousehold', value: null, trust: 'MISSING', direction: 'higher-better' }),
    metric({ key: 'subwayDistance', value: 300, direction: 'lower-better' }),
  ];
  const b = [
    metric({ key: 'parkingPerHousehold', value: 1.0, direction: 'higher-better' }),
    metric({ key: 'subwayDistance', value: 900, direction: 'lower-better' }),
  ];
  const diffs = buildDifferences(a, b);
  const tradeoff = buildTradeoffSummary(diffs);
  assert.equal(tradeoff.needsReview.some((d) => d.metricKey === 'parkingPerHousehold'), true);
  assert.equal(tradeoff.aStrengths.some((d) => d.metricKey === 'parkingPerHousehold'), false);
  assert.equal(tradeoff.bStrengths.some((d) => d.metricKey === 'parkingPerHousehold'), false);
  assert.equal(tradeoff.aStrengths.some((d) => d.metricKey === 'subwayDistance'), true);
});
