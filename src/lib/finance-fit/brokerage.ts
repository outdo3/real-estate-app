// FINANCE_FIT_V1_PHASE2A §11/§12 — 주택 매매 중개보수 법정 상한. 표는 사용자가
// FINANCE_FIT_V1_PHASE2A 작업 지시에서 직접 명시한 공인중개사법 시행규칙 별표 1 기준
// 값을 그대로 사용한다(Phase 1 감사에서 "공식 외부 근거 확인 필요"로 남겨둔 항목 —
// 이번 STEP에서 사용자가 정확한 표를 제공해 해소됨). 법령 개정 시 이 배열과
// types.ts의 BROKERAGE_RULE_VERSION만 교체하면 되도록 계산 로직에서 분리해 둔다.
// 절대 "확정 중개수수료"로 표현하지 않는다 — 실제 금액은 상한 내에서 협의된다(§11).

export interface BrokerageBand {
  minPrice: number; // 원, 이상
  maxPriceExclusive: number | null; // 원, 미만(null이면 최상위 구간)
  rate: number; // 예: 0.006
  cap: number | null; // 원, 없으면 요율만 적용(상한액 없음)
}

export const BROKERAGE_BANDS_SALE: BrokerageBand[] = [
  { minPrice: 0, maxPriceExclusive: 50_000_000, rate: 0.006, cap: 250_000 },
  { minPrice: 50_000_000, maxPriceExclusive: 200_000_000, rate: 0.005, cap: 800_000 },
  { minPrice: 200_000_000, maxPriceExclusive: 900_000_000, rate: 0.004, cap: null },
  { minPrice: 900_000_000, maxPriceExclusive: 1_200_000_000, rate: 0.005, cap: null },
  { minPrice: 1_200_000_000, maxPriceExclusive: 1_500_000_000, rate: 0.006, cap: null },
  { minPrice: 1_500_000_000, maxPriceExclusive: null, rate: 0.007, cap: null },
];

export function findBrokerageBand(price: number): BrokerageBand {
  const band = BROKERAGE_BANDS_SALE.find(
    (b) => price >= b.minPrice && (b.maxPriceExclusive === null || price < b.maxPriceExclusive)
  );
  return band ?? BROKERAGE_BANDS_SALE[BROKERAGE_BANDS_SALE.length - 1];
}

export function calculateBrokerageCeiling(price: number): { rate: number; cap: number | null; amount: number } {
  const safePrice = Math.max(0, price);
  const band = findBrokerageBand(safePrice);
  const raw = safePrice * band.rate;
  const amount = band.cap !== null ? Math.min(raw, band.cap) : raw;
  return { rate: band.rate, cap: band.cap, amount };
}
