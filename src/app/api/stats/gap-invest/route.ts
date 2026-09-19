import { NextResponse } from 'next/server';
import { isStatsEnabledLawdCd } from '@/lib/region/enablement';
import { isStatsRegionSupported, statsUnsupportedStatusBody } from '@/lib/region/stats-gate';
import { formatKoreanPrice, fetchMolitData } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, fetchMonthsThrottledWithStatus, MonthTask } from '@/lib/molit-stats-helpers';
import { getSigunguListForSido } from '@/lib/region-utils';
import { prisma, warmupConnections } from '@/lib/prisma';
import { resolveTrustworthyPyeongBatch, resolveApartmentContextBatch, pyeongLookupKeyId, type PyeongLookupKey } from '@/lib/statistics-pyeong-resolver';
import { type PriceRankingPeriodPreset } from '@/lib/price-ranking';
import { computeGapInvestInsights, toGapInputs } from '@/lib/stats/gap-invest-insights';
import { loadGapInvestSidoRaw, resolveSidoApiError, type GapInvestDataSource } from '@/lib/stats/gap-invest-db-source';
import { isFeedDbBackedSido } from '@/lib/stats/feed-db-source';
import { getRegionalSaleRowsForFeedFromDb } from '@/lib/trade-history-read';
import { fetchRentMonthBucketsFromDb, getRentVerifiedRange } from '@/lib/rent-history-read';
import { loadVerifiedSaleCellKeys } from '@/lib/sync-coverage';

// STATISTICS V2.1-3 — GAP INVESTMENT REGION RANKING. "어느 지역에서 갭투자
// 형태 거래가 늘고 있는가"가 핵심 질문이다(§1/§27). dashboard/route.ts와
// 동일하게 12개월 apt+rent를 한 번만 fetch해(§39 N+1 금지, 기존 아키텍처
// 재사용) 지역 랭킹/단지 랭킹/월별 추이/이전 기간 비교를 전부 그 위에서
// 메모리 계산으로 처리한다 — 필터를 바꿔도 재fetch 없음.
//
// GAP_INVEST_BUSAN_DB_FIRST_V1 — 부산 전체는 검증된 (구, 월) 셀을 DB에서, 나머지(현재월 등)만
// MOLIT에서 읽는다(src/lib/stats/gap-invest-db-source.ts). 집계는 원본 소스와 무관하게
// src/lib/stats/gap-invest-insights.ts의 같은 함수 하나로 계산한다.
export const dynamic = 'force-dynamic';

const VALID_PRESETS: PriceRankingPeriodPreset[] = ['30d', '3m', '6m', '12m'];

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

  // NON_BUSAN_STATS_TRUST_GATE_V1 — 통계가 열리지 않은 지역은 캐시·DB·MOLIT에 닿기 전에 돌려보낸다.
  if (!isStatsRegionSupported({ lawdCd: lawdCdParam, sidoCode: sidoCodeParam, sidoName: sido })) {
    return NextResponse.json(statsUnsupportedStatusBody());
  }

  try {
    let lawdCd: string | null = null;
    if (!isSidoAll) {
      lawdCd = lawdCdParam && /^\d{5}$/.test(lawdCdParam) ? lawdCdParam : await resolveLawdCd(sido, gungu);
      if (!lawdCd) {
        return NextResponse.json({ status: 'ERROR', message: `"${sido} ${gungu}" 지역 코드를 찾을 수 없습니다.` }, { status: 400 });
      }
      if (!isStatsEnabledLawdCd(lawdCd)) return NextResponse.json(statsUnsupportedStatusBody());
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
    let dataSource: GapInvestDataSource | null = null;
    const sigunguNameByLawdCd = new Map<string, string>();

    if (isSidoAll) {
      const districts = await getSigunguListForSido(sidoCodeParam!);
      const lawdCds = districts.map((d) => d.code.substring(0, 5));
      for (const d of districts) sigunguNameByLawdCd.set(d.code.substring(0, 5), d.name.split(' ').slice(1).join(' '));

      const dbBacked = isFeedDbBackedSido(sidoCodeParam);
      // 캐시에 담는 값에 dataSource가 추가돼 v2로 올린다. 창(월 목록)을 키에 넣어 달이 바뀐
      // 직후 이전 창의 원본을 5분간 재사용하지 않게 한다(TTL 5분은 그대로).
      const cacheKey = `stats-gap-invest-sido:v2:${sidoCodeParam}:${last12Months.join(',')}`;
      const data = await getOrSetCache(cacheKey, 5 * 60 * 1000, () =>
        loadGapInvestSidoRaw(
          // 현재월 = 요청 창의 마지막 달(last12Months와 같은 기준으로 계산된 값).
          { lawdCds, months: last12Months, currentMonth: last12Months[last12Months.length - 1], dbBacked },
          {
            loadVerifiedSaleCellKeys,
            getRentVerifiedRange,
            loadSaleRows: getRegionalSaleRowsForFeedFromDb,
            loadRentBuckets: fetchRentMonthBucketsFromDb,
            fetchMolit: fetchMonthsThrottledWithStatus,
            warmup: () => warmupConnections(2),
            logError: (message, error) => console.error(message, error),
          }
        )
      );
      failedLawdCds = data.failedLawdCds;
      totalDistrictCount = lawdCds.length;
      partial = failedLawdCds.length > 0;
      // §36 총 실패(모든 구 실패) vs 부분 실패 구분 — 다른 sido-all 라우트와 동일 관례.
      // DB로 읽은 셀이 있으면 총 실패로 올리지 않는다(resolveSidoApiError 주석 참고).
      apiError = resolveSidoApiError(data, totalDistrictCount);
      aptMonthly = data.aptByMonth;
      rentMonthly = data.rentByMonth;
      dataSource = data.dataSource;
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

    const { saleTrades, pureJeonseTrades } = toGapInputs(aptMonthly.flat(), rentMonthly.flat(), { isSidoAll, dong });

    // §39 API 실패 vs 거래 없음 구분(단일 구) — 진단성 probe(추가 호출 1회, N+1 아님).
    if (!isSidoAll && saleTrades.length === 0 && pureJeonseTrades.length === 0) {
      try {
        const probe = await fetchMolitData({ type: 'apt', lawdCd: lawdCd!, dealYmd: last12Months[last12Months.length - 1] });
        apiError = probe.length === 1 && (probe[0] as any)?.typeLabel === '에러';
      } catch {
        apiError = true;
      }
    }

    const { period, previousRange, summary, regionScope, regionRanking, apartmentRankingTop, monthlyTrend } = computeGapInvestInsights({
      saleTrades,
      pureJeonseTrades,
      isSidoAll,
      dong,
      preset,
      now,
      last12Months,
      sigunguNameByLawdCd,
      sort: searchParams.get('sort') || 'count',
    });

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
      // GAP_INVEST_BUSAN_DB_FIRST_V1 — 추가 전용 필드(기존 필드 불변). 시도 전체 응답이 어느
      // 셀을 DB/MOLIT에서 읽었는지 드러낸다(provenance). 단일 구 경로는 기존 MOLIT 그대로라 null.
      dataSource,
    });
  } catch (error) {
    console.error('Failed to load gap invest insights:', error);
    return NextResponse.json({ status: 'ERROR', message: '갭투자 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
