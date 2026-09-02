// FINANCE_FIT_V1_PHASE2A §7 — 원리금균등상환 표준 공식. Phase 2A는 이 상환방식만
// 지원한다(원금균등/만기일시는 미구현이며 UI에도 노출하지 않는다 — spec §4).

export function calculateMonthlyPayment(principal: number, annualRatePercent: number, years: number): number {
  const n = Math.round(years * 12);
  if (n <= 0 || principal <= 0) return 0;

  const monthlyRate = annualRatePercent / 100 / 12;
  if (monthlyRate === 0) return principal / n;

  const factor = Math.pow(1 + monthlyRate, n);
  return (principal * monthlyRate * factor) / (factor - 1);
}
