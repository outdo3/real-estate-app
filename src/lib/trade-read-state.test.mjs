import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTradeReadState, TRADE_API_UNAVAILABLE_MESSAGE, TRADE_PARTIAL_MESSAGE } from './trade-read-state.ts';

test('keeps a successful response with trades distinct from no-trade', () => {
  const trade = { id: 1 };
  assert.deepEqual(resolveTradeReadState(true, { trades: [trade] }), {
    trades: [trade],
    apiError: null,
    partial: false,
    incompleteMessage: null,
  });
});

test('keeps a successful verified zero response as no-trade', () => {
  assert.deepEqual(resolveTradeReadState(true, { trades: [] }), {
    trades: [],
    apiError: null,
    partial: false,
    incompleteMessage: null,
  });
});

test('does not disguise an HTTP failure as no-trade', () => {
  assert.deepEqual(resolveTradeReadState(false, { trades: [] }), {
    trades: [],
    apiError: TRADE_API_UNAVAILABLE_MESSAGE,
    partial: false,
    incompleteMessage: TRADE_API_UNAVAILABLE_MESSAGE,
  });
});

test('preserves an upstream API failure returned in a successful response', () => {
  assert.deepEqual(resolveTradeReadState(true, { trades: [], apiError: 'upstream unavailable' }), {
    trades: [],
    apiError: 'upstream unavailable',
    partial: false,
    incompleteMessage: TRADE_API_UNAVAILABLE_MESSAGE,
  });
});

// APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX §FRONTEND_HONEST_STATE

test('부분 실패 응답은 거래가 있어도 완전한 결과로 취급하지 않는다', () => {
  const state = resolveTradeReadState(true, { trades: [{ id: 1 }], partial: true, failedMonths: ['202601'] });
  assert.equal(state.partial, true);
  assert.equal(state.apiError, null, '일부 실패는 전체 실패(apiError)로 승격하지 않는다');
  assert.equal(state.incompleteMessage, TRADE_PARTIAL_MESSAGE);
});

test('부분 실패 + 거래 0건도 "거래 없음"이 아니라 불완전으로 읽힌다', () => {
  const state = resolveTradeReadState(true, { trades: [], partial: true, failedMonths: ['202601', '202602'] });
  assert.equal(state.partial, true);
  assert.equal(state.incompleteMessage, TRADE_PARTIAL_MESSAGE);
});

test('전체 실패(apiError)면 부분 실패 문구가 아니라 실패 문구를 쓴다', () => {
  const state = resolveTradeReadState(true, { trades: [], apiError: '초당 서비스 요청제한 횟수 초과 에러', partial: true });
  assert.equal(state.incompleteMessage, TRADE_API_UNAVAILABLE_MESSAGE);
});

test('사용자에게 노출되는 문구에는 내부 API/제한 관련 원문이 들어가지 않는다', () => {
  const state = resolveTradeReadState(true, { trades: [], apiError: '초당 서비스 요청제한 횟수 초과 에러', partial: true });
  assert.ok(!state.incompleteMessage.includes('초당'), '원문 오류 메시지를 그대로 노출하면 안 된다');
  assert.ok(!TRADE_PARTIAL_MESSAGE.includes('거래 없음'), '부분 실패를 거래 없음이라고 말하면 안 된다');
});

test('partial 필드가 없는 예전 응답 형태도 그대로 동작한다(하위 호환)', () => {
  const state = resolveTradeReadState(true, { trades: [{ id: 1 }] });
  assert.equal(state.partial, false);
  assert.equal(state.incompleteMessage, null);
});
