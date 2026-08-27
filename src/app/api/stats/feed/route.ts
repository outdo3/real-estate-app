import { NextResponse } from 'next/server';
import { fetchMolitData, formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, fetchMonthsThrottled, MonthTask } from '@/lib/molit-stats-helpers';
import {
  resolvePeriodRange,
  monthsForRange,
  isDateInRange,
  annotateTrades,
  buildRegionSummary,
  buildMarketInterpretation,
  groupTradesByDate,
  dedupeTrades,
  filterVerifiedTrades,
  areaBandLabel,
  type FeedTrade,
  type PeriodPreset,
} from '@/lib/regional-feed';

// STATISTICS V2 — REGIONAL TRANSACTION FEED §8/§9/§32. 기존 rankings/dashboard와
// 동일하게 "달 단위 배치 fetch + 전역 스로틀"만 쓴다(거래 row 개수만큼 MOLIT을
// 호출하지 않음 — N+1 금지). 신고가/직전거래 비교를 위해 조회 기간보다 최대
// 12개월 넓은 lookback을 한 번에 fetch한다.
export const dynamic = 'force-dynamic';

const VALID_PRESETS: PeriodPreset[] = ['today', 'yesterday', '7d', 'thisWeek', 'lastWeek', '30d', '12m', 'custom'];
const MAX_LOOKBACK_MONTHS = 12;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function subtractMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

function toFeedTrade(item: any, dealType: 'sale' | 'jeonse' | 'wolse'): FeedTrade | null {
  if (!item || item.typeLabel === '에러' || !(item.dealAmount > 0)) return null;
  return {
    uid: item.id,
    aptSeq: item.aptSeq ?? null,
    name: item.name,
    dong: item.dong || '',
    dealType,
    dealAmount: item.dealAmount,
    excluUseArea: item.excluUseArea ?? null,
    floorRaw: item.floorRaw ?? null,
    dealDate: item.dealDate,
    dealCanceled: !!item.dealCanceled,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lawdCdParam = searchParams.get('lawdCd');
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  const dong = searchParams.get('dong') || 'all';
  const presetParam = searchParams.get('period') || '7d';
  const preset: PeriodPreset = (VALID_PRESETS as string[]).includes(presetParam) ? (presetParam as PeriodPreset) : '7d';
  const dealTypeFilter = searchParams.get('dealType'); // 'sale'|'jeonse'|'wolse'|null(전체)
  const customFrom = searchParams.get('from') || undefined;
  const customTo = searchParams.get('to') || undefined;
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

  try {
    const lawdCd = lawdCdParam && /^\d{5}$/.test(lawdCdParam) ? lawdCdParam : await resolveLawdCd(sido, gungu);
    if (!lawdCd) {
      return NextResponse.json({ status: 'ERROR', message: `"${sido} ${gungu}" 지역 코드를 찾을 수 없습니다.` }, { status: 400 });
    }

    const now = new Date();
    const periodRange = resolvePeriodRange(preset, now, customFrom && customTo ? { from: customFrom, to: customTo } : undefined);
    // 신고가/직전거래 비교용 lookback — 표시 기간보다 최대 12개월 넓게(기존
    // rankings/dashboard의 "최근 12개월" 관례와 동일한 폭, §21 문서화).
    const lookbackFrom = subtractMonths(periodRange.from, MAX_LOOKBACK_MONTHS);
    const fetchRange = { from: lookbackFrom, to: periodRange.to };
    const months = monthsForRange(fetchRange);

    const cacheKey = `stats-feed:${lawdCd}:${months.join(',')}`;
    const rawByMonth = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
      const tasks: MonthTask[] = [];
      for (const m of months) {
        tasks.push({ key: `apt:${m}`, lawdCd, dealYmd: m, type: 'apt' });
        tasks.push({ key: `rent:${m}`, lawdCd, dealYmd: m, type: 'rent' });
      }
      return fetchMonthsThrottled(tasks);
    });

    let allTrades: FeedTrade[] = [];
    for (const m of months) {
      for (const raw of rawByMonth[`apt:${m}`] || []) {
        const t = toFeedTrade(raw, 'sale');
        if (t) allTrades.push(t);
      }
      for (const raw of rawByMonth[`rent:${m}`] || []) {
        const t = toFeedTrade(raw, raw.monthlyRent > 0 ? 'wolse' : 'jeonse');
        if (t) allTrades.push(t);
      }
    }
    allTrades = dedupeTrades(allTrades);
    if (dong !== 'all') allTrades = allTrades.filter((t) => t.dong === dong);

    // §39 API 실패 vs 거래 없음 구분 — period 안에 거래가 하나도 없을 때만, 그
    // period의 최신 달 하나를 직접(재시도 래퍼 우회) 한 번 더 찔러봐서 실제로
    // '에러' placeholder가 오는지 확인한다(추가 호출 1회, N+1 아님).
    const periodTradesRaw = allTrades.filter((t) => isDateInRange(t.dealDate, periodRange));
    let apiError = false;
    if (periodTradesRaw.length === 0) {
      const periodMonths = monthsForRange(periodRange);
      const latestMonth = periodMonths[periodMonths.length - 1];
      try {
        const probe = await fetchMolitData({ type: 'apt', lawdCd, dealYmd: latestMonth });
        apiError = probe.length === 1 && probe[0]?.typeLabel === '에러';
      } catch {
        apiError = true;
      }
    }

    const annotations = annotateTrades(allTrades);

    let periodTrades = periodTradesRaw;
    if (dealTypeFilter === 'sale' || dealTypeFilter === 'jeonse' || dealTypeFilter === 'wolse') {
      periodTrades = periodTrades.filter((t) => t.dealType === dealTypeFilter);
    }

    const summary = buildRegionSummary(periodTrades, annotations);

    const verifiedPeriod = filterVerifiedTrades(periodTrades);
    const dongCounts: Record<string, number> = {};
    const areaBandCounts: Record<string, number> = {};
    for (const t of verifiedPeriod) {
      if (t.dong) dongCounts[t.dong] = (dongCounts[t.dong] || 0) + 1;
      const band = areaBandLabel(t.excluUseArea);
      if (band) areaBandCounts[band] = (areaBandCounts[band] || 0) + 1;
    }

    const lookbackVerified = filterVerifiedTrades(allTrades.filter((t) => isDateInRange(t.dealDate, fetchRange)));
    const interpretation = buildMarketInterpretation({
      periodLabel: presetLabel(preset),
      periodDays: daysBetween(periodRange.from, periodRange.to),
      summary,
      lookbackVerifiedCount: lookbackVerified.length,
      lookbackDays: daysBetween(fetchRange.from, fetchRange.to),
      dongCounts,
      areaBandCounts,
    });

    // 정렬(최신순) 후 페이지네이션 — 한 번에 수천 건 반환하지 않는다(§31).
    const sorted = [...periodTrades].sort((a, b) => (b.dealDate === a.dealDate ? b.dealAmount - a.dealAmount : b.dealDate.localeCompare(a.dealDate)));
    const page = sorted.slice(offset, offset + limit);
    const enriched = page.map((t) => {
      const a = annotations.get(t.uid);
      return {
        ...t,
        priceLabel: formatKoreanPrice(String(t.dealAmount)),
        isRecordHigh: !t.dealCanceled && (a?.isRecordHigh ?? false),
        previousTrade: t.dealCanceled ? null : a?.previousTrade ?? null,
        changeAmount: t.dealCanceled ? null : a?.changeAmount ?? null,
        changePct: t.dealCanceled ? null : a?.changePct ?? null,
      };
    });
    const groups = groupTradesByDate(enriched as any);

    return NextResponse.json({
      status: 'OK',
      region: { lawdCd, dong },
      period: { preset, from: periodRange.from, to: periodRange.to, label: presetLabel(preset) },
      summary,
      interpretation,
      topDongs: Object.entries(dongCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
      topAreaBands: Object.entries(areaBandCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
      groups,
      pagination: { offset, limit, total: sorted.length, hasMore: offset + limit < sorted.length },
      apiError,
    });
  } catch (error) {
    console.error('Failed to load regional transaction feed:', error);
    return NextResponse.json({ status: 'ERROR', message: '실거래 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}

function presetLabel(preset: PeriodPreset): string {
  switch (preset) {
    case 'today': return '오늘';
    case 'yesterday': return '어제';
    case '7d': return '최근 7일';
    case 'thisWeek': return '이번 주';
    case 'lastWeek': return '지난주';
    case '30d': return '최근 30일';
    case '12m': return '최근 12개월';
    case 'custom': return '지정 기간';
    default: return '';
  }
}
