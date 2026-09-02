// FINANCE_FIT_V1_PHASE2A §15/§16 — input validation. Upper bounds exist only to catch
// obvious typos/overflow (e.g. an extra zero), not to constrain legitimate high-end inputs —
// set well above any realistic Busan apartment price.
export const MAX_REASONABLE_WON = 100_000_000_000; // 1,000억원
export const MAX_REASONABLE_RATE_PERCENT = 30;
export const MAX_REASONABLE_YEARS = 50;

export interface FinanceFitValidationError {
  field: 'purchasePrice' | 'availableCash' | 'loanAmount' | 'interestRatePercent' | 'loanYears';
  message: string;
}

export function validateFinanceFitInputs(inputs: {
  purchasePrice: number;
  availableCash: number | null;
  loanAmount: number;
  interestRatePercent: number;
  loanYears: number;
}): FinanceFitValidationError[] {
  const errors: FinanceFitValidationError[] = [];

  if (!Number.isFinite(inputs.purchasePrice) || inputs.purchasePrice < 0) {
    errors.push({ field: 'purchasePrice', message: '매수가는 0 이상의 값을 입력해주세요.' });
  } else if (inputs.purchasePrice > MAX_REASONABLE_WON) {
    errors.push({ field: 'purchasePrice', message: '입력한 매수가가 너무 큽니다. 다시 확인해주세요.' });
  }

  if (inputs.availableCash != null) {
    if (!Number.isFinite(inputs.availableCash) || inputs.availableCash < 0) {
      errors.push({ field: 'availableCash', message: '준비자금은 0 이상의 값을 입력해주세요.' });
    } else if (inputs.availableCash > MAX_REASONABLE_WON) {
      errors.push({ field: 'availableCash', message: '입력한 준비자금이 너무 큽니다. 다시 확인해주세요.' });
    }
  }

  if (!Number.isFinite(inputs.loanAmount) || inputs.loanAmount < 0) {
    errors.push({ field: 'loanAmount', message: '대출액은 0 이상의 값을 입력해주세요.' });
  } else if (inputs.loanAmount > MAX_REASONABLE_WON) {
    errors.push({ field: 'loanAmount', message: '입력한 대출액이 너무 큽니다. 다시 확인해주세요.' });
  }

  if (!Number.isFinite(inputs.interestRatePercent) || inputs.interestRatePercent < 0) {
    errors.push({ field: 'interestRatePercent', message: '금리는 0 이상의 값을 입력해주세요.' });
  } else if (inputs.interestRatePercent > MAX_REASONABLE_RATE_PERCENT) {
    errors.push({ field: 'interestRatePercent', message: '입력한 금리가 너무 높습니다. 다시 확인해주세요.' });
  }

  if (!Number.isFinite(inputs.loanYears) || inputs.loanYears <= 0) {
    errors.push({ field: 'loanYears', message: '대출 기간은 1년 이상이어야 합니다.' });
  } else if (inputs.loanYears > MAX_REASONABLE_YEARS) {
    errors.push({ field: 'loanYears', message: '대출 기간을 다시 확인해주세요.' });
  }

  // FINANCE_FIT_V1_PHASE2A §15 — 대출액이 매수가보다 크면 계산을 허용하지 않는다(권장 정책).
  if (
    Number.isFinite(inputs.purchasePrice) &&
    Number.isFinite(inputs.loanAmount) &&
    inputs.purchasePrice > 0 &&
    inputs.loanAmount > inputs.purchasePrice
  ) {
    errors.push({ field: 'loanAmount', message: '대출액이 예상 매수가보다 큽니다. 입력값을 다시 확인해주세요.' });
  }

  return errors;
}
