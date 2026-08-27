import { NextResponse } from 'next/server';
import { formatKoreanPrice, fetchMolitData } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, fetchMonthsThrottled, fetchMonthsThrottledWithStatus, MonthTask } from '@/lib/molit-stats-helpers';
import { getSigunguListForSido } from '@/lib/region-utils';
import { prisma } from '@/lib/prisma';
import { resolveApartmentContextBatch, resolveTrustworthyPyeongBatch, pyeongLookupKeyId, type PyeongLookupKey } from '@/lib/statistics-pyeong-resolver';
import {
  resolvePriceRankingPeriod,
  type PriceRankingPeriodPreset,
} from '@/lib/price-ranking';
import {
  previousPeriodRange,
  monthsForRange,
  isDateInRange,
  toFeedTrade,
  dedupeTrades,
  buildConcentrationRanking,
  type FeedTrade,
} from '@/lib/regional-feed';

// STATISTICS V2.1-2 §19/§20 — "거래집중": 기간 내 같은 단지에 실제 거래가 몇 건
// 있었는지(정상 거래만) 집계한다. 기존 rankings.ts의 top-traded는 "months"(월
// 단위, day-precise 아님) 하나만 지원했는데, 이 화면은 아실 "많이산단지"
// benchmark처럼 7일/30일/3개월 같은 짧은 day-precise 기간과 "직전 동일 기간
// 대비 증감"이 핵심이라 feed와 동일한 day-precise fetch/period 인프라
// (regional-feed.ts)를 그대로 재사용한다 — 새 fetch 메커니즘을 만들지 않는다.
export const dynamic = 'force-dynamic';

const VALID_PRESETS: PriceRankingPeriodPreset[] = ['7d', '30d', '3m', '6m', '12m'];
const MAX_ENTRIES = 30;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lawdCdParam = searchParams.get('lawdCd');
  const sidoCodeParam = searchParams.get('sidoCode');
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  const dong = searchParams.get('dong') || 'all';
  const presetParam = searchParams.get('period') || '30d';
  const preset: PriceRankingPeriodPreset = (VALID_PRESETS as string[]).includes(presetParam) ? (presetParam as PriceRankingPeriodPreset) : '30d';
  const dealTypeParam = searchParams.get('dealType');
  const dealType: 'sale' | 'jeonse' | 'wolse' = dealTypeParam === 'jeonse' || dealTypeParam === 'wolse' ? dealTypeParam : 'sale';
  const sortParam = searchParams.get('sort');
  const sort: 'count' | 'delta' | 'latest' = sortParam === 'delta' || sortParam === 'latest' ? sortParam : 'count';
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
    const currentRange = resolvePriceRankingPeriod(preset, now);
    const previousRange = previousPeriodRange(currentRange);
    // §18/§32 — 이전 기간까지 한 번에 커버하는 fetch 범위(끊기지 않는 연속 구간).
    const fetchRange = { from: previousRange.from, to: currentRange.to };
    const apiType: 'apt' | 'rent' = dealType === 'sale' ? 'apt' : 'rent';

    let allTrades: FeedTrade[] = [];
    let apiError = false;
    let partial = false;
    let failedDistricts: string[] = [];

    if (isSidoAll) {
      const months = monthsForRange(fetchRange);
      const districts = await getSigunguListForSido(sidoCodeParam!);
      const lawdCds = districts.map((d) => d.code.substring(0, 5));

      const cacheKey = `stats-concentration-sido:${sidoCodeParam}:${apiType}:${months.join(',')}`;
      const cached = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
        const tasks: MonthTask[] = [];
        for (const dLawdCd of lawdCds) {
          for (const m of months) tasks.push({ key: `${dLawdCd}|${m}`, lawdCd: dLawdCd, dealYmd: m, type: apiType });
        }
        const results = await fetchMonthsThrottledWithStatus(tasks);
        const failedSet = new Set<string>();
        for (const dLawdCd of lawdCds) {
          for (const m of months) if (results[`${dLawdCd}|${m}`]?.failed) failedSet.add(dLawdCd);
        }
        return { results, failedLawdCds: Array.from(failedSet), lawdCds, months };
      });

      partial = cached.failedLawdCds.length > 0;
      failedDistricts = cached.failedLawdCds;

      for (const dLawdCd of cached.lawdCds) {
        for (const m of cached.months) {
          for (const raw of cached.results[`${dLawdCd}|${m}`]?.items || []) {
            const t = toFeedTrade(raw, dealType === 'sale' ? 'sale' : raw.monthlyRent > 0 ? 'wolse' : 'jeonse', dLawdCd);
            if (t) allTrades.push(t);
          }
        }
      }
      allTrades = dedupeTrades(allTrades);
      if (cached.failedLawdCds.length === cached.lawdCds.length && cached.lawdCds.length > 0) apiError = true;
    } else {
      const months = monthsForRange(fetchRange);
      const cacheKey = `stats-concentration:${lawdCd}:${apiType}:${months.join(',')}`;
      const rawByMonth = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
        const tasks: MonthTask[] = months.map((m) => ({ key: m, lawdCd: lawdCd!, dealYmd: m, type: apiType }));
        return fetchMonthsThrottled(tasks);
      });
      for (const m of months) {
        for (const raw of rawByMonth[m] || []) {
          const t = toFeedTrade(raw, dealType === 'sale' ? 'sale' : raw.monthlyRent > 0 ? 'wolse' : 'jeonse', lawdCd!);
          if (t) allTrades.push(t);
        }
      }
      allTrades = dedupeTrades(allTrades);
      if (dong !== 'all') allTrades = allTrades.filter((t) => t.dong === dong);

      // §36 — API 실패 vs 거래 없음 구분(feed와 동일 원칙).
      const currentProbe = allTrades.filter((t) => isDateInRange(t.dealDate, currentRange));
      if (currentProbe.length === 0) {
        const currentMonths = monthsForRange(currentRange);
        const latestMonth = currentMonths[currentMonths.length - 1];
        try {
          const probe = await fetchMolitData({ type: apiType, lawdCd: lawdCd!, dealYmd: latestMonth });
          apiError = probe.length === 1 && (probe[0] as any)?.typeLabel === '에러';
        } catch {
          apiError = true;
        }
      }
    }

    // dealType==='jeonse'|'wolse' 필터: rent 타입 원본은 전세/월세가 섞여 오므로
    // toFeedTrade에서 이미 monthlyRent 유무로 분류했다 — 요청한 dealType만 남긴다.
    if (dealType !== 'sale') {
      allTrades = allTrades.filter((t) => t.dealType === dealType);
    }

    const currentTrades = allTrades.filter((t) => isDateInRange(t.dealDate, currentRange));
    const previousTrades = allTrades.filter((t) => isDateInRange(t.dealDate, previousRange));

    const entries = buildConcentrationRanking(currentTrades, previousTrades);
    const sorted = [...entries].sort((a, b) => {
      if (sort === 'delta') return b.deltaCount - a.deltaCount;
      if (sort === 'latest') return b.latestDealDate.localeCompare(a.latestDealDate);
      return b.currentCount - a.currentCount;
    });
    const top = sorted.slice(0, MAX_ENTRIES);

    // §8/§18/§24 — 상위 항목만 세대수/입주연도 + trustworthy 대표평형(최근 거래
    // 면적 기준) batch 조회. 페이지당 최대 MAX_ENTRIES건이라 쿼리 2쌍 고정.
    const contextKeys: PyeongLookupKey[] = top.map((e) => ({ name: e.name, dong: e.dong, aptSeq: e.aptSeq, rawAreaM2: 0 }));
    const pyeongKeys: PyeongLookupKey[] = top
      .filter((e) => e.latestExcluUseArea != null)
      .map((e) => ({ name: e.name, dong: e.dong, aptSeq: e.aptSeq, rawAreaM2: e.latestExcluUseArea as number }));
    const [contextMap, pyeongMap] = await Promise.all([
      resolveApartmentContextBatch(prisma, contextKeys),
      resolveTrustworthyPyeongBatch(prisma, pyeongKeys),
    ]);

    const rows = top.map((e, i) => {
      const ctx = contextMap.get(`${e.aptSeq || ''}|${e.name}|${e.dong}|0`) ?? null;
      const pyung = e.latestExcluUseArea != null ? pyeongMap.get(pyeongLookupKeyId({ name: e.name, dong: e.dong, aptSeq: e.aptSeq, rawAreaM2: e.latestExcluUseArea })) ?? null : null;
      return {
        rank: i + 1,
        name: e.name,
        dong: e.dong,
        lawdCd: e.lawdCd,
        currentCount: e.currentCount,
        previousCount: e.previousCount,
        deltaCount: e.deltaCount,
        latestDealAmount: e.latestDealAmount,
        latestPriceLabel: formatKoreanPrice(String(e.latestDealAmount)),
        latestDealDate: e.latestDealDate,
        latestExcluUseArea: e.latestExcluUseArea,
        latestPyung: pyung,
        totalHouseholds: ctx?.totalHouseholds ?? null,
        approvalDate: ctx?.approvalDate ?? null,
      };
    });

    return NextResponse.json({
      status: 'OK',
      region: { lawdCd, sidoCode: isSidoAll ? sidoCodeParam : (lawdCd ? lawdCd.substring(0, 2) : null), dong: isSidoAll ? 'all' : dong, sidoAll: isSidoAll },
      dealType,
      period: { preset, from: currentRange.from, to: currentRange.to },
      previousPeriod: { from: previousRange.from, to: previousRange.to },
      entries: rows,
      complexCount: entries.length,
      apiError,
      partial,
      failedDistricts,
    });
  } catch (error) {
    console.error('Failed to load trade concentration ranking:', error);
    return NextResponse.json({ status: 'ERROR', message: '거래집중 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
