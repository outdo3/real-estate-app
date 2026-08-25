export interface PriceTrendTrade {
  price: number;
  priceStr: string;
  area: string;
  tradeDate: string;
  monthlyRent?: number;
}

export interface PriceTrendPoint {
  id: number;
  date: string;
  salePrice: number | null;
  saleStr: string | null;
  rentPrice: number | null;
  rentStr: string | null;
  saleVolume: number | null;
  rentVolume: number | null;
  dailySaleCount: number;
  dailyRentCount: number;
}

type Event = Omit<PriceTrendPoint, 'id' | 'saleVolume' | 'rentVolume' | 'dailySaleCount' | 'dailyRentCount'>;

export function filterTradesForArea(trades: PriceTrendTrade[] | null, selectedArea?: string): PriceTrendTrade[] | null {
  if (!trades || !selectedArea || selectedArea === '전체') return trades;
  return trades.filter((trade) => trade.area === selectedArea);
}

// Price values remain individual MOLIT trades. Only the volume bar counts multiple
// transactions on the same calendar day; it never substitutes or aggregates a price.
export function buildPriceTrendPoints(saleTrades: PriceTrendTrade[], rentTrades: PriceTrendTrade[]): PriceTrendPoint[] {
  const events: Event[] = [
    ...saleTrades.map((trade) => ({ date: trade.tradeDate, salePrice: trade.price, saleStr: trade.priceStr, rentPrice: null, rentStr: null })),
    ...rentTrades.map((trade) => ({ date: trade.tradeDate, salePrice: null, saleStr: null, rentPrice: trade.price, rentStr: trade.priceStr })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const counts = new Map<string, { sale: number; rent: number }>();
  for (const event of events) {
    const count = counts.get(event.date) ?? { sale: 0, rent: 0 };
    if (event.salePrice !== null) count.sale += 1;
    if (event.rentPrice !== null) count.rent += 1;
    counts.set(event.date, count);
  }

  const renderedVolumeDates = new Set<string>();
  return events.map((event, id) => {
    const count = counts.get(event.date)!;
    const showVolume = !renderedVolumeDates.has(event.date);
    renderedVolumeDates.add(event.date);
    return {
      id,
      ...event,
      saleVolume: showVolume && count.sale > 0 ? count.sale : null,
      rentVolume: showVolume && count.rent > 0 ? count.rent : null,
      dailySaleCount: count.sale,
      dailyRentCount: count.rent,
    };
  });
}

export function formatTrendDate(date: string): string {
  const [year, month] = date.split('-');
  return year && month ? `${year.slice(2)}.${month}` : date;
}

export function latestTrade(trades: PriceTrendTrade[]): PriceTrendTrade | null {
  return trades.reduce<PriceTrendTrade | null>((latest, trade) => (!latest || trade.tradeDate > latest.tradeDate ? trade : latest), null);
}
