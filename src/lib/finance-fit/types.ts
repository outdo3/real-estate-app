// FINANCE_FIT_V1_PHASE2A — data contract, per FINANCE_FIT_V1_PHASE1_AUDIT.md §15.
// Every result field carries its own trust label so the UI never has to guess whether a
// number is a real calculation, a user's own input, or sourced from real trade data.
// Acquisition tax / LTV / DSR / loan-approval judgment are explicitly out of Phase 2A scope
// (FINANCE_FIT_V1_PHASE2A spec §1) — this contract has no field for any of them.

export type ResultConfidence = 'CALCULATED' | 'USER_INPUT' | 'SOURCE_DATA' | 'UNAVAILABLE';

export interface FinanceFitInputs {
  purchasePrice: number; // 원 단위
  availableCash: number | null; // 원 단위, 미입력 시 null
  loanAmount: number; // 원 단위
  interestRatePercent: number; // 예: 3.5
  loanYears: number;
}

export interface MonthlyPaymentBreakdown {
  ratePercent: number;
  monthlyPayment: number; // 원 단위
  trust: ResultConfidence; // 항상 'CALCULATED'
}

export interface BrokerageCeiling {
  rate: number; // 예: 0.004
  cap: number | null; // 원 단위 상한액, 없으면 null(요율만 적용)
  amount: number; // 원 단위
  trust: ResultConfidence; // 항상 'CALCULATED'
}

export interface CashGap {
  amount: number; // 원 단위, 항상 양수
  direction: 'SHORT' | 'SURPLUS';
  trust: ResultConfidence; // 항상 'CALCULATED'
}

export interface FinanceFitResult {
  purchasePrice: { value: number; trust: ResultConfidence }; // USER_INPUT
  loanAmount: { value: number; trust: ResultConfidence }; // USER_INPUT
  brokerage: BrokerageCeiling;
  requiredCash: { value: number; trust: ResultConfidence }; // CALCULATED
  monthlyPayment: MonthlyPaymentBreakdown; // base(입력 금리) 기준
  stressTest: {
    base: MonthlyPaymentBreakdown;
    plus1: MonthlyPaymentBreakdown;
    plus2: MonthlyPaymentBreakdown;
  };
  cashGap: CashGap | null; // availableCash 미입력 시 null
}

export interface ReferencePrice {
  priceWon: number | null;
  tradeDate: string | null;
  trust: ResultConfidence; // 'SOURCE_DATA' | 'UNAVAILABLE'
}

// FINANCE_FIT_V1_PHASE2A §12 — rule version metadata. 법령 개정 시 이 값과
// brokerage.ts의 BROKERAGE_BANDS_SALE만 교체하면 되도록 계산 로직과 분리해 둔다.
export const BROKERAGE_RULE_VERSION = {
  source: '공인중개사법 시행규칙 별표 1 (주택 매매 기준)',
  referenceDate: '2026-09-02',
} as const;
