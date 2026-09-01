import { NextResponse } from 'next/server';
import { fetchMolitData, formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, fetchMonthsThrottledWithStatus, MonthTask } from '@/lib/molit-stats-helpers';
import { getSigunguListForSido } from '@/lib/region-utils';
import { prisma } from '@/lib/prisma';
import { resolveTrustworthyPyeongBatch, resolveApartmentContextBatch, pyeongLookupKeyId, type PyeongLookupKey } from '@/lib/statistics-pyeong-resolver';
import { queryTrades, getDeclineRowsFromDb, getRisingRowsFromDb, getRecordHighRowsFromDb } from '@/lib/trade-history-read';
import {
  dedupeTrades,
  groupKey,
  buildDeclineRows,
  buildRecordHighRows,
  buildRisingRows,
  buildJeonseRiskRows,
  buildArea84RankingRows,
  buildDeclineInterpretation,
  buildRecordHighInterpretation,
  buildRisingInterpretation,
  buildJeonseRiskInterpretation,
  buildArea84Interpretation,
  buildArea84RegionDistributionInterpretation,
  resolvePriceRankingPeriod,
  historicalCoverageLabel,
  HISTORICAL_LOOKBACK_MONTHS,
  RISING_SUFFICIENT_SAMPLE,
  type DeclineRow,
  type RisingRow,
  type RecordHighRow,
  type FeedTrade,
  type PriceRankingPeriodPreset,
} from '@/lib/price-ranking';

// STATISTICS V2.1-1 — DECLINE + RECORD HIGH + RISING. 세 화면 모두 "같은
// aptSeq + 같은 raw 전용면적" 그룹의 시간순 히스토리를 필요로 하므로(§8~§16
// 감사 결과), 매매(apt) 트레일링 24개월을 한 번만 fetch해 캐싱하고 그 위에서
// mode/period/sort/area를 전부 메모리 계산으로 처리한다 — period를 바꿔도
// 재fetch가 필요 없다(§28/§31 성능 요구사항).
export const dynamic = 'force-dynamic';

// FIX_PRICE_RANKINGS_V2_1_1A — 이 상수는 price-ranking.ts의
// HISTORICAL_LOOKBACK_MONTHS와 동일한 값을 가리켜야 한다("역대 최고가"
// 문구가 실제 fetch 범위와 항상 일치해야 하므로 단일 source로 통합했다).
// 로컬 상수를 따로 두지 않고 그 값을 그대로 재사용한다.
const LOOKBACK_MONTHS = HISTORICAL_LOOKBACK_MONTHS;
// 84SQM_RANKING_V1 §10 — '1m'/'24m'은 area84 전용으로 추가된 preset(price-ranking.ts
// 참고). 기존 4개 모드는 여전히 '7d'~'12m'만 실제로 노출/사용한다(additive).
const VALID_PRESETS: PriceRankingPeriodPreset[] = ['1m', '7d', '30d', '3m', '6m', '12m', '24m'];
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// TRADE_DB_FIRST_V1 STEP B — 84㎡ 국민평형 순위(mode='area84'), STEP C —
// 하락/상승(mode='decline'/'rising'), STEP E — 신고가(mode='record-high')를
// 부산 요청에 한해 TradeHistory DB-first로 전환했다. jeonse-risk(전세 위험)
// 1개 모드와 4개 모드의 非부산 요청은 기존 live MOLIT 경로를 그대로
// 유지한다 — jeonse-risk는 apiType이 rent라 TradeHistory DB(dealType='sale'만
// 존재) 대상이 아니다. 이집 TradeHistory DB는 부산 16/16 구·군만 구축돼 있고
// (TRADE_HISTORY_DATA_V1) 다른 시/도는 데이터가 아예 없다 — "DB에 없으면
// MOLIT으로 보완"이 아니라, 애초에 데이터가 존재하는 지역(부산)만 DB
// 경로를 타도록 하는 고정된 지역 라우팅이다(§15 "정직한 coverage 표시" —
// 非부산 사용자 동작은 이번 STEP으로 전혀 바뀌지 않는다).
//
// TRADE_DB_FIRST_V1 STEP E §TRUST — record-high가 쓰는 24개월
// (HISTORICAL_LOOKBACK_MONTHS) 트레일링 윈도우 중 취소(dealCanceled) 정확성이
// 실측 검증된 구간은 가장 최근 13개월뿐이다(TRADE_CANCELLATION_RESYNC_V1.md
// §3/§5 — 2026-08-30 시점 "현재월+직전12개월"만 재동기화, 그 이전 구간은 과거
// parser 버그로 dealCanceled가 항상 false로 backfill되어 있을 수 있음, 재수집은
// 명시적으로 범위 밖). 즉 "2년최고가" 문구가 가리키는 24개월 중 뒤쪽 약 11개월
// (13~24개월 전)은 취소거래가 유효거래로 잘못 섞여 priorHigh를 부풀릴 위험이
// 이론상 있다 — 단, 이 wording 자체("최근 24개월"/coverageLabel, "역대" 아님)는
// 이미 완료 범위만 정직하게 주장하고 있어 완전성(completeness)을 주장하지
// 않는다. 이 노출은 STEP B/C/C-2/D가 이미 동일한 24개월 DB 윈도우를 써서
// 선행 도입한 것과 동일한 성격이며 STEP E가 새로 만든 것이 아니다(문구를 더
// 과장되게 바꾸지 않는다는 §40 원칙 준수) — 결론(LIMITED, PM_DECISION_REQUIRED
// 권고)은 docs/development/TRADE_DB_FIRST_V1_STEP_E.md §TRUST VERDICT 참고.
// 이번 STEP은 과거 취소 재동기화를 수행하지 않으며(범위 밖), UI 문구도 임의로
// 바꾸지 않는다(기존 buildRecordHighInterpretation을 그대로 재사용).
const BUSAN_SIDO_CODE = '26';

function isBusanScopedRequest(lawdCd: string | null, sidoCodeParam: string | null, isSidoAll: boolean): boolean {
  if (isSidoAll) return sidoCodeParam === BUSAN_SIDO_CODE;
  return !!lawdCd && lawdCd.startsWith(BUSAN_SIDO_CODE);
}

// StoredTrade(queryTrades 반환)를 기존 순수 로직(buildArea84RankingRows 등)이
// 기대하는 FeedTrade 형태로 변환한다. 이 변환 하나만 새로 만들고, 대표거래
// 선정/직전거래 비교/2년최고가/interpretation 로직은 전부 기존 함수를 그대로
// 재사용한다(§7 — 기존 제품 정의를 바꾸지 않기 위해 로직은 건드리지 않고
// data source만 교체).
function storedTradeToFeedTrade(t: Awaited<ReturnType<typeof queryTrades>>['trades'][number]): FeedTrade {
  return {
    uid: String(t.id),
    aptSeq: t.aptSeq,
    name: t.aptName,
    dong: t.dong,
    lawdCd: t.lawdCd,
    dealType: 'sale',
    dealAmount: t.dealAmount,
    excluUseArea: Number(t.exclusiveArea),
    floorRaw: t.floor,
    dealDate: t.dealDate.toISOString().slice(0, 10),
    dealCanceled: t.dealCanceled,
  };
}

// area84는 84~85㎡ band 후보만 대표거래로 뽑히므로(§8 buildArea84RankingRows),
// history(priorHigh/immediatePrior)도 같은 band의 exact area 그룹만 있으면
// 충분하다 — 다른 면적 거래는 결과에 전혀 영향을 주지 않는다(groupKey가
// exact area를 포함해 서로 다른 면적은 완전히 분리된 그룹). 따라서 DB fetch
// 자체를 band로 좁혀도 buildArea84RankingRows의 출력은 100% 동일하며(STEP A
// 벤치마크에서 이미 실측된 것처럼, area filter가 없으면 부산 전체 조회가
// 수 초 더 걸린다 — 이 최적화로 그 비용을 피한다). STEP C에서 이 함수는
// 건드리지 않는다(§25 — area84 코드는 이번 STEP에서 원칙적으로 수정 금지).
async function fetchArea84TradesFromDb(lawdCds: string[]): Promise<FeedTrade[]> {
  const from = new Date();
  from.setMonth(from.getMonth() - HISTORICAL_LOOKBACK_MONTHS);
  const { trades } = await queryTrades({
    lawdCd: lawdCds,
    from,
    exclusiveAreaRange: { gte: 84, lt: 85 },
  });
  return trades.map(storedTradeToFeedTrade);
}

// TRADE_DB_FIRST_V1 STEP C — decline(하락)/rising(상승) 전용. record-high
// (신고가)/jeonse-risk(전세 위험)는 이번 STEP 범위 밖(§44) — jeonse-risk는
// apiType이 rent라 애초에 TradeHistory DB(dealType='sale'만 존재) 대상이
// 아니다.
//
// TRADE_DB_FIRST_V1 STEP C-2 — 성능 최적화. getDeclineRowsFromDb()/
// getRisingRowsFromDb()(trade-history-read.ts, 설계 근거 상세 주석 참고)가
// 이미 priorHigh/immediatePrior/트레일링 표본수까지 SQL 단일 pass로 전부
// 계산해 반환하므로, 여기서는 buildDeclineRows()/buildRisingRows()와
// **동일한 반올림 공식**으로 최종 DeclineRow/RisingRow shape만 조립한다
// (declinePct/risePct = Math.round(x*1000)/10 — price-ranking.ts의 공식을
// 그대로 복사, 재발명 아님). groupKey는 price-ranking.ts가 재노출하는
// groupKey() 순수 함수를 그대로 재사용한다.
function sqlDeclineRowToDeclineRow(r: Awaited<ReturnType<typeof getDeclineRowsFromDb>>[number]): DeclineRow {
  const excluUseArea = Number(r.exclusiveArea);
  const declineAmount = r.currentAmount - r.priorHighAmount;
  return {
    groupKey: groupKey({ aptSeq: r.aptSeq, name: r.aptName, dong: r.dong, excluUseArea, dealType: 'sale' }),
    aptSeq: r.aptSeq,
    name: r.aptName,
    dong: r.dong,
    lawdCd: r.lawdCd,
    excluUseArea,
    floorRaw: r.floor,
    currentAmount: r.currentAmount,
    currentDate: r.currentDate.toISOString().slice(0, 10),
    priorHighAmount: r.priorHighAmount,
    priorHighDate: r.priorHighDate.toISOString().slice(0, 10),
    declineAmount,
    declinePct: r.priorHighAmount > 0 ? Math.round((declineAmount / r.priorHighAmount) * 1000) / 10 : 0,
    trailing12moSampleCount: r.trailingSampleCount,
  };
}

function sqlRisingRowToRisingRow(r: Awaited<ReturnType<typeof getRisingRowsFromDb>>[number]): RisingRow {
  const excluUseArea = Number(r.exclusiveArea);
  const riseAmount = r.currentAmount - r.previousAmount;
  return {
    groupKey: groupKey({ aptSeq: r.aptSeq, name: r.aptName, dong: r.dong, excluUseArea, dealType: 'sale' }),
    aptSeq: r.aptSeq,
    name: r.aptName,
    dong: r.dong,
    lawdCd: r.lawdCd,
    excluUseArea,
    floorRaw: r.floor,
    currentAmount: r.currentAmount,
    currentDate: r.currentDate.toISOString().slice(0, 10),
    previousAmount: r.previousAmount,
    previousDate: r.previousDate.toISOString().slice(0, 10),
    riseAmount,
    risePct: r.previousAmount > 0 ? Math.round((riseAmount / r.previousAmount) * 1000) / 10 : 0,
    trailing12moSampleCount: r.trailingSampleCount,
    hasSufficientSample: r.trailingSampleCount >= RISING_SUFFICIENT_SAMPLE,
  };
}

// TRADE_DB_FIRST_V1 STEP E — getRecordHighRowsFromDb()가 이미 priorHigh/
// trailingSampleCount까지 SQL 단일 pass로 계산해 반환하므로, 여기서는
// buildRecordHighRows()와 동일한 반올림 공식(deltaPct = Math.round(x*1000)/10)
// 으로 최종 RecordHighRow shape만 조립한다 — decline/rising 변환 함수와 동일한
// 패턴(§9 재발명 아님).
function sqlRecordHighRowToRecordHighRow(r: Awaited<ReturnType<typeof getRecordHighRowsFromDb>>[number]): RecordHighRow {
  const excluUseArea = Number(r.exclusiveArea);
  const deltaAmount = r.currentAmount - r.priorHighAmount;
  return {
    groupKey: groupKey({ aptSeq: r.aptSeq, name: r.aptName, dong: r.dong, excluUseArea, dealType: 'sale' }),
    aptSeq: r.aptSeq,
    name: r.aptName,
    dong: r.dong,
    lawdCd: r.lawdCd,
    excluUseArea,
    floorRaw: r.floor,
    currentAmount: r.currentAmount,
    currentDate: r.currentDate.toISOString().slice(0, 10),
    priorHighAmount: r.priorHighAmount,
    priorHighDate: r.priorHighDate.toISOString().slice(0, 10),
    deltaAmount,
    deltaPct: r.priorHighAmount > 0 ? Math.round((deltaAmount / r.priorHighAmount) * 1000) / 10 : 0,
    trailing12moSampleCount: r.trailingSampleCount,
  };
}

function monthsForLookback(now: Date): string[] {
  const months: string[] = [];
  const d = new Date(now);
  for (let i = 0; i < LOOKBACK_MONTHS; i++) {
    months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return months.reverse();
}

// STATISTICS V2.1-3 — jeonse-risk 모드는 apt가 아니라 rent(전월세) 원본을
// 쓴다. rent 원본은 순수 전세/반전세·월세가 섞여 오므로(monthlyRent 유무로
// 구분, dashboard/feed/concentration 라우트가 이미 쓰는 관례) 여기서도 동일
// 규칙으로 순수 전세만 남기고 wolse는 아예 만들지 않는다(§16 same dealType
// jeonse only).
function toFeedTrade(item: any, lawdCd: string, dealType: 'sale' | 'jeonse'): FeedTrade | null {
  if (!item || item.typeLabel === '에러' || !(item.dealAmount > 0)) return null;
  if (dealType === 'jeonse' && item.monthlyRent > 0) return null; // 반전세/월세 제외
  return {
    uid: item.id,
    aptSeq: item.aptSeq ?? null,
    name: item.name,
    dong: item.dong || '',
    lawdCd,
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
  const modeParam = searchParams.get('mode');
  const mode =
    modeParam === 'decline' || modeParam === 'record-high' || modeParam === 'rising' || modeParam === 'jeonse-risk' || modeParam === 'area84'
      ? modeParam
      : null;
  if (!mode) {
    return NextResponse.json({ status: 'ERROR', message: 'mode 파라미터가 필요합니다(decline|record-high|rising|jeonse-risk|area84).' }, { status: 400 });
  }
  // STATISTICS V2.1-3 §16 — jeonse-risk는 rent(전월세) API를 쓴다. 다른 3개
  // 모드는 기존과 동일하게 apt(매매)만 쓴다.
  const apiType: 'apt' | 'rent' = mode === 'jeonse-risk' ? 'rent' : 'apt';
  const feedDealType: 'sale' | 'jeonse' = mode === 'jeonse-risk' ? 'jeonse' : 'sale';

  const lawdCdParam = searchParams.get('lawdCd');
  const sidoCodeParam = searchParams.get('sidoCode');
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  const dong = searchParams.get('dong') || 'all';
  // 84SQM_RANKING_V1 §10 — area84 기본 기간은 12개월(다른 3개 모드는 기존과
  // 동일하게 30일 기본을 유지, 동작 변경 없음).
  const presetParam = searchParams.get('period') || (mode === 'area84' ? '12m' : '30d');
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
    // TRADE_DB_FIRST_V1 STEP C-2 — decline/rising의 DB candidate-filter
    // 쿼리가 기간(period.from/to)을 필요로 해서, 기존에 훨씬 아래(정렬 직전)
    // 계산하던 것을 여기로 끌어올렸다. resolvePriceRankingPeriod는 순수
    // 함수(부작용 없음)라 호출 시점을 옮겨도 값/동작은 동일하다.
    const period = resolvePriceRankingPeriod(preset, now);
    let allTrades: FeedTrade[] = [];
    // TRADE_DB_FIRST_V1 STEP C-2 — decline/rising의 부산 DB-first 경로는
    // buildDeclineRows()/buildRisingRows()를 거치지 않고 최종 row를 SQL에서
    // 직접 만든다(§ 위 getDeclineRowsFromDb/getRisingRowsFromDb 주석 참고).
    // null이면 기존 allTrades → build*Rows() 경로를 그대로 탄다(area84/
    // jeonse-risk/비부산 decline·rising·record-high 전부 무변경).
    // TRADE_DB_FIRST_V1 STEP E — RecordHighRow 추가(record-high도 이제 DB-first
    // 후보).
    let dbComputedRows: Array<DeclineRow | RisingRow | RecordHighRow> | null = null;
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
      if (mode === 'area84' && isBusanScopedRequest(null, sidoCodeParam, true)) {
        // TRADE_DB_FIRST_V1 STEP B — 부산 전체(area84) DB-first 경로. MOLIT
        // 재조회 없음, 지역별 부분 실패(failedDistricts) 개념 자체가 없음(DB
        // read는 전체 성공 또는 예외 둘 중 하나 — try/catch가 바깥에서 처리).
        // PERFORMANCE_V1 §33/§42 — 16개 구 전체를 lawdCd IN(...)으로 한 번에
        // 조회하는 이 경로는 실측 3.4~6s(단일 구는 0.6s)로, exclusiveArea
        // range를 걸치는 조합에 최적화된 복합 인덱스가 없어 생기는 구조적
        // DB 비용이다(해결하려면 스키마 변경 필요 — 이번 STEP 승인 범위 밖,
        // docs/development/PERFORMANCE_V1.md의 Index Recommendations 참고).
        // 스키마 없이 가능한 유일한 완화책으로 TTL만 5분→30분으로 늘려 이
        // 비싼 재계산 빈도를 줄인다(캐시 키/의미는 그대로, 데이터는 배치
        // 갱신이라 30분 지연이 실질적 문제가 되지 않음 — Score peer
        // universe의 1시간 TTL과 같은 원칙).
        const cacheKey = `stats-price-rankings-area84-db-sido:${sidoCodeParam}:${lawdCds.join(',')}`;
        allTrades = await getOrSetCache(cacheKey, 30 * 60 * 1000, async () => fetchArea84TradesFromDb(lawdCds));
      } else if ((mode === 'decline' || mode === 'rising') && isBusanScopedRequest(null, sidoCodeParam, true)) {
        // TRADE_DB_FIRST_V1 STEP C-2 — 부산 전체(decline/rising) DB-first
        // 경로(단일 SQL pass, 최종 row 직접 반환). area84와 동일하게 부분
        // 실패 개념 없음(DB read는 전체 성공 또는 예외). 캐시 키에
        // mode+period preset을 포함한다 — 기간이 바뀌면 실제로 다른 후보
        // 집합이 나온다(STEP C의 "기간 무관 통짜 fetch"와 다른 지점).
        const cacheKey = `stats-price-rankings-declinerising-v3-db-sido:${mode}:${preset}:${sidoCodeParam}:${lawdCds.join(',')}`;
        dbComputedRows = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () =>
          mode === 'decline'
            ? (await getDeclineRowsFromDb(lawdCds, period.from, period.to)).map(sqlDeclineRowToDeclineRow)
            : (await getRisingRowsFromDb(lawdCds, period.from, period.to)).map(sqlRisingRowToRisingRow)
        );
      } else if (mode === 'record-high' && isBusanScopedRequest(null, sidoCodeParam, true)) {
        // TRADE_DB_FIRST_V1 STEP E — 부산 전체(record-high) DB-first 경로.
        // 캐시 키 prefix(recordhigh-v1)를 decline/rising(declinerising-v3)과
        // 완전히 분리한다 — 같은 mode 문자열 세그먼트를 키에 넣더라도, 오래된
        // decline/rising 캐시 엔트리와 절대 충돌하지 않도록 새 STEP은 항상 새
        // prefix를 쓴다(§ 캐시 감사 요구사항).
        const cacheKey = `stats-price-rankings-recordhigh-v1-db-sido:${preset}:${sidoCodeParam}:${lawdCds.join(',')}`;
        dbComputedRows = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () =>
          (await getRecordHighRowsFromDb(lawdCds, period.from, period.to)).map(sqlRecordHighRowToRecordHighRow)
        );
      } else {
        // PERF §21 — apiType(apt/rent)이 다르면 완전히 다른 원본 데이터이므로
        // 캐시 키에 반드시 포함한다(포함하지 않으면 decline/rising 캐시가
        // jeonse-risk에 매매 데이터를 잘못 서빙할 위험).
        const cacheKey = `stats-price-rankings-sido:${apiType}:${sidoCodeParam}:${months[0]}-${months[months.length - 1]}`;
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
          return { results, failedLawdCds: Array.from(failedSet), lawdCds };
        });
        partial = cached.failedLawdCds.length > 0;
        failedDistricts = cached.failedLawdCds;
        for (const dLawdCd of cached.lawdCds) {
          for (const m of months) {
            for (const raw of cached.results[`${dLawdCd}|${m}`]?.items || []) {
              const t = toFeedTrade(raw, dLawdCd, feedDealType);
              if (t) allTrades.push(t);
            }
          }
        }
        if (cached.failedLawdCds.length === cached.lawdCds.length && cached.lawdCds.length > 0) apiError = true;
      }
    } else if (mode === 'area84' && isBusanScopedRequest(lawdCd, null, false)) {
      // TRADE_DB_FIRST_V1 STEP B — 부산 단일 구(area84) DB-first 경로.
      const cacheKey = `stats-price-rankings-area84-db:${lawdCd}`;
      allTrades = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => fetchArea84TradesFromDb([lawdCd!]));
    } else if ((mode === 'decline' || mode === 'rising') && isBusanScopedRequest(lawdCd, null, false)) {
      // TRADE_DB_FIRST_V1 STEP C-2 — 부산 단일 구(decline/rising) DB-first 경로.
      const cacheKey = `stats-price-rankings-declinerising-v3-db:${mode}:${preset}:${lawdCd}`;
      dbComputedRows = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () =>
        mode === 'decline'
          ? (await getDeclineRowsFromDb([lawdCd!], period.from, period.to)).map(sqlDeclineRowToDeclineRow)
          : (await getRisingRowsFromDb([lawdCd!], period.from, period.to)).map(sqlRisingRowToRisingRow)
      );
    } else if (mode === 'record-high' && isBusanScopedRequest(lawdCd, null, false)) {
      // TRADE_DB_FIRST_V1 STEP E — 부산 단일 구(record-high) DB-first 경로.
      const cacheKey = `stats-price-rankings-recordhigh-v1-db:${preset}:${lawdCd}`;
      dbComputedRows = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () =>
        (await getRecordHighRowsFromDb([lawdCd!], period.from, period.to)).map(sqlRecordHighRowToRecordHighRow)
      );
    } else {
      const cacheKey = `stats-price-rankings:${apiType}:${lawdCd}:${months[0]}-${months[months.length - 1]}`;
      const rawByMonth = await getOrSetCache(cacheKey, 5 * 60 * 1000, async () => {
        const tasks: MonthTask[] = months.map((m) => ({ key: m, lawdCd: lawdCd!, dealYmd: m, type: apiType }));
        return fetchMonthsThrottledWithStatus(tasks);
      });
      for (const m of months) {
        for (const raw of rawByMonth[m]?.items || []) {
          const t = toFeedTrade(raw, lawdCd!, feedDealType);
          if (t) allTrades.push(t);
        }
      }
      // §39 API 실패 vs 거래 없음 구분 — 진단성 probe(추가 호출 1회, N+1 아님).
      if (allTrades.length === 0) {
        try {
          const probe = await fetchMolitData({ type: apiType, lawdCd: lawdCd!, dealYmd: months[months.length - 1] });
          apiError = probe.length === 1 && probe[0]?.typeLabel === '에러';
        } catch {
          apiError = true;
        }
      }
    }

    let rows: Array<Record<string, any>>;
    if (dbComputedRows) {
      // TRADE_DB_FIRST_V1 STEP C-2 — dong/areaFilter를 SQL 결과에 직접
      // 적용한다. build*Rows()가 allTrades에 대해 하던 것과 동일한 필터
      // 조건(단지가 어떤 다른 후보와 비교되는지에 영향받지 않는, 각 row
      // 독립적인 필터)이라 적용 순서를 바꿔도 최종 집합은 동일하다.
      rows = dbComputedRows.filter(
        (r) => (dong === 'all' || r.dong === dong) && (!areaFilter || r.excluUseArea?.toString() === areaFilter)
      );
    } else {
      allTrades = dedupeTrades(allTrades);
      if (dong !== 'all') allTrades = allTrades.filter((t) => t.dong === dong);
      if (areaFilter) allTrades = allTrades.filter((t) => t.excluUseArea != null && t.excluUseArea.toString() === areaFilter);

      if (mode === 'decline') rows = buildDeclineRows(allTrades, period);
      else if (mode === 'record-high') rows = buildRecordHighRows(allTrades, period);
      else if (mode === 'jeonse-risk') rows = buildJeonseRiskRows(allTrades, period);
      else if (mode === 'area84') rows = buildArea84RankingRows(allTrades, period);
      else rows = buildRisingRows(allTrades, period);
    }

    // §7 정렬 — 기존 API가 지원 가능한 필드 범위에서만 구현(새 데이터 소스 없음).
    // PERF — 정렬 키(declinePct/riseAmount 등)는 pyung/interpretation과 무관하게
    // rows 자체에 이미 있으므로, Unit Master 조회보다 먼저 정렬+페이지네이션부터
    // 끝낸다. 이전에는 sido-all의 모든 후보 단지(수백~수천 개)를 대상으로 매번
    // Unit Master batch 조회를 했는데, 실제로 응답에 노출되는 건 페이지당
    // limit(기본 30, 최대 100)건뿐이었다 — pyeongLookupKeys/interpretation을
    // page로 좁히면 결과는 완전히 동일하면서 DB batch 조회 크기만 줄어든다
    // (§21/§27, 정렬 순서·값 자체는 바뀌지 않음).
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
      // 84㎡ 순위 — §12 기본: 대표 거래가 DESC. recent는 위 record-high 정렬과 동일 키 재사용.
    };
    const defaultSort: Record<string, string> = {
      decline: 'declineRate',
      'record-high': 'recent',
      rising: 'riseRate',
      'jeonse-risk': 'declineRate',
      area84: 'price',
    };
    const sortKey = sortFns[sortParam] ? sortParam : defaultSort[mode];
    rows.sort(sortFns[sortKey]);

    const total = rows.length;
    const pageRows = rows.slice(offset, offset + limit);

    // FIX_STATISTICS_DATA_TRUST 원칙 재사용 — Unit Master 신뢰 가능한 평형만
    // batch 조회(쿼리 2회 고정, N+1 없음). 없으면 null(raw ㎡만 표시). 이제
    // 페이지에 실제로 노출되는 건만 조회한다(위 PERF 코멘트).
    const lookupKeys = new Map<string, PyeongLookupKey>();
    for (const r of pageRows) {
      if (r.excluUseArea == null) continue;
      const key: PyeongLookupKey = { name: r.name, dong: r.dong, aptSeq: r.aptSeq, rawAreaM2: r.excluUseArea };
      lookupKeys.set(pyeongLookupKeyId(key), key);
    }
    const pyeongMap = await resolveTrustworthyPyeongBatch(prisma, Array.from(lookupKeys.values()));
    // 84SQM_RANKING_V1 §17/§32 — 세대수/준공연도는 area84 모드에서만 필요하다.
    // 다른 3개 모드는 기존과 동일하게 이 batch 쿼리를 타지 않는다(쿼리 수 불변).
    // resolveApartmentContextBatch는 feed/gap-invest/concentration이 이미 쓰는
    // 동일 batch 헬퍼(고정 2쿼리, N+1 없음) 재사용 — 새로 만들지 않는다.
    const contextMap =
      mode === 'area84'
        ? await resolveApartmentContextBatch(
            prisma,
            pageRows.map((r) => ({ aptSeq: r.aptSeq, name: r.name, dong: r.dong }))
          )
        : new Map();
    // FIX_PRICE_RANKINGS_V2_1_1A §6 — "역대 최고가"를 조회 가능 범위(트레일링
    // LOOKBACK_MONTHS)로 명시적으로 제한한 라벨. decline/record-high 문구에
    // 항상 이 라벨을 넣어 실제 fetch 범위를 벗어난 "진짜 역대 최고가"라고
    // 오해할 수 없게 한다(rising은 직전거래 비교라 해당 없음).
    const coverageLabel = historicalCoverageLabel(LOOKBACK_MONTHS);
    const withPyeong: any[] = pageRows.map((r) => {
      const pyung = r.excluUseArea != null ? pyeongMap.get(pyeongLookupKeyId({ name: r.name, dong: r.dong, aptSeq: r.aptSeq, rawAreaM2: r.excluUseArea })) ?? null : null;
      const interpretation =
        mode === 'decline'
          ? buildDeclineInterpretation(r as any, coverageLabel)
          : mode === 'record-high'
            ? buildRecordHighInterpretation(r as any, coverageLabel)
            : mode === 'jeonse-risk'
              ? buildJeonseRiskInterpretation(r as any)
              : mode === 'area84'
                ? buildArea84Interpretation(r as any, coverageLabel)
                : buildRisingInterpretation(r as any);
      const sigunguName = isSidoAll ? sigunguNameByLawdCd.get(r.lawdCd) || null : null;
      if (mode === 'area84') {
        const ctx = contextMap.get(`${r.aptSeq || ''}|${r.name}|${r.dong}|0`) ?? null;
        return { ...r, pyung, interpretation, sigunguName, totalHouseholds: ctx?.totalHouseholds ?? null, approvalDate: ctx?.approvalDate ?? null };
      }
      return { ...r, pyung, interpretation, sigunguName };
    });

    const page = withPyeong.map((r) => ({
      ...r,
      priceLabel: r.currentAmount != null ? formatKoreanPrice(String(r.currentAmount)) : null,
    }));

    // 84SQM_RANKING_V1 §28 REGION SUMMARY — 페이지네이션 이전 전체 rows 기준으로
    // 계산(표시되는 페이지 30건만 보고 중앙값을 왜곡하지 않기 위함). §27 구 분포
    // 문구는 항상 가격 내림차순 top 10을 기준으로 계산한다(사용자가 다른 정렬을
    // 선택해도 "상위권이 어디 몰려있나"라는 질문의 의미가 바뀌지 않도록).
    let area84Summary: { totalCount: number; topAmount: number | null; medianAmount: number | null } | null = null;
    let area84RegionInterpretation: string | null = null;
    if (mode === 'area84') {
      const amounts = (rows as any[]).map((r) => r.currentAmount).sort((a, b) => a - b);
      const medianAmount = amounts.length > 0 ? amounts[Math.floor((amounts.length - 1) / 2)] : null;
      area84Summary = { totalCount: rows.length, topAmount: amounts.length > 0 ? amounts[amounts.length - 1] : null, medianAmount };
      if (isSidoAll) {
        const byPrice = [...(rows as any[])].sort((a, b) => b.currentAmount - a.currentAmount).slice(0, 10);
        area84RegionInterpretation = buildArea84RegionDistributionInterpretation(byPrice, sigunguNameByLawdCd, sido.replace(/(특별자치시|특별자치도|광역시|특별시|자치도|도)$/, '') || sido);
      }
    }

    return NextResponse.json({
      status: 'OK',
      mode,
      region: { lawdCd, sidoCode: isSidoAll ? sidoCodeParam : lawdCd ? lawdCd.substring(0, 2) : null, dong, sidoAll: isSidoAll },
      period: { preset, from: period.from, to: period.to },
      lookbackMonths: LOOKBACK_MONTHS,
      areaBand: mode === 'area84' ? { min: 84, max: 85 } : null,
      summary: area84Summary,
      regionInterpretation: area84RegionInterpretation,
      // FIX_PRICE_RANKINGS_V2_1_1A — 클라이언트가 "역대 최고가"류 문구를 직접
      // 만드는 곳(예: PriceRankingView의 evidence 줄)에서도 동일한 정직한
      // 범위 라벨을 재사용할 수 있게 API가 그대로 내려준다(하드코딩 방지).
      historicalHighCoverageLabel: mode === 'rising' || mode === 'jeonse-risk' ? null : coverageLabel,
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
