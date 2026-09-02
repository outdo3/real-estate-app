import { NextResponse } from 'next/server';
import { formatKoreanPrice } from '@/lib/api-molit';
import { getOrSetCache } from '@/lib/server-cache';
import { resolveLawdCd, isValidTrade, fetchMonthsThrottledWithStatus, MonthTask } from '@/lib/molit-stats-helpers';
import { getSigunguListForSido } from '@/lib/region-utils';
import { buildGapCandidates, normalizeAptName } from '@/lib/gap-invest-calc';
import { prisma, warmupConnections } from '@/lib/prisma';
import { resolveTrustworthyPyeongBatch, pyeongLookupKeyId, type PyeongLookupKey } from '@/lib/statistics-pyeong-resolver';
import { resolvePriceRankingPeriod, type PriceRankingPeriodPreset } from '@/lib/price-ranking';
import { previousPeriodRange } from '@/lib/regional-feed';
import { getRegionalSaleRowsRawFromDb, type StoredTrade } from '@/lib/trade-history-read';
import {
  splitVerifiedMonths,
  fetchRentMonthBucketsFromDb,
  getRentMonthlyAggregateFromDb,
  getRentPeriodComparisonFromDb,
  clipDateRangeToVerified,
  type StoredRentTrade,
  type RentMonthAggregate,
} from '@/lib/rent-history-read';

// TRADE_DB_FIRST_V1 STEP B-2 — 거래량 dashboard(그래프+요약)의 매매(sale) 쪽만
// 부산 요청에 한해 DB-first로 전환했다. hotIssues/topPrices/gapInvest/complexTrades
// 등은 개별 거래 row 단위 로직(정렬/그룹핑/짝짓기)이라 순수 aggregate(COUNT/SUM 등)로
// 대체할 수 없다 — 12개월(무제한 지역과 달리 시간 범위는 bounded) 원본 row를 그대로
// 가져와 기존 JS 로직(변경 없음)에 넣는다. MOLIT-shape과 동일한 필드(price/info/
// dealAmount/aptSeq/dealCanceled 등)를 만드는 어댑터만 새로 추가한다.
//
// RENT_TRADE_HISTORY_V1 PHASE D — 전세/월세도 같은 원칙으로 부산 요청에 한해
// DB-first 전환한다. 단, sale과 근본적으로 다른 제약이 하나 있다: sale은 2006-01~
// 오늘까지 매일 갱신되는 nationwide incremental sync가 있어 "부산이면 항상 DB"가
// 성립하지만, rent는 completed-month sync로만 전진하는 **고정 스냅샷**(현재
// 202408~202608)이고 rolling window처럼 매일 갱신되지 않는다. dashboard의
// `last12Months`는 `now` 기준 rolling window라 시간이 흐를수록 window 뒤쪽(주로
// 진행 중인 현재월)이 이 스냅샷 밖으로 밀려난다 — splitVerifiedMonths()로 매
// 요청마다 검증범위 안/밖을 나눠, 검증범위 안 월만 DB로, 밖 월은 기존 MOLIT
// 경로를 그대로 쓴다("검증 안 된 기간을 DB complete로 가장하지 않는다").
//
// RENT_TRADE_HISTORY_V1 PHASE D.2 — CONSUMER SEPARATION. Phase D는 verified 개월
// 전체(최대 24개월)를 row로 통째로 옮겨 chartDataByType/volumeSummaryByPeriod까지
// 계산했는데, 이 둘은 실제로는 row-level 매칭이 전혀 필요 없다(count/avg, day 단위
// range COUNT뿐) — PERFORMANCE_V1.1-A/B가 이미 증명한 대로 SQL이 최종 값을 직접
// 계산하게 바꾼다(getRentMonthlyAggregateFromDb/getRentPeriodComparisonFromDb).
// gapInvest/jeonseRate만 apartment name+area row-level 매칭이 필요해 row를 계속
// 옮기지만, "최근 3개월 슬라이스와 겹치는 verified 월"만 좁혀서 가져온다(최대
// 24개월 대신 최대 2~3개월) — fetchRentMonthBucketsFromDb 호출 범위 축소.
const BUSAN_SIDO_CODE = '26';

function isBusanScopedRequest(lawdCd: string | null, sidoCodeParam: string | null, isSidoAll: boolean): boolean {
  if (isSidoAll) return sidoCodeParam === BUSAN_SIDO_CODE;
  return !!lawdCd && lawdCd.startsWith(BUSAN_SIDO_CODE);
}

function storedTradeToDashboardTrade(t: StoredTrade): any {
  const areaStr = `${t.exclusiveArea}m²`;
  const floorStr = t.floor != null ? `${t.floor}층` : '';
  const tradeDate = t.dealDate.toISOString().slice(0, 10);
  return {
    id: `db-sale-${t.id}`,
    name: t.aptName,
    price: formatKoreanPrice(t.dealAmount),
    dealAmount: t.dealAmount,
    monthlyRent: 0,
    typeLabel: '실거래',
    info: `${areaStr} • ${floorStr} • ${tradeDate}`,
    dong: t.dong,
    dealCanceled: t.dealCanceled,
    aptSeq: t.aptSeq,
    excluUseArea: Number(t.exclusiveArea),
    dealDate: tradeDate,
    floorRaw: t.floor,
    lawdCd: t.lawdCd,
  };
}

// RENT_TRADE_HISTORY_V1 PHASE D — sale의 storedTradeToDashboardTrade와 동일한 역할.
// dealCanceled는 항상 false로 고정한다(새로 지어내는 개념이 아니다 — MOLIT rent API
// 자체에 취소 필드가 없어, 기존 live-fetch 경로도 이미 모든 rent row에 대해 항상
// dealCanceled=false를 만들어 왔다, PHASE A §7. DB row는 애초에 취소 컬럼 자체가
// 없으므로(PHASE B §1) 이 adapter가 하는 일은 "취소 없음을 새로 판정"하는 게
// 아니라 기존과 동일한 상수 shape을 맞추는 것뿐이다).
function storedRentToDashboardTrade(r: StoredRentTrade): any {
  const areaNum = Number(r.exclusiveArea);
  const areaStr = `${areaNum}m²`;
  const floorStr = r.floor != null ? `${r.floor}층` : '';
  const tradeDate = r.dealDate.toISOString().slice(0, 10);
  const priceStr =
    r.monthlyRent > 0
      ? `보 ${formatKoreanPrice(String(r.deposit))} / 월세 ${formatKoreanPrice(String(r.monthlyRent))}`
      : `보 ${formatKoreanPrice(String(r.deposit))}`;
  return {
    name: r.aptName,
    price: priceStr,
    dealAmount: r.deposit,
    monthlyRent: r.monthlyRent,
    typeLabel: '전월세',
    info: `${areaStr} • ${floorStr} • ${tradeDate}`,
    dong: r.dong,
    dealCanceled: false,
    aptSeq: r.aptSeq,
    excluUseArea: areaNum,
    dealDate: tradeDate,
    floorRaw: r.floor,
    lawdCd: r.lawdCd,
  };
}

// last12Months(예: ["202509", ..., "202608"]) 형태와 동일하게 12개 월버킷으로
// 나눠 돌려준다 — 기존 aptMonthly[i]/aptMonthly.slice(...) 등 하위 로직이 이
// 배열 모양(12개 배열의 배열)에 의존하므로 그대로 맞춘다. lawdCd는 DB row
// 자체가 이미 정확한 값을 갖고 있어(배치 조회) 기존 MOLIT 경로처럼 수동으로
// 태그할 필요가 없다(오히려 더 정확 — 원본 row 자체의 값).
//
// PHASE D.2 §PERFORMANCE — queryTrades()(Prisma 모델 매핑 findMany) 대신
// getRegionalSaleRowsRawFromDb(raw SQL)를 쓴다. 실측: 부산 12개월 31,993
// row 기준 6.2초→수백 ms대(trade-history-read.ts 주석 참고) — dashboard
// cold 병목의 더 큰 비중이 rent가 아니라 이 sale fetch였다는 것을 이번
// 성능 감사 중 발견했다. queryTrades() 자체는 변경하지 않는다(다른
// 소비처 영향 없음).
async function fetchApt12MonthBucketsFromDb(lawdCds: string[], months: string[]): Promise<any[][]> {
  const fromYear = Number(months[0].slice(0, 4));
  const fromMonth = Number(months[0].slice(4, 6));
  const from = new Date(Date.UTC(fromYear, fromMonth - 1, 1));
  const trades = await getRegionalSaleRowsRawFromDb(lawdCds, from);
  const buckets = new Map<string, any[]>(months.map((m) => [m, []]));
  trades.forEach((t) => {
    const ym = t.dealDate.toISOString().slice(0, 7).replace('-', '');
    buckets.get(ym)?.push(storedTradeToDashboardTrade(t));
  });
  return months.map((m) => buckets.get(m)!);
}

// FIX_STATISTICS_DATA_TRUST — item.info === "면적m² • 층 • YYYY-MM-DD"에서
// raw 전용면적(㎡)만 파싱한다. 예전에는 `Math.round(areaNum / 3.3058)`로 가짜
// 평형을 만들어 화면 표시(hotIssues/gapInvest)와 "평당가" 랭킹(topPrices) 양쪽에
// 썼다 — AGENTS.md Unit Master 보호 원칙 위반. 이제 표시용 평형은 Unit Master
// batch 조회로만 채우고(resolveTrustworthyPyeongBatch), 평당가 랭킹도 Unit
// Master 신뢰 가능한 값이 있는 거래만 집계한다(가짜 평형으로 억지로 채우지
// 않음 — 표본이 줄어들 수 있지만 정직한 값만 보여준다).
const parseAreaM2 = (item: any): number | null => {
  const area = (item.info || '').split('•')[0]?.trim() || '';
  const areaNum = parseFloat(area);
  return areaNum || null;
};
const toPyeongLookupKey = (t: any): PyeongLookupKey => ({ name: t.name, dong: t.dong || '', aptSeq: t.aptSeq ?? null, rawAreaM2: parseAreaM2(t) as number });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lawdCdParam = searchParams.get('lawdCd');
  const sidoCodeParam = searchParams.get('sidoCode');
  const sido = searchParams.get('sido') || '부산광역시';
  const gungu = searchParams.get('gungu') || '서구';
  // STATISTICS REGION FILTER V2 — lawdCd 없이 sidoCode만 오면 "시도 전체".
  const isSidoAll = !lawdCdParam && !!sidoCodeParam && /^\d{2}$/.test(sidoCodeParam);

  try {
    let lawdCd: string | null = null;
    if (!isSidoAll) {
      lawdCd = lawdCdParam && /^\d{5}$/.test(lawdCdParam) ? lawdCdParam : await resolveLawdCd(sido, gungu);
      if (!lawdCd) {
        return NextResponse.json({ success: false, error: `"${sido} ${gungu}" 지역 코드를 찾을 수 없습니다.` });
      }
    }

    // RENT_TRADE_HISTORY_V1 PHASE D.2 §31 — rent source/routing이 Phase D(row-level
    // 전체 fetch)에서 Phase D.2(aggregate 분리)로 바뀌면서 응답 계산 방식 자체가
    // 달라졌다. 이 in-memory cache(server-cache.ts)는 프로세스 재시작마다 비므로
    // 배포 시 자연히 새로 채워지지만, 혹시 모를 warm-인스턴스 재사용에 대비해
    // key에 버전을 추가해 이전 코드가 만든 응답과 절대 섞이지 않게 한다(global
    // cache flush infra 없이 가능한 최소 대응).
    const cacheKey = isSidoAll ? `stats-dashboard-sido:v2:${sidoCodeParam}` : `stats-dashboard:v2:${lawdCd}`;
    // PERFORMANCE_V1 §21/§33 / PHASE D / PHASE D.2 — sido-wide(전체 시/도) 요청은
    // 매매(sale)+전세/월세 verified 개월 모두 DB-first다(Busan 한정). 검증범위
    // 밖(주로 진행 중인 현재월 1개월)만 여전히 MOLIT 호출이 필요하다. 스키마
    // 변경 없이 가능한 완화책으로 sido-wide만 TTL을 5분→30분으로
    // 늘려 이 비싼 재계산이 발생하는 빈도를 줄인다.
    const ttlMs = isSidoAll ? 30 * 60 * 1000 : 5 * 60 * 1000;
    const data = await getOrSetCache(cacheKey, ttlMs, async () => {
      const now = new Date();

      // ── 1) 최근 12개월 매매/전세: 그래프 + 핫이슈 + 갭투자 + 전세가율에 재사용 ──
      const last12Months = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
      });
      // PHASE D.2 §6 — gapInvest/jeonseRate는 "최근 3개월"만 본다(recentAptTrades/
      // recentRentTrades, 아래). row-level DB fetch는 이 슬라이스와 겹치는 verified
      // 월만 좁혀서 가져온다 — verified 전체(최대 24개월)를 다 옮기지 않는다.
      const recentMonths = last12Months.slice(-3);

      let aptMonthly: any[][];
      let rentMonthly: any[][];
      let partial = false;
      let failedLawdCds: string[] = [];
      // PHASE D.2 — chartDataByType/volumeSummaryByPeriod가 verified 개월에 한해
      // aggregate 경로를 쓰기 위해, if/else 분기 밖에서도 필요한 값들을 밖으로 끌어둔다.
      let isBusanFlag = false;
      let rentLawdCds: string[] = [];
      let verifiedRentMonthsFlag: string[] = [];
      let rentMonthlyAggregate: Map<string, RentMonthAggregate> = new Map();

      if (isSidoAll) {
        // §19/§20 성능 — 부산 16개 구 × 12개월 × 2타입 = 384 task 최대치였으나,
        // PHASE D/D.2부터는 부산 요청의 rent verified 개월만큼 MOLIT task 자체가
        // 안 만들어진다(아래 unverifiedRentMonths, 현재 11/12 verified). 기존
        // rankings sido-all과 동일한 공유 스로틀을 그대로 쓴다(새 동시성 풀 없음).
        // PERFORMANCE_V1.2 — getSigunguListForSido(외부 네트워크 호출)와 겹쳐서
        // DB 커넥션을 미리 몇 개 워밍업해둔다. 아래에서 sale/rent-rows/rent-agg
        // 3개 DB 쿼리를 Promise.all로 "동시에" 쏘는데, 커넥션이 전부 콜드면 각자
        // 새 연결을 맺어야 해 병렬 실행의 이득이 사라진다(prisma.ts 주석 참고).
        const [districts] = await Promise.all([getSigunguListForSido(sidoCodeParam!), warmupConnections(3)]);
        const lawdCds = districts.map((d) => d.code.substring(0, 5));
        const isBusan = isBusanScopedRequest(null, sidoCodeParam, true);
        // RENT_TRADE_HISTORY_V1 PHASE D — 부산 요청만 verified/unverified로 나눈다
        // (비부산은 rent DB 자체가 없으므로 전부 unverified 취급 = 기존과 동일하게
        // 전부 MOLIT).
        const { verified: verifiedRentMonths, unverified: unverifiedRentMonths } = isBusan
          ? splitVerifiedMonths(last12Months)
          : { verified: [] as string[], unverified: last12Months };
        // PHASE D.2 §6 — row-level(gapInvest/jeonseRate)용으로는 verified 중 최근
        // 3개월 슬라이스와 겹치는 월만 좁혀서 DB에 묻는다.
        const rowLevelVerifiedMonths = verifiedRentMonths.filter((m) => recentMonths.includes(m));
        isBusanFlag = isBusan;
        rentLawdCds = lawdCds;
        verifiedRentMonthsFlag = verifiedRentMonths;
        const tasks: MonthTask[] = [];
        for (const dLawdCd of lawdCds) {
          for (const ym of last12Months) {
            // 부산 매매는 DB에서 가져오므로 MOLIT apt task 자체를 만들지 않는다
            // (호출 수 절반 절감, yearly.ts와 동일 원칙).
            if (!isBusan) tasks.push({ key: `${dLawdCd}|apt:${ym}`, lawdCd: dLawdCd, dealYmd: ym, type: 'apt' });
          }
          // rent는 verified 개월만 DB로 빠지고, unverified 개월(부산이 아니면 전체
          // 12개월)만 MOLIT task를 만든다 — 검증 안 된 기간을 DB complete로
          // 가장하지 않는다(PHASE D §16/§17).
          for (const ym of unverifiedRentMonths) {
            tasks.push({ key: `${dLawdCd}|rent:${ym}`, lawdCd: dLawdCd, dealYmd: ym, type: 'rent' });
          }
        }
        const [results, aptMonthlyFromDb, rentBucketsFromDb, rentAggFromDb] = await Promise.all([
          fetchMonthsThrottledWithStatus(tasks),
          isBusan ? fetchApt12MonthBucketsFromDb(lawdCds, last12Months) : Promise.resolve(null),
          isBusan ? fetchRentMonthBucketsFromDb(lawdCds, rowLevelVerifiedMonths) : Promise.resolve(null),
          isBusan ? getRentMonthlyAggregateFromDb(lawdCds, verifiedRentMonths) : Promise.resolve(null),
        ]);
        if (rentAggFromDb) rentMonthlyAggregate = rentAggFromDb;
        const failedSet = new Set<string>();
        for (const dLawdCd of lawdCds) {
          for (const ym of last12Months) {
            // 부산 매매는 MOLIT을 호출하지 않으므로 실패 개념이 없다(DB 조회
            // 실패는 route 최상위 catch로 전체 실패 처리 — MOLIT처럼 구별
            // partial degrade 대상 아님). rent도 verified 개월은 동일 원칙 —
            // task 자체가 없어 results[...]가 undefined이므로 아래 optional
            // chaining이 자연히 false를 반환한다(부산 매매와 동일 처리).
            const aptFailed = !isBusan && results[`${dLawdCd}|apt:${ym}`]?.failed;
            if (aptFailed || results[`${dLawdCd}|rent:${ym}`]?.failed) failedSet.add(dLawdCd);
          }
        }
        failedLawdCds = Array.from(failedSet);
        partial = failedLawdCds.length > 0;
        // 시도 전체 집계는 구별로 트레이드를 합치기 때문에, 합치기 전 원본
        // lawdCd를 각 거래에 태그해 둔다 — GapInvestView/hotIssues 등이 단지
        // 상세로 이동할 때 어느 구 소속인지 몰라 잘못된 단지로 연결되는 것을
        // 막기 위함(§25 canonical route 요구사항). DB 경로는 row 자체가 이미
        // 정확한 lawdCd를 갖고 있어 별도 태그가 필요 없다.
        aptMonthly = isBusan
          ? aptMonthlyFromDb!
          : last12Months.map((ym) => lawdCds.flatMap((d) => (results[`${d}|apt:${ym}`]?.items || []).map((t: any) => ({ ...t, lawdCd: d }))));
        // PHASE D.2 — verified이지만 row-level 슬라이스 밖인 달은 빈 배열이다(그 달의
        // chart 집계는 rentMonthlyAggregate에서 온다, gapInvest/jeonseRate는 애초에
        // 최근 3개월만 보므로 이 달의 row가 필요 없다).
        rentMonthly = last12Months.map((ym) => {
          if (isBusan && rowLevelVerifiedMonths.includes(ym)) {
            return (rentBucketsFromDb?.get(ym) || []).map(storedRentToDashboardTrade);
          }
          if (isBusan && verifiedRentMonths.includes(ym)) return [];
          return lawdCds.flatMap((d) => (results[`${d}|rent:${ym}`]?.items || []).map((t: any) => ({ ...t, lawdCd: d })));
        });
      } else {
        const isBusan = isBusanScopedRequest(lawdCd, null, false);
        const { verified: verifiedRentMonths, unverified: unverifiedRentMonths } = isBusan
          ? splitVerifiedMonths(last12Months)
          : { verified: [] as string[], unverified: last12Months };
        const rowLevelVerifiedMonths = verifiedRentMonths.filter((m) => recentMonths.includes(m));
        isBusanFlag = isBusan;
        rentLawdCds = [lawdCd!];
        verifiedRentMonthsFlag = verifiedRentMonths;
        const rollingTasks: MonthTask[] = [
          ...(isBusan ? [] : last12Months.map((dealYmd) => ({ key: `apt-roll-${dealYmd}`, lawdCd: lawdCd!, dealYmd, type: 'apt' as const }))),
          ...unverifiedRentMonths.map((dealYmd) => ({ key: `rent-roll-${dealYmd}`, lawdCd: lawdCd!, dealYmd, type: 'rent' as const })),
        ];
        // LAUNCH_TRUST_BLOCKERS_V1 — 예전에는 실패 여부를 버리는 fetchMonthsThrottled를
        // 써서, 단일 지역(구) 요청에서 MOLIT 호출이 실패한 달이 조용히 빈 배열이 되어
        // "거래 0건"과 구분이 안 됐다(시도 전체 분기는 이미 failedLawdCds로 구분함).
        // fetchMonthsThrottledWithStatus로 바꿔 실패 여부를 유지하고, 부산(DB 조회,
        // 실패 시 상위 try/catch가 전체 요청을 실패 처리함)이 아닌 한 개라도 실패한
        // 달이 있으면 partial=true로 표시한다.
        const [taskResults, aptMonthlyFromDb, rentBucketsFromDb, rentAggFromDb] = await Promise.all([
          fetchMonthsThrottledWithStatus(rollingTasks),
          isBusan ? fetchApt12MonthBucketsFromDb([lawdCd!], last12Months) : Promise.resolve(null),
          isBusan ? fetchRentMonthBucketsFromDb([lawdCd!], rowLevelVerifiedMonths) : Promise.resolve(null),
          isBusan ? getRentMonthlyAggregateFromDb([lawdCd!], verifiedRentMonths) : Promise.resolve(null),
        ]);
        if (rentAggFromDb) rentMonthlyAggregate = rentAggFromDb;
        aptMonthly = isBusan
          ? aptMonthlyFromDb!
          : last12Months.map((dealYmd) => (taskResults[`apt-roll-${dealYmd}`]?.items || []).map((t: any) => ({ ...t, lawdCd: lawdCd })));
        rentMonthly = last12Months.map((dealYmd) => {
          if (isBusan && rowLevelVerifiedMonths.includes(dealYmd)) {
            return (rentBucketsFromDb?.get(dealYmd) || []).map(storedRentToDashboardTrade);
          }
          if (isBusan && verifiedRentMonths.includes(dealYmd)) return [];
          return (taskResults[`rent-roll-${dealYmd}`]?.items || []).map((t: any) => ({ ...t, lawdCd: lawdCd }));
        });
        const anyTaskFailed = rollingTasks.some((task) => taskResults[task.key]?.failed);
        if (anyTaskFailed) {
          partial = true;
          failedLawdCds = [lawdCd!];
        }
      }

      const allAptTrades = aptMonthly.flat().filter(isValidTrade);
      const recentAptTrades = aptMonthly.slice(-3).flat().filter(isValidTrade);
      const recentRentTrades = rentMonthly.slice(-3).flat().filter(isValidTrade);

      // ── STATISTICS V2.1-2 §13~§18 — 거래량 기간별 이전 기간 대비 비교 ──
      // "거래량이 많다"가 아니라 "이전 기간보다 얼마나 변했는지"가 핵심이다.
      // 7일/30일/3개월만 지원한다(§16, 차트 재설계는 범위 밖).
      //
      // RENT_TRADE_HISTORY_V1 PHASE D.2 §8/§9 — Phase D까지는 12개월치 rent row를
      // 전부 옮겨와 JS에서 날짜 필터링했다(countInRange). day 단위 range COUNT는
      // row-level 매칭이 필요 없는 순수 aggregate라 SQL로 직접 계산할 수 있다 —
      // Busan verified 구간은 getRentPeriodComparisonFromDb(GROUP BY + FILTER,
      // raw row materialization 없음)로, 검증범위 밖(현재 진행중인 월, 이미
      // MOLIT로 받아둔 소량의 row)만 JS로 보충한다(hybrid, 이중 카운트 방지는
      // clipDateRangeToVerified의 배타적 경계로 보장됨). 비부산은 rent DB 자체가
      // 없으므로 기존 row 전체 기반 계산을 그대로 쓴다(동작 변경 없음).
      const VOLUME_COMPARISON_PRESETS: PriceRankingPeriodPreset[] = ['7d', '30d', '3m'];
      const verifiedApt = allAptTrades.filter((t: any) => !t.dealCanceled);
      const countInRange = (trades: any[], range: { from: string; to: string }) =>
        trades.filter((t: any) => t.dealDate >= range.from && t.dealDate <= range.to).length;
      const buildComparison = (trades: any[], current: { from: string; to: string }, previous: { from: string; to: string }) => {
        const currentCount = countInRange(trades, current);
        const previousCount = countInRange(trades, previous);
        const changeCount = currentCount - previousCount;
        const changePct = previousCount > 0 ? Math.round((changeCount / previousCount) * 1000) / 10 : null;
        return { currentCount, previousCount, changeCount, changePct };
      };
      const mkComparison = (currentCount: number, previousCount: number) => {
        const changeCount = currentCount - previousCount;
        const changePct = previousCount > 0 ? Math.round((changeCount / previousCount) * 1000) / 10 : null;
        return { currentCount, previousCount, changeCount, changePct };
      };
      const toUtcDateFromYmd = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
      const addOneDayUtc = (d: Date) => new Date(d.getTime() + 24 * 60 * 60 * 1000);
      // 검증범위 밖(진행 중인 현재월 등)의 remainder만 이미 가져온 MOLIT row에서 센다.
      // clipDateRangeToVerified가 반환하는 clipped.to의 "다음 날"부터가 remainder
      // 시작점이므로 DB가 이미 센 구간과 절대 겹치지 않는다(§ 이중 카운트 방지).
      const countRentRemainderByType = (rows: any[], from: Date, to: Date) => {
        const clipped = clipDateRangeToVerified(from, to);
        const remainderFrom = clipped ? addOneDayUtc(clipped.to) : from;
        if (remainderFrom > to) return { jeonse: 0, wolse: 0 };
        const fromStr = remainderFrom.toISOString().slice(0, 10);
        const toStr = to.toISOString().slice(0, 10);
        let jeonse = 0;
        let wolse = 0;
        for (const t of rows) {
          if (!isValidTrade(t)) continue;
          if (t.dealDate < fromStr || t.dealDate > toStr) continue;
          if (!t.monthlyRent || t.monthlyRent === 0) jeonse++;
          else wolse++;
        }
        return { jeonse, wolse };
      };

      const volumeSummaryByPeriod: Record<string, any> = {};
      if (isBusanFlag) {
        // verified 개월(row-level 슬라이스 포함)은 SQL aggregate가 이미 정확히
        // 세므로, 여기서는 진짜 unverified(MOLIT) 개월의 row만 remainder 계산에
        // 쓴다 — verified-and-row-level 달의 row를 섞으면 이중 카운트가 된다.
        const unverifiedRentRowsFlat = last12Months.flatMap((ym, i) => (verifiedRentMonthsFlag.includes(ym) ? [] : rentMonthly[i]));
        for (const preset of VOLUME_COMPARISON_PRESETS) {
          const current = resolvePriceRankingPeriod(preset, now);
          const previous = previousPeriodRange(current);
          const currentFromDate = toUtcDateFromYmd(current.from);
          const currentToDate = toUtcDateFromYmd(current.to);
          const previousFromDate = toUtcDateFromYmd(previous.from);
          const previousToDate = toUtcDateFromYmd(previous.to);
          const dbCounts = await getRentPeriodComparisonFromDb(
            rentLawdCds,
            { from: currentFromDate, to: currentToDate },
            { from: previousFromDate, to: previousToDate }
          );
          const currentRemainder = countRentRemainderByType(unverifiedRentRowsFlat, currentFromDate, currentToDate);
          const previousRemainder = countRentRemainderByType(unverifiedRentRowsFlat, previousFromDate, previousToDate);
          volumeSummaryByPeriod[preset] = {
            period: current,
            previousPeriod: previous,
            sale: buildComparison(verifiedApt, current, previous),
            jeonse: mkComparison(dbCounts.current.jeonse + currentRemainder.jeonse, dbCounts.previous.jeonse + previousRemainder.jeonse),
            wolse: mkComparison(dbCounts.current.wolse + currentRemainder.wolse, dbCounts.previous.wolse + previousRemainder.wolse),
          };
        }
      } else {
        // 비부산 — rent DB 자체가 없으므로 rentMonthly가 항상 전체 12개월 row로
        // 채워져 있다(기존 Phase D 이전 동작과 완전히 동일, 변경 없음).
        const allRentTrades = rentMonthly.flat().filter(isValidTrade);
        const verifiedRentAll = allRentTrades.filter((t: any) => !t.dealCanceled);
        const verifiedJeonse = verifiedRentAll.filter((t: any) => !t.monthlyRent || t.monthlyRent === 0);
        const verifiedWolse = verifiedRentAll.filter((t: any) => t.monthlyRent && t.monthlyRent > 0);
        for (const preset of VOLUME_COMPARISON_PRESETS) {
          const current = resolvePriceRankingPeriod(preset, now);
          const previous = previousPeriodRange(current);
          volumeSummaryByPeriod[preset] = {
            period: current,
            previousPeriod: previous,
            sale: buildComparison(verifiedApt, current, previous),
            jeonse: buildComparison(verifiedJeonse, current, previous),
            wolse: buildComparison(verifiedWolse, current, previous),
          };
        }
      }

      // ── 2) 월별 그래프 데이터: 거래유형(매매/전세/월세)별 거래량(막대) + 가격지수(꺾은선,
      // 최초 유효월=100 기준). 세 유형 모두 한 번에 계산해둬서 클라이언트가 칩을 눌러
      // 유형을 바꿀 때마다 새로 API를 부를 필요가 없게 한다.
      //
      // PHASE D.2 §8/§9 — Busan verified rent 개월은 rentMonthlyAggregate(SQL
      // GROUP BY, row materialization 없음)에서 직접 count/avg를 읽는다. sale은
      // 항상, rent의 unverified/비부산 개월은 그대로 rentMonthly[i] row 기반
      // 계산을 쓴다(기존 로직 변경 없음).
      const buildChartData = (dealType: 'sale' | 'jeonse' | 'wolse') => {
        const monthlyAgg = last12Months.map((ym, i) => {
          if (dealType !== 'sale' && isBusanFlag && verifiedRentMonthsFlag.includes(ym)) {
            const agg = rentMonthlyAggregate.get(ym);
            const typeAgg = dealType === 'jeonse' ? agg?.jeonse : agg?.wolse;
            return { month: `${ym.substring(2, 4)}.${ym.substring(4, 6)}`, volume: typeAgg?.count ?? 0, avg: typeAgg?.avgDeposit ?? null };
          }
          const aptTrades = aptMonthly[i].filter(isValidTrade);
          const rentTrades = rentMonthly[i].filter(isValidTrade);
          const selected =
            dealType === 'sale'
              ? aptTrades
              : dealType === 'jeonse'
                ? rentTrades.filter((t: any) => !t.monthlyRent || t.monthlyRent === 0)
                : rentTrades.filter((t: any) => t.monthlyRent && t.monthlyRent > 0);
          const avg = selected.length ? selected.reduce((s: number, t: any) => s + t.dealAmount, 0) / selected.length : null;
          return { month: `${ym.substring(2, 4)}.${ym.substring(4, 6)}`, volume: selected.length, avg };
        });
        const base = monthlyAgg.find((d) => d.avg)?.avg || null;
        return monthlyAgg.map((d) => ({
          month: d.month,
          volume: d.volume,
          priceIndex: base && d.avg ? Math.round((d.avg / base) * 1000) / 10 : null,
        }));
      };
      const chartDataByType = {
        sale: buildChartData('sale'),
        jeonse: buildChartData('jeonse'),
        wolse: buildChartData('wolse'),
      };
      const chartData = chartDataByType.sale; // 하위 호환: 기존 소비처(AI 검색 등)는 이 필드만 읽음

      // FIX_STATISTICS_DATA_TRUST — hotIssues(표시용)와 topPrices(평당가 집계,
      // 분모 자체에 평형이 들어감) 양쪽 다 Unit Master 조회가 끝나야 값을 채울
      // 수 있어, 필요한 lookup key를 먼저 전부 모아 batch 조회 한 번으로
      // 끝낸다(거래 개수만큼 DB 조회 안 함 — 쿼리 2회 고정).
      const pyeongLookupKeys = new Map<string, PyeongLookupKey>();
      allAptTrades.forEach((t: any) => {
        const key = toPyeongLookupKey(t);
        if (key.rawAreaM2 != null) pyeongLookupKeys.set(pyeongLookupKeyId(key), key);
      });
      const pyeongMap = await resolveTrustworthyPyeongBatch(prisma, Array.from(pyeongLookupKeys.values()));
      const lookupPyeong = (t: any): number | null => {
        const key = toPyeongLookupKey(t);
        if (key.rawAreaM2 == null) return null;
        return pyeongMap.get(pyeongLookupKeyId(key)) ?? null;
      };

      // ── 3) 핫이슈 거래: 최근 3개월 중 최고가 개별 거래 Top 5 ──
      const hotIssues = [...recentAptTrades]
        .sort((a: any, b: any) => b.dealAmount - a.dealAmount)
        .slice(0, 5)
        .map((t: any, i: number) => ({
          rank: i + 1,
          name: t.name,
          dong: t.dong || '',
          lawdCd: t.lawdCd,
          pyung: lookupPyeong(t),
          exclusiveAreaM2: parseAreaM2(t),
          price: t.price,
          dealCount: allAptTrades.filter((x: any) => normalizeAptName(x.name) === normalizeAptName(t.name)).length,
        }));

      // ── 4) 단지 랭킹: 최근 1년 평당가 평균 Top 5 — Unit Master 신뢰 가능한
      // 평형이 있는 거래만 집계한다(가짜 평형으로 채우지 않음, 표본이 줄어들
      // 수 있음을 감수한다).
      const pyungAgg: Record<string, { name: string; sum: number; count: number }> = {};
      allAptTrades.forEach((t: any) => {
        const pyung = lookupPyeong(t);
        if (!pyung || pyung <= 0) return;
        const key = normalizeAptName(t.name);
        const pricePerPyung = t.dealAmount / pyung;
        if (!pyungAgg[key]) pyungAgg[key] = { name: t.name, sum: 0, count: 0 };
        pyungAgg[key].sum += pricePerPyung;
        pyungAgg[key].count += 1;
      });
      const topPrices = Object.values(pyungAgg)
        .map((c) => ({ name: c.name, avgPricePerPyung: c.sum / c.count, dealCount: c.count }))
        .sort((a, b) => b.avgPricePerPyung - a.avgPricePerPyung)
        .slice(0, 5)
        .map((c, i) => ({
          rank: i + 1,
          name: c.name,
          pricePerPyung: `${Math.round(c.avgPricePerPyung).toLocaleString('ko-KR')}만/평`,
          dealCount: c.dealCount,
        }));

      // ── 5) 갭투자: 최근 3개월 내 매매+전세가 모두 존재하는 단지의 (매매가-전세보증금) Top 5 ──
      // [STATISTICS V2.1 correctness hotfix] 기존에는 단지명만으로 묶어 배열의 첫
      // 원소를 "최근 매매"/"최근 전세"로 썼다 — 부산 서구 3개월 표본 실측 결과
      // 133개 후보 중 68건(51%)이 서로 다른 전용면적의 매매/전세를 뺀 값이었다
      // (예: "엘지" 49.83㎡ 매매 vs 134.94㎡ 전세). pairing 로직을
      // src/lib/gap-invest-calc.ts로 분리해 단위 테스트로 검증했다 — (정규화된
      // 단지명, 정확한 excluUseArea) 조합만 짝짓고(AREA MODEL V1 원칙대로 근접값
      // 병합 없음), dealDate 기준 정렬로 진짜 최신 거래를 고르며, 취소(해제)된
      // 매매와 반전세/월세(monthlyRent>0)는 제외한다.
      const recentPureJeonseTrades = recentRentTrades.filter((t: any) => !t.monthlyRent || t.monthlyRent === 0);
      const gapCandidates = buildGapCandidates(recentAptTrades, recentPureJeonseTrades)
        .map((c) => ({
          name: c.name,
          dong: c.dong,
          lawdCd: c.lawdCd,
          // FIX_STATISTICS_DATA_TRUST — 이전에는 `exclusiveAreaM2 / 3.3058`로
          // 가짜 평형을 만들었다. 갭투자 후보의 aptSeq+name+dong+raw면적은 이미
          // 위에서 매매 거래 전체 기준으로 batch 조회해 둔 pyeongMap에 대부분
          // 포함돼 있어 재조회 없이 조회만 한다 — 없으면 null(raw ㎡만 표시).
          pyung: pyeongMap.get(pyeongLookupKeyId({ name: c.name, dong: c.dong, aptSeq: c.aptSeq, rawAreaM2: c.exclusiveAreaM2 })) ?? null,
          exclusiveAreaM2: c.exclusiveAreaM2,
          gap: c.gap,
          dealCount: c.latestSale.tradeCount,
        }))
        .filter((c) => c.gap >= 0);

      const gapInvest = gapCandidates
        .sort((a, b) => a.gap - b.gap)
        .slice(0, 5)
        .map((c, i) => ({
          rank: i + 1,
          name: c.name,
          dong: c.dong,
          lawdCd: c.lawdCd,
          pyung: c.pyung,
          gap: formatKoreanPrice(c.gap),
          dealCount: c.dealCount,
        }));

      // ── 6) 전세가율: 매매+전세가 모두 있는 단지들의 (전세/매매) 평균 비율 ──
      // 지역 전체 평균 비율 계산은 이번 STEP의 감사 대상이 아니다 — 기존과 동일
      // 하게 단지명 단위(면적 무관)로만 그룹핑해 그대로 둔다.
      const aptByComplex: Record<string, any[]> = {};
      recentAptTrades.forEach((t: any) => {
        const key = normalizeAptName(t.name);
        (aptByComplex[key] ||= []).push(t);
      });
      const rentByComplex: Record<string, any[]> = {};
      // 전세가율은 전세 보증금 대비 매매가라 반전세/월세(monthlyRent>0)가 섞이면
      // 평균 보증금이 왜곡된다 — recentPureJeonseTrades(순수 전세만, §5에서 계산됨)를
      // 써야 한다(과거 -97% 허위 "역전세" 사례와 동일한 버그 클래스, rankings/route.ts:113 참고).
      recentPureJeonseTrades.forEach((t: any) => {
        const key = normalizeAptName(t.name);
        (rentByComplex[key] ||= []).push(t);
      });
      const jeonseRatios: number[] = [];
      Object.keys(aptByComplex).forEach((key) => {
        const rents = rentByComplex[key];
        if (!rents?.length) return;
        const apts = aptByComplex[key];
        const avgApt = apts.reduce((s: number, t: any) => s + t.dealAmount, 0) / apts.length;
        const avgRent = rents.reduce((s: number, t: any) => s + t.dealAmount, 0) / rents.length;
        if (avgApt > 0) jeonseRatios.push((avgRent / avgApt) * 100);
      });
      const jeonseRate = jeonseRatios.length
        ? Math.round((jeonseRatios.reduce((a, b) => a + b, 0) / jeonseRatios.length) * 10) / 10
        : null;

      const volume = aptMonthly[11]?.filter(isValidTrade).length || 0;
      const prevVolume = aptMonthly[10]?.filter(isValidTrade).length || 0;

      // ── AI 검색 거래량 카드의 기간 선택(1/3/6/12개월)용: 각 기간 창 안에서 단지별
      // 거래건수를 집계해 상위 단지 순위를 미리 계산해둔다. allAptTrades는 이미 12개월치를
      // 다 갖고 있으므로 클라이언트가 기간을 바꿀 때마다 새로 API를 부를 필요가 없다.
      const buildVolumeRanking = (monthsBack: number) => {
        const windowTrades = aptMonthly.slice(12 - monthsBack).flat().filter(isValidTrade);
        const byName: Record<string, { name: string; dong: string; count: number }> = {};
        windowTrades.forEach((t: any) => {
          const key = normalizeAptName(t.name);
          if (!byName[key]) byName[key] = { name: t.name, dong: t.dong || '', count: 0 };
          byName[key].count += 1;
        });
        return Object.values(byName)
          .sort((a, b) => b.count - a.count)
          .slice(0, 10)
          .map((c, i) => ({ rank: i + 1, name: c.name, dong: c.dong, dealCount: c.count }));
      };
      const volumeRanking = {
        '1': buildVolumeRanking(1),
        '3': buildVolumeRanking(3),
        '6': buildVolumeRanking(6),
        '12': buildVolumeRanking(12),
      };
      const volumeByPeriod = {
        '1': volume,
        '3': aptMonthly.slice(9).flat().filter(isValidTrade).length,
        '6': aptMonthly.slice(6).flat().filter(isValidTrade).length,
        '12': allAptTrades.length,
      };

      // ── 7) 클릭 시 팝업으로 보여줄 실거래 내역 ──
      const tradeDetail = (t: any) => ({
        name: t.name,
        price: t.price,
        tradeDate: (t.info || '').split('•').pop()?.trim() || '',
        dong: t.dong || '',
      });

      const currentMonthTrades = (aptMonthly[11] || [])
        .filter(isValidTrade)
        .map(tradeDetail)
        .sort((a: any, b: any) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());

      const clickableNames = new Set<string>([
        ...hotIssues.map((h) => normalizeAptName(h.name)),
        ...topPrices.map((h) => normalizeAptName(h.name)),
        ...gapInvest.map((h) => normalizeAptName(h.name)),
      ]);
      const complexTrades: Record<string, ReturnType<typeof tradeDetail>[]> = {};
      allAptTrades.forEach((t: any) => {
        const key = normalizeAptName(t.name);
        if (!clickableNames.has(key)) return;
        (complexTrades[key] ||= []).push(tradeDetail(t));
      });
      Object.values(complexTrades).forEach((list) =>
        list.sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime())
      );
      return {
        summary: {
          volume,
          volumeChange: volume - prevVolume,
          chonseRate: jeonseRate,
        },
        chartData,
        chartDataByType,
        volumeSummaryByPeriod,
        hotIssues,
        gapInvest,
        topPrices,
        jeonseRate,
        currentMonthTrades,
        complexTrades,
        volumeRanking,
        volumeByPeriod,
        sidoAll: isSidoAll,
        sidoCode: sidoCodeParam,
        lawdCd,
        partial,
        failedDistricts: failedLawdCds,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('Failed to fetch dashboard molit data:', err);
    return NextResponse.json({ success: false, error: 'API Error' });
  }
}
