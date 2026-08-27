import assert from 'node:assert/strict';
import test from 'node:test';
import { attachLatestPrice } from './school-trade-price.ts';

const candidates = [
  { aptSeq: '26140-1164', name: '대신롯데캐슬', dong: '서대신동3가' },
  { aptSeq: '26140-1129', name: '대신공원한신휴플러스', dong: '서대신동3가' },
];

test('attachLatestPrice: 매칭되는 거래가 있으면 최신 거래를 붙인다', () => {
  const trades = [
    { name: '대신롯데캐슬', dong: '서대신동3가', dealAmount: 38700, price: '3억 8,700만', tradeDate: '2026-08-21' },
    { name: '대신롯데캐슬', dong: '서대신동3가', dealAmount: 49000, price: '4억 9,000만', tradeDate: '2026-05-01' },
  ];
  const result = attachLatestPrice(candidates, trades);
  const first = result.find((r) => r.aptSeq === '26140-1164');
  assert.equal(first.hasRecentPrice, true);
  assert.equal(first.dealAmount, 38700);
  assert.equal(first.tradeDate, '2026-08-21');
});

test('attachLatestPrice: 거래가 없는 후보는 hasRecentPrice=false, price=null(0/추정 없음)', () => {
  const result = attachLatestPrice(candidates, []);
  assert.ok(result.every((r) => r.hasRecentPrice === false && r.price === null && r.dealAmount === null));
});

test('attachLatestPrice: 해제(취소)된 거래는 최신 거래로 채택하지 않는다', () => {
  const trades = [
    { name: '대신롯데캐슬', dong: '서대신동3가', dealAmount: 60000, price: '6억', tradeDate: '2026-08-25', dealCanceled: true },
    { name: '대신롯데캐슬', dong: '서대신동3가', dealAmount: 38700, price: '3억 8,700만', tradeDate: '2026-08-21', dealCanceled: false },
  ];
  const result = attachLatestPrice(candidates, trades);
  const first = result.find((r) => r.aptSeq === '26140-1164');
  assert.equal(first.dealAmount, 38700);
});

test('attachLatestPrice: 다른 단지 거래가 섞여도 dong+name이 다르면 매칭되지 않는다', () => {
  const trades = [{ name: '전혀다른단지', dong: '다른동', dealAmount: 99999, price: '9억9,999만', tradeDate: '2026-08-21' }];
  const result = attachLatestPrice(candidates, trades);
  assert.ok(result.every((r) => r.hasRecentPrice === false));
});
