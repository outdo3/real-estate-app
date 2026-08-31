import { NextResponse } from 'next/server';
import { formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { fetchMonthsThrottledWithStatus, type MonthTask } from '@/lib/molit-stats-helpers';
import { getSigunguListForSido, getSidoList, resolveRegionNameByLawdCd } from '@/lib/region-utils';
import { getRegionChangeBucketsFromDb, getComplexChangeRowsFromDb, type RegionChangeBucketRow, type ComplexChangeCandidateRow } from '@/lib/trade-history-read';
import {
  resolveRegionChangeWindows,
  regionChangeFetchMonths,
  buildRegionChangePairs,
  buildComplexChangeRows,
  aggregateChangeByBucket,
  buildRegionChangeInterpretation,
  deriveConfidence,
  classifyDirection,
  classifyIntensity,
  periodLabelOf,
  MIN_SAMPLE_PAIRS,
  type FeedTrade,
  type RegionChangeAggregate,
  type ComplexChangeRow,
  type RegionChangePeriodPreset,
} from '@/lib/region-change';

// TRADE_DB_FIRST_V1 STEP D — 지역 변동지도를 부산 요청에 한해 DB-first로
// 전환했다. 이집 TradeHistory DB는 부산 16/16 구·군만 구축돼 있고 다른
// 시/도는 데이터가 아예 없다 — "DB에 없으면 MOLIT으로 보완"이 아니라,
// 애초에 데이터가 존재하는 지역(부산)만 DB 경로를 타도록 하는 고정된 지역
// 라우팅이다(STEP B/C와 동일 원칙). 非부산 사용자 동작은 이번 STEP으로
// 전혀 바뀌지 않는다.
const BUSAN_SIDO_CODE = '26';

function isBusanScopedRequest(lawdCd: string | null, sidoCode: string | null): boolean {
  if (sidoCode) return sidoCode === BUSAN_SIDO_CODE;
  return !!lawdCd && lawdCd.startsWith(BUSAN_SIDO_CODE);
}

// DB 집계 결과(RegionChangeBucketRow)를 기존 aggregateChangeByBucket()이
// 만드는 RegionChangeAggregate와 동일한 shape으로 변환한다 — confidence/
// direction/intensity 판정은 region-change.ts의 기존 순수 함수(무변경)를
// 그대로 재사용해, "숫자 계산은 SQL, 임계값 판정은 검증된 기존 JS"로
// 책임을 나눈다(판정 로직을 SQL로 재구현하지 않음 — 재구현 시 threshold
// 두 곳에 흩어져 나중에 어긋날 위험을 피한다).
function dbBucketToAggregate(b: RegionChangeBucketRow, key: string, label: string): RegionChangeAggregate {
  const confidence = deriveConfidence(b.pairCount);
  const medianPct = confidence === 'INSUFFICIENT' ? null : b.medianPct;
  return {
    key,
    label,
    medianPct,
    pairCount: b.pairCount,
    complexCount: b.complexCount,
    minPct: b.minPct,
    maxPct: b.maxPct,
    confidence,
    direction: confidence === 'INSUFFICIENT' || medianPct == null ? null : classifyDirection(medianPct),
    intensity: confidence === 'INSUFFICIENT' || medianPct == null ? null : classifyIntensity(medianPct),
  };
}

function dbComplexRowToComplexChangeRow(r: ComplexChangeCandidateRow): ComplexChangeRow {
  const changePct = ((r.currentAmount - r.baselineAmount) / r.baselineAmount) * 100;
  return {
    complexKey: r.identityKey,
    name: r.aptName,
    dong: r.dong,
    lawdCd: r.lawdCd,
    aptSeq: r.aptSeq,
    excluUseArea: Number(r.exclusiveArea),
    currentAmount: r.currentAmount,
    currentDate: r.currentDate.toISOString().slice(0, 10),
    baselineAmount: r.baselineAmount,
    baselineDate: r.baselineDate.toISOString().slice(0, 10),
    changePct,
    sampleTradeCount: r.sampleTradeCount,
    confidence: deriveConfidence(r.sampleTradeCount),
  };
}

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

      let overallBuckets: RegionChangeAggregate[];
      let districtBuckets: RegionChangeAggregate[];
      let partial = false;
      let apiError = false;
      let failedDistricts: string[] = [];

      if (isBusanScopedRequest(null, sidoCode)) {
        // TRADE_DB_FIRST_V1 STEP D — 부산 전체(sigungu) DB-first 경로. DB
        // read는 전체 성공 또는 예외 둘 중 하나(부분 실패 개념 없음, STEP
        // B/C와 동일 패턴).
        const cacheKey = `region-change-db-sigungu:${sidoCode}:${preset}`;
        const buckets = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () =>
          getRegionChangeBucketsFromDb(lawdCds, windows.current.from, windows.current.to, windows.previous.from, windows.previous.to, 'lawdCd')
        );
        const overall = buckets.find((b) => b.bucketKey === null);
        overallBuckets = overall ? [dbBucketToAggregate(overall, 'overall', sidoName)] : [];
        districtBuckets = buckets
          .filter((b) => b.bucketKey !== null)
          .map((b) => dbBucketToAggregate(b, b.bucketKey!, sigunguNameByLawdCd.get(b.bucketKey!) || b.bucketKey!));
      } else {
        const results = await Promise.all(lawdCds.map((lawdCd) => fetchDistrictTrades(lawdCd, months)));
        failedDistricts = lawdCds.filter((_, i) => results[i].failed);
        const allTrades = results.flatMap((r) => r.trades);
        partial = failedDistricts.length > 0;
        apiError = failedDistricts.length === lawdCds.length && lawdCds.length > 0;

        const pairs = buildRegionChangePairs(allTrades, windows);
        overallBuckets = aggregateChangeByBucket(pairs, () => 'overall', () => sidoName);
        districtBuckets = aggregateChangeByBucket(
          pairs,
          (p) => p.lawdCd,
          (key) => sigunguNameByLawdCd.get(key) || key
        );
      }
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
      const isBusan = isBusanScopedRequest(lawdCd, null);
      let overallBuckets: RegionChangeAggregate[];
      let dongBuckets: RegionChangeAggregate[];
      let failed = false;
      let tradesLength = 0;

      if (isBusan) {
        // TRADE_DB_FIRST_V1 STEP D — 부산 단일 구(dong) DB-first 경로.
        const regionNameDb = await resolveRegionNameByLawdCd(lawdCd);
        const sigunguLabelDb = regionNameDb?.sigungu || regionNameDb?.fullName || lawdCd;
        const sidoLabelDb = regionNameDb?.sido || '';
        const cacheKey = `region-change-db-dong:${lawdCd}:${preset}`;
        const buckets = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () =>
          getRegionChangeBucketsFromDb([lawdCd], windows.current.from, windows.current.to, windows.previous.from, windows.previous.to, 'dong')
        );
        const overall = buckets.find((b) => b.bucketKey === null);
        overallBuckets = overall ? [dbBucketToAggregate(overall, 'overall', sigunguLabelDb)] : [];
        dongBuckets = buckets
          .filter((b) => b.bucketKey !== null)
          .map((b) => dbBucketToAggregate(b, b.bucketKey || '(동 정보 없음)', b.bucketKey || '(동 정보 없음)'));
        const interpretation = buildRegionChangeInterpretation(dongBuckets, sigunguLabelDb, periodLabel);
        return NextResponse.json({
          status: 'OK',
          level: 'dong',
          lawdCd,
          sidoName: sidoLabelDb,
          sigunguName: sigunguLabelDb,
          period: { preset, label: periodLabel, current: windows.current, previous: windows.previous },
          minSamplePairs: MIN_SAMPLE_PAIRS,
          overall: overallBuckets[0] ? roundBucket(overallBuckets[0]) : null,
          dongs: dongBuckets.sort((a, b) => a.label.localeCompare(b.label, 'ko')).map(roundBucket),
          interpretation,
          callBudget: { districtsFetched: 1, monthsFetched: months.length },
          apiError: false,
          partial: false,
          failedDistricts: [],
        });
      }

      const [{ trades, failed: fetchFailed }, regionName] = await Promise.all([fetchDistrictTrades(lawdCd, months), resolveRegionNameByLawdCd(lawdCd)]);
      failed = fetchFailed;
      tradesLength = trades.length;
      const sigunguLabel = regionName?.sigungu || regionName?.fullName || lawdCd;
      const sidoLabel = regionName?.sido || '';
      const pairs = buildRegionChangePairs(trades, windows);
      overallBuckets = aggregateChangeByBucket(pairs, () => 'overall', () => sigunguLabel);
      dongBuckets = aggregateChangeByBucket(
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
        apiError: failed && tradesLength === 0,
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

    const isBusanComplex = isBusanScopedRequest(lawdCd, null);
    let rows: ComplexChangeRow[];
    let complexFailed = false;
    let complexTradesLength = 0;
    let regionName: Awaited<ReturnType<typeof resolveRegionNameByLawdCd>>;

    if (isBusanComplex) {
      // TRADE_DB_FIRST_V1 STEP D — 부산 단지(complex) DB-first 경로.
      const cacheKey = `region-change-db-complex:${lawdCd}:${preset}:${dong || 'all'}`;
      const [dbRows, regionNameDb] = await Promise.all([
        getOrSetCache(cacheKey, 5 * 60 * 1000, async () =>
          getComplexChangeRowsFromDb(lawdCd, windows.current.from, windows.current.to, windows.previous.from, windows.previous.to, dong && dong !== 'all' ? dong : undefined)
        ),
        resolveRegionNameByLawdCd(lawdCd),
      ]);
      regionName = regionNameDb;
      rows = dbRows.map(dbComplexRowToComplexChangeRow);
    } else {
      const [{ trades, failed }, regionNameLive] = await Promise.all([fetchDistrictTrades(lawdCd, months), resolveRegionNameByLawdCd(lawdCd)]);
      complexFailed = failed;
      complexTradesLength = trades.length;
      regionName = regionNameLive;
      const scoped = dong && dong !== 'all' ? trades.filter((t) => t.dong === dong) : trades;
      rows = buildComplexChangeRows(scoped, windows);
    }

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
      apiError: !isBusanComplex && complexFailed && complexTradesLength === 0,
      partial: false,
    });
  } catch (error) {
    console.error('Failed to load region change map data:', error);
    return NextResponse.json({ status: 'ERROR', message: '지역 변동지도 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
