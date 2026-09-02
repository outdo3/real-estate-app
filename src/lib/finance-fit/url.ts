// FINANCE_FIT_V1_PHASE2A §25/§26 — URL state carries only identity + public reference-price
// context (같은 단지 페이지들이 이미 노출하는 실거래가), never the user's own financial
// inputs (availableCash/loanAmount/interestRatePercent 등은 client state에만 존재하고
// 새로고침 시 사라진다 — 자동 persistence 없음, spec §21/§26).
export interface FinanceFitSeed {
  name: string;
  lawdCd: string;
  dong: string;
  aptSeq?: string;
  refPriceWon?: number;
  refTradeDate?: string;
}

export function buildFinanceFitUrl(seed: FinanceFitSeed): string {
  const qs = new URLSearchParams();
  qs.set('name', seed.name);
  if (seed.lawdCd) qs.set('lawdCd', seed.lawdCd);
  if (seed.dong) qs.set('dong', seed.dong);
  if (seed.aptSeq) qs.set('aptSeq', seed.aptSeq);
  if (seed.refPriceWon != null && Number.isFinite(seed.refPriceWon)) {
    qs.set('refPrice', String(Math.round(seed.refPriceWon)));
  }
  if (seed.refTradeDate) qs.set('refDate', seed.refTradeDate);
  return `/finance-fit?${qs.toString()}`;
}

export function parseFinanceFitUrl(searchParams: URLSearchParams): FinanceFitSeed | null {
  const name = searchParams.get('name');
  if (!name) return null;

  const refPriceRaw = searchParams.get('refPrice');
  const refPriceWon = refPriceRaw ? Number(refPriceRaw) : undefined;

  return {
    name,
    lawdCd: searchParams.get('lawdCd') || '',
    dong: searchParams.get('dong') || '',
    aptSeq: searchParams.get('aptSeq') || undefined,
    refPriceWon: refPriceWon != null && Number.isFinite(refPriceWon) ? refPriceWon : undefined,
    refTradeDate: searchParams.get('refDate') || undefined,
  };
}
