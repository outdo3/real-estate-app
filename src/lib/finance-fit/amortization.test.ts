import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateMonthlyPayment } from './amortization';

test('0% 금리는 단순 원금/개월수로 계산된다(분모 0 방지)', () => {
  const payment = calculateMonthlyPayment(120_000_000, 0, 10);
  assert.equal(payment, 120_000_000 / 120);
});

test('표준 원리금균등 공식과 직접 계산한 값이 일치한다(3% 금리, 30년)', () => {
  const principal = 300_000_000;
  const rate = 3;
  const years = 30;
  const n = years * 12;
  const monthlyRate = rate / 100 / 12;
  const factor = Math.pow(1 + monthlyRate, n);
  const expected = (principal * monthlyRate * factor) / (factor - 1);
  assert.equal(calculateMonthlyPayment(principal, rate, years), expected);
});

test('5% 금리, 1년 만기 — 짧은 만기도 정상 계산된다', () => {
  const payment = calculateMonthlyPayment(12_000_000, 5, 1);
  assert.ok(payment > 1_000_000 && payment < 1_100_000);
});

test('고금리(15%)도 NaN/Infinity 없이 계산된다', () => {
  const payment = calculateMonthlyPayment(100_000_000, 15, 20);
  assert.ok(Number.isFinite(payment));
  assert.ok(payment > 0);
});

test('40년 장기 만기도 정상 계산된다', () => {
  const payment = calculateMonthlyPayment(500_000_000, 4, 40);
  assert.ok(Number.isFinite(payment));
  assert.ok(payment > 0);
});

test('원금 0이면 월상환액도 0이다', () => {
  assert.equal(calculateMonthlyPayment(0, 3.5, 30), 0);
});

test('연수 0 이하는 방어적으로 0을 반환한다(상위 validation이 이미 막지만 순수함수 자체도 안전해야 함)', () => {
  assert.equal(calculateMonthlyPayment(100_000_000, 3, 0), 0);
  assert.equal(calculateMonthlyPayment(100_000_000, 3, -5), 0);
});
