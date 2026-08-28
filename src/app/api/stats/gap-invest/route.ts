import { NextResponse } from 'next/server';
import { formatKoreanPrice, fetchMolitData } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, fetchMonthsThrottledWithStatus, MonthTask } from '@/lib/molit-stats-helpers';
import { getSigunguListForSido } from '@/lib/region-utils';
import { prisma } from '@/lib/prisma';
import { resolveTrustworthyPyeongBatch, resolveApartmentContextBatch, pyeongLookupKeyId, type PyeongLookupKey } from '@/lib/statistics-pyeong-resolver';
import { resolvePriceRankingPeriod, type PriceRankingPeriodPreset } from '@/lib/price-ranking';
import { previousPeriodRange } from '@/lib/regional-feed';
import {
  buildGapTradeEvents,
  gapEventGroupKey,
  median,
  type GapTrade,
  type GapTradeEvent,
} from '@/lib/gap-invest-calc';

// STATISTICS V2.1-3 — GAP INVESTMENT REGION RANKING. "어느 지역에서 갭투자
// 형태 거래가 늘고 있는가"가 핵심 질문이다(§1/§27). dashboard/route.ts와
// 동일하게 12개월 apt+rent를 한 번만 fetch해(§39 N+1 금지, 기존 아키텍처
// 재사용) 지역 랭킹/단지 랭킹/월별 추이/이전 기간 비교를 전부 그 위에서
// 메모리 계산으로 처리한다 — 필터를 바꿔도 재fetch 없음.
export const dynamic = 'force-dynamic';

const VALID_PRESETS: PriceRankingPeriodPreset[] = ['30d', '3m', '6m', '12m'];
// §8/§13 — 이전 기간 비교는 (period 길이 × 2)가 이미 fetch해둔 12개월 안에
// 들어올 때만 정직하게 계산할 수 있다. 12m은 두 배(24개월)가 fetch 범위를
// 벗어나므로 비교를 제공하지 않는다(dashboard의 VOLUME_COMPARISON_PRESETS와
// 동일한 원칙, §18 절대 사용 안 함 원칙과 동일선상).
const COMPARISON_ELIGIBLE_PRESETS = new Set<PriceRankingPeriodPreset>(['30d', '3m', '6m']);
const REGION_RANKING_LIMIT = 30;
const APARTMENT_RANKING_LIMIT = 30;

function toGapTrade(item: any, lawdCd: string): GapTrade | null {
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lawdCdParam = searchParams.get('lawdCd');
  const sidoCodeParam = searchParams.get('sidoCode');
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  const dong = searchParams.get('dong') || 'all';
  const presetParam = searchParams.get('period') || '3m';
  const preset: PriceRankingPeriodPreset = (VALID_PRESETS as string[]).includes(presetParam) ? (presetParam as PriceRankingPeriodPreset) : '3m';
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
    const last12Months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
      return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    let aptMonthly: any[][];
    let rentMonthly: any[][];
    let partial = false;
    let failedLawdCds: string[] = [];
    let totalDistrictCount = 0;
    let apiError = false;
    const sigunguNameByLawdCd = new Map<string, string>();

    if (isSidoAll) {
      const districts = await getSigunguListForSido(sidoCodeParam!);
      const lawdCds = districts.map((d) => d.code.substring(0, 5));
      for (const d of districts) sigunguNameByLawdCd.set(d.code.substring(0, 5), d.name.split(' ').slice(1).join(' '));

      const cacheKey = `stats-gap-invest-sido:${sidoCodeParam}`;
      const data = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
        const tasks: MonthTask[] = [];
        for (const dLawdCd of lawdCds) {
          for (const ym of last12Months) {
            tasks.push({ key: `${dLawdCd}|apt:${ym}`, lawdCd: dLawdCd, dealYmd: ym, type: 'apt' });
            tasks.push({ key: `${dLawdCd}|rent:${ym}`, lawdCd: dLawdCd, dealYmd: ym, type: 'rent' });
          }
        }
        const results = await fetchMonthsThrottledWithStatus(tasks);
        const failedSet = new Set<string>();
        for (const dLawdCd of lawdCds) {
          for (const ym of last12Months) {
            if (results[`${dLawdCd}|apt:${ym}`]?.failed || results[`${dLawdCd}|rent:${ym}`]?.failed) failedSet.add(dLawdCd);
          }
        }
        return {
          failedLawdCds: Array.from(failedSet),
          aptByMonth: last12Months.map((ym) => lawdCds.flatMap((d) => (results[`${d}|apt:${ym}`]?.items || []).map((t: any) => ({ ...t, lawdCd: d })))),
          rentByMonth: last12Months.map((ym) => lawdCds.flatMap((d) => (results[`${d}|rent:${ym}`]?.items || []).map((t: any) => ({ ...t, lawdCd: d })))),
        };
      });
      failedLawdCds = data.failedLawdCds;
      totalDistrictCount = lawdCds.length;
      partial = failedLawdCds.length > 0;
      // §36 총 실패(모든 구 실패) vs 부분 실패 구분 — 다른 sido-all 라우트와 동일 관례.
      apiError = totalDistrictCount > 0 && failedLawdCds.length === totalDistrictCount;
      aptMonthly = data.aptByMonth;
      rentMonthly = data.rentByMonth;
    } else {
      const cacheKey = `stats-gap-invest:${lawdCd}`;
      const data = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
        const tasks: MonthTask[] = [
          ...last12Months.map((ym) => ({ key: `apt:${ym}`, lawdCd: lawdCd!, dealYmd: ym, type: 'apt' as const })),
          ...last12Months.map((ym) => ({ key: `rent:${ym}`, lawdCd: lawdCd!, dealYmd: ym, type: 'rent' as const })),
        ];
        const results = await fetchMonthsThrottledWithStatus(tasks);
        return {
          aptByMonth: last12Months.map((ym) => (results[`apt:${ym}`]?.items || []).map((t: any) => ({ ...t, lawdCd }))),
          rentByMonth: last12Months.map((ym) => (results[`rent:${ym}`]?.items || []).map((t: any) => ({ ...t, lawdCd }))),
        };
      });
      aptMonthly = data.aptByMonth;
      rentMonthly = data.rentByMonth;
    }

    const allAptRaw = aptMonthly.flat();
    const allRentRaw = rentMonthly.flat();
    let saleTrades = allAptRaw.map((t) => toGapTrade(t, t.lawdCd)).filter((t): t is GapTrade => t != null && !t.dealCanceled);
    const pureJeonseTrades = allRentRaw.map((t) => toGapTrade(t, t.lawdCd)).filter((t): t is GapTrade => t != null && !t.dealCanceled && (!t.monthlyRent || t.monthlyRent === 0));

    if (!isSidoAll && dong !== 'all') {
      saleTrades = saleTrades.filter((t) => t.dong === dong);
    }

    // §39 API 실패 vs 거래 없음 구분(단일 구) — 진단성 probe(추가 호출 1회, N+1 아님).
    if (!isSidoAll && saleTrades.length === 0 && pureJeonseTrades.length === 0) {
      try {
        const probe = await fetchMolitData({ type: 'apt', lawdCd: lawdCd!, dealYmd: last12Months[last12Months.length - 1] });
        apiError = probe.length === 1 && (probe[0] as any)?.typeLabel === '에러';
      } catch {
        apiError = true;
      }
    }

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
    type RegionRow = { code: string; name: string; gapCount: number; totalSaleCount: number; ratioPct: number | null; previousCount: number | null };
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

    const sortParam = searchParams.get('sort') || 'count';
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

    // PERF §39 — Unit Master/세대수 batch 조회는 실제로 노출되는 단지 랭킹
    // 페이지(최대 30건)에만 수행한다(price-rankings의 교훈 재사용).
    const pyeongKeys: PyeongLookupKey[] = apartmentRankingTop.map((r) => ({ name: r.name, dong: r.dong, aptSeq: r.aptSeq, rawAreaM2: r.exclusiveAreaM2 }));
    const contextKeys = apartmentRankingTop.map((r) => ({ name: r.name, dong: r.dong, aptSeq: r.aptSeq }));
    const [pyeongMap, contextMap] = await Promise.all([
      resolveTrustworthyPyeongBatch(prisma, pyeongKeys),
      resolveApartmentContextBatch(prisma, contextKeys),
    ]);
    const apartmentRanking = apartmentRankingTop.map((r, i) => {
      const pyung = pyeongMap.get(pyeongLookupKeyId({ name: r.name, dong: r.dong, aptSeq: r.aptSeq, rawAreaM2: r.exclusiveAreaM2 })) ?? null;
      const ctx = contextMap.get(`${r.aptSeq || ''}|${r.name}|${r.dong}|0`) ?? null;
      return {
        rank: i + 1,
        ...r,
        pyung,
        saleLabel: formatKoreanPrice(String(r.saleAmount)),
        jeonseLabel: formatKoreanPrice(String(r.jeonseAmount)),
        gapLabel: formatKoreanPrice(String(r.gap)),
        totalHouseholds: ctx?.totalHouseholds ?? null,
        approvalDate: ctx?.approvalDate ?? null,
      };
    });

    // ── 월별 추이(§30) — 전체 12개월 이벤트를 월별로 묶는다(period와 무관하게 항상 12개월). ──
    const monthlyTrend = last12Months.map((ym) => ({
      month: `${ym.substring(2, 4)}.${ym.substring(4, 6)}`,
      count: allEvents.filter((e) => e.saleDate.replace(/-/g, '').substring(0, 6) === ym).length,
    }));

    return NextResponse.json({
      status: 'OK',
      region: { lawdCd, sidoCode: isSidoAll ? sidoCodeParam : lawdCd ? lawdCd.substring(0, 2) : null, dong: isSidoAll ? 'all' : dong, sidoAll: isSidoAll },
      scope: regionScope,
      period: { preset, from: period.from, to: period.to },
      previousPeriod: previousRange,
      maxDayGap: 90,
      summary,
      regionRanking,
      apartmentRanking,
      monthlyTrend,
      apiError,
      partial,
      failedDistricts: failedLawdCds,
    });
  } catch (error) {
    console.error('Failed to load gap invest insights:', error);
    return NextResponse.json({ status: 'ERROR', message: '갭투자 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
