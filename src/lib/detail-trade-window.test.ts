import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthsForPeriod, tradeMonthKey, narrowTradeWindow } from './detail-trade-window';
import {
  TRADE_API_UNAVAILABLE_MESSAGE,
  TRADE_PARTIAL_MESSAGE,
  type TradeReadState,
} from './trade-read-state';

// PERCEIVED_PERFORMANCE_V2_DATAFLOW §6 — 좁은 창 파생이 완전성 의미를 바꾸지 않는지
// 확정적으로 검증한다. 여기서 지키려는 계약은 성능이 아니라 "FAILED != ZERO"다.

// 고정 시계 — 2026-09-09. 60개월 창 = 202609(최신) ... 202110(가장 오래됨).
const NOW = new Date(2026, 8, 9);

function trade(tradeDate: string) {
  return { tradeDate, price: 1, area: '84.99' };
}

function source(over: Partial<TradeReadState<ReturnType<typeof trade>>> = {}): TradeReadState<ReturnType<typeof trade>> {
  return {
    trades: [],
    apiError: null,
    partial: false,
    incompleteMessage: null,
    failedMonths: [],
    monthsRequested: 60,
    monthsSucceeded: 60,
    ...over,
  };
}

test('monthsForPeriod: 라우트와 같은 규칙 — 최신월이 먼저, YYYYMM, 요청한 개수만큼', () => {
  const months = monthsForPeriod(3, NOW);
  assert.deepEqual(months, ['202609', '202608', '202607']);
  assert.equal(monthsForPeriod(60, NOW).length, 60);
  assert.equal(monthsForPeriod(60, NOW)[59], '202110');
});

test('monthsForPeriod: 연도 경계를 넘어도 어긋나지 않는다', () => {
  assert.deepEqual(monthsForPeriod(3, new Date(2026, 0, 15)), ['202601', '202512', '202511']);
});

test('tradeMonthKey: YYYY-MM-DD → YYYYMM, 읽을 수 없으면 null', () => {
  assert.equal(tradeMonthKey('2026-08-21'), '202608');
  assert.equal(tradeMonthKey(''), null);
  assert.equal(tradeMonthKey(undefined), null);
  assert.equal(tradeMonthKey('2026/08/21'), null);
});

test('가장 넓은 창(target >= source)은 원본을 그대로 돌려준다 — 손실 없음', () => {
  const s = source({ trades: [trade('2021-11-02')] });
  assert.equal(narrowTradeWindow(s, 60, 60, NOW), s);
  assert.equal(narrowTradeWindow(s, 60, 120, NOW), s);
});

test('거래를 대상 창의 월로만 거른다 — 창 밖 거래는 좁은 view에 들어오지 않는다', () => {
  const s = source({
    trades: [trade('2026-09-01'), trade('2025-09-30'), trade('2024-01-10')],
  });
  const narrowed = narrowTradeWindow(s, 60, 12, NOW);
  // 12개월 창 = 202609..202510. 202509와 202401은 창 밖이다.
  assert.deepEqual(narrowed.trades.map((t) => t.tradeDate), ['2026-09-01']);
});

test('경계 포함: 12개월 창의 가장 오래된 달(202510)은 포함, 그 직전 달(202509)은 제외', () => {
  const s = source({ trades: [trade('2025-10-31'), trade('2025-09-30')] });
  const narrowed = narrowTradeWindow(s, 60, 12, NOW);
  assert.deepEqual(narrowed.trades.map((t) => t.tradeDate), ['2025-10-31']);
});

test('완전한 원본에서 좁히면 완전한 view가 된다 — 없는 실패를 만들어내지 않는다', () => {
  const narrowed = narrowTradeWindow(source(), 60, 36, NOW);
  assert.equal(narrowed.partial, false);
  assert.equal(narrowed.apiError, null);
  assert.equal(narrowed.incompleteMessage, null);
  assert.deepEqual(narrowed.failedMonths, []);
  assert.equal(narrowed.monthsRequested, 36);
  assert.equal(narrowed.monthsSucceeded, 36);
});

test('실패한 달이 창 **밖**이면 좁은 view는 partial이 아니다 — 60개월 실패를 1년 화면에 덮어씌우지 않는다', () => {
  const s = source({ partial: true, incompleteMessage: TRADE_PARTIAL_MESSAGE, failedMonths: ['202401'], monthsSucceeded: 59 });
  const narrowed = narrowTradeWindow(s, 60, 12, NOW);
  assert.equal(narrowed.partial, false);
  assert.equal(narrowed.incompleteMessage, null);
  assert.deepEqual(narrowed.failedMonths, []);
  assert.equal(narrowed.monthsRequested, 12);
  assert.equal(narrowed.monthsSucceeded, 12);
});

test('실패한 달이 창 **안**이면 좁은 view도 partial이다 — 빠진 사실이 묻히지 않는다', () => {
  const s = source({ partial: true, incompleteMessage: TRADE_PARTIAL_MESSAGE, failedMonths: ['202401', '202606'], monthsSucceeded: 58 });
  const narrowed = narrowTradeWindow(s, 60, 12, NOW);
  assert.equal(narrowed.partial, true);
  assert.equal(narrowed.incompleteMessage, TRADE_PARTIAL_MESSAGE);
  assert.deepEqual(narrowed.failedMonths, ['202606']);
  assert.equal(narrowed.monthsRequested, 12);
  assert.equal(narrowed.monthsSucceeded, 11);
});

test('대상 창의 모든 달이 실패하면 apiError다 — 거래 0건을 "거래 없음"으로 보여주지 않는다', () => {
  const s = source({
    partial: true,
    incompleteMessage: TRADE_PARTIAL_MESSAGE,
    failedMonths: monthsForPeriod(12, NOW),
    monthsSucceeded: 48,
    trades: [trade('2024-05-02')],
  });
  const narrowed = narrowTradeWindow(s, 60, 12, NOW);
  assert.equal(narrowed.apiError, TRADE_API_UNAVAILABLE_MESSAGE);
  assert.equal(narrowed.incompleteMessage, TRADE_API_UNAVAILABLE_MESSAGE);
  assert.equal(narrowed.partial, false);
  assert.deepEqual(narrowed.trades, []);
  assert.equal(narrowed.monthsSucceeded, 0);
});

test('원본이 전체 실패(apiError)면 좁혀도 전체 실패 — 상태를 완화하지 않는다', () => {
  const s = source({ apiError: TRADE_API_UNAVAILABLE_MESSAGE, incompleteMessage: TRADE_API_UNAVAILABLE_MESSAGE, monthsSucceeded: 0, failedMonths: monthsForPeriod(60, NOW) });
  const narrowed = narrowTradeWindow(s, 60, 12, NOW);
  assert.equal(narrowed.apiError, TRADE_API_UNAVAILABLE_MESSAGE);
  assert.deepEqual(narrowed.trades, []);
});

test('서버 메타데이터를 신뢰할 수 없으면(monthsRequested 불일치) 완전성을 다시 계산하지 않고 원본 값을 유지한다', () => {
  // 구버전 응답(필드 없음) — 0은 "모른다"는 뜻이다.
  const legacy = source({ monthsRequested: 0, monthsSucceeded: 0, trades: [trade('2026-09-01'), trade('2024-01-10')] });
  const narrowed = narrowTradeWindow(legacy, 60, 12, NOW);
  assert.equal(narrowed.monthsRequested, 0);
  assert.equal(narrowed.monthsSucceeded, 0);
  // 거래는 그래도 창으로 거른다.
  assert.deepEqual(narrowed.trades.map((t) => t.tradeDate), ['2026-09-01']);
});

test('메타데이터 불일치 + 원본 partial이면 좁은 view도 partial을 유지한다 — 더 완전하다고 주장하지 않는다', () => {
  const skewed = source({ monthsRequested: 59, partial: true, incompleteMessage: TRADE_PARTIAL_MESSAGE, failedMonths: ['202401'] });
  const narrowed = narrowTradeWindow(skewed, 60, 12, NOW);
  assert.equal(narrowed.partial, true);
  assert.equal(narrowed.incompleteMessage, TRADE_PARTIAL_MESSAGE);
});

test('월을 읽을 수 없는 거래는 좁은 창에서 빠지지만 가장 넓은 view에는 그대로 남는다', () => {
  const s = source({ trades: [trade('2026-09-01'), { tradeDate: '', price: 1, area: '84.99' }] });
  assert.equal(narrowTradeWindow(s, 60, 12, NOW).trades.length, 1);
  assert.equal(narrowTradeWindow(s, 60, 60, NOW).trades.length, 2);
});
