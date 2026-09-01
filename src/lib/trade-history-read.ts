// TRADE_HISTORY_DATA_V1 §33/§34 COMMON READ HELPER(getTradeHistory/getAllTimeHigh/
// getPreviousTrade/getRegionalTrades) + TRADE_DB_FIRST_V1 STEP A GENERAL READ CORE
// (queryTrades 이하). ApartmentTradeHistory(영구 저장 이력, 855,000+ rows, 부산
// 16/16 구·군, 2006-01~) 를 읽는 공통 layer — 사용자 요청 경로에서 MOLIT을 직접
// 호출하지 않기 위한 기반이다(이 파일은 fetchMolitData/molit-stats-helpers를 import하지
// 않는다 — grep으로 언제든 재확인 가능). identity 정의는 regional-feed.ts와 동일하게
// aptSeq 우선/name+dong 폴백을 그대로 쓴다(새로 발명하지 않음).
//
// STEP A 시점(main baseline 60b27c3)까지는 이 파일의 기존 4개 함수가 여전히 어떤 live
// API route에서도 import되지 않은 상태였다(scripts/qa-trade-history.ts만 사용) — 다음
// STEP(TRADE_HISTORY_READ_MIGRATION_V1, 기존 라이브 통계 API를 이 core로 단계적 전환)
// 의 대상. 이번 STEP은 그 전환에 쓸 "공통 read core"만 완성한다(§27 — 기존 84㎡/거래량/
// 상승/하락/변동지도 API를 한꺼번에 갈아끼우지 않음).
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { identityKey } from './regional-feed';

export interface TradeIdentity {
  aptSeq: string | null;
  name: string;
  dong: string;
}

function resolveIdentityKey(identity: TradeIdentity): string {
  return identityKey(identity);
}

export interface StoredTrade {
  id: number;
  lawdCd: string;
  aptSeq: string | null;
  aptName: string;
  dong: string;
  exclusiveArea: string; // Prisma.Decimal -> string(정밀도 보존, 호출부가 필요시 Number() 변환)
  dealAmount: number;
  dealDate: Date;
  floor: number | null; // DB 컬럼 자체는 nullable(스키마 참고) — 정상 backfill row는 항상 값이 있음
  dealCanceled: boolean;
}

function toStoredTrade<
  T extends {
    id: number;
    lawdCd: string;
    aptSeq: string | null;
    aptName: string;
    dong: string;
    exclusiveArea: { toString(): string };
    dealAmount: number;
    dealDate: Date;
    floor: number | null;
    dealCanceled: boolean;
  },
>(row: T): StoredTrade {
  const { id, lawdCd, aptSeq, aptName, dong, dealAmount, dealDate, floor, dealCanceled } = row;
  return { id, lawdCd, aptSeq, aptName, dong, dealAmount, dealDate, floor, dealCanceled, exclusiveArea: row.exclusiveArea.toString() };
}

/** 취소 제외, 같은 identity+exact area(dealType='sale')의 전체 저장 이력(시간순). */
export async function getTradeHistory(identity: TradeIdentity, exclusiveArea: number): Promise<StoredTrade[]> {
  const idKey = resolveIdentityKey(identity);
  const rows = await prisma.apartmentTradeHistory.findMany({
    // §QA-FIX — Prisma가 Decimal 컬럼을 JS number(float64)로 필터링할 때 일부 값
    // (실측: 84.8773, 84.6389 등)에서 내부 직렬화 반올림 차이로 조용히 0건을 반환하는
    // 현상을 backfill 완료 후 QA에서 발견했다(같은 값을 string으로 넘기면 정상 매칭).
    // 문자열로 넘겨 Decimal 파싱 경로를 타게 해 무손실 비교를 보장한다.
    where: { identityKey: idKey, exclusiveArea: String(exclusiveArea), dealType: 'sale', dealCanceled: false },
    orderBy: { dealDate: 'asc' },
  });
  return rows.map((r) => toStoredTrade(r));
}

/** §29/§30 TRUE RECORD HIGH — DB에 저장된 전체 이력 기준 최고가(취소 제외). backfill
 * completeness가 검증되지 않은 기간/지역에서는 "역대"라는 표현을 UI에 쓰면 안 된다
 * (§30 ALL-TIME CLAIM SAFETY — 이 함수 자체는 그 검증을 하지 않는다, 호출부 책임). */
export async function getAllTimeHigh(identity: TradeIdentity, exclusiveArea: number): Promise<{ amount: number; date: Date } | null> {
  const idKey = resolveIdentityKey(identity);
  const top = await prisma.apartmentTradeHistory.findFirst({
    // §QA-FIX — getTradeHistory와 동일 이유(문자열로 넘겨 Decimal float 직렬화 오매칭 방지).
    where: { identityKey: idKey, exclusiveArea: String(exclusiveArea), dealType: 'sale', dealCanceled: false },
    orderBy: [{ dealAmount: 'desc' }, { dealDate: 'asc' }],
  });
  if (!top) return null;
  return { amount: top.dealAmount, date: top.dealDate };
}

/** §50 — 주어진 날짜 이전(strictly earlier), 같은 identity+exact area의 가장 최근
 * 검증된(비취소) 거래. */
export async function getPreviousTrade(identity: TradeIdentity, exclusiveArea: number, beforeDate: Date): Promise<{ amount: number; date: Date } | null> {
  const idKey = resolveIdentityKey(identity);
  const prev = await prisma.apartmentTradeHistory.findFirst({
    where: {
      identityKey: idKey,
      // §QA-FIX — getTradeHistory와 동일 이유(문자열로 넘겨 Decimal float 직렬화 오매칭 방지).
      exclusiveArea: String(exclusiveArea),
      dealType: 'sale',
      dealCanceled: false,
      dealDate: { lt: beforeDate },
    },
    orderBy: { dealDate: 'desc' },
  });
  if (!prev) return null;
  return { amount: prev.dealAmount, date: prev.dealDate };
}

/** 지역+기간 내 전체 거래(취소 포함 — 호출부가 필요시 필터링). */
export async function getRegionalTrades(lawdCd: string, from: Date, to: Date): Promise<StoredTrade[]> {
  const rows = await prisma.apartmentTradeHistory.findMany({
    where: { lawdCd, dealDate: { gte: from, lte: to } },
    orderBy: { dealDate: 'desc' },
  });
  return rows.map((r) => toStoredTrade(r));
}

// ══════════════════════════════════════════════════════════════════════════
// TRADE_DB_FIRST_V1 STEP A — GENERAL READ CORE. 위 4개 함수는 각각 특정
// use case(단일 단지 전체 이력/역대 최고가/직전거래/지역+기간 전체)에 맞춘
// 좁은 헬퍼다. 아래 queryTrades()는 STEP B~D(84㎡ 순위/거래량/상승·하락/
// 변동지도)가 공통으로 재사용할 수 있는 조합 가능한(composable) 쿼리
// 진입점이다 — 기존 4개 함수를 대체하지 않는다(qa-trade-history.ts가 계속
// 그대로 씀, 시그니처 변경 없음).
// ══════════════════════════════════════════════════════════════════════════

// §18 — 실수로 85만 rows 전체를 반환하지 못하도록 하는 안전장치. limit을
// 명시하지 않으면 take를 아예 걸지 않는다(aggregation use case가 전체
// 결과가 필요할 수 있으므로 억지로 자르지 않음, §18) — 대신 buildTradeWhere가
// aptSeq/identity/lawdCd 중 최소 하나도 없는 입력 자체를 거부해, "조건 없이
// 전체 855,000+ rows"가 애초에 만들어질 수 없게 한다.
export const MAX_TRADE_QUERY_LIMIT = 5000;

export type TradeOrderDirection = 'asc' | 'desc';

export interface TradeQueryInput {
  /** canonical identity — 단일 aptSeq 또는 다수(batch, N+1 방지용 IN 쿼리). */
  aptSeq?: string | string[];
  /** aptSeq가 없는 단지의 identity fallback(name+dong) — getTradeHistory 등과 동일 정의. */
  identity?: TradeIdentity;
  /** 지역 필터 — 단일 lawdCd 또는 다수(부산 전체 조회 시 16개 구·군 IN). */
  lawdCd?: string | string[];
  /** 전용면적 정확히 일치(§QA-FIX와 동일 이유로 문자열 비교 — 반드시 이 필드를 쓸 것,
   * exclusiveAreaRange와 동시 사용 금지). */
  exclusiveArea?: number;
  /** 전용면적 bounded range(예: 84㎡대 = {gte:84, lt:85}). 범위 비교는 Decimal
   * float 직렬화 문제가 재현되지 않아(§QA-FIX는 등가비교에서만 발생) 일반 number를
   * 그대로 쓴다 — benchmark-trade-history.ts scenario4에서 이미 실측 확인됨. */
  exclusiveAreaRange?: { gte?: number; lt?: number; lte?: number; gt?: number };
  /** dealDate 기준, 둘 다 inclusive. Date는 자정(day boundary) 기준으로 전달할 것
   * (dealDate 컬럼 자체가 @db.Date, 시각 없음). */
  from?: Date;
  to?: Date;
  /** 기본 false — 유효 거래 분석은 항상 취소 제외. forensic/admin 용도만 명시적으로 true. */
  includeCanceled?: boolean;
  /** 기본 'desc'(최근 거래 우선). 동일 dealDate 내에서는 항상 id로 2차 정렬해
   * deterministic ordering을 보장한다(§17). */
  orderDirection?: TradeOrderDirection;
  /** 지정 시 MAX_TRADE_QUERY_LIMIT으로 clamp. 지정하지 않으면 take 없음(전체 반환 —
   * aggregation 용도, §18). */
  limit?: number;
}

export class TradeQueryValidationError extends Error {}

export interface BuiltTradeQuery {
  where: Prisma.ApartmentTradeHistoryWhereInput;
  orderBy: Prisma.ApartmentTradeHistoryOrderByWithRelationInput[];
  take: number | undefined;
  includeCanceled: boolean;
  requestedRange: { from: string | null; to: string | null };
}

/** 순수 함수(DB 접근 없음) — query input 검증 + Prisma where/orderBy/take 조립.
 * unit test 대상(§24). queryTrades()가 이 결과를 그대로 실행한다. */
export function buildTradeQuery(input: TradeQueryInput): BuiltTradeQuery {
  const hasAptSeq = input.aptSeq !== undefined && (Array.isArray(input.aptSeq) ? input.aptSeq.length > 0 : input.aptSeq.length > 0);
  const hasIdentity = input.identity !== undefined;
  const hasLawdCd = input.lawdCd !== undefined && (Array.isArray(input.lawdCd) ? input.lawdCd.length > 0 : input.lawdCd.length > 0);

  // §18 안전장치 — 최소 하나의 scoping 조건 없이는 전체 테이블 스캔이 될 수 있으므로
  // 여기서 거부한다(추측/기본값으로 채우지 않음, 명확한 에러).
  if (!hasAptSeq && !hasIdentity && !hasLawdCd) {
    throw new TradeQueryValidationError(
      'queryTrades는 aptSeq/identity/lawdCd 중 최소 하나가 필요합니다(전체 테이블 스캔 방지).'
    );
  }
  if (input.exclusiveArea !== undefined && input.exclusiveAreaRange !== undefined) {
    throw new TradeQueryValidationError('exclusiveArea(정확 일치)와 exclusiveAreaRange(범위)는 동시에 쓸 수 없습니다.');
  }

  const where: Prisma.ApartmentTradeHistoryWhereInput = { dealType: 'sale' };

  if (hasAptSeq) {
    where.aptSeq = Array.isArray(input.aptSeq) ? { in: input.aptSeq } : input.aptSeq;
  }
  if (hasIdentity) {
    // aptSeq와 identity를 동시에 주면 identity가 더 좁은 조건이 아니므로 aptSeq를
    // 우선한다(canonical identity 원칙, §13) — 대신 AND로 겹쳐 걸지 않고 하나만 적용.
    if (!hasAptSeq) {
      where.identityKey = resolveIdentityKey(input.identity as TradeIdentity);
    }
  }
  if (hasLawdCd) {
    where.lawdCd = Array.isArray(input.lawdCd) ? { in: input.lawdCd } : input.lawdCd;
  }

  if (input.exclusiveArea !== undefined) {
    // §QA-FIX — 정확 일치는 반드시 문자열로 비교(Decimal float 직렬화 오매칭 방지).
    where.exclusiveArea = String(input.exclusiveArea);
  } else if (input.exclusiveAreaRange !== undefined) {
    const r = input.exclusiveAreaRange;
    const rangeFilter: Prisma.DecimalFilter = {};
    if (r.gte !== undefined) rangeFilter.gte = r.gte;
    if (r.gt !== undefined) rangeFilter.gt = r.gt;
    if (r.lt !== undefined) rangeFilter.lt = r.lt;
    if (r.lte !== undefined) rangeFilter.lte = r.lte;
    where.exclusiveArea = rangeFilter;
  }

  if (input.from !== undefined || input.to !== undefined) {
    where.dealDate = {
      ...(input.from !== undefined ? { gte: input.from } : {}),
      ...(input.to !== undefined ? { lte: input.to } : {}),
    };
  }

  const includeCanceled = input.includeCanceled === true;
  if (!includeCanceled) {
    where.dealCanceled = false;
  }

  const direction: TradeOrderDirection = input.orderDirection ?? 'desc';
  const orderBy: Prisma.ApartmentTradeHistoryOrderByWithRelationInput[] = [{ dealDate: direction }, { id: direction }];

  let take: number | undefined;
  if (input.limit !== undefined) {
    if (!Number.isFinite(input.limit) || input.limit <= 0) {
      throw new TradeQueryValidationError('limit은 1 이상의 유한한 숫자여야 합니다.');
    }
    take = Math.min(input.limit, MAX_TRADE_QUERY_LIMIT);
  }

  return {
    where,
    orderBy,
    take,
    includeCanceled,
    requestedRange: {
      from: input.from ? input.from.toISOString().slice(0, 10) : null,
      to: input.to ? input.to.toISOString().slice(0, 10) : null,
    },
  };
}

export interface TradeQueryMeta {
  dataSource: 'DB';
  requestedRange: { from: string | null; to: string | null };
  returnedCount: number;
  limitApplied: number | null;
  /** returnedCount === limitApplied — 더 많은 row가 있을 수 있다는 신호(호출부가
   * "전체" 처럼 표시하지 않도록). limit을 안 준 경우(take 없음) 항상 false. */
  possiblyTruncated: boolean;
  /** 이 조건에 실제로 걸리는 전체 결과 집합의 MAX(dealDate) — limit/orderDirection과
   * 무관하게 항상 정확하다(반환된 배열에서 유추하지 않고 별도 aggregate로 계산). */
  latestDealDate: string | null;
  includeCanceled: boolean;
}

export interface TradeQueryResult {
  trades: StoredTrade[];
  meta: TradeQueryMeta;
}

/** STEP B~D 공통 진입점 — MOLIT을 호출하지 않는다(이 파일 전체에 fetch/molit import
 * 없음, grep으로 재확인 가능). DB에 해당 조건 데이터가 없으면 정직하게 빈 배열을
 * 반환한다(§21 — 다른 단지/기간으로 대체하지 않음). */
export async function queryTrades(input: TradeQueryInput): Promise<TradeQueryResult> {
  const built = buildTradeQuery(input);

  const [rows, latest] = await Promise.all([
    prisma.apartmentTradeHistory.findMany({ where: built.where, orderBy: built.orderBy, take: built.take }),
    prisma.apartmentTradeHistory.aggregate({ where: built.where, _max: { dealDate: true } }),
  ]);

  const trades = rows.map((r) => toStoredTrade(r));
  const returnedCount = trades.length;

  return {
    trades,
    meta: {
      dataSource: 'DB',
      requestedRange: built.requestedRange,
      returnedCount,
      limitApplied: built.take ?? null,
      possiblyTruncated: built.take !== undefined && returnedCount === built.take,
      latestDealDate: latest._max.dealDate ? latest._max.dealDate.toISOString().slice(0, 10) : null,
      includeCanceled: built.includeCanceled,
    },
  };
}

export interface YearlySaleAggregateRow {
  year: number;
  count: number;
  maxAmount: number;
  minAmount: number;
  avgAmount: number;
}

// TRADE_DB_FIRST_V1 STEP B — 연도별 매매 집계(count/max/min/avg). Prisma의
// 타입세이프 groupBy는 "연도"처럼 컬럼에서 파생된 값으로 묶는 것을 지원하지
// 않는다(dealDate 원본 컬럼 값으로만 묶을 수 있음) — 이 한 곳에서만 raw SQL을
// 쓴다(queryTrades()의 §18 설계 노트와 동일하게, §16 "Prisma groupBy/distinct/
// raw SQL 중 안전하고 성능 좋은 방식 선택"이 명시적으로 허용한 경로). 파라미터는
// 전부 Prisma tagged-template 보간으로 넘겨 SQL injection 없이 파라미터화된다
// (문자열 concat 없음). 실측: lawdCd 하나(해운대구)의 13년치 69,025 row를
// Node로 끌어와 JS에서 reduce하면 12.9초가 걸렸다(§25 STEP B 벤치마크) — DB가
// 직접 집계하게 바꾸면 raw row를 전혀 Node로 옮기지 않아도 된다.
export async function getYearlySaleAggregate(lawdCd: string, fromYear: number): Promise<YearlySaleAggregateRow[]> {
  const fromDate = new Date(Date.UTC(fromYear, 0, 1));
  const rows = await prisma.$queryRaw<{ year: number; count: bigint | number; max_amount: number; min_amount: number; avg_amount: number }[]>`
    SELECT
      EXTRACT(YEAR FROM deal_date)::int AS year,
      COUNT(*)::int AS count,
      MAX(deal_amount)::int AS max_amount,
      MIN(deal_amount)::int AS min_amount,
      ROUND(AVG(deal_amount))::int AS avg_amount
    FROM apartment_trade_histories
    WHERE lawd_cd = ${lawdCd}
      AND deal_type = 'sale'
      AND deal_canceled = false
      AND deal_date >= ${fromDate}
    GROUP BY EXTRACT(YEAR FROM deal_date)
    ORDER BY year ASC
  `;
  return rows.map((r) => ({
    year: Number(r.year),
    count: Number(r.count),
    maxAmount: Number(r.max_amount),
    minAmount: Number(r.min_amount),
    avgAmount: Number(r.avg_amount),
  }));
}

// ══════════════════════════════════════════════════════════════════════════
// TRADE_DB_FIRST_V1 STEP C-2 — 최근 상승/하락 성능 최적화. STEP C는 부산
// 전체 24개월×전체면적 65,532 row를 통째로 Node로 가져와 buildHistory()가
// 계산했다(4.0~7.3초). 첫 시도는 "후보 group_key만 SQL로 판정 → 후보 group의
// 24개월 전체 이력을 다시 fetch → 기존 buildHistory() 재사용"이었으나, 실측
// 결과 후보 group 수가 기간이 길어질수록 전체 group 수에 근접해(12개월
// 하락 기준 4,007개 group, 재조회 시 51,729 row — 원래 65,532 row와 큰
// 차이가 없음) 오히려 STEP C보다 느려졌다(최악 11.2초, FAIL 근접) — 이
// 실패 원인과 실측 수치는 TRADE_DB_FIRST_V1_STEP_C2.md에 그대로 기록했다.
//
// 최종 채택: priorHigh(하락)/immediatePrior(상승)의 **금액과 날짜 둘 다**를
// row 재조회 없이 순수 window function만으로 한 번에 계산해, 최종 후보
// row(부산 전체 기준 881~4012건 정도)만 애플리케이션으로 반환한다 — 중간
// row 재조회 단계 자체가 없다. priorHigh의 "언제"(날짜)는 표준 MAX() OVER가
// 직접 주지 않으므로(집계값은 얻어도 그 값이 나온 시점은 별도 계산 필요),
// "이 row가 실제로 running max를 갱신시켰는가"(is_new_high)를 먼저 계산하고,
// 그 상태를 다시 앞으로 전파(propagate)하는 3단계 CTE로 얻는다(§SQL DESIGN).
// 실측(부산 전체, 12개월, 하락, 최악 케이스): 42.5초(CTE 참조 상관 서브쿼리,
// group_key 미인덱스) → 23.9초(인덱스 컬럼 기반 서브쿼리로 교체해도 여전히
// row당 반복 실행이라 느림) → **2.1초**(순수 window function, 서브쿼리
// 없음) — 최종 채택안.
//
// 최종 계산 필드(현재가/직전가/priorHigh/변화율 등)는 buildDeclineRows()/
// buildRisingRows()(price-ranking.ts)와 정의상 동일해야 하므로, 호출부
// (price-rankings/route.ts)가 이 함수의 raw 결과를 그 두 함수와 **동일한
// 반올림 공식**(Math.round(x*1000)/10)으로 DeclineRow/RisingRow를 직접
// 구성한다 — buildHistory()를 재사용하지 않는 대신, §13 old-vs-new A/B에서
// 기존 STEP C(=STEP C 자체가 이미 buildDeclineRows/buildRisingRows의
// oracle 역할) 결과와 광범위하게(6개 지역×5개 기간×2모드=60케이스) 대조해
// 정확성을 검증했다(TRADE_DB_FIRST_V1_STEP_C2.md §5 참고).
//
// PARTITION BY는 group_key 컬럼(스키마에 이미 저장돼 있음, regional-feed.ts의
// groupKey()를 backfill/sync 시점에 그대로 호출한 결과)을 직접 쓴다 — 855,047개
// 부산 row 전체를 Node에서 재계산해 대조한 결과 불일치 0건으로, 이 컬럼이
// JS groupKey()와 항상 동일함을 실측 확인했다(재구현 없이 그대로 신뢰 가능).
//
// §SAME-DAY TIE — buildHistory()의 `sorted = [...list].sort((a,b) =>
// a.dealDate.localeCompare(b.dealDate))`는 Array.sort가 stable이므로,
// 동일 dealDate(시각 없음) 여러 거래의 상대 순서는 정렬 "이전"(즉 원본
// allTrades 배열 순서)을 그대로 보존한다. STEP C의 DB fetch가 Prisma
// `orderBy: [{dealDate:'desc'},{id:'desc'}]`를 쓰므로, 같은 날짜 거래는
// id 내림차순(더 큰 id 먼저) 순서로 도착하고, 오름차순 안정 정렬 후에도
// 그 상대 순서(큰 id가 먼저)가 유지된다 — 즉 "latest in period" 선정과
// "priorHigh" running-max 둘 다 동일 날짜 동점에서는 **id가 더 큰 거래를
// 먼저(시간상 앞선 것처럼) 취급**한다(실측: 26260-1476/84.965㎡ 사례로
// 검증, STEP C 문서 §5-2). 아래 window ORDER BY를 `deal_date ASC, id DESC`
// (priorHigh/immediatePrior)와 `deal_date DESC, id DESC`("latest in
// period" 선정)로 맞춘 이유가 이 실측 tie-break를 그대로 재현하기
// 위함이다. 이 tie-break는 이번 STEP이 새로 만든 규칙이 아니라 STEP C가
// 이미 프로덕션에 내놓은 기존 동작을 그대로 따르는 것뿐이다(§9 — 몰래
// 새 규칙을 넣지 않음).
//
// §TRAILING12MO — DeclineRow/RisingRow의 trailing12moSampleCount(§15 표본
// 규칙)는 JS `monthsBetween(a,b) = (by-ay)*12+(bm-am)`를 그대로 재현해야
// 한다 — **일(day)은 완전히 무시하고 연·월만 비교**하는 값이다(예:
// 2025-01-31과 2026-01-05는 monthsBetween=12로 "포함"). 처음엔
// `RANGE BETWEEN INTERVAL '12 months' PRECEDING`(일 단위 정밀 뺄셈)을
// 썼는데, 실측 A/B(6개 지역×5개 기간, TRADE_DB_FIRST_V1_STEP_C2.md §5)에서
// 매 케이스 수십 건씩 JS 값과 어긋났다 — 원인은 정확히 이 day-vs-month
// 정밀도 차이였다. 고정: `(연*12+월)`을 정수 "month_index"로 미리
// 계산해두고, RANGE 경계를 정수 오프셋(`12 PRECEDING`)으로 준다 — 이러면
// 같은 달의 서로 다른 날짜 거래는 전부 같은 month_index를 가져 RANGE의
// "peer" 규칙에 따라 함께 포함되고(일 단위 무시), 경계도 정확히 12개월
// 차이로 판정된다(day-of-month에 영향받지 않음). RANGE frame은 ORDER BY
// 컬럼이 하나여야 하는 제약이 있어(id tie-break 불가) 이 카운트 전용
// window는 `ORDER BY month_index`만 쓴다 — COUNT는 tie-break 순서와
// 무관하므로 안전하다.
//
// §DEDUPE — month_index 수정 후에도 여전히 소수 케이스가 JS보다 1건씩 더
// 세고 있었다. 원인은 완전히 다른 곳: 기존 route.ts는 `buildDeclineRows`/
// `buildRisingRows` 호출 전에 항상 `allTrades = dedupeTrades(allTrades)`
// (regional-feed.ts, groupKey+dealAmount+dealDate+floor가 같으면 하나만
// 남김)를 거친다 — MOLIT 월별 fetch가 달 경계에서 같은 거래를 두 번
// 반환할 수 있어 생긴 기존 안전장치인데, DB에도 동일 자연키를 가진 row가
// 실제로 2건 이상 존재하는 사례가 있었다(예: 26140-978/84.9891, 2025-08-19
// 동일 금액·동일 층 row 2개). 이 함수의 base CTE는 원래 이 dedup을 거치지
// 않아 group_key+deal_amount+deal_date+floor가 같은 row를 전부 별도로
// 세고 있었다 — `ROW_NUMBER() OVER (PARTITION BY group_key, deal_amount,
// deal_date, floor ORDER BY id DESC) = 1`로 dedupeTrades와 동일한 자연키
// 기준 dedup을 재현했다(dedupeTrades가 배열의 "먼저 나온" 것을 남기는데,
// STEP C의 DB fetch 순서가 항상 `id DESC`였으므로 id가 더 큰 쪽이
// "먼저" 나온 것과 동치 — 동일한 승자 선택 재현).
//
// §SAME-MONTH PEER — month_index + dedupe 수정 후에도 여전히 소수 케이스가
// 어긋났다. 원인: `RANGE ... CURRENT ROW`는 "같은 month_index를 가진 모든
// row"를 무조건 peer로 묶어 전부 포함시킨다 — 그런데 JS의 `sampleCount`는
// `sorted`에서 자기 자신보다 **앞쪽(더 이른 row_seq)** 에 있는 row만 센다.
// 같은 달(often 같은 날) 안에 여러 거래가 있고 그중 "latest in period"로
// 뽑힌 row가 그 달의 첫 번째(id DESC라 가장 큰 id)라면, 같은 달의 "나중"
// row(다른 낮은 id)는 RANGE peer로는 포함되지만 JS 기준으로는 포함되면 안
// 된다 — 실측(26260-1476/84.965㎡, 2026-08-18 동일가 2건)으로 확인.
// 고정: base에 `row_seq`(그룹별 deal_date ASC, id DESC 순번)를 추가하고,
// 후보(candidates)와 base를 `row_seq <= 후보.row_seq AND month_index >=
// 후보.month_index - 12` 조건으로 JOIN해 GROUP BY로 COUNT — "자기 자신
// 이전(포함)의 row만, 그리고 12개월 이내"라는 JS의 정확한 의미를 재현한다.
// **성능 함정**: 이 조인 조건을 상관 서브쿼리(`(SELECT COUNT(*) FROM base b
// WHERE ...) AS trailing_sample_count`, 후보 row마다 한 번씩 실행)로 처음
// 구현했더니 부산 전체 12개월(하락 4,012건/상승 2,645건 후보) 기준
// 43.4초/28.9초가 걸렸다 — group_key가 인덱스 없는 컬럼이라 후보 하나당
// base 전체에 가까운 scan이 반복된 것. 동일 조건을 상관 서브쿼리 대신
// **JOIN + GROUP BY**로 바꾸자(옵티마이저가 nested-loop 대신 hash join을
// 선택) 1.17초/0.62초로 떨어졌다 — 완전히 동일한 논리 조건이라도 상관
// 서브쿼리 대 JOIN의 실행계획 차이가 이렇게 클 수 있다는 실측 교훈.
//
// 위 3개 수정(month_index + dedupe + same-month-peer-JOIN) 전부 적용 후
// 6개 지역×5개 기간×2모드=60케이스, 매 요청 직전 코드를 stash/복원해
// 동일 시점 기준으로 재측정한 tight A/B에서 모든 필드(currentAmount/
// currentDate/priorHighAmount/priorHighDate/previousAmount/previousDate/
// declinePct/risePct/trailing12moSampleCount)가 완전히 일치했다 — 남은
// 유일한 차이(8/60 파일, 페이지 경계에서 row 1개씩)는 risePct/declinePct
// 동점 후보가 페이지네이션 컷오프(limit=100)에 걸릴 때 동점 tie-break
// 순서 차이로 어느 쪽이 100번째에 들어가는지가 갈리는 것 — STEP C가 이미
// 문서화한 "동일 날짜/동점 tie-break 미정의"와 같은 근본 원인이며 데이터
// 오류가 아니다(TRADE_DB_FIRST_V1_STEP_C2.md §5 상세).
// §BOUNDARY-FIX — raw SQL(`$queryRaw`)로 보내는 Date는 Prisma의 타입세이프
// 필터(예: queryTrades()의 `dealDate: {gte: input.from}`)와 달리 컬럼
// 타입(@db.Date)에 맞춰 자동으로 정규화되지 않는다. `new Date()`가 만드는
// "현재 시각"의 시/분/초를 그대로 유지한 채 24개월만 뺀 값을 그대로
// 파라미터로 보내면, Postgres가 그 값을 자정 이후 시각으로 취급해
// 경계일(24개월 전 그 날짜) 거래가 `>=` 비교에서 조용히 제외되는 실측
// 버그를 발견했다(동래구 12개월 하락 A/B에서 2건 누락 — 둘 다 정확히
// 경계일 priorHighDate를 가진 케이스였다, TRADE_DB_FIRST_V1_STEP_C2.md
// §5 참고). STEP B의 getYearlySaleAggregate()가 이미 안전하게 쓰던 패턴
// (`Date.UTC(year, 0, 1)`, 시각 없이 자정 고정)과 동일하게 UTC 자정으로
// 명시 생성해 재발을 막는다.
function candidateFromDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 24, now.getUTCDate()));
}

export interface DeclineCandidateRow {
  id: number;
  aptSeq: string | null;
  aptName: string;
  dong: string;
  lawdCd: string;
  exclusiveArea: string;
  floor: number | null;
  currentAmount: number;
  currentDate: Date;
  priorHighAmount: number;
  priorHighDate: Date;
  trailingSampleCount: number;
}

/** 하락 후보 전체 row를 단일 SQL pass로 반환한다(중간 row 재조회 없음) —
 * priorHigh(트레일링 24개월 running max, strictly 이전 시점)보다 기간 내
 * 최근 거래가 낮은 group만. */
export async function getDeclineRowsFromDb(lawdCds: string[], periodFrom: string, periodTo: string): Promise<DeclineCandidateRow[]> {
  const from = candidateFromDate();
  const rows = await prisma.$queryRaw<
    { id: number; aptSeq: string | null; aptName: string; dong: string; lawdCd: string; exclusiveArea: string; floor: number | null; currentAmount: number; currentDate: Date; priorHighAmount: number; priorHighDate: Date; trailingSampleCount: bigint }[]
  >`
    WITH raw AS (
      SELECT id, group_key, apt_seq, apt_name, dong, lawd_cd, exclusive_area, floor, deal_amount, deal_date,
        ROW_NUMBER() OVER (PARTITION BY group_key, deal_amount, deal_date, floor ORDER BY id DESC) AS dedupe_rn
      FROM apartment_trade_histories
      WHERE lawd_cd = ANY(${lawdCds})
        AND deal_type = 'sale'
        AND deal_canceled = false
        AND deal_date >= ${from}
    ),
    base AS (
      SELECT id, group_key, apt_seq, apt_name, dong, lawd_cd, exclusive_area, floor, deal_amount, deal_date,
        (EXTRACT(YEAR FROM deal_date)::int * 12 + EXTRACT(MONTH FROM deal_date)::int) AS month_index,
        ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY deal_date ASC, id DESC) AS row_seq
      FROM raw
      WHERE dedupe_rn = 1
    ),
    step1 AS (
      SELECT *,
        MAX(deal_amount) OVER (
          PARTITION BY group_key ORDER BY deal_date ASC, id DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS prior_high_amount
      FROM base
    ),
    step2 AS (
      SELECT *, (deal_amount > COALESCE(prior_high_amount, -2147483648)) AS is_new_high
      FROM step1
    ),
    step3 AS (
      SELECT *,
        MAX(CASE WHEN is_new_high THEN deal_date END) OVER (
          PARTITION BY group_key ORDER BY deal_date ASC, id DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS prior_high_date
      FROM step2
    ),
    period_latest AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY deal_date DESC, id DESC) AS rn
      FROM step3
      WHERE deal_date BETWEEN ${periodFrom}::date AND ${periodTo}::date
    ),
    candidates AS (
      SELECT * FROM period_latest
      WHERE rn = 1 AND prior_high_amount IS NOT NULL AND deal_amount < prior_high_amount
    )
    SELECT
      c.id, c.apt_seq AS "aptSeq", c.apt_name AS "aptName", c.dong, c.lawd_cd AS "lawdCd",
      c.exclusive_area::text AS "exclusiveArea", c.floor,
      c.deal_amount AS "currentAmount", c.deal_date AS "currentDate",
      c.prior_high_amount AS "priorHighAmount", c.prior_high_date AS "priorHighDate",
      COUNT(b.id) AS "trailingSampleCount"
    FROM candidates c
    JOIN base b ON b.group_key = c.group_key AND b.row_seq <= c.row_seq AND b.month_index >= c.month_index - 12
    GROUP BY c.id, c.apt_seq, c.apt_name, c.dong, c.lawd_cd, c.exclusive_area, c.floor,
      c.deal_amount, c.deal_date, c.prior_high_amount, c.prior_high_date
  `;
  return rows.map((r) => ({ ...r, trailingSampleCount: Number(r.trailingSampleCount) }));
}

export interface RisingCandidateRow {
  id: number;
  aptSeq: string | null;
  aptName: string;
  dong: string;
  lawdCd: string;
  exclusiveArea: string;
  floor: number | null;
  currentAmount: number;
  currentDate: Date;
  previousAmount: number;
  previousDate: Date;
  trailingSampleCount: number;
}

/** 상승 후보 전체 row를 단일 SQL pass로 반환한다 — immediatePrior(시간순
 * 바로 직전 거래, LAG로 금액·날짜 모두 직접 계산 가능해 decline과 달리
 * 별도 argmax 계산이 필요 없다)보다 기간 내 최근 거래가 높은 group만. */
export async function getRisingRowsFromDb(lawdCds: string[], periodFrom: string, periodTo: string): Promise<RisingCandidateRow[]> {
  const from = candidateFromDate();
  const rows = await prisma.$queryRaw<
    { id: number; aptSeq: string | null; aptName: string; dong: string; lawdCd: string; exclusiveArea: string; floor: number | null; currentAmount: number; currentDate: Date; previousAmount: number; previousDate: Date; trailingSampleCount: bigint }[]
  >`
    WITH raw AS (
      SELECT id, group_key, apt_seq, apt_name, dong, lawd_cd, exclusive_area, floor, deal_amount, deal_date,
        ROW_NUMBER() OVER (PARTITION BY group_key, deal_amount, deal_date, floor ORDER BY id DESC) AS dedupe_rn
      FROM apartment_trade_histories
      WHERE lawd_cd = ANY(${lawdCds})
        AND deal_type = 'sale'
        AND deal_canceled = false
        AND deal_date >= ${from}
    ),
    base AS (
      SELECT id, group_key, apt_seq, apt_name, dong, lawd_cd, exclusive_area, floor, deal_amount, deal_date,
        (EXTRACT(YEAR FROM deal_date)::int * 12 + EXTRACT(MONTH FROM deal_date)::int) AS month_index,
        ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY deal_date ASC, id DESC) AS row_seq
      FROM raw
      WHERE dedupe_rn = 1
    ),
    step1 AS (
      SELECT *,
        LAG(deal_amount) OVER (
          PARTITION BY group_key ORDER BY deal_date ASC, id DESC
        ) AS immediate_prior_amount,
        LAG(deal_date) OVER (
          PARTITION BY group_key ORDER BY deal_date ASC, id DESC
        ) AS immediate_prior_date
      FROM base
    ),
    period_latest AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY deal_date DESC, id DESC) AS rn
      FROM step1
      WHERE deal_date BETWEEN ${periodFrom}::date AND ${periodTo}::date
    ),
    candidates AS (
      SELECT * FROM period_latest
      WHERE rn = 1 AND immediate_prior_amount IS NOT NULL AND deal_amount > immediate_prior_amount
    )
    SELECT
      c.id, c.apt_seq AS "aptSeq", c.apt_name AS "aptName", c.dong, c.lawd_cd AS "lawdCd",
      c.exclusive_area::text AS "exclusiveArea", c.floor,
      c.deal_amount AS "currentAmount", c.deal_date AS "currentDate",
      c.immediate_prior_amount AS "previousAmount", c.immediate_prior_date AS "previousDate",
      COUNT(b.id) AS "trailingSampleCount"
    FROM candidates c
    JOIN base b ON b.group_key = c.group_key AND b.row_seq <= c.row_seq AND b.month_index >= c.month_index - 12
    GROUP BY c.id, c.apt_seq, c.apt_name, c.dong, c.lawd_cd, c.exclusive_area, c.floor,
      c.deal_amount, c.deal_date, c.immediate_prior_amount, c.immediate_prior_date
  `;
  return rows.map((r) => ({ ...r, trailingSampleCount: Number(r.trailingSampleCount) }));
}

// ══════════════════════════════════════════════════════════════════════════
// TRADE_DB_FIRST_V1 STEP E — 신고가(price-ranking.ts buildRecordHighRows) DB-FIRST.
//
// §STRUCTURE-DIFF — decline/rising과 CTE 구조(raw dedupe → base row_seq/
// month_index → step1 prior_high_amount → step2 is_new_high → step3
// prior_high_date 전파)는 완전히 동일하게 재사용한다(§9 — 이미 검증된 tie-break/
// dedupe/trailing12mo 로직을 새로 발명하지 않음). 유일한 구조적 차이는 decline/
// rising이 `period_latest`에서 `ROW_NUMBER() ... rn = 1`로 그룹당 "기간 내
// 최근 거래" 단 하나만 남기는 반면, 신고가는 buildRecordHighRows()의 정의상
// "기간 내에서 실제로 자기 자신의 이전 최고가를 넘어선 거래는 전부" row로
// 남겨야 한다(§11/§12 — 같은 그룹에서 기간 내 여러 건이 각각 신고가를
// 경신했다면 전부 별도 row) — 따라서 rn 필터를 두지 않고 `is_new_high = true`
// 조건만으로 candidates를 뽑는다. is_new_high 자체는 STEP C-2가 이미 증명한
// `deal_amount > COALESCE(prior_high_amount, sentinel)` 패턴(step2)을 그대로
// 재사용 — 신고가 판정의 핵심 조건이 decline의 "step2 부산물"과 정확히
// 동일한 연산이었다는 뜻이다.
export interface RecordHighCandidateRow {
  id: number;
  aptSeq: string | null;
  aptName: string;
  dong: string;
  lawdCd: string;
  exclusiveArea: string;
  floor: number | null;
  currentAmount: number;
  currentDate: Date;
  priorHighAmount: number;
  priorHighDate: Date;
  trailingSampleCount: number;
}

/** 신고가 후보 전체 row를 단일 SQL pass로 반환한다 — 그룹별로 기간 내
 * "자기 자신 이전 최고가를 실제로 넘어선" 거래는 전부(그룹당 여러 건 가능). */
export async function getRecordHighRowsFromDb(lawdCds: string[], periodFrom: string, periodTo: string): Promise<RecordHighCandidateRow[]> {
  const from = candidateFromDate();
  const rows = await prisma.$queryRaw<
    { id: number; aptSeq: string | null; aptName: string; dong: string; lawdCd: string; exclusiveArea: string; floor: number | null; currentAmount: number; currentDate: Date; priorHighAmount: number; priorHighDate: Date; trailingSampleCount: bigint }[]
  >`
    WITH raw AS (
      SELECT id, group_key, apt_seq, apt_name, dong, lawd_cd, exclusive_area, floor, deal_amount, deal_date,
        ROW_NUMBER() OVER (PARTITION BY group_key, deal_amount, deal_date, floor ORDER BY id DESC) AS dedupe_rn
      FROM apartment_trade_histories
      WHERE lawd_cd = ANY(${lawdCds})
        AND deal_type = 'sale'
        AND deal_canceled = false
        AND deal_date >= ${from}
    ),
    base AS (
      SELECT id, group_key, apt_seq, apt_name, dong, lawd_cd, exclusive_area, floor, deal_amount, deal_date,
        (EXTRACT(YEAR FROM deal_date)::int * 12 + EXTRACT(MONTH FROM deal_date)::int) AS month_index,
        ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY deal_date ASC, id DESC) AS row_seq
      FROM raw
      WHERE dedupe_rn = 1
    ),
    step1 AS (
      SELECT *,
        MAX(deal_amount) OVER (
          PARTITION BY group_key ORDER BY deal_date ASC, id DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS prior_high_amount
      FROM base
    ),
    step2 AS (
      SELECT *, (deal_amount > COALESCE(prior_high_amount, -2147483648)) AS is_new_high
      FROM step1
    ),
    step3 AS (
      SELECT *,
        MAX(CASE WHEN is_new_high THEN deal_date END) OVER (
          PARTITION BY group_key ORDER BY deal_date ASC, id DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS prior_high_date
      FROM step2
    ),
    candidates AS (
      SELECT * FROM step3
      WHERE deal_date BETWEEN ${periodFrom}::date AND ${periodTo}::date
        AND is_new_high = true
        AND prior_high_amount IS NOT NULL
    )
    SELECT
      c.id, c.apt_seq AS "aptSeq", c.apt_name AS "aptName", c.dong, c.lawd_cd AS "lawdCd",
      c.exclusive_area::text AS "exclusiveArea", c.floor,
      c.deal_amount AS "currentAmount", c.deal_date AS "currentDate",
      c.prior_high_amount AS "priorHighAmount", c.prior_high_date AS "priorHighDate",
      COUNT(b.id) AS "trailingSampleCount"
    FROM candidates c
    JOIN base b ON b.group_key = c.group_key AND b.row_seq <= c.row_seq AND b.month_index >= c.month_index - 12
    GROUP BY c.id, c.apt_seq, c.apt_name, c.dong, c.lawd_cd, c.exclusive_area, c.floor,
      c.deal_amount, c.deal_date, c.prior_high_amount, c.prior_high_date
  `;
  return rows.map((r) => ({ ...r, trailingSampleCount: Number(r.trailingSampleCount) }));
}

// ══════════════════════════════════════════════════════════════════════════
// PERFORMANCE_V1_1_B — 84㎡ 순위(buildArea84RankingRows, price-ranking.ts)
// SQL pushdown. 이전(TRADE_DB_FIRST_V1 STEP A)에는 84~85㎡ band만 DB에서
// 걸러 fetchArea84TradesFromDb()로 raw row ~23K건을 그대로 Node로 옮긴 뒤
// buildArea84RankingRows()가 JS에서 그룹핑/랭킹했다 — PERFORMANCE_V1.1-A에서
// 실측한 것처럼 SQL 자체는 75~150ms인데 Prisma가 23K row를 역직렬화하는 데만
// 3.2~3.8초가 걸렸다(§PERFORMANCE_V1_1_A). raw/base/step1(priorHigh MAX
// window)/dedupe/month_index/row_seq 구조는 decline/rising/record-high가
// 이미 검증한 것을 그대로 재사용한다(§9 — 새로 발명하지 않음) — 차이는 두 곳뿐:
//
// §1 area84는 decline/rising처럼 group_key(=identity+exact area+dealType)
// 단위가 아니라 **complexKey(=identity_key만, exact area 무시)** 단위로
// "대표 거래" 1건을 뽑는다(buildArea84RankingRows의 candidatesByComplex가
// identityKey()로만 묶는 것과 동일) — 같은 단지의 서로 다른 정확 면적(예:
// 84.51㎡와 84.8758㎡)이 둘 다 band 안에 있으면 그중 하나만 대표로 남는다.
// 대표 선정 tie-break(compareArea84Candidates)는 `deal_date DESC →
// deal_amount DESC → exclusive_area DESC → floor DESC → uid(=id를 String()한
// 값) ASC`이므로, region-change.ts의 buildRegionChangePairs()가 이미 쓰는
//것과 동일하게 `DISTINCT ON (identity_key) ... ORDER BY identity_key,
// deal_date DESC, deal_amount DESC, exclusive_area DESC, COALESCE(floor,0)
// DESC, id::text ASC`로 재현한다(id를 숫자가 아니라 문자열로 정렬 — "10" vs
// "9" 같은 경우 기존 동작과 다르게 나오는 것을 방지, region-change.ts §PAIR와
// 동일 원칙).
//
// §2 area84는 priorHigh(신고가 대비용, recent2yHighAmount/isRecent2yHigh)와
// immediatePrior(직전거래 대비용, previousAmount/previousDate) 둘 다
// 동시에 필요하다(decline은 priorHigh만, rising은 immediatePrior만) — 하나의
// step1 CTE에서 MAX() window와 LAG() window를 함께 계산해 얻는다.
// trailingSampleCount는 대표 거래가 속한 정확 그룹(group_key, exact area
// 그대로)의 표본이어야 한다(buildArea84RankingRows가 `repGroupKey =
// groupKey(rep)`로 정확히 그 그룹의 history만 보는 것과 동일) — base와의
// JOIN 조건(`row_seq <=`, `month_index >=`)은 STEP C-2가 이미 검증한 것을
// 그대로 쓴다.
//
// exclusive_area >= 84 AND < 85를 base 단계(raw CTE)에서부터 필터링해도
// 결과가 100% 동일한 이유는 fetchArea84TradesFromDb()가 이미 문서화한
// 것과 같다 — band 밖 거래는 candidatesByComplex에 애초에 들어가지 않고,
// group_key가 exact area를 포함해 band 밖 거래가 band 안 거래의 history에도
// 절대 섞이지 않는다(§9 area84 exact area rule, 서로 다른 면적은 완전히
// 분리된 그룹).
export interface Area84CandidateRow {
  id: number;
  aptSeq: string | null;
  aptName: string;
  dong: string;
  lawdCd: string;
  exclusiveArea: string;
  floor: number | null;
  currentAmount: number;
  currentDate: Date;
  priorHighAmount: number | null;
  previousAmount: number | null;
  previousDate: Date | null;
  trailingSampleCount: number;
}

/** 84㎡ 순위 후보 전체 row를 단일 SQL pass로 반환한다(raw row를 Node로
 * 옮기지 않음) — 단지(identity_key)별 대표 거래 1건 + 그 거래의 priorHigh/
 * immediatePrior/trailing12moSampleCount. buildArea84RankingRows()와 동일
 * semantics(§ 위 주석 참고). */
export async function getArea84RowsFromDb(lawdCds: string[], periodFrom: string, periodTo: string): Promise<Area84CandidateRow[]> {
  const from = candidateFromDate();
  const rows = await prisma.$queryRaw<
    { id: number; aptSeq: string | null; aptName: string; dong: string; lawdCd: string; exclusiveArea: string; floor: number | null; currentAmount: number; currentDate: Date; priorHighAmount: number | null; previousAmount: number | null; previousDate: Date | null; trailingSampleCount: bigint }[]
  >`
    WITH raw AS (
      SELECT id, group_key, identity_key, apt_seq, apt_name, dong, lawd_cd, exclusive_area, floor, deal_amount, deal_date,
        ROW_NUMBER() OVER (PARTITION BY group_key, deal_amount, deal_date, floor ORDER BY id DESC) AS dedupe_rn
      FROM apartment_trade_histories
      WHERE lawd_cd = ANY(${lawdCds})
        AND deal_type = 'sale'
        AND deal_canceled = false
        AND deal_date >= ${from}
        AND exclusive_area >= 84 AND exclusive_area < 85
    ),
    base AS (
      SELECT id, group_key, identity_key, apt_seq, apt_name, dong, lawd_cd, exclusive_area, floor, deal_amount, deal_date,
        (EXTRACT(YEAR FROM deal_date)::int * 12 + EXTRACT(MONTH FROM deal_date)::int) AS month_index,
        ROW_NUMBER() OVER (PARTITION BY group_key ORDER BY deal_date ASC, id DESC) AS row_seq
      FROM raw
      WHERE dedupe_rn = 1
    ),
    step1 AS (
      SELECT *,
        MAX(deal_amount) OVER (
          PARTITION BY group_key ORDER BY deal_date ASC, id DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS prior_high_amount,
        LAG(deal_amount) OVER (
          PARTITION BY group_key ORDER BY deal_date ASC, id DESC
        ) AS immediate_prior_amount,
        LAG(deal_date) OVER (
          PARTITION BY group_key ORDER BY deal_date ASC, id DESC
        ) AS immediate_prior_date
      FROM base
    ),
    period_filtered AS (
      SELECT * FROM step1
      WHERE deal_date BETWEEN ${periodFrom}::date AND ${periodTo}::date
    ),
    representative AS (
      SELECT DISTINCT ON (identity_key) *
      FROM period_filtered
      ORDER BY identity_key, deal_date DESC, deal_amount DESC, exclusive_area DESC, COALESCE(floor, 0) DESC, id::text ASC
    )
    SELECT
      r.id, r.apt_seq AS "aptSeq", r.apt_name AS "aptName", r.dong, r.lawd_cd AS "lawdCd",
      r.exclusive_area::text AS "exclusiveArea", r.floor,
      r.deal_amount AS "currentAmount", r.deal_date AS "currentDate",
      r.prior_high_amount AS "priorHighAmount",
      r.immediate_prior_amount AS "previousAmount", r.immediate_prior_date AS "previousDate",
      COUNT(b.id) AS "trailingSampleCount"
    FROM representative r
    JOIN base b ON b.group_key = r.group_key AND b.row_seq <= r.row_seq AND b.month_index >= r.month_index - 12
    GROUP BY r.id, r.apt_seq, r.apt_name, r.dong, r.lawd_cd, r.exclusive_area, r.floor,
      r.deal_amount, r.deal_date, r.prior_high_amount, r.immediate_prior_amount, r.immediate_prior_date
    ORDER BY r.deal_date DESC, r.id DESC
  `;
  return rows.map((r) => ({ ...r, trailingSampleCount: Number(r.trailingSampleCount) }));
}

// ══════════════════════════════════════════════════════════════════════════
// TRADE_DB_FIRST_V1 STEP D — 지역 변동지도(region-change.ts) DB-FIRST. STEP
// C-2의 교훈(원본 row를 Node로 옮기지 않고 SQL이 최종/준최종 결과까지 계산)을
// 처음부터 적용한다 — "먼저 만들고 나중에 최적화"를 반복하지 않는다.
//
// §PAIR — region-change.ts의 buildRegionChangePairs()와 정확히 같은 정의:
// group_key(=identityKey+exact area+dealType)별로 current window의
// "가장 최근" 거래와 previous window의 "가장 최근" 거래를 각각 하나씩 뽑아
// 짝짓는다. "가장 최근" 선정 tie-break는 pickLatest()의
// `dealDate DESC → dealAmount DESC → uid ASC`를 그대로 재현한다 — 여기서
// uid는 FeedTrade 변환 시 `String(t.id)`이므로, SQL에서도 `id::text`를
// **문자열로 정렬**해야 정확히 동일한 승자가 나온다(id를 숫자로 정렬하면
// "10" vs "9" 같은 경우 다른 순서가 나올 수 있음 — 기존 동작을 "개선"하지
// 않고 있는 그대로 재현). `DISTINCT ON (group_key) ... ORDER BY group_key,
// deal_date DESC, deal_amount DESC, id::text ASC`가 pickLatest()와
// 완전히 동치다.
//
// §MEDIAN — PostgreSQL `percentile_cont(0.5) WITHIN GROUP (ORDER BY x)`는
// 연속 보간 방식의 50th percentile로, 정확히 "정렬 후 홀수면 가운데 값,
// 짝수면 가운데 두 값의 평균"과 수학적으로 동일하다(region-change.ts의
// medianOf()와 동일 정의) — 별도 재구현 없이 신뢰할 수 있다.
//
// §GROUPING SETS — "부산 전체(overall)"와 "구별(district) breakdown"을
// 한 번의 쿼리로 함께 얻기 위해 `GROUP BY GROUPING SETS ((lawd_cd), ())`를
// 쓴다 — overall 행은 lawd_cd가 NULL로 나온다.
export interface RegionChangeBucketRow {
  bucketKey: string | null; // null이면 overall
  pairCount: number;
  complexCount: number;
  medianPct: number | null;
  minPct: number | null;
  maxPct: number | null;
}

/** sigungu/dong level 공용 — bucketBy에 따라 lawd_cd 또는 dong으로 묶는다.
 * overall(전체 1행, bucketKey=null)과 bucket별 행을 한 쿼리로 함께 반환한다. */
export async function getRegionChangeBucketsFromDb(
  lawdCds: string[],
  currentFrom: string,
  currentTo: string,
  previousFrom: string,
  previousTo: string,
  bucketBy: 'lawdCd' | 'dong',
  dongFilter?: string
): Promise<RegionChangeBucketRow[]> {
  const bucketExpr = bucketBy === 'lawdCd' ? Prisma.sql`lawd_cd` : Prisma.sql`dong`;
  const dongClause = dongFilter ? Prisma.sql`AND dong = ${dongFilter}` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ bucket_key: string | null; pair_count: bigint; complex_count: bigint; median_pct: number | null; min_pct: number | null; max_pct: number | null }[]>`
    WITH base AS (
      SELECT id, group_key, identity_key, lawd_cd, dong, deal_amount, deal_date
      FROM apartment_trade_histories
      WHERE lawd_cd = ANY(${lawdCds})
        AND deal_type = 'sale'
        AND deal_canceled = false
        AND deal_date BETWEEN ${previousFrom}::date AND ${currentTo}::date
        ${dongClause}
    ),
    current_latest AS (
      SELECT DISTINCT ON (group_key) group_key, identity_key, lawd_cd, dong, deal_amount AS current_amount
      FROM base
      WHERE deal_date BETWEEN ${currentFrom}::date AND ${currentTo}::date
      ORDER BY group_key, deal_date DESC, deal_amount DESC, id::text ASC
    ),
    previous_latest AS (
      SELECT DISTINCT ON (group_key) group_key, deal_amount AS baseline_amount
      FROM base
      WHERE deal_date BETWEEN ${previousFrom}::date AND ${previousTo}::date
      ORDER BY group_key, deal_date DESC, deal_amount DESC, id::text ASC
    ),
    pairs AS (
      SELECT c.group_key, c.identity_key, c.lawd_cd, c.dong,
        ((c.current_amount - p.baseline_amount)::numeric / p.baseline_amount) * 100 AS change_pct
      FROM current_latest c
      JOIN previous_latest p ON p.group_key = c.group_key
      WHERE p.baseline_amount > 0
    )
    SELECT
      ${bucketExpr} AS bucket_key,
      COUNT(*) AS pair_count,
      COUNT(DISTINCT identity_key) AS complex_count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY change_pct) AS median_pct,
      MIN(change_pct)::float8 AS min_pct,
      MAX(change_pct)::float8 AS max_pct
    FROM pairs
    GROUP BY GROUPING SETS ((${bucketExpr}), ())
  `;
  return rows.map((r) => ({
    bucketKey: r.bucket_key,
    pairCount: Number(r.pair_count),
    complexCount: Number(r.complex_count),
    medianPct: r.median_pct,
    minPct: r.min_pct,
    maxPct: r.max_pct,
  }));
}

export interface ComplexChangeCandidateRow {
  identityKey: string;
  groupKey: string;
  aptSeq: string | null;
  aptName: string;
  dong: string;
  lawdCd: string;
  exclusiveArea: string;
  currentAmount: number;
  currentDate: Date;
  baselineAmount: number;
  baselineDate: Date;
  sampleTradeCount: number;
}

/** complex(단지) level — buildComplexChangeRows()와 동일하게, 단지(identity_key)
 * 안에 여러 raw 전용면적이 있으면 두 window 모두 거래가 있는 면적 그룹 중
 * "표본(current+previous 거래 건수 합)이 가장 많은" 면적 1개만 대표로 고른다
 * (동점이면 최근 current 거래일 DESC → group_key ASC — buildComplexChangeRows의
 * candidates.sort()와 동일한 tie-break). */
export async function getComplexChangeRowsFromDb(
  lawdCd: string,
  currentFrom: string,
  currentTo: string,
  previousFrom: string,
  previousTo: string,
  dongFilter?: string
): Promise<ComplexChangeCandidateRow[]> {
  const dongClause = dongFilter ? Prisma.sql`AND dong = ${dongFilter}` : Prisma.empty;
  const rows = await prisma.$queryRaw<
    { identityKey: string; groupKey: string; aptSeq: string | null; aptName: string; dong: string; lawdCd: string; exclusiveArea: string; currentAmount: number; currentDate: Date; baselineAmount: number; baselineDate: Date; sampleTradeCount: bigint }[]
  >`
    WITH base AS (
      SELECT id, group_key, identity_key, apt_seq, apt_name, dong, lawd_cd, exclusive_area, deal_amount, deal_date
      FROM apartment_trade_histories
      WHERE lawd_cd = ${lawdCd}
        AND deal_type = 'sale'
        AND deal_canceled = false
        AND deal_date BETWEEN ${previousFrom}::date AND ${currentTo}::date
        ${dongClause}
    ),
    area_current AS (
      SELECT DISTINCT ON (group_key) group_key, identity_key, apt_seq, apt_name, dong, lawd_cd, exclusive_area,
        deal_amount AS current_amount, deal_date AS current_date
      FROM base
      WHERE deal_date BETWEEN ${currentFrom}::date AND ${currentTo}::date
      ORDER BY group_key, deal_date DESC, deal_amount DESC, id::text ASC
    ),
    area_previous AS (
      SELECT DISTINCT ON (group_key) group_key, deal_amount AS baseline_amount, deal_date AS baseline_date
      FROM base
      WHERE deal_date BETWEEN ${previousFrom}::date AND ${previousTo}::date
      ORDER BY group_key, deal_date DESC, deal_amount DESC, id::text ASC
    ),
    area_counts AS (
      SELECT group_key,
        COUNT(*) FILTER (WHERE deal_date BETWEEN ${currentFrom}::date AND ${currentTo}::date) AS current_count,
        COUNT(*) FILTER (WHERE deal_date BETWEEN ${previousFrom}::date AND ${previousTo}::date) AS previous_count
      FROM base GROUP BY group_key
    ),
    area_pairs AS (
      SELECT c.group_key, c.identity_key, c.apt_seq, c.apt_name, c.dong, c.lawd_cd, c.exclusive_area,
        c.current_amount, c.current_date, p.baseline_amount, p.baseline_date,
        (ac.current_count + ac.previous_count) AS sample_trade_count
      FROM area_current c
      JOIN area_previous p ON p.group_key = c.group_key
      JOIN area_counts ac ON ac.group_key = c.group_key
      WHERE p.baseline_amount > 0
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY identity_key
        ORDER BY sample_trade_count DESC, current_date DESC, group_key ASC
      ) AS rn
      FROM area_pairs
    )
    SELECT
      identity_key AS "identityKey", group_key AS "groupKey", apt_seq AS "aptSeq", apt_name AS "aptName",
      dong, lawd_cd AS "lawdCd", exclusive_area::text AS "exclusiveArea",
      current_amount AS "currentAmount", current_date AS "currentDate",
      baseline_amount AS "baselineAmount", baseline_date AS "baselineDate",
      sample_trade_count AS "sampleTradeCount"
    FROM ranked
    WHERE rn = 1
  `;
  return rows.map((r) => ({ ...r, sampleTradeCount: Number(r.sampleTradeCount) }));
}
