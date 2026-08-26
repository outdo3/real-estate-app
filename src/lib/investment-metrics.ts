// DETAIL TRADE AREA STATE SPLIT V1 — pure helper mirroring InvestmentMetrics.tsx's
// gap/전세가율 calculation exactly (extracted only for unit-testability). Operates
// strictly on selectedTradeArea (raw trade.area identity) — never on Unit Master
// canonicalExclusiveArea.

export interface InvestmentMetricsTrade {
  price: number;
  priceStr: string;
  area: string;
  tradeDate: string;
  monthlyRent?: number;
}

export interface InvestmentMetricsResult {
  latestSale: InvestmentMetricsTrade | null;
  matchedRent: InvestmentMetricsTrade | null;
  jeonseRate: number | null;
  gap: number | null;
}

// sale/rentTrades may be any-area; this function itself narrows to
// selectedTradeArea. Rent is narrowed further to pure-jeonse (monthlyRent === 0)
// — a mixed 전세/반전세 deposit is not comparable to a 매매 price.
export function computeInvestmentMetrics(
  saleTrades: InvestmentMetricsTrade[],
  rentTrades: InvestmentMetricsTrade[],
  selectedTradeArea: string | undefined
): InvestmentMetricsResult {
  const isAreaFiltered = !!selectedTradeArea && selectedTradeArea !== '전체';
  if (!isAreaFiltered) {
    return { latestSale: null, matchedRent: null, jeonseRate: null, gap: null };
  }

  const areaSaleTrades = saleTrades.filter((t) => t.area === selectedTradeArea);
  const areaRentTrades = rentTrades.filter((t) => t.area === selectedTradeArea);

  const latestSale = areaSaleTrades.length > 0
    ? [...areaSaleTrades].sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime())[0]
    : null;

  const jeonseOnlyRent = areaRentTrades.filter((r) => (r.monthlyRent ?? 0) === 0);
  const sortedRent = [...jeonseOnlyRent].sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());
  const matchedRent = latestSale ? sortedRent.find((r) => r.area === latestSale.area) ?? null : null;

  const isSameArea = !!(latestSale && matchedRent && matchedRent.area === latestSale.area);
  const gap = isSameArea && latestSale && matchedRent ? latestSale.price - matchedRent.price : null;
  const jeonseRate = isSameArea && latestSale && matchedRent && latestSale.price > 0
    ? (matchedRent.price / latestSale.price) * 100
    : null;

  return { latestSale, matchedRent, jeonseRate, gap };
}
