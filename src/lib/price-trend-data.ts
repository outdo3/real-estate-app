import { areaMatchesSelection, isAllAreas } from './unit-area-match';
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
  if (!trades || isAllAreas(selectedArea)) return trades;
  // UNIT/TRADE FILTER BUG V1 — 문자열 === 대신 숫자 매칭(unit-area-match.ts).
  // selectedArea가 Unit Master canonical("84.7855")이어도 raw trade.area
  // ("84.7855m²")와 정상적으로 매칭된다.
  return trades.filter((trade) => areaMatchesSelection(trade.area, selectedArea));
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

// ─────────────────────────────────────────────────────────────────────────────
// APT_DETAIL_DEFAULT_ALL_TRUST_FIX_V1 §6 — 전체 모드 평형별 비교 시리즈.
//
// 전체가 기본 상태가 되면서 차트가 비어 있으면 안 된다. 그렇다고 서로 다른 면적의
// 거래를 **하나의 절대가격 선으로 이으면 안 된다** — 59㎡ 거래와 129㎡ 거래를 한 선으로
// 연결하면 존재하지 않는 가격 변동을 그려낸다. 그래서 면적마다 **독립된 선**을 만든다.
//
// 그룹 기준은 parseFloat 후 소수 4자리까지의 **정확한 전용면적**이다. "84.7855m²"와
// "84.7855"처럼 표기만 다른 같은 면적은 한 그룹이 되지만, 84.7855와 84.9950처럼
// **다른 면적은 절대 합쳐지지 않는다**(Unit Master 보호 규칙).
// ─────────────────────────────────────────────────────────────────────────────

export interface UnitTrendSeries {
  /** Recharts dataKey. 면적 문자열을 그대로 키로 쓰면 소수점이 경로로 해석된다. */
  key: string;
  /** 이 시리즈의 대표 raw area 문자열(라벨 생성은 호출부가 Unit Master로 한다). */
  area: string;
  /** 이 면적의 거래 건수. 가독성 규칙과 범례 정렬에 쓴다. */
  count: number;
}

export interface UnitTrendPoint {
  id: number;
  date: string;
  /** 이 거래가 속한 시리즈의 key만 가격을 갖고 나머지는 null이다. */
  [seriesKey: string]: number | string | null;
}

export interface UnitTrendResult {
  series: UnitTrendSeries[];
  points: UnitTrendPoint[];
  /** 가독성 상한 때문에 화면에서 빠진 면적 수. 0이 아니면 안내 문구를 띄운다. */
  omittedCount: number;
}

/** 같은 전용면적으로 묶을 때 쓰는 키. 표기 차이는 흡수하고 값 차이는 보존한다. */
function areaGroupKey(area: string): string | null {
  const value = parseFloat(area);
  return Number.isFinite(value) ? value.toFixed(4) : null;
}

/**
 * 면적별로 나뉜 시리즈와, 모든 거래를 날짜순으로 늘어놓은 포인트 배열을 만든다.
 *
 * 가독성 규칙(§6)은 **결정적**이다: 거래 건수 내림차순 → 같으면 면적 오름차순으로
 * 정렬해 상위 `maxSeries`개만 남긴다. 같은 입력이면 언제나 같은 결과가 나온다.
 * 무작위 표본이나 임의 대표값을 만들지 않으며, 빠진 면적은 지어내지 않고 개수만 알린다.
 */
export function buildUnitTrendSeries(trades: PriceTrendTrade[], maxSeries = 5): UnitTrendResult {
  const groups = new Map<string, { area: string; trades: PriceTrendTrade[] }>();
  for (const trade of trades) {
    const key = areaGroupKey(trade.area);
    if (key === null) continue;
    const group = groups.get(key) ?? { area: trade.area, trades: [] };
    group.trades.push(trade);
    groups.set(key, group);
  }
  if (groups.size === 0) return { series: [], points: [], omittedCount: 0 };

  const ordered = Array.from(groups.entries()).sort((a, b) => {
    const byCount = b[1].trades.length - a[1].trades.length;
    if (byCount !== 0) return byCount;
    return parseFloat(a[0]) - parseFloat(b[0]);
  });

  const kept = ordered.slice(0, maxSeries);
  const omittedCount = ordered.length - kept.length;

  // 범례는 면적 오름차순이 읽기 쉽다(59 → 84 → 129). 선택은 건수 기준으로 이미 끝났다.
  const keptByArea = [...kept].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

  const series: UnitTrendSeries[] = keptByArea.map(([, group], index) => ({
    key: `u${index}`,
    area: group.area,
    count: group.trades.length,
  }));

  const events: { date: string; key: string; price: number; priceStr: string }[] = [];
  keptByArea.forEach(([, group], index) => {
    for (const trade of group.trades) {
      events.push({ date: trade.tradeDate, key: `u${index}`, price: trade.price, priceStr: trade.priceStr });
    }
  });
  events.sort((a, b) => a.date.localeCompare(b.date));

  const points: UnitTrendPoint[] = events.map((event, id) => {
    const point: UnitTrendPoint = { id, date: event.date };
    for (const s of series) point[s.key] = null;
    point[event.key] = event.price;
    point[`${event.key}Str`] = event.priceStr;
    return point;
  });

  return { series, points, omittedCount };
}
