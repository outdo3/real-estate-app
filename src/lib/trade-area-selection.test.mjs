import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTransactionAreaOptions, pickDefaultTradeArea } from './trade-area-selection.ts';

test('builds the raw sale+pure-jeonse area union, deduplicated and ascending', () => {
  const sale = [{ area: '84.79' }, { area: '59.88' }, { area: '84.79' }];
  const rent = [{ area: '129.72' }, { area: '84.79' }];
  assert.deepEqual(buildTransactionAreaOptions(sale, rent), ['59.88', '84.79', '129.72']);
});

test('keeps precision-distinct raw areas separate (84.7855 vs 84.9950, 59.8826 vs 59.8839)', () => {
  const sale = [{ area: '84.7855' }, { area: '84.9950' }, { area: '59.8826' }, { area: '59.8839' }];
  assert.deepEqual(buildTransactionAreaOptions(sale, []), ['59.8826', '59.8839', '84.7855', '84.9950']);
});

test('returns 전체 when there are no trades at all', () => {
  assert.equal(pickDefaultTradeArea([]), '전체');
});

test('prefers the 84~85㎡ range raw area when present', () => {
  const trades = [
    { area: '59.88', tradeDate: '2026-08-20' },
    { area: '84.79', tradeDate: '2026-08-01' },
    { area: '129.72', tradeDate: '2026-08-25' },
  ];
  assert.equal(pickDefaultTradeArea(trades), '84.79');
});

test('with multiple 84-range raw areas, picks the one with the most recent transaction', () => {
  const trades = [
    { area: '84.7855', tradeDate: '2026-01-01' },
    { area: '84.9950', tradeDate: '2026-08-01' },
    { area: '84.7855', tradeDate: '2026-06-01' },
  ];
  assert.equal(pickDefaultTradeArea(trades), '84.9950');
});

test('falls back to the most recent raw area overall when no 84-range area exists', () => {
  const trades = [
    { area: '59.88', tradeDate: '2026-01-01' },
    { area: '129.72', tradeDate: '2026-08-01' },
  ];
  assert.equal(pickDefaultTradeArea(trades), '129.72');
});
