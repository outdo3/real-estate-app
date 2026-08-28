import { NextResponse } from 'next/server';
import { formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { fetchMonthsThrottledWithStatus, type MonthTask } from '@/lib/molit-stats-helpers';
import { getSigunguListForSido, getSidoList, resolveRegionNameByLawdCd } from '@/lib/region-utils';
import {
  resolveRegionChangeWindows,
  regionChangeFetchMonths,
  buildRegionChangePairs,
  buildComplexChangeRows,
  aggregateChangeByBucket,
  buildRegionChangeInterpretation,
  periodLabelOf,
  MIN_SAMPLE_PAIRS,
  type FeedTrade,
  type RegionChangePeriodPreset,
} from '@/lib/region-change';

// REGION_PRICE_CHANGE_MAP_V2 — "지역 변동지도". 세 가지 level만 서버에서
// 계산한다(§10 LEVEL 0/1은 클라이언트가 이 API를 시도별로 여러 번 호출해
// 조립한다 — §35 nationwide eager fan-out 금지 원칙):
//   - level=sigungu&sidoCode=XX : 그 시도 전체(모든 구/군) fetch, overall
//     1개 + 구/군별 breakdown. 대한민국 전체 화면은 이 API를 시도 17개에 대해
//     각각 호출해 overall만 읽어 타일을 채운다(시도 하나하나가 독립 요청이라
//     느린 시도가 전체를 막지 않는다).
//   - level=dong&lawdCd=XXXXX : 그 구/군 전체 fetch, overall 1개 + 동별 breakdown.
//   - level=complex&lawdCd=XXXXX(&dong=옵션) : 단지별 row 목록(§14).
export const dynamic = 'force-dynamic';

const VALID_PERIODS: RegionChangePeriodPreset[] = ['1m', '3m', '6m', '12m'];
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function toFeedTrade(item: any, lawdCd: string): FeedTrade | null {
  if (!item || item.typeLabel === '에러' || !(item.dealAmount > 0)) return null;
  return {
    uid: item.id,
    aptSeq: item.aptSeq ?? null,
    name: item.name,
    dong: item.dong || '',
    lawdCd,
    dealType: 'sale',
    dealAmount: item.dealAmount,
    excluUseArea: item.excluUseArea ?? null,
    floorRaw: item.floorRaw ?? null,
    dealDate: item.dealDate,
    dealCanceled: !!item.dealCanceled,
  };
}

function round1(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10) / 10;
}

function roundBucket<T extends { medianPct: number | null; minPct: number | null; maxPct: number | null }>(b: T): T {
  return { ...b, medianPct: round1(b.medianPct), minPct: round1(b.minPct), maxPct: round1(b.maxPct) };
}

async function fetchDistrictTrades(lawdCd: string, months: string[]): Promise<{ trades: FeedTrade[]; failed: boolean }> {
  const cacheKey = `region-change-district:${lawdCd}:${months[0]}-${months[months.length - 1]}`;
  const rawByMonth = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
    const tasks: MonthTask[] = months.map((m) => ({ key: m, lawdCd, dealYmd: m, type: 'apt' as const }));
    return fetchMonthsThrottledWithStatus(tasks);
  });
  const trades: FeedTrade[] = [];
  let anyOk = false;
  for (const m of months) {
    const entry = rawByMonth[m];
    if (entry && !entry.failed) anyOk = true;
    for (const raw of entry?.items || []) {
      const t = toFeedTrade(raw, lawdCd);
      if (t) trades.push(t);
    }
  }
  return { trades, failed: !anyOk };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const level = searchParams.get('level');
  if (level !== 'nation' && level !== 'sigungu' && level !== 'dong' && level !== 'complex') {
    return NextResponse.json({ status: 'ERROR', message: 'level 파라미터가 필요합니다(nation|sigungu|dong|complex).' }, { status: 400 });
  }

  // §11 LEVEL 0 — 대한민국 화면이 17개 시도 타일을 조립하려면 시도 code/name
  // 목록이 먼저 필요하다. 거래 fetch 없이 REGCODE_PROXY 1회 호출만으로 즉시
  // 응답한다(getSidoList 자체가 in-memory 캐시라 반복 호출도 저렴하다).
  if (level === 'nation') {
    const sidos = await getSidoList();
    return NextResponse.json({ status: 'OK', level: 'nation', sidos });
  }

  const presetParam = searchParams.get('period') || '3m';
  const preset: RegionChangePeriodPreset = (VALID_PERIODS as string[]).includes(presetParam) ? (presetParam as RegionChangePeriodPreset) : '3m';
  const periodLabel = periodLabelOf(preset);
  const now = new Date();
  const windows = resolveRegionChangeWindows(preset, now);
  const months = regionChangeFetchMonths(preset, now);

  try {
    if (level === 'sigungu') {
      const sidoCode = searchParams.get('sidoCode');
      if (!sidoCode || !/^\d{2}$/.test(sidoCode)) {
        return NextResponse.json({ status: 'ERROR', message: 'sidoCode 파라미터가 필요합니다.' }, { status: 400 });
      }
      const districts = await getSigunguListForSido(sidoCode);
      if (districts.length === 0) {
        return NextResponse.json({ status: 'ERROR', message: `시도코드 "${sidoCode}"의 시군구 목록을 찾을 수 없습니다.` }, { status: 400 });
      }
      const sigunguNameByLawdCd = new Map<string, string>();
      const lawdCds = districts.map((d) => {
        const lawdCd = d.code.substring(0, 5);
        sigunguNameByLawdCd.set(lawdCd, d.name.split(' ').slice(1).join(' '));
        return lawdCd;
      });
      const sidoName = districts[0].name.split(' ')[0];

      const results = await Promise.all(lawdCds.map((lawdCd) => fetchDistrictTrades(lawdCd, months)));
      const failedDistricts = lawdCds.filter((_, i) => results[i].failed);
      const allTrades = results.flatMap((r) => r.trades);
      const partial = failedDistricts.length > 0;
      const apiError = failedDistricts.length === lawdCds.length && lawdCds.length > 0;

      const pairs = buildRegionChangePairs(allTrades, windows);
      const overallBuckets = aggregateChangeByBucket(pairs, () => 'overall', () => sidoName);
      const districtBuckets = aggregateChangeByBucket(
        pairs,
        (p) => p.lawdCd,
        (key) => sigunguNameByLawdCd.get(key) || key
      );
      const interpretation = buildRegionChangeInterpretation(districtBuckets, sidoName, periodLabel);

      return NextResponse.json({
        status: 'OK',
        level: 'sigungu',
        sidoCode,
        sidoName,
        period: { preset, label: periodLabel, current: windows.current, previous: windows.previous },
        minSamplePairs: MIN_SAMPLE_PAIRS,
        overall: overallBuckets[0] ? roundBucket(overallBuckets[0]) : null,
        districts: districtBuckets.sort((a, b) => a.label.localeCompare(b.label, 'ko')).map(roundBucket),
        interpretation,
        callBudget: { districtsFetched: lawdCds.length, monthsFetched: months.length },
        apiError,
        partial,
        failedDistricts,
      });
    }

    if (level === 'dong') {
      const lawdCd = searchParams.get('lawdCd');
      if (!lawdCd || !/^\d{5}$/.test(lawdCd)) {
        return NextResponse.json({ status: 'ERROR', message: 'lawdCd 파라미터가 필요합니다.' }, { status: 400 });
      }
      const [{ trades, failed }, regionName] = await Promise.all([fetchDistrictTrades(lawdCd, months), resolveRegionNameByLawdCd(lawdCd)]);
      const sigunguLabel = regionName?.sigungu || regionName?.fullName || lawdCd;
      const sidoLabel = regionName?.sido || '';
      const pairs = buildRegionChangePairs(trades, windows);
      const overallBuckets = aggregateChangeByBucket(pairs, () => 'overall', () => sigunguLabel);
      const dongBuckets = aggregateChangeByBucket(
        pairs,
        (p) => p.dong || '(동 정보 없음)',
        (key) => key
      );
      const interpretation = buildRegionChangeInterpretation(dongBuckets, sigunguLabel, periodLabel);

      return NextResponse.json({
        status: 'OK',
        level: 'dong',
        lawdCd,
        sidoName: sidoLabel,
        sigunguName: sigunguLabel,
        period: { preset, label: periodLabel, current: windows.current, previous: windows.previous },
        minSamplePairs: MIN_SAMPLE_PAIRS,
        overall: overallBuckets[0] ? roundBucket(overallBuckets[0]) : null,
        dongs: dongBuckets.sort((a, b) => a.label.localeCompare(b.label, 'ko')).map(roundBucket),
        interpretation,
        callBudget: { districtsFetched: 1, monthsFetched: months.length },
        apiError: failed && trades.length === 0,
        partial: false,
        failedDistricts: failed ? [lawdCd] : [],
      });
    }

    // level === 'complex'
    const lawdCd = searchParams.get('lawdCd');
    if (!lawdCd || !/^\d{5}$/.test(lawdCd)) {
      return NextResponse.json({ status: 'ERROR', message: 'lawdCd 파라미터가 필요합니다.' }, { status: 400 });
    }
    const dong = searchParams.get('dong');
    const sortParam = searchParams.get('sort') || 'changePct';
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

    const [{ trades, failed }, regionName] = await Promise.all([fetchDistrictTrades(lawdCd, months), resolveRegionNameByLawdCd(lawdCd)]);
    const scoped = dong && dong !== 'all' ? trades.filter((t) => t.dong === dong) : trades;
    let rows = buildComplexChangeRows(scoped, windows);

    const sortFns: Record<string, (a: any, b: any) => number> = {
      changePct: (a, b) => b.changePct - a.changePct,
      changePctAsc: (a, b) => a.changePct - b.changePct,
      price: (a, b) => b.currentAmount - a.currentAmount,
      recent: (a, b) => b.currentDate.localeCompare(a.currentDate),
    };
    const sortKey = sortFns[sortParam] ? sortParam : 'changePct';
    rows = [...rows].sort(sortFns[sortKey]);

    const total = rows.length;
    const pageRows = rows.slice(offset, offset + limit).map((r) => ({
      ...r,
      changePct: round1(r.changePct),
      priceLabel: formatKoreanPrice(String(r.currentAmount)),
    }));

    return NextResponse.json({
      status: 'OK',
      level: 'complex',
      lawdCd,
      sidoName: regionName?.sido || '',
      sigunguName: regionName?.sigungu || '',
      dong: dong || 'all',
      period: { preset, label: periodLabel, current: windows.current, previous: windows.previous },
      minSamplePairs: MIN_SAMPLE_PAIRS,
      sort: sortKey,
      rows: pageRows,
      pagination: { offset, limit, total, hasMore: offset + limit < total },
      callBudget: { districtsFetched: 1, monthsFetched: months.length },
      apiError: failed && trades.length === 0,
      partial: false,
    });
  } catch (error) {
    console.error('Failed to load region change map data:', error);
    return NextResponse.json({ status: 'ERROR', message: '지역 변동지도 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
