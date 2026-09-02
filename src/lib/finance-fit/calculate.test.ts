import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFinanceFit } from './calculate';

const baseInputs = {
  purchasePrice: 500_000_000,
  availableCash: null as number | null,
  loanAmount: 300_000_000,
  interestRatePercent: 3.5,
  loanYears: 30,
};

test('필요 자기자금 = 매수가 - 대출액 + 중개보수 상한 (취득세 제외)', () => {
  const result = calculateFinanceFit(baseInputs);
  const expectedBrokerage = 500_000_000 * 0.004; // 2억~9억 미만 구간
  assert.equal(result.brokerage.amount, expectedBrokerage);
  assert.equal(result.requiredCash.value, 500_000_000 - 300_000_000 + expectedBrokerage);
});

test('대출 0원이면 월상환액도 0원이고 requiredCash는 매수가+중개보수뿐이다', () => {
  const result = calculateFinanceFit({ ...baseInputs, loanAmount: 0 });
  assert.equal(result.monthlyPayment.monthlyPayment, 0);
  assert.equal(result.requiredCash.value, 500_000_000 + result.brokerage.amount);
});

test('준비자금 미입력 시 cashGap은 null이다', () => {
  const result = calculateFinanceFit(baseInputs);
  assert.equal(result.cashGap, null);
});

test('준비자금이 부족하면 SHORT 방향과 부족액이 나온다', () => {
  const result = calculateFinanceFit({ ...baseInputs, availableCash: 100_000_000 });
  assert.equal(result.cashGap?.direction, 'SHORT');
  assert.equal(result.cashGap?.amount, result.requiredCash.value - 100_000_000);
});

test('준비자금이 충분하면 SURPLUS 방향과 여유액이 나온다(구매 가능/불가능 판정 없음 — amount/direction만)', () => {
  const result = calculateFinanceFit({ ...baseInputs, availableCash: 1_000_000_000 });
  assert.equal(result.cashGap?.direction, 'SURPLUS');
  assert.equal(result.cashGap?.amount, 1_000_000_000 - result.requiredCash.value);
});

test('현금이 정확히 필요액과 같으면 SHORT(0원)로 분류된다(경계값)', () => {
  const result = calculateFinanceFit(baseInputs);
  const exact = calculateFinanceFit({ ...baseInputs, availableCash: result.requiredCash.value });
  assert.equal(exact.cashGap?.amount, 0);
  assert.equal(exact.cashGap?.direction, 'SHORT');
});

test('스트레스 테스트: base/+1%p/+2%p 모두 계산되고 금리가 높을수록 월상환액이 커진다', () => {
  const result = calculateFinanceFit(baseInputs);
  assert.equal(result.stressTest.base.ratePercent, 3.5);
  assert.equal(result.stressTest.plus1.ratePercent, 4.5);
  assert.equal(result.stressTest.plus2.ratePercent, 5.5);
  assert.ok(result.stressTest.plus1.monthlyPayment > result.stressTest.base.monthlyPayment);
  assert.ok(result.stressTest.plus2.monthlyPayment > result.stressTest.plus1.monthlyPayment);
});

test('모든 결과 필드는 명시적 trust를 갖는다(USER_INPUT/CALCULATED)', () => {
  const result = calculateFinanceFit({ ...baseInputs, availableCash: 100_000_000 });
  assert.equal(result.purchasePrice.trust, 'USER_INPUT');
  assert.equal(result.loanAmount.trust, 'USER_INPUT');
  assert.equal(result.brokerage.trust, 'CALCULATED');
  assert.equal(result.requiredCash.trust, 'CALCULATED');
  assert.equal(result.monthlyPayment.trust, 'CALCULATED');
  assert.equal(result.cashGap?.trust, 'CALCULATED');
});
