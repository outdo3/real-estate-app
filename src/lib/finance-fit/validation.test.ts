import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFinanceFitInputs } from './validation';

const valid = {
  purchasePrice: 500_000_000,
  availableCash: 100_000_000,
  loanAmount: 300_000_000,
  interestRatePercent: 3.5,
  loanYears: 30,
};

test('유효한 입력은 에러가 없다', () => {
  assert.deepEqual(validateFinanceFitInputs(valid), []);
});

test('매수가 0은 허용된다(에러 없음) — 0은 unknown이 아니라 유효한 입력', () => {
  const errors = validateFinanceFitInputs({ ...valid, purchasePrice: 0 });
  assert.equal(errors.some((e) => e.field === 'purchasePrice'), false);
});

test('음수 매수가는 차단된다', () => {
  const errors = validateFinanceFitInputs({ ...valid, purchasePrice: -1 });
  assert.ok(errors.some((e) => e.field === 'purchasePrice'));
});

test('음수 준비자금/대출액은 차단된다', () => {
  assert.ok(validateFinanceFitInputs({ ...valid, availableCash: -1 }).some((e) => e.field === 'availableCash'));
  assert.ok(validateFinanceFitInputs({ ...valid, loanAmount: -1 }).some((e) => e.field === 'loanAmount'));
});

test('금리 0은 허용된다', () => {
  const errors = validateFinanceFitInputs({ ...valid, interestRatePercent: 0 });
  assert.equal(errors.some((e) => e.field === 'interestRatePercent'), false);
});

test('과도하게 높은 금리는 차단된다', () => {
  const errors = validateFinanceFitInputs({ ...valid, interestRatePercent: 999 });
  assert.ok(errors.some((e) => e.field === 'interestRatePercent'));
});

test('대출 기간 0/음수는 차단된다', () => {
  assert.ok(validateFinanceFitInputs({ ...valid, loanYears: 0 }).some((e) => e.field === 'loanYears'));
  assert.ok(validateFinanceFitInputs({ ...valid, loanYears: -5 }).some((e) => e.field === 'loanYears'));
});

test('1년/40년 만기는 모두 허용된다', () => {
  assert.equal(validateFinanceFitInputs({ ...valid, loanYears: 1 }).length, 0);
  assert.equal(validateFinanceFitInputs({ ...valid, loanYears: 40 }).length, 0);
});

test('대출액이 매수가보다 크면 차단된다(계산 자체를 허용하지 않는 정책)', () => {
  const errors = validateFinanceFitInputs({ ...valid, purchasePrice: 100, loanAmount: 200 });
  assert.ok(errors.some((e) => e.field === 'loanAmount'));
});

test('현금 0(충분히 준비된 것이 아니라 미입력과 구분되는 값)도 유효한 입력이다', () => {
  const errors = validateFinanceFitInputs({ ...valid, availableCash: 0 });
  assert.equal(errors.some((e) => e.field === 'availableCash'), false);
});

test('비정상적으로 큰 금액은 오버플로 방지를 위해 차단된다', () => {
  const errors = validateFinanceFitInputs({ ...valid, purchasePrice: 1e15 });
  assert.ok(errors.some((e) => e.field === 'purchasePrice'));
});
