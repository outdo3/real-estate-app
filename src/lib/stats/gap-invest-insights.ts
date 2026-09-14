// GAP_INVEST_BUSAN_DB_FIRST_V1 — /api/stats/gap-invest의 **순수 집계** 부분.
//
// 라우트 본문에 있던 코드를 의미를 바꾸지 않고 그대로 옮겼다(공식·정렬·기간 경계·
// 필터 동일). 옮긴 이유는 하나다: 부산 전체를 DB-first로 바꾸면서 "MOLIT로 모은 원본"과
// "DB로 모은 원본"을 **같은 함수**에 넣어 결과를 대조해야 했다(parity 감사/테스트).
// 라우트 안에 두면 그 대조를 하려고 로직을 복제해야 한다 — 복제는 언젠가 갈라진다.
//
// 이 파일은 네트워크/DB를 전혀 만지지 않는다. 비동기 부분(단일 구 apiError probe,
// Unit Master/세대수 batch 조회)은 라우트에 그대로 남았다.
import { resolvePriceRankingPeriod, type PriceRankingPeriodPreset } from '@/lib/price-ranking';
import { previousPeriodRange } from '@/lib/regional-feed';
import {
  buildGapTradeEvents,
  gapEventGroupKey,
  median,
  type GapTrade,
  type GapTradeEvent,
} from '@/lib/gap-invest-calc';

// §8/§13 — 이전 기간 비교는 (period 길이 × 2)가 이미 fetch해둔 12개월 안에
// 들어올 때만 정직하게 계산할 수 있다. 12m은 두 배(24개월)가 fetch 범위를
// 벗어나므로 비교를 제공하지 않는다(dashboard의 VOLUME_COMPARISON_PRESETS와
// 동일한 원칙, §18 절대 사용 안 함 원칙과 동일선상).
export const COMPARISON_ELIGIBLE_PRESETS = new Set<PriceRankingPeriodPreset>(['30d', '3m', '6m']);
export const REGION_RANKING_LIMIT = 30;
export const APARTMENT_RANKING_LIMIT = 30;

export function toGapTrade(item: any, lawdCd: string): GapTrade | null {
  if (!item || item.typeLabel === '에러' || !(item.dealAmount > 0)) return null;
  return {
    name: item.name,
    dong: item.dong || '',
    lawdCd,
    dealAmount: item.dealAmount,
    excluUseArea: item.excluUseArea ?? null,
    dealDate: item.dealDate,
    dealCanceled: !!item.dealCanceled,
    monthlyRent: item.monthlyRent,
    aptSeq: item.aptSeq ?? null,
  };
}

function inRange(dateStr: string, range: { from: string; to: string }): boolean {
  return dateStr >= range.from && dateStr <= range.to;
}

function ratioPct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** 원본(MOLIT-shape raw item, lawdCd 부착) → 매매(취소 제외) / 순수 전세(취소·반전세 제외). */
export function toGapInputs(
  aptRaw: any[],
  rentRaw: any[],
  opts: { isSidoAll: boolean; dong: string }
): { saleTrades: GapTrade[]; pureJeonseTrades: GapTrade[] } {
  let saleTrades = aptRaw.map((t) => toGapTrade(t, t.lawdCd)).filter((t): t is GapTrade => t != null && !t.dealCanceled);
  const pureJeonseTrades = rentRaw.map((t) => toGapTrade(t, t.lawdCd)).filter((t): t is GapTrade => t != null && !t.dealCanceled && (!t.monthlyRent || t.monthlyRent === 0));

  if (!opts.isSidoAll && opts.dong !== 'all') {
    saleTrades = saleTrades.filter((t) => t.dong === opts.dong);
  }
  return { saleTrades, pureJeonseTrades };
}

export type RegionRow = { code: string; name: string; gapCount: number; totalSaleCount: number; ratioPct: number | null; previousCount: number | null };

export interface GapInvestInsightsInput {
  saleTrades: GapTrade[];
  pureJeonseTrades: GapTrade[];
  isSidoAll: boolean;
  dong: string;
  preset: PriceRankingPeriodPreset;
  now: Date;
  last12Months: string[];
  sigunguNameByLawdCd: Map<string, string>;
  sort: string;
}

export function computeGapInvestInsights(input: GapInvestInsightsInput) {
  const { saleTrades, pureJeonseTrades, isSidoAll, dong, preset, now, last12Months, sigunguNameByLawdCd } = input;

  // §5/§7/§8/§30 — 12개월 전체를 대상으로 이벤트를 한 번만 계산하고, 이후
  // 모든 집계(요약/지역랭킹/단지랭킹/월별추이/이전기간비교)는 이 단일
  // 이벤트 목록을 날짜로 필터링해서만 쓴다(뷰마다 다른 계산 없음 — §1 데이터
  // 신뢰: 모든 숫자가 같은 정의에서 나온다).
  const allEvents = buildGapTradeEvents(saleTrades, pureJeonseTrades);

  const period = resolvePriceRankingPeriod(preset, now);
  const periodEvents = allEvents.filter((e) => inRange(e.saleDate, period));
  const periodSaleTrades = saleTrades.filter((t) => inRange(t.dealDate, period));

  let previousRange: { from: string; to: string } | null = null;
  let previousEvents: GapTradeEvent[] = [];
  let previousSaleCount = 0;
  if (COMPARISON_ELIGIBLE_PRESETS.has(preset)) {
    previousRange = previousPeriodRange(period);
    previousEvents = allEvents.filter((e) => inRange(e.saleDate, previousRange!));
    previousSaleCount = saleTrades.filter((t) => inRange(t.dealDate, previousRange!)).length;
  }

  // ── 요약 ──
  const summary = {
    totalSaleCount: periodSaleTrades.length,
    gapEventCount: periodEvents.length,
    ratioPct: ratioPct(periodEvents.length, periodSaleTrades.length),
    previousGapEventCount: previousRange ? previousEvents.length : null,
    previousTotalSaleCount: previousRange ? previousSaleCount : null,
    changeCount: previousRange ? periodEvents.length - previousEvents.length : null,
    medianGap: median(periodEvents.map((e) => e.gap)),
  };

  // ── 지역 랭킹: SIDO_ALL이면 시군구, 특정 구 선택 + dong=all이면 동 ──
  let regionRanking: RegionRow[] = [];
  const regionScope: 'sido' | 'district' | 'dong' = isSidoAll ? 'sido' : dong === 'all' ? 'district' : 'dong';

  if (regionScope === 'sido') {
    const byCode = new Map<string, { gap: number; sale: number; prevGap: number }>();
    for (const e of periodEvents) {
      const code = e.lawdCd || '';
      if (!byCode.has(code)) byCode.set(code, { gap: 0, sale: 0, prevGap: 0 });
      byCode.get(code)!.gap++;
    }
    for (const t of periodSaleTrades) {
      const code = t.lawdCd || '';
      if (!byCode.has(code)) byCode.set(code, { gap: 0, sale: 0, prevGap: 0 });
      byCode.get(code)!.sale++;
    }
    if (previousRange) {
      for (const e of previousEvents) {
        const code = e.lawdCd || '';
        if (!byCode.has(code)) byCode.set(code, { gap: 0, sale: 0, prevGap: 0 });
        byCode.get(code)!.prevGap++;
      }
    }
    regionRanking = Array.from(byCode.entries()).map(([code, v]) => ({
      code,
      name: sigunguNameByLawdCd.get(code) || code,
      gapCount: v.gap,
      totalSaleCount: v.sale,
      ratioPct: ratioPct(v.gap, v.sale),
      previousCount: previousRange ? v.prevGap : null,
    }));
  } else if (regionScope === 'district') {
    const byDong = new Map<string, { gap: number; sale: number; prevGap: number }>();
    for (const e of periodEvents) {
      const key = e.dong || '(동 정보 없음)';
      if (!byDong.has(key)) byDong.set(key, { gap: 0, sale: 0, prevGap: 0 });
      byDong.get(key)!.gap++;
    }
    for (const t of periodSaleTrades) {
      const key = t.dong || '(동 정보 없음)';
      if (!byDong.has(key)) byDong.set(key, { gap: 0, sale: 0, prevGap: 0 });
      byDong.get(key)!.sale++;
    }
    if (previousRange) {
      for (const e of previousEvents) {
        const key = e.dong || '(동 정보 없음)';
        if (!byDong.has(key)) byDong.set(key, { gap: 0, sale: 0, prevGap: 0 });
        byDong.get(key)!.prevGap++;
      }
    }
    regionRanking = Array.from(byDong.entries()).map(([name, v]) => ({
      code: name,
      name,
      gapCount: v.gap,
      totalSaleCount: v.sale,
      ratioPct: ratioPct(v.gap, v.sale),
      previousCount: previousRange ? v.prevGap : null,
    }));
  }

  const sortParam = input.sort || 'count';
  const regionSortFns: Record<string, (a: RegionRow, b: RegionRow) => number> = {
    count: (a, b) => b.gapCount - a.gapCount,
    rate: (a, b) => (b.ratioPct ?? -1) - (a.ratioPct ?? -1),
    increase: (a, b) => ((b.previousCount != null ? b.gapCount - b.previousCount : -Infinity) - (a.previousCount != null ? a.gapCount - a.previousCount : -Infinity)),
  };
  regionRanking.sort(regionSortFns[sortParam] || regionSortFns.count);
  regionRanking = regionRanking.filter((r) => r.gapCount > 0).slice(0, REGION_RANKING_LIMIT);

  // ── 단지 랭킹: 현재 scope(전체 후보 events) 안에서 identity+area로 묶음 ──
  const byApt = new Map<string, GapTradeEvent[]>();
  for (const e of periodEvents) {
    const key = gapEventGroupKey(e);
    if (!byApt.has(key)) byApt.set(key, []);
    byApt.get(key)!.push(e);
  }
  const apartmentRankingRaw = Array.from(byApt.entries()).map(([key, events]) => {
    const sorted = [...events].sort((a, b) => (a.saleDate < b.saleDate ? 1 : a.saleDate > b.saleDate ? -1 : 0));
    const latest = sorted[0];
    return {
      groupKey: key,
      name: latest.name,
      dong: latest.dong,
      lawdCd: latest.lawdCd,
      aptSeq: latest.aptSeq,
      exclusiveAreaM2: latest.exclusiveAreaM2,
      saleAmount: latest.saleAmount,
      saleDate: latest.saleDate,
      jeonseAmount: latest.jeonseAmount,
      jeonseDate: latest.jeonseDate,
      gap: latest.gap,
      medianGap: median(events.map((e) => e.gap)),
      gapRatePct: latest.saleAmount > 0 ? Math.round((latest.jeonseAmount / latest.saleAmount) * 1000) / 10 : null,
      dealCount: events.length,
    };
  });
  // §11/§14 — "소액 갭투자" 관점: gap이 작은 순으로 기본 정렬한다(기존
  // dashboard 갭투자 TOP5가 이미 쓰던 정렬 관례와 동일, §3 재사용).
  apartmentRankingRaw.sort((a, b) => a.gap - b.gap);
  const apartmentRankingTop = apartmentRankingRaw.slice(0, APARTMENT_RANKING_LIMIT);

  // ── 월별 추이(§30) — 전체 12개월 이벤트를 월별로 묶는다(period와 무관하게 항상 12개월). ──
  const monthlyTrend = last12Months.map((ym) => ({
    month: `${ym.substring(2, 4)}.${ym.substring(4, 6)}`,
    count: allEvents.filter((e) => e.saleDate.replace(/-/g, '').substring(0, 6) === ym).length,
  }));

  return { period, previousRange, summary, regionScope, regionRanking, apartmentRankingTop, monthlyTrend, allEventCount: allEvents.length };
}
