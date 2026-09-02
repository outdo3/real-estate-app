import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPriceMetric, buildFactMetrics, buildLocationMetrics } from './metrics';

test('selectPriceMetric: 84㎡ band 거래가 있으면 그 중 최신 거래를 쓴다', () => {
  const trades = [
    { tradeDate: '2026-01-10', price: 5.5, priceStr: '5억 5,000만', area: '59.98' },
    { tradeDate: '2026-06-20', price: 6.5, priceStr: '6억 5,000만', area: '84.94' },
    { tradeDate: '2026-03-01', price: 6.2, priceStr: '6억 2,000만', area: '84.94' },
  ];
  const m = selectPriceMetric(trades);
  assert.equal(m.value, 6.5);
  assert.equal(m.trust, 'SAFE');
  assert.equal(m.area?.exclusiveAreaM2, 84.94);
});

test('selectPriceMetric: 84㎡ band 거래가 없으면 가장 최근 거래를 쓰고 LIMITED로 표시한다', () => {
  const trades = [{ tradeDate: '2026-05-01', price: 4.1, priceStr: '4억 1,000만', area: '59.98' }];
  const m = selectPriceMetric(trades);
  assert.equal(m.value, 4.1);
  assert.equal(m.trust, 'LIMITED');
  assert.match(m.area?.label || '', /84㎡ 기준 거래 없음/);
});

test('selectPriceMetric: dealCanceled 거래는 제외한다', () => {
  const trades = [
    { tradeDate: '2026-08-01', price: 9.9, priceStr: '9억 9,000만', area: '84.94', dealCanceled: true },
    { tradeDate: '2026-01-01', price: 6.0, priceStr: '6억', area: '84.94', dealCanceled: false },
  ];
  const m = selectPriceMetric(trades);
  assert.equal(m.value, 6.0);
});

test('selectPriceMetric: 거래가 전혀 없으면 MISSING이고 0이 아니다', () => {
  const m = selectPriceMetric([]);
  assert.equal(m.value, null);
  assert.equal(m.trust, 'MISSING');
  assert.equal(m.displayValue, '최근 거래 없음');
});

test('buildFactMetrics: parkingRawStatus가 MISSING이면 주차를 MISSING으로 표시(0이 아님)', () => {
  const metrics = buildFactMetrics({ buildYear: 2020, totalHouseholds: 700, parkingRawStatus: 'MISSING', parkingRatio: null });
  const parking = metrics.find((m) => m.key === 'parkingPerHousehold')!;
  assert.equal(parking.value, null);
  assert.equal(parking.trust, 'MISSING');
  assert.equal(parking.displayValue, '정보 없음');
});

test('buildFactMetrics: parkingRawStatus가 KNOWN이면 실제 비율을 쓴다', () => {
  const metrics = buildFactMetrics({ buildYear: 2020, totalHouseholds: 700, parkingRawStatus: 'KNOWN', parkingRatio: 1.15 });
  const parking = metrics.find((m) => m.key === 'parkingPerHousehold')!;
  assert.equal(parking.value, 1.15);
  assert.equal(parking.direction, 'higher-better');
});

test('buildLocationMetrics: subwayStatus CONFIRMED_ABSENT은 "정보 없음"이 아니라 "확인된 없음"으로 구분한다', () => {
  const metrics = buildLocationMetrics(
    { subwayStatus: 'CONFIRMED_ABSENT', nearestSubwayDistanceM: null, nearestBusStopDistanceM: 200 },
    {}, {}
  );
  const subway = metrics.find((m) => m.key === 'subwayDistance')!;
  assert.equal(subway.value, null);
  assert.match(subway.displayValue, /확인/);
});

test('buildLocationMetrics: subwayStatus MISSING(수집 실패)은 순수 정보 없음으로 표시한다', () => {
  const metrics = buildLocationMetrics(
    { subwayStatus: 'MISSING', nearestSubwayDistanceM: null },
    {}, {}
  );
  const subway = metrics.find((m) => m.key === 'subwayDistance')!;
  assert.equal(subway.trust, 'MISSING');
  assert.equal(subway.displayValue, '정보 없음');
});
