// DETAIL TRADE AREA STATE SPLIT V1 — pure helpers for the transaction-area
// selector. These operate only on raw `trade.area` strings (the API's exact
// identity) and never on Unit Master `canonicalExclusiveArea` — see
// docs/development/DETAIL_TRADE_AREA_STATE_SPLIT_V1.md for why the two must
// stay independent (no verified mapping between them exists yet).

export interface TransactionAreaTrade {
  area: string;
}

export interface TradeAreaDateCandidate {
  area: string;
  tradeDate: string;
}

const STANDARD_AREA_MIN = 84;
const STANDARD_AREA_MAX = 85;

// Union of raw sale + pure-jeonse trade.area values, deduplicated, ascending
// numeric order. Callers must pre-filter rent trades to pure-jeonse
// (monthlyRent === 0) before passing them in — this function does not know
// about rent semantics.
export function buildTransactionAreaOptions(
  saleTrades: TransactionAreaTrade[],
  pureJeonseTrades: TransactionAreaTrade[]
): string[] {
  const areas = new Set<string>();
  for (const trade of saleTrades) if (trade.area) areas.add(trade.area);
  for (const trade of pureJeonseTrades) if (trade.area) areas.add(trade.area);
  return Array.from(areas).sort((a, b) => parseFloat(a) - parseFloat(b));
}

// Default selectedTradeArea policy: prefer the most recently traded raw area
// in the 84~85㎡ range; otherwise the most recently traded raw area overall;
// '전체' (no selection) when there are no trades at all. Never merges distinct
// raw areas (e.g. 84.7855 vs 84.9950) — it only picks among the exact values
// already present in the data.
export function pickDefaultTradeArea(trades: TradeAreaDateCandidate[]): string {
  if (trades.length === 0) return '전체';

  const latestByArea = new Map<string, TradeAreaDateCandidate>();
  for (const trade of trades) {
    const previous = latestByArea.get(trade.area);
    if (!previous || trade.tradeDate > previous.tradeDate) latestByArea.set(trade.area, trade);
  }
  const candidates = Array.from(latestByArea.values());

  const standard = candidates.filter((trade) => {
    const area = parseFloat(trade.area);
    return area >= STANDARD_AREA_MIN && area < STANDARD_AREA_MAX;
  });
  const pool = standard.length > 0 ? standard : candidates;

  return [...pool].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))[0].area;
}
