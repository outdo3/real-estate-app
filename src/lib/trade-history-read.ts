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
import type { Prisma } from '@prisma/client';
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
