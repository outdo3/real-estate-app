import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveTradeReadState,
  resolveDerivedMetricTrust,
  resolveObservedMetricTrust,
  isAnySourceIncomplete,
  TRADE_API_UNAVAILABLE_MESSAGE,
  TRADE_PARTIAL_MESSAGE,
  TRADE_DERIVED_SUPPRESSED_MESSAGE,
} from './trade-read-state.ts';

// MOLIT_PARTIAL_TRUST_V2 §6 — 완전성 메타데이터(failedMonths/monthsRequested/
// monthsSucceeded)가 계약에 추가됐다. 기존 4개 필드의 값은 한 글자도 바뀌지 않는다.
const COMPLETE_META = { failedMonths: [], monthsRequested: 0, monthsSucceeded: 0 };

test('keeps a successful response with trades distinct from no-trade', () => {
  const trade = { id: 1 };
  assert.deepEqual(resolveTradeReadState(true, { trades: [trade] }), {
    trades: [trade],
    apiError: null,
    partial: false,
    incompleteMessage: null,
    ...COMPLETE_META,
  });
});

test('keeps a successful verified zero response as no-trade', () => {
  assert.deepEqual(resolveTradeReadState(true, { trades: [] }), {
    trades: [],
    apiError: null,
    partial: false,
    incompleteMessage: null,
    ...COMPLETE_META,
  });
});

test('does not disguise an HTTP failure as no-trade', () => {
  assert.deepEqual(resolveTradeReadState(false, { trades: [] }), {
    trades: [],
    apiError: TRADE_API_UNAVAILABLE_MESSAGE,
    partial: false,
    incompleteMessage: TRADE_API_UNAVAILABLE_MESSAGE,
    ...COMPLETE_META,
  });
});

test('preserves an upstream API failure returned in a successful response', () => {
  assert.deepEqual(resolveTradeReadState(true, { trades: [], apiError: 'upstream unavailable' }), {
    trades: [],
    apiError: 'upstream unavailable',
    partial: false,
    incompleteMessage: TRADE_API_UNAVAILABLE_MESSAGE,
    ...COMPLETE_META,
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

// ── MOLIT_PARTIAL_TRUST_V2 §6/§18 — 완전성 메타데이터 전달 ────────────────────

test('monthsRequested/monthsSucceeded/failedMonths가 클라이언트 계약까지 그대로 전달된다', () => {
  const state = resolveTradeReadState(true, {
    trades: [{ id: 1 }],
    partial: true,
    failedMonths: ['202312'],
    monthsRequested: 36,
    monthsSucceeded: 35,
  });
  assert.deepEqual(state.failedMonths, ['202312']);
  assert.equal(state.monthsRequested, 36);
  assert.equal(state.monthsSucceeded, 35);
});

test('메타데이터가 없는 예전 응답은 0/빈 배열로 채워지되 partial 판정에는 영향이 없다', () => {
  const state = resolveTradeReadState(true, { trades: [{ id: 1 }], partial: true });
  assert.deepEqual(state.failedMonths, []);
  assert.equal(state.monthsRequested, 0);
  assert.equal(state.monthsSucceeded, 0);
  assert.equal(state.partial, true, '메타데이터 부재가 불완전 판정을 뒤집으면 안 된다');
});

// ── MOLIT_PARTIAL_TRUST_V2 §3/§5 — 파생 지표 신뢰 판정 (혼합 원천 매트릭스) ────
//
// 매매(SALE)/전월세(RENT) 두 계열의 조합 6가지를 전부 고정한다. 결합 계산값
// (전세가율/갭)은 어느 한쪽이라도 불완전하면 SUPPRESSED, 관측값(매매가/전세가)은
// 자기 계열이 불완전할 때만 QUALIFIED다.

const complete = (n = 1) => resolveTradeReadState(true, { trades: Array.from({ length: n }, (_, i) => ({ id: i })) });
const trueZero = () => resolveTradeReadState(true, { trades: [], partial: false });
const partial = () => resolveTradeReadState(true, { trades: [{ id: 1 }], partial: true, failedMonths: ['202601'] });
const allFailed = () => resolveTradeReadState(true, { trades: [], apiError: 'upstream unavailable' });

test('매트릭스 A: SALE 완전 + RENT 완전 → 결합 계산값 SAFE (기존 동작 그대로)', () => {
  assert.equal(resolveDerivedMetricTrust(complete(), complete()), 'SAFE');
  assert.equal(resolveObservedMetricTrust(complete()), 'SAFE');
});

test('매트릭스 B: SALE 완전 + RENT 부분실패 → 결합은 SUPPRESSED, 매매가는 SAFE 유지', () => {
  const sale = complete();
  const rent = partial();
  assert.equal(resolveDerivedMetricTrust(sale, rent), 'SUPPRESSED');
  assert.equal(resolveObservedMetricTrust(sale), 'SAFE', '전월세 실패가 매매가를 가리면 안 된다');
  assert.equal(resolveObservedMetricTrust(rent), 'QUALIFIED');
});

test('매트릭스 C: SALE 부분실패 + RENT 완전 → 결합은 SUPPRESSED, 전세가는 SAFE 유지', () => {
  const sale = partial();
  const rent = complete();
  assert.equal(resolveDerivedMetricTrust(sale, rent), 'SUPPRESSED');
  assert.equal(resolveObservedMetricTrust(sale), 'QUALIFIED');
  assert.equal(resolveObservedMetricTrust(rent), 'SAFE');
});

test('매트릭스 D: SALE 부분실패 + RENT 부분실패 → 전부 불완전', () => {
  assert.equal(resolveDerivedMetricTrust(partial(), partial()), 'SUPPRESSED');
  assert.equal(resolveObservedMetricTrust(partial()), 'QUALIFIED');
});

test('매트릭스 E: SALE 완전 + RENT 검증된 0건 → 완전한 데이터다 (SAFE)', () => {
  assert.equal(resolveDerivedMetricTrust(complete(), trueZero()), 'SAFE');
  assert.equal(resolveObservedMetricTrust(trueZero()), 'SAFE', '진짜 0건은 불완전이 아니다');
});

test('매트릭스 F: SALE 검증된 0건 + RENT 완전 → 완전한 데이터다 (SAFE)', () => {
  assert.equal(resolveDerivedMetricTrust(trueZero(), complete()), 'SAFE');
});

test('전체 실패(apiError)도 불완전 원천으로 취급된다', () => {
  assert.equal(resolveDerivedMetricTrust(allFailed(), complete()), 'SUPPRESSED');
  assert.equal(resolveObservedMetricTrust(allFailed()), 'QUALIFIED');
  assert.equal(isAnySourceIncomplete(allFailed()), true);
});

test('아직 로딩 중(null)인 원천은 불완전으로 세지 않는다 — 로딩과 실패는 다른 상태다', () => {
  assert.equal(isAnySourceIncomplete(null, undefined), false);
});

test('나중에 완전 회복하면 SUPPRESSED가 스스로 풀린다', () => {
  assert.equal(resolveDerivedMetricTrust(partial(), complete()), 'SUPPRESSED');
  // 같은 두 계열이 다음 조회에서 전부 성공하면 아무 잔여 상태 없이 SAFE로 돌아온다.
  assert.equal(resolveDerivedMetricTrust(complete(), complete()), 'SAFE');
});

test('억제 문구는 "데이터 부족"/"거래 없음"과 명확히 다른 문장이다', () => {
  assert.ok(!TRADE_DERIVED_SUPPRESSED_MESSAGE.includes('거래 없음'));
  assert.ok(!TRADE_DERIVED_SUPPRESSED_MESSAGE.includes('데이터 부족'));
  assert.ok(TRADE_DERIVED_SUPPRESSED_MESSAGE.includes('계산할 수 없습니다'));
});

test('사용자 문구에 MOLIT/타임아웃/제한/내부 월키 같은 내부 용어가 없다', () => {
  for (const message of [TRADE_PARTIAL_MESSAGE, TRADE_DERIVED_SUPPRESSED_MESSAGE, TRADE_API_UNAVAILABLE_MESSAGE]) {
    for (const forbidden of ['MOLIT', '국토교통부', 'timeout', '타임아웃', 'rate', '초당', 'serviceKey', '2026']) {
      assert.ok(!message.includes(forbidden), `문구에 "${forbidden}"이 노출되면 안 된다: ${message}`);
    }
  }
});
