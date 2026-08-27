import { NextResponse } from 'next/server';
import { fetchMolitData, formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, fetchMonthsThrottled, fetchMonthsThrottledWithStatus, MonthTask } from '@/lib/molit-stats-helpers';
import { getSigunguListForSido } from '@/lib/region-utils';
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
  windowCoverageLabel,
  identityKey,
  toFeedTrade,
  type FeedTrade,
  type PeriodPreset,
} from '@/lib/regional-feed';
import { prisma } from '@/lib/prisma';
import { resolveApartmentContextBatch, type PyeongLookupKey as ContextLookupKey } from '@/lib/statistics-pyeong-resolver';

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lawdCdParam = searchParams.get('lawdCd');
  const sidoCodeParam = searchParams.get('sidoCode');
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
  // STATISTICS REGION FILTER V2 §10/§17 — "부산광역시 전체"처럼 시군구를 특정하지
  // 않는 조회. lawdCd가 없고 sidoCode(2자리)만 있을 때만 이 모드로 들어간다 —
  // 기존 lawdCd 기반 단일 구 조회 계약은 전혀 바뀌지 않는다(하위호환).
  const isSidoAll = !lawdCdParam && !!sidoCodeParam && /^\d{2}$/.test(sidoCodeParam);

  try {
    let lawdCd: string | null = null;
    if (!isSidoAll) {
      lawdCd = lawdCdParam && /^\d{5}$/.test(lawdCdParam) ? lawdCdParam : await resolveLawdCd(sido, gungu);
      if (!lawdCd) {
        return NextResponse.json({ status: 'ERROR', message: `"${sido} ${gungu}" 지역 코드를 찾을 수 없습니다.` }, { status: 400 });
      }
    }

    const now = new Date();
    const periodRange = resolvePeriodRange(preset, now, customFrom && customTo ? { from: customFrom, to: customTo } : undefined);

    let allTrades: FeedTrade[] = [];
    let apiError = false;
    let partial = false;
    let failedDistricts: string[] = [];
    let fetchRange: { from: string; to: string };

    if (isSidoAll) {
      // §19/§20 — 부산 16개/서울 25개 구를 곱하면 (구 수 × 월 수 × 2타입)이
      // 급격히 커진다(N+1 위험). 신고가/직전거래 비교용 12개월 lookback을 시도
      // 전체 조회에서는 붙이지 않고 "표시 기간 안에서만" 비교한다 — 표시 기간이
      // 곧 fetch 범위가 되어 (구 수 × 표시기간 개월 수 × 2)로 억제된다. 이
      // 절충은 §7(TRUE GATE: 현재 데이터로 안전한 구현 불가능급은 아니지만
      // 성능상 필요한 축소)로 문서화한다 — 신고가/직전거래 자체가 사라지는 게
      // 아니라 "12개월"이 아니라 "표시 기간 내" 기준으로 좁아질 뿐이다.
      fetchRange = periodRange;
      const months = monthsForRange(fetchRange);
      const districts = await getSigunguListForSido(sidoCodeParam!);
      const lawdCds = districts.map((d) => d.code.substring(0, 5));

      const cacheKey = `stats-feed-sido:${sidoCodeParam}:${months.join(',')}`;
      const cached = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
        const tasks: MonthTask[] = [];
        for (const dLawdCd of lawdCds) {
          for (const m of months) {
            tasks.push({ key: `${dLawdCd}|apt:${m}`, lawdCd: dLawdCd, dealYmd: m, type: 'apt' });
            tasks.push({ key: `${dLawdCd}|rent:${m}`, lawdCd: dLawdCd, dealYmd: m, type: 'rent' });
          }
        }
        const results = await fetchMonthsThrottledWithStatus(tasks);
        // §36 부분 실패 — lawdCd 하나라도 task가 실패했으면 그 구를 실패 목록에 남긴다
        // (엄격하게: 일부 달만 실패해도 그 구 전체를 "부분 실패"로 정직하게 표시).
        const failedSet = new Set<string>();
        for (const dLawdCd of lawdCds) {
          for (const m of months) {
            if (results[`${dLawdCd}|apt:${m}`]?.failed || results[`${dLawdCd}|rent:${m}`]?.failed) failedSet.add(dLawdCd);
          }
        }
        return { results, failedLawdCds: Array.from(failedSet), lawdCds, months };
      });

      partial = cached.failedLawdCds.length > 0;
      failedDistricts = cached.failedLawdCds;

      for (const dLawdCd of cached.lawdCds) {
        for (const m of cached.months) {
          for (const raw of cached.results[`${dLawdCd}|apt:${m}`]?.items || []) {
            const t = toFeedTrade(raw, 'sale', dLawdCd);
            if (t) allTrades.push(t);
          }
          for (const raw of cached.results[`${dLawdCd}|rent:${m}`]?.items || []) {
            const t = toFeedTrade(raw, raw.monthlyRent > 0 ? 'wolse' : 'jeonse', dLawdCd);
            if (t) allTrades.push(t);
          }
        }
      }
      allTrades = dedupeTrades(allTrades);
      // TOTAL_FAILURE — 모든 구가 실패했으면(부분이 아니라 전체) 정직하게 API
      // 에러로 보고한다(거래 0건과 절대 혼동하지 않는다).
      if (cached.failedLawdCds.length === cached.lawdCds.length && cached.lawdCds.length > 0) apiError = true;
    } else {
      // 신고가/직전거래 비교를 위해 조회 기간보다 최대 12개월 넓은 lookback을
      // 한 번에 fetch한다(기존 rankings/dashboard의 "최근 12개월" 관례와 동일한 폭).
      const lookbackFrom = subtractMonths(periodRange.from, MAX_LOOKBACK_MONTHS);
      fetchRange = { from: lookbackFrom, to: periodRange.to };
      const months = monthsForRange(fetchRange);

      const cacheKey = `stats-feed:${lawdCd}:${months.join(',')}`;
      const rawByMonth = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
        const tasks: MonthTask[] = [];
        for (const m of months) {
          tasks.push({ key: `apt:${m}`, lawdCd: lawdCd!, dealYmd: m, type: 'apt' });
          tasks.push({ key: `rent:${m}`, lawdCd: lawdCd!, dealYmd: m, type: 'rent' });
        }
        return fetchMonthsThrottled(tasks);
      });

      for (const m of months) {
        for (const raw of rawByMonth[`apt:${m}`] || []) {
          const t = toFeedTrade(raw, 'sale', lawdCd!);
          if (t) allTrades.push(t);
        }
        for (const raw of rawByMonth[`rent:${m}`] || []) {
          const t = toFeedTrade(raw, raw.monthlyRent > 0 ? 'wolse' : 'jeonse', lawdCd!);
          if (t) allTrades.push(t);
        }
      }
      allTrades = dedupeTrades(allTrades);
      if (dong !== 'all') allTrades = allTrades.filter((t) => t.dong === dong);

      // §39 API 실패 vs 거래 없음 구분 — period 안에 거래가 하나도 없을 때만, 그
      // period의 최신 달 하나를 직접(재시도 래퍼 우회) 한 번 더 찔러봐서 실제로
      // '에러' placeholder가 오는지 확인한다(추가 호출 1회, N+1 아님).
      const periodTradesProbe = allTrades.filter((t) => isDateInRange(t.dealDate, periodRange));
      if (periodTradesProbe.length === 0) {
        const periodMonths = monthsForRange(periodRange);
        const latestMonth = periodMonths[periodMonths.length - 1];
        try {
          const probe = await fetchMolitData({ type: 'apt', lawdCd: lawdCd!, dealYmd: latestMonth });
          apiError = probe.length === 1 && probe[0]?.typeLabel === '에러';
        } catch {
          apiError = true;
        }
      }
    }

    const periodTradesRaw = allTrades.filter((t) => isDateInRange(t.dealDate, periodRange));
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

    // §11/§20 — 실제 조회 범위(fetchRange)로부터 정직한 커버리지 라벨을 계산한다
    // (SIDO_ALL은 표시 기간뿐이라 짧고, 단일 구는 +12개월 lookback이 붙어 더
    // 넓다 — "신고가"라는 무제한 단어를 절대 단독으로 쓰지 않는다).
    const recordHighCoverageLabel = windowCoverageLabel(fetchRange.from, fetchRange.to);

    const lookbackVerified = filterVerifiedTrades(allTrades.filter((t) => isDateInRange(t.dealDate, fetchRange)));
    const interpretation = buildMarketInterpretation({
      periodLabel: presetLabel(preset),
      periodDays: daysBetween(periodRange.from, periodRange.to),
      summary,
      lookbackVerifiedCount: lookbackVerified.length,
      lookbackDays: daysBetween(fetchRange.from, fetchRange.to),
      dongCounts,
      areaBandCounts,
      recordHighCoverageLabel,
    });

    // 정렬(최신순) 후 페이지네이션 — 한 번에 수천 건 반환하지 않는다(§31).
    const sorted = [...periodTrades].sort((a, b) => (b.dealDate === a.dealDate ? b.dealAmount - a.dealAmount : b.dealDate.localeCompare(a.dealDate)));
    const page = sorted.slice(offset, offset + limit);

    // §8/§18 — 페이지에 보이는 거래들의 단지 identity만 모아 세대수/입주연도를
    // batch 조회한다(페이지당 최대 limit건이지만 단지 identity 기준 dedup 후
    // 쿼리 1쌍 고정 — 거래 row 개수만큼 DB를 조회하지 않는다, N+1 금지).
    const contextKeysMap = new Map<string, ContextLookupKey>();
    for (const t of page) {
      const k: ContextLookupKey = { name: t.name, dong: t.dong, aptSeq: t.aptSeq, rawAreaM2: 0 };
      contextKeysMap.set(identityKey(t), k);
    }
    const contextMap = await resolveApartmentContextBatch(prisma, Array.from(contextKeysMap.values()));

    const enriched = page.map((t) => {
      const a = annotations.get(t.uid);
      const ctx = contextMap.get(`${t.aptSeq || ''}|${t.name}|${t.dong}|0`) ?? null;
      // mini trend(§9) — 같은 그룹(identity+area+dealType) 최근 검증 거래가
      // 3건 이상일 때만 노출한다. 취소 거래 자신은 애초에 annotations에 없어
      // recentTrend가 undefined가 되므로 자동으로 숨겨진다.
      const trend = !t.dealCanceled && a && a.recentTrend.length >= 3 ? a.recentTrend : null;
      return {
        ...t,
        priceLabel: formatKoreanPrice(String(t.dealAmount)),
        isRecordHigh: !t.dealCanceled && (a?.isRecordHigh ?? false),
        previousTrade: t.dealCanceled ? null : a?.previousTrade ?? null,
        changeAmount: t.dealCanceled ? null : a?.changeAmount ?? null,
        changePct: t.dealCanceled ? null : a?.changePct ?? null,
        recentTrend: trend,
        totalHouseholds: ctx?.totalHouseholds ?? null,
        approvalDate: ctx?.approvalDate ?? null,
      };
    });
    const groups = groupTradesByDate(enriched as any);

    return NextResponse.json({
      status: 'OK',
      region: { lawdCd, sidoCode: isSidoAll ? sidoCodeParam : (lawdCd ? lawdCd.substring(0, 2) : null), dong: isSidoAll ? 'all' : dong, sidoAll: isSidoAll },
      period: { preset, from: periodRange.from, to: periodRange.to, label: presetLabel(preset) },
      summary,
      interpretation,
      topDongs: Object.entries(dongCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
      topAreaBands: Object.entries(areaBandCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
      groups,
      pagination: { offset, limit, total: sorted.length, hasMore: offset + limit < sorted.length },
      apiError,
      // §19 신고가/직전거래 비교가 실제로 어느 기간을 기준으로 이뤄졌는지 명시한다
      // (부산/서울 전체 조회는 성능상 lookback을 표시 기간과 동일하게 좁혀서
      // "역대 신고가"가 아니라 "표시 기간 내 신고가"에 가깝다 — §18 정의 왜곡
      // 방지, 절대 12개월 기준인 것처럼 오해시키지 않는다).
      recordHighWindow: { from: fetchRange.from, to: fetchRange.to },
      recordHighCoverageLabel,
      // §35/36 — 부분 실패(일부 구만 실패)와 전체 실패(apiError)를 구분해 알린다.
      // sido-all이 아니면 항상 false/빈 배열(단일 구 조회는 부분 실패 개념이 없음).
      partial,
      failedDistricts,
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
