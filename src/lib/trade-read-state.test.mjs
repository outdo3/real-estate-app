import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTradeReadState, TRADE_API_UNAVAILABLE_MESSAGE } from './trade-read-state.ts';

test('keeps a successful response with trades distinct from no-trade', () => {
  const trade = { id: 1 };
  assert.deepEqual(resolveTradeReadState(true, { trades: [trade] }), {
    trades: [trade],
    apiError: null,
  });
});

test('keeps a successful verified zero response as no-trade', () => {
  assert.deepEqual(resolveTradeReadState(true, { trades: [] }), {
    trades: [],
    apiError: null,
  });
});

test('does not disguise an HTTP failure as no-trade', () => {
  assert.deepEqual(resolveTradeReadState(false, { trades: [] }), {
    trades: [],
    apiError: TRADE_API_UNAVAILABLE_MESSAGE,
  });
});

test('preserves an upstream API failure returned in a successful response', () => {
  assert.deepEqual(resolveTradeReadState(true, { trades: [], apiError: 'upstream unavailable' }), {
    trades: [],
    apiError: 'upstream unavailable',
  });
});
