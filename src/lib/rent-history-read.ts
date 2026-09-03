// RENT_TRADE_HISTORY_V1 PHASE D/D.2 — 전월세(jeonse/wolse) DB-first 공통 read layer.
// trade-history-read.ts(매매)와 같은 원칙: 이 파일은 fetchMolitData/molit-stats-helpers를
// import하지 않는다(grep으로 재확인 가능) — MOLIT 호출 없이 apartment_rent_histories만
// 읽는다.
//
// 검증범위는 "오늘 기준 최근 N개월"이 아니라 실제 sync 증거로 확정된 **고정 스냅샷**
// (rent-verified-range.ts 참고)이다 — sale(2006-01~, 매일 갱신되는 nationwide incremental
// sync 존재)과 근본적으로 다르다. 이 파일은 그 경계를 명시적으로 강제한다 — 호출부는
// 반드시 splitVerifiedMonths()로 verified/unverified를 나눠 verified만 이 파일에 묻어야
// 하고, 각 함수도 방어적으로 범위를 벗어난 데이터는 절대 조회하지 않는다.
//
// PHASE D.2 — CONSUMER SEPARATION(§6): dashboard/volume은 row-level 매칭이 필요 없다
// (region/month/dealType 단위 count/avg, 그리고 day 단위 range COUNT만 필요) — 이 둘은
// PERFORMANCE_V1.1-A/B가 이미 증명한 대로 raw row를 Node로 옮기지 않고 SQL이 최종/준최종
// 값을 직접 계산해야 한다(getRentMonthlyAggregateFromDb/getRentPeriodComparisonFromDb).
// gapInvest/jeonseRate만 실제 apartment name+area row-level 매칭이 필요해
// fetchRentMonthBucketsFromDb(row-level path)를 계속 쓰지만, 호출부(dashboard/route.ts)가
// 이제 "최근 3개월 슬라이스와 겹치는 verified 월"만 좁혀서 넘긴다 — 예전처럼 verified
// 전체(최대 24개월)를 다 row로 옮기지 않는다.
// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §24 — 검증범위는 더 이상 module load 시점에 고정되는
// 상수가 아니다. Vercel에서 파일 기반 coverage가 durable할 수 없음이 실측으로 확인돼
// (rent-verified-range.ts 헤더 참고) 이제 DB(sync_coverage_cells)에서 읽는다. 따라서 범위를
// 쓰는 지점은 반드시 await로 조회한다 — 이 파일의 함수들은 원래 전부 async였으므로 호출
// 계약은 그대로다.
import { prisma } from './prisma';
import { clipDateRangeToVerified } from './rent-verified-range';
import { getRentVerifiedRange } from './sync-coverage';

export { splitVerifiedMonths, verifiedToDateInclusive, verifiedFromDateInclusive, clipDateRangeToVerified } from './rent-verified-range';
export { getRentVerifiedRange } from './sync-coverage';

export interface StoredRentTrade {
  lawdCd: string;
  aptSeq: string | null;
  aptName: string;
  dong: string;
  exclusiveArea: string; // Prisma.Decimal -> string(정밀도 보존, trade-history-read.ts와 동일 관례)
  deposit: number;
  monthlyRent: number;
  dealType: string; // 'jeonse' | 'wolse'
  dealDate: Date;
  dealYmd: string;
  floor: number | null;
  buildYear: number | null;
  jibun: string | null;
}

function ymStartDate(ym: string): Date {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(4, 6)) - 1, 1));
}
function ymEndDate(ym: string): Date {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(4, 6)), 0));
}

/** lawdCd(들) x 월(들)에 해당하는 apartment_rent_histories row를 월별로 버킷팅해
 * 반환한다 — 단일 쿼리(§13 ONE QUERY PREFERENCE, N+1 금지). months에 검증범위 밖 월이
 * 섞여 있으면 조용히 무시한다(빈 버킷) — 호출부가 반드시 splitVerifiedMonths()로 미리
 * 걸러야 하고, 이 함수 자체도 방어적으로 범위를 벗어난 월은 절대 조회하지 않는다(검증
 * 안 된 기간을 "DB complete"로 가장하지 않기 위한 이중 안전장치, PHASE D §5/§16).
 *
 * PHASE D.2 — row-level 매칭(gapInvest/jeonseRate)에만 쓴다. 호출부는 verified 전체가
 * 아니라 "최근 3개월 슬라이스와 겹치는 verified 월"만 좁혀서 넘겨야 한다(§6 CONSUMER
 * SEPARATION) — chart/volume-summary aggregate는 아래 getRentMonthlyAggregateFromDb/
 * getRentPeriodComparisonFromDb를 쓴다. */
export async function fetchRentMonthBucketsFromDb(lawdCds: string[], months: string[]): Promise<Map<string, StoredRentTrade[]>> {
  const buckets = new Map<string, StoredRentTrade[]>(months.map((m) => [m, []]));
  const range = await getRentVerifiedRange();
  const inRange = months.filter((m) => m >= range.from && m <= range.to);
  if (inRange.length === 0 || lawdCds.length === 0) return buckets;

  const sorted = [...inRange].sort();
  const from = ymStartDate(sorted[0]);
  const to = ymEndDate(sorted[sorted.length - 1]);

  // PERFORMANCE_V1.1_AREA84_INDEX/PERFORMANCE_V1.1_B가 이미 실측한 교훈 재적용 — Prisma의
  // 모델 매핑 findMany는 select를 좁혀도(48,768 rows 기준 8.0s→3.86s) 여전히 raw SQL
  // (동일 조건, 동일 row 수, 2.34s)보다 느리다. row 자체는 반드시 옮겨야 하므로(gapInvest/
  // jeonseRate는 apartment name+area 단위 row-level 매칭이 필요해 aggregate로 대체 불가)
  // 최소한 "옮기는 방식"만 더 빠르게 한다.
  const rows = await prisma.$queryRaw<
    { lawdCd: string; aptSeq: string | null; aptName: string; dong: string; exclusiveArea: string; deposit: number; monthlyRent: number; dealType: string; dealDate: Date; dealYmd: string; floor: number | null; buildYear: number | null; jibun: string | null }[]
  >`
    SELECT lawd_cd as "lawdCd", apt_seq as "aptSeq", apt_name as "aptName", dong,
           exclusive_area::text as "exclusiveArea", deposit, monthly_rent as "monthlyRent",
           deal_type as "dealType", deal_date as "dealDate", deal_ymd as "dealYmd",
           floor, build_year as "buildYear", jibun
    FROM apartment_rent_histories
    WHERE lawd_cd = ANY(${lawdCds}) AND deal_date >= ${from} AND deal_date <= ${to}
  `;
  for (const r of rows) {
    const bucket = buckets.get(r.dealYmd);
    if (bucket) bucket.push(r);
  }
  return buckets;
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE D.2 — AGGREGATE PATH(§6/§8/§9). dashboard의 chartDataByType(월별 거래량+
// 평균가)과 volumeSummaryByPeriod(7일/30일/3개월 비교)는 row-level 매칭이 전혀 필요
// 없다(count/avg, 그리고 day 단위 range COUNT뿐) — PERFORMANCE_V1.1-A/B와 동일하게
// raw row를 Node로 옮기지 않고 SQL이 최종 값을 직접 계산한다. 두 함수 모두 lawdCd
// 배열 전체를 한 번에 받아 단일 쿼리로 처리한다(§13 ONE QUERY PREFERENCE — 부산
// 16구를 구별로 16번 쏘지 않음). isValidTrade(dashboard/route.ts)의 `dealAmount > 0`
// 배제 규칙과 동일하게 `deposit > 0`만 집계한다(순수월세 deposit=0 edge case는 기존
// 라이브 경로도 동일하게 제외해 왔음 — PHASE D §21 실측 확인).
// ══════════════════════════════════════════════════════════════════════════

export interface RentMonthTypeAggregate {
  count: number;
  avgDeposit: number | null;
}
export interface RentMonthAggregate {
  jeonse: RentMonthTypeAggregate;
  wolse: RentMonthTypeAggregate;
}

const ZERO_TYPE_AGG: RentMonthTypeAggregate = { count: 0, avgDeposit: null };

/** lawdCd(들) x 월(들)의 dealType별 count/avg(deposit)를 단일 GROUP BY 쿼리로 반환한다
 * (raw row materialization 없음). months에 검증범위 밖 월이 섞여 있으면 조용히 무시
 * (0/null) — fetchRentMonthBucketsFromDb와 동일한 이중 안전장치. */
export async function getRentMonthlyAggregateFromDb(lawdCds: string[], months: string[]): Promise<Map<string, RentMonthAggregate>> {
  const buckets = new Map<string, RentMonthAggregate>(months.map((m) => [m, { jeonse: { ...ZERO_TYPE_AGG }, wolse: { ...ZERO_TYPE_AGG } }]));
  const range = await getRentVerifiedRange();
  const inRange = months.filter((m) => m >= range.from && m <= range.to);
  if (inRange.length === 0 || lawdCds.length === 0) return buckets;

  const sorted = [...inRange].sort();
  const from = ymStartDate(sorted[0]);
  const to = ymEndDate(sorted[sorted.length - 1]);

  const rows = await prisma.$queryRaw<{ deal_ymd: string; deal_type: string; cnt: bigint; avg_deposit: number | null }[]>`
    SELECT deal_ymd, deal_type, COUNT(*) as cnt, AVG(deposit)::float as avg_deposit
    FROM apartment_rent_histories
    WHERE lawd_cd = ANY(${lawdCds}) AND deal_date >= ${from} AND deal_date <= ${to} AND deposit > 0
    GROUP BY deal_ymd, deal_type
  `;
  for (const r of rows) {
    const bucket = buckets.get(r.deal_ymd);
    if (!bucket) continue;
    const agg: RentMonthTypeAggregate = { count: Number(r.cnt), avgDeposit: r.avg_deposit };
    if (r.deal_type === 'jeonse') bucket.jeonse = agg;
    else if (r.deal_type === 'wolse') bucket.wolse = agg;
  }
  return buckets;
}

export interface RentPeriodTypeCounts {
  jeonse: number;
  wolse: number;
}

const ZERO_PERIOD_COUNTS: RentPeriodTypeCounts = { jeonse: 0, wolse: 0 };

// 검증범위를 완전히 벗어난 range에 sentinel(연도 9999, from=to)을 넣어 SQL의 두
// FILTER 절을 항상 동일한 shape으로 유지한다 — 조건부로 절 자체를 빼는 대신, 실제
// 데이터가 결코 존재할 수 없는 날짜로 치환해 "0건"을 자연스럽게 만든다(파라미터
// 구조가 매번 달라지는 것보다 안전하고 단순함).
const NEVER_MATCH_DATE = new Date(Date.UTC(9999, 0, 1));

/** current/previous 두 기간의 dealType별 COUNT를 단일 쿼리로 반환한다. 각 range는
 * 내부적으로 검증범위로 clip된다 — range가 검증범위와 전혀 겹치지 않으면 해당 기간은
 * 0으로 반환(호출부가 clipDateRangeToVerified()로 직접 remainder를 계산해 미검증
 * 월의 이미 가져온 MOLIT row에서 보충해야 한다, PHASE D.2 §16 hybrid routing). */
export async function getRentPeriodComparisonFromDb(
  lawdCds: string[],
  currentRange: { from: Date; to: Date },
  previousRange: { from: Date; to: Date }
): Promise<{ current: RentPeriodTypeCounts; previous: RentPeriodTypeCounts }> {
  const result = { current: { ...ZERO_PERIOD_COUNTS }, previous: { ...ZERO_PERIOD_COUNTS } };
  if (lawdCds.length === 0) return result;

  const range = await getRentVerifiedRange();
  const clippedCurrent = clipDateRangeToVerified(currentRange.from, currentRange.to, range);
  const clippedPrevious = clipDateRangeToVerified(previousRange.from, previousRange.to, range);
  if (!clippedCurrent && !clippedPrevious) return result;

  const curFrom = clippedCurrent?.from ?? NEVER_MATCH_DATE;
  const curTo = clippedCurrent?.to ?? NEVER_MATCH_DATE;
  const prevFrom = clippedPrevious?.from ?? NEVER_MATCH_DATE;
  const prevTo = clippedPrevious?.to ?? NEVER_MATCH_DATE;

  const rows = await prisma.$queryRaw<{ deal_type: string; current_cnt: bigint; previous_cnt: bigint }[]>`
    SELECT deal_type,
      COUNT(*) FILTER (WHERE deal_date >= ${curFrom} AND deal_date <= ${curTo}) as current_cnt,
      COUNT(*) FILTER (WHERE deal_date >= ${prevFrom} AND deal_date <= ${prevTo}) as previous_cnt
    FROM apartment_rent_histories
    WHERE lawd_cd = ANY(${lawdCds}) AND deposit > 0
      AND ((deal_date >= ${prevFrom} AND deal_date <= ${prevTo}) OR (deal_date >= ${curFrom} AND deal_date <= ${curTo}))
    GROUP BY deal_type
  `;
  for (const r of rows) {
    if (r.deal_type === 'jeonse') {
      result.current.jeonse = Number(r.current_cnt);
      result.previous.jeonse = Number(r.previous_cnt);
    } else if (r.deal_type === 'wolse') {
      result.current.wolse = Number(r.current_cnt);
      result.previous.wolse = Number(r.previous_cnt);
    }
  }
  return result;
}
