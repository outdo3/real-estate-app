// FINANCE_FIT_V1_PHASE2A — orchestrates the individual pure calculators into one
// FinanceFitResult. No API calls, no DB access — pure functions over already-known inputs
// (spec §31/§39: instant, client-side only).
import { calculateMonthlyPayment } from './amortization';
import { calculateBrokerageCeiling } from './brokerage';
import type { CashGap, FinanceFitInputs, FinanceFitResult, MonthlyPaymentBreakdown } from './types';

function buildMonthlyPaymentBreakdown(principal: number, ratePercent: number, years: number): MonthlyPaymentBreakdown {
  return {
    ratePercent,
    monthlyPayment: calculateMonthlyPayment(principal, ratePercent, years),
    trust: 'CALCULATED',
  };
}

function calculateCashGap(requiredCash: number, availableCash: number | null): CashGap | null {
  if (availableCash == null) return null;
  const diff = requiredCash - availableCash;
  return {
    amount: Math.abs(diff),
    direction: diff >= 0 ? 'SHORT' : 'SURPLUS',
    trust: 'CALCULATED',
  };
}

export function calculateFinanceFit(inputs: FinanceFitInputs): FinanceFitResult {
  const { purchasePrice, availableCash, loanAmount, interestRatePercent, loanYears } = inputs;

  const brokerageRaw = calculateBrokerageCeiling(purchasePrice);
  const brokerage = { ...brokerageRaw, trust: 'CALCULATED' as const };

  // FINANCE_FIT_V1_PHASE2A §9 — 취득세는 Phase 2A 정식 계산에 포함하지 않는다.
  // requiredCash = 매수가 - 대출액 + 중개보수 상한.
  const requiredCashValue = purchasePrice - loanAmount + brokerage.amount;

  const monthlyPayment = buildMonthlyPaymentBreakdown(loanAmount, interestRatePercent, loanYears);
  const stressTest = {
    base: monthlyPayment,
    plus1: buildMonthlyPaymentBreakdown(loanAmount, interestRatePercent + 1, loanYears),
    plus2: buildMonthlyPaymentBreakdown(loanAmount, interestRatePercent + 2, loanYears),
  };

  return {
    purchasePrice: { value: purchasePrice, trust: 'USER_INPUT' },
    loanAmount: { value: loanAmount, trust: 'USER_INPUT' },
    brokerage,
    requiredCash: { value: requiredCashValue, trust: 'CALCULATED' },
    monthlyPayment,
    stressTest,
    cashGap: calculateCashGap(requiredCashValue, availableCash),
  };
}
