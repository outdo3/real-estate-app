import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateBrokerageCeiling } from './brokerage';

// FINANCE_FIT_V1_PHASE2A §32/§33 — 모든 구간 경계값 전수 검증. maxPriceExclusive 규칙:
// "미만"이므로 경계값 자체는 다음 구간이 아니라 현재(더 낮은) 구간에 속한다.
test('구간 경계 전수 검증: 5천만원 미만/이상', () => {
  const under = calculateBrokerageCeiling(49_999_999);
  assert.equal(under.rate, 0.006);
  assert.equal(under.cap, 250_000);
  assert.equal(under.amount, 250_000); // raw = 299,999.994 > cap → capped

  const at = calculateBrokerageCeiling(50_000_000);
  assert.equal(at.rate, 0.005);
  assert.equal(at.cap, 800_000);
});

test('구간 경계 전수 검증: 2억원 미만/이상', () => {
  const under = calculateBrokerageCeiling(199_999_999);
  assert.equal(under.rate, 0.005);
  assert.equal(under.cap, 800_000);
  assert.equal(under.amount, 800_000); // raw ≈ 999,999.995 > cap → capped

  const at = calculateBrokerageCeiling(200_000_000);
  assert.equal(at.rate, 0.004);
  assert.equal(at.cap, null);
  assert.equal(at.amount, 200_000_000 * 0.004);
});

test('구간 경계 전수 검증: 9억원 미만/이상', () => {
  const under = calculateBrokerageCeiling(899_999_999);
  assert.equal(under.rate, 0.004);
  assert.equal(under.cap, null);

  const at = calculateBrokerageCeiling(900_000_000);
  assert.equal(at.rate, 0.005);
  assert.equal(at.cap, null);
  assert.equal(at.amount, 900_000_000 * 0.005);
});

test('구간 경계 전수 검증: 12억원 미만/이상', () => {
  const under = calculateBrokerageCeiling(1_199_999_999);
  assert.equal(under.rate, 0.005);

  const at = calculateBrokerageCeiling(1_200_000_000);
  assert.equal(at.rate, 0.006);
  assert.equal(at.amount, 1_200_000_000 * 0.006);
});

test('구간 경계 전수 검증: 15억원 미만/이상', () => {
  const under = calculateBrokerageCeiling(1_499_999_999);
  assert.equal(under.rate, 0.006);

  const at = calculateBrokerageCeiling(1_500_000_000);
  assert.equal(at.rate, 0.007);
  assert.equal(at.cap, null);
  assert.equal(at.amount, 1_500_000_000 * 0.007);
});

test('0원 입력은 크래시 없이 0을 반환한다', () => {
  const result = calculateBrokerageCeiling(0);
  assert.equal(result.amount, 0);
});

test('음수 입력은 방어적으로 0원 취급된다', () => {
  const result = calculateBrokerageCeiling(-1_000_000);
  assert.equal(result.amount, 0);
});

test('초고가 주택(50억)도 최상위 구간(0.7%, 상한 없음)으로 정상 계산된다', () => {
  const result = calculateBrokerageCeiling(5_000_000_000);
  assert.equal(result.rate, 0.007);
  assert.equal(result.cap, null);
  assert.equal(result.amount, 5_000_000_000 * 0.007);
});
