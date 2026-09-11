import { M2_PER_PYEONG } from '@/lib/area-utils';

/**
 * REAL_ESTATE_TOOLS_FINANCE_ACTION_LOOP_V1 §6/§7/§12~§14 — **산수만** 하는 계산기들.
 *
 * ── 이 파일이 하지 않는 일 ─────────────────────────────────────────────────
 * 여기 있는 함수는 전부 정의가 고정된 비율 계산이다. LTV는 "대출액 ÷ 집값",
 * DSR은 "연간 원리금 ÷ 연소득", 전세가율은 "전세가 ÷ 매매가"다. 이건 정책이 아니라
 * 산수이므로 안심하고 계산할 수 있다.
 *
 * **정책은 계산하지 않는다.** "당신은 LTV 70%까지 받을 수 있다", "DSR 40% 이하면
 * 승인된다" 같은 판단은 지역 규제·주택 수·은행 심사에 달려 있고 수시로 바뀐다.
 * 그래서 비율의 *한도*는 사용자가 가정값으로 넣고, 우리는 그 가정에서 나오는 금액만
 * 보여준다. 금융기관 승인 금액이라고 말하지 않는다.
 */

/** 0으로 나누기·NaN·Infinity를 만들지 않기 위한 공통 가드. */
function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  if (numerator < 0) return null;
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}

// ── LTV ─────────────────────────────────────────────────────────────────────

export interface LtvResult {
  /** 가정한 비율에서 나오는 대출 금액(원). */
  loanAmount: number;
  /** 그 금액을 받았을 때 필요한 자기자금(원). */
  requiredOwnFunds: number;
  ratioPercent: number;
}

/**
 * 가정한 LTV 비율에서 나오는 대출 금액. **한도를 판정하지 않는다** —
 * 사용자가 넣은 비율을 집값에 적용할 뿐이다.
 */
export function loanAmountAtLtv(purchasePrice: number, ratioPercent: number): LtvResult | null {
  if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) return null;
  if (!Number.isFinite(ratioPercent) || ratioPercent < 0 || ratioPercent > 100) return null;
  const loanAmount = Math.round(purchasePrice * (ratioPercent / 100));
  return {
    loanAmount,
    requiredOwnFunds: Math.round(purchasePrice - loanAmount),
    ratioPercent,
  };
}

/** 이미 정한 대출액이 집값의 몇 %인가. 0~100을 넘어설 수도 있다(사실 그대로 보여준다). */
export function ltvPercent(loanAmount: number, purchasePrice: number): number | null {
  const ratio = safeRatio(loanAmount, purchasePrice);
  return ratio === null ? null : ratio * 100;
}

// ── DSR ─────────────────────────────────────────────────────────────────────

export interface DsrResult {
  /** 신규 대출의 연간 원리금(원). */
  newAnnualDebtService: number;
  /** 기존 + 신규 합계 연간 원리금(원). */
  totalAnnualDebtService: number;
  percent: number;
}

/**
 * DSR = (기존 연간 원리금 + 신규 연간 원리금) / 연소득 × 100.
 *
 * 월 상환액은 호출부가 기존 `calculateMonthlyPayment`로 구해서 넘긴다 —
 * 상환 공식을 여기서 다시 구현하지 않는다(두 벌이 되면 한쪽만 고쳐진다).
 *
 * 규제 한도(40%/50% 등)는 **판정하지 않는다**. 비율만 돌려준다.
 */
export function calculateDsr(
  annualIncome: number,
  existingAnnualDebtService: number,
  newMonthlyPayment: number
): DsrResult | null {
  if (!Number.isFinite(annualIncome) || annualIncome <= 0) return null;
  if (!Number.isFinite(existingAnnualDebtService) || existingAnnualDebtService < 0) return null;
  if (!Number.isFinite(newMonthlyPayment) || newMonthlyPayment < 0) return null;

  const newAnnual = Math.round(newMonthlyPayment * 12);
  const total = Math.round(existingAnnualDebtService + newAnnual);
  const ratio = safeRatio(total, annualIncome);
  if (ratio === null) return null;

  return {
    newAnnualDebtService: newAnnual,
    totalAnnualDebtService: total,
    percent: ratio * 100,
  };
}

// ── 갭 / 전세가율 ───────────────────────────────────────────────────────────

export interface GapResult {
  /** 매매가 - 전세가(원). 전세가가 더 크면 음수 — 사실대로 둔다. */
  gapAmount: number;
  /** 전세가 / 매매가 × 100. */
  jeonseRatioPercent: number;
}

/**
 * 필요 갭과 전세가율.
 *
 * **두 값이 같은 대상을 가리킬 때만 의미가 있다.** 서로 다른 전용면적이나 시점의
 * 거래를 섞으면 존재하지 않는 갭이 나온다. 이 함수는 숫자만 받으므로 그 판단을 할 수
 * 없고, 그래서 **자동 prefill은 호출부가 동일 단지·동일 전용면적을 확인했을 때만**
 * 한다(§12/§13). 확인할 수 없으면 사용자가 직접 넣는다.
 */
export function calculateGap(salePrice: number, jeonsePrice: number): GapResult | null {
  if (!Number.isFinite(salePrice) || salePrice <= 0) return null;
  if (!Number.isFinite(jeonsePrice) || jeonsePrice < 0) return null;
  const ratio = safeRatio(jeonsePrice, salePrice);
  if (ratio === null) return null;
  return {
    gapAmount: Math.round(salePrice - jeonsePrice),
    jeonseRatioPercent: ratio * 100,
  };
}

// ── 평당가 ──────────────────────────────────────────────────────────────────

export interface PricePerPyeongResult {
  pyeong: number;
  pricePerPyeong: number;
  pricePerM2: number;
}

/**
 * 평당가. 면적 환산은 저장소의 기존 상수(`M2_PER_PYEONG`)를 그대로 쓴다 —
 * 두 번째 환산 규칙을 만들지 않는다(§14).
 *
 * 주의: 이건 **사용자가 직접 넣은 면적**에 대한 산수다. Unit Master의 대표 평형을
 * `exclusiveArea / 3.3058`로 만들어내는 것(저장소에서 금지된 동작)과는 다른 일이다.
 */
export function pricePerPyeong(price: number, areaM2: number): PricePerPyeongResult | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(areaM2) || areaM2 <= 0) return null;
  const pyeong = areaM2 / M2_PER_PYEONG;
  if (!Number.isFinite(pyeong) || pyeong <= 0) return null;
  return {
    pyeong,
    pricePerPyeong: Math.round(price / pyeong),
    pricePerM2: Math.round(price / areaM2),
  };
}
