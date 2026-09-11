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

// ⚠️ APT_DETAIL_DEFAULT_ALL_TRUST_FIX_V1 §1 — **단지 상세의 기본 평형으로 쓰지 말 것.**
//
// 이 함수는 84~85㎡ 구간을 우선 고르기 때문에, 상세 진입 시 자동 선택에 쓰면
// 헤더는 "최근 실거래가"인데 값은 84㎡의 최신 거래인 상태가 만들어진다. 다른 평형에
// 더 최근 거래가 있으면 그게 가려지고, 라벨과 값이 어긋난다(사용자 신뢰 버그로 보고됨).
// 그래서 apt-client는 더 이상 이 함수를 호출하지 않고 '전체'로 시작한다.
//
// 함수 자체는 남겨 둔다 — "가장 흔한 평형"이 실제로 필요한 다른 화면(예: 단지 요약
// 카드의 대표 평형)에서는 유효한 정책이기 때문이다. 다만 **"최근 실거래가"처럼
// 전 평형을 뜻하는 라벨 옆에는 절대 쓰지 않는다.**
//
// 정책: 84~85㎡ 구간 중 가장 최근 거래된 raw area를 우선하고, 없으면 전체에서 가장
// 최근 거래된 raw area. 거래가 하나도 없으면 '전체'. 서로 다른 raw area
// (84.7855 vs 84.9950)를 합치지 않고, 데이터에 실제로 있는 값 중에서만 고른다.
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
