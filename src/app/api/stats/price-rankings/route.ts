import { NextResponse } from 'next/server';
import { fetchMolitData, formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, fetchMonthsThrottledWithStatus, MonthTask } from '@/lib/molit-stats-helpers';
import { getSigunguListForSido } from '@/lib/region-utils';
import { prisma } from '@/lib/prisma';
import { resolveTrustworthyPyeongBatch, pyeongLookupKeyId, type PyeongLookupKey } from '@/lib/statistics-pyeong-resolver';
import {
  dedupeTrades,
  buildDeclineRows,
  buildRecordHighRows,
  buildRisingRows,
  buildDeclineInterpretation,
  buildRecordHighInterpretation,
  buildRisingInterpretation,
  resolvePriceRankingPeriod,
  type FeedTrade,
  type PriceRankingPeriodPreset,
} from '@/lib/price-ranking';

// STATISTICS V2.1-1 — DECLINE + RECORD HIGH + RISING. 세 화면 모두 "같은
// aptSeq + 같은 raw 전용면적" 그룹의 시간순 히스토리를 필요로 하므로(§8~§16
// 감사 결과), 매매(apt) 트레일링 24개월을 한 번만 fetch해 캐싱하고 그 위에서
// mode/period/sort/area를 전부 메모리 계산으로 처리한다 — period를 바꿔도
// 재fetch가 필요 없다(§28/§31 성능 요구사항).
export const dynamic = 'force-dynamic';

const LOOKBACK_MONTHS = 24; // §12 "historical high window" — 전체 역사가 아닌 24개월로 명시적 제한(문서화)
const VALID_PRESETS: PriceRankingPeriodPreset[] = ['7d', '30d', '3m', '6m', '12m'];
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function monthsForLookback(now: Date): string[] {
  const months: string[] = [];
  const d = new Date(now);
  for (let i = 0; i < LOOKBACK_MONTHS; i++) {
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return months.reverse();
}

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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const modeParam = searchParams.get('mode');
  const mode = modeParam === 'decline' || modeParam === 'record-high' || modeParam === 'rising' ? modeParam : null;
  if (!mode) {
    return NextResponse.json({ status: 'ERROR', message: 'mode 파라미터가 필요합니다(decline|record-high|rising).' }, { status: 400 });
  }

  const lawdCdParam = searchParams.get('lawdCd');
  const sidoCodeParam = searchParams.get('sidoCode');
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  const dong = searchParams.get('dong') || 'all';
  const presetParam = searchParams.get('period') || '30d';
  const preset: PriceRankingPeriodPreset = (VALID_PRESETS as string[]).includes(presetParam) ? (presetParam as PriceRankingPeriodPreset) : '30d';
  const areaFilter = searchParams.get('area'); // exact raw area string, optional
  const sortParam = searchParams.get('sort') || '';
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
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
    const months = monthsForLookback(now);
    let allTrades: FeedTrade[] = [];
    let apiError = false;
    let partial = false;
    let failedDistricts: string[] = [];
    // §26 — 시도 전체 결과는 동 이름만으로 지역이 모호할 수 있어(예: "우동"이
    // 여러 구에 있을 수 있음) 구/군 이름을 항상 함께 표시해야 한다. sido-all
    // 조회 시 이미 구 목록(name="부산광역시 서구" 형식)을 갖고 있으므로 별도
    // 네트워크 호출 없이 lawdCd -> 구/군 짧은 이름 맵을 만든다.
    const sigunguNameByLawdCd = new Map<string, string>();

    if (isSidoAll) {
      const districts = await getSigunguListForSido(sidoCodeParam!);
      const lawdCds = districts.map((d) => d.code.substring(0, 5));
      for (const d of districts) {
        const shortName = d.name.split(' ').slice(1).join(' ');
        sigunguNameByLawdCd.set(d.code.substring(0, 5), shortName);
      }
      const cacheKey = `stats-price-rankings-sido:${sidoCodeParam}:${months[0]}-${months[months.length - 1]}`;
      const cached = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
        const tasks: MonthTask[] = [];
        for (const dLawdCd of lawdCds) {
          for (const m of months) tasks.push({ key: `${dLawdCd}|${m}`, lawdCd: dLawdCd, dealYmd: m, type: 'apt' });
        }
        const results = await fetchMonthsThrottledWithStatus(tasks);
        const failedSet = new Set<string>();
        for (const dLawdCd of lawdCds) {
          for (const m of months) if (results[`${dLawdCd}|${m}`]?.failed) failedSet.add(dLawdCd);
        }
        return { results, failedLawdCds: Array.from(failedSet), lawdCds };
      });
      partial = cached.failedLawdCds.length > 0;
      failedDistricts = cached.failedLawdCds;
      for (const dLawdCd of cached.lawdCds) {
        for (const m of months) {
          for (const raw of cached.results[`${dLawdCd}|${m}`]?.items || []) {
            const t = toFeedTrade(raw, dLawdCd);
            if (t) allTrades.push(t);
          }
        }
      }
      if (cached.failedLawdCds.length === cached.lawdCds.length && cached.lawdCds.length > 0) apiError = true;
    } else {
      const cacheKey = `stats-price-rankings:${lawdCd}:${months[0]}-${months[months.length - 1]}`;
      const rawByMonth = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
        const tasks: MonthTask[] = months.map((m) => ({ key: m, lawdCd: lawdCd!, dealYmd: m, type: 'apt' }));
        return fetchMonthsThrottledWithStatus(tasks);
      });
      for (const m of months) {
        for (const raw of rawByMonth[m]?.items || []) {
          const t = toFeedTrade(raw, lawdCd!);
          if (t) allTrades.push(t);
        }
      }
      // §39 API 실패 vs 거래 없음 구분 — 진단성 probe(추가 호출 1회, N+1 아님).
      if (allTrades.length === 0) {
        try {
          const probe = await fetchMolitData({ type: 'apt', lawdCd: lawdCd!, dealYmd: months[months.length - 1] });
          apiError = probe.length === 1 && probe[0]?.typeLabel === '에러';
        } catch {
          apiError = true;
        }
      }
    }

    allTrades = dedupeTrades(allTrades);
    if (dong !== 'all') allTrades = allTrades.filter((t) => t.dong === dong);
    if (areaFilter) allTrades = allTrades.filter((t) => t.excluUseArea != null && t.excluUseArea.toString() === areaFilter);

    const period = resolvePriceRankingPeriod(preset, now);

    let rows: Array<Record<string, any>>;
    if (mode === 'decline') rows = buildDeclineRows(allTrades, period);
    else if (mode === 'record-high') rows = buildRecordHighRows(allTrades, period);
    else rows = buildRisingRows(allTrades, period);

    // FIX_STATISTICS_DATA_TRUST 원칙 재사용 — Unit Master 신뢰 가능한 평형만
    // batch 조회(쿼리 2회 고정, N+1 없음). 없으면 null(raw ㎡만 표시).
    const lookupKeys = new Map<string, PyeongLookupKey>();
    for (const r of rows) {
      if (r.excluUseArea == null) continue;
      const key: PyeongLookupKey = { name: r.name, dong: r.dong, aptSeq: r.aptSeq, rawAreaM2: r.excluUseArea };
      lookupKeys.set(pyeongLookupKeyId(key), key);
    }
    const pyeongMap = await resolveTrustworthyPyeongBatch(prisma, Array.from(lookupKeys.values()));
    const withPyeong: any[] = rows.map((r) => {
      const pyung = r.excluUseArea != null ? pyeongMap.get(pyeongLookupKeyId({ name: r.name, dong: r.dong, aptSeq: r.aptSeq, rawAreaM2: r.excluUseArea })) ?? null : null;
      const interpretation =
        mode === 'decline' ? buildDeclineInterpretation(r as any) : mode === 'record-high' ? buildRecordHighInterpretation(r as any) : buildRisingInterpretation(r as any);
      const sigunguName = isSidoAll ? sigunguNameByLawdCd.get(r.lawdCd) || null : null;
      return { ...r, pyung, interpretation, sigunguName };
    });

    // §7 정렬 — 기존 API가 지원 가능한 필드 범위에서만 구현(새 데이터 소스 없음).
    const sortFns: Record<string, (a: any, b: any) => number> = {
      // 하락
      declineRate: (a, b) => a.declinePct - b.declinePct, // 더 큰 하락(더 음수)이 먼저
      declineAmount: (a, b) => a.declineAmount - b.declineAmount,
      recent: (a, b) => b.currentDate.localeCompare(a.currentDate),
      // 신고가
      deltaAmount: (a, b) => b.deltaAmount - a.deltaAmount,
      deltaRate: (a, b) => b.deltaPct - a.deltaPct,
      price: (a, b) => b.currentAmount - a.currentAmount,
      // 상승
      riseRate: (a, b) => b.risePct - a.risePct,
      riseAmount: (a, b) => b.riseAmount - a.riseAmount,
    };
    const defaultSort: Record<string, string> = { decline: 'declineRate', 'record-high': 'recent', rising: 'riseRate' };
    const sortKey = sortFns[sortParam] ? sortParam : defaultSort[mode];
    withPyeong.sort(sortFns[sortKey]);

    const total = withPyeong.length;
    const page = withPyeong.slice(offset, offset + limit).map((r) => ({
      ...r,
      priceLabel: r.currentAmount != null ? formatKoreanPrice(String(r.currentAmount)) : null,
    }));

    return NextResponse.json({
      status: 'OK',
      mode,
      region: { lawdCd, sidoCode: isSidoAll ? sidoCodeParam : lawdCd ? lawdCd.substring(0, 2) : null, dong, sidoAll: isSidoAll },
      period: { preset, from: period.from, to: period.to },
      lookbackMonths: LOOKBACK_MONTHS,
      sort: sortKey,
      rows: page,
      pagination: { offset, limit, total, hasMore: offset + limit < total },
      apiError,
      partial,
      failedDistricts,
    });
  } catch (error) {
    console.error('Failed to load price rankings:', error);
    return NextResponse.json({ status: 'ERROR', message: '통계 데이터를 불러오지 못했습니다.' }, { status: 500 });
  }
}
