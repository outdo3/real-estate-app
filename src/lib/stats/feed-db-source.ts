// BUSAN_12M_STATS_PERFORMANCE_FIX_V1 §4 — /api/stats/feed "부산 전체" 조회의 DB-first 소스.
//
// ── 왜 필요한가 ────────────────────────────────────────────────────────────────
// `GET /api/stats/feed?sidoCode=26&period=12m`은 16개 구 × 12개월 × (매매+전월세) =
// **384개의 MOLIT 호출**을 한 요청 안에서 했다. 전역 스로틀(동시 6, 슬롯당 200ms 페이싱)
// 때문에 호출 수가 곧 벽시계 시간이 되어 실측 22~25초였다(계산: (150ms + 200ms) × 384 / 6
// ≈ 22.4s — 실측치와 일치). 캐시가 비는 순간마다 그 22초가 다시 발생한다(force-dynamic,
// 인스턴스별 5분 TTL 메모리 캐시).
//
// ── 왜 DB로 바꿀 수 있는가 ─────────────────────────────────────────────────────
// 부산 매매/전월세는 이미 영구 테이블에 있고, 같은 데이터를 이미 다른 화면이 DB에서 읽는다:
//   · apartment_trade_histories — 부산 16/16 구, 2006-01~, 매일 sync + 회전 recheck
//     (/api/transactions DB-first, /api/stats/dashboard, 지도 마커, 분위지도)
//   · apartment_rent_histories  — 완료월 스냅샷(검증범위는 sync_coverage_cells가 결정)
//     (/api/stats/dashboard PHASE D)
// 즉 이 파일은 **새 데이터 소스를 만드는 게 아니라**, 같은 요청을 이미 DB로 처리하는
// 경로(dashboard)와 동일한 어댑터 패턴을 피드에도 적용하는 것이다.
//
// ── 무엇을 하지 않는가(신뢰 경계) ──────────────────────────────────────────────
//  · 부산이 아닌 시도에는 적용하지 않는다(그쪽은 DB에 데이터가 없다) — 기존 MOLIT 경로 그대로.
//  · 전월세는 **검증범위 안 월만** DB로 읽는다. 검증되지 않은 월(주로 진행 중인 현재월)은
//    기존 MOLIT 경로를 그대로 쓴다 — 검증 안 된 기간을 "DB complete"로 가장하지 않는다
//    (RENT_TRADE_HISTORY_V1 PHASE D §16/§17과 동일 규칙, 같은 함수를 재사용한다).
//  · 취소 거래를 버리지 않는다. 피드는 취소 거래를 배지와 함께 보여주고 집계에서만 뺀다.
//  · 집계 공식·기간 옵션·신고가 정의를 바꾸지 않는다. 이 파일이 만드는 것은 `toFeedTrade()`가
//    먹는 것과 **동일한 모양의 raw item**뿐이고, 그 뒤 로직(dedupe/annotate/summary/정렬)은
//    한 줄도 바뀌지 않는다.
import { toFeedTrade, type FeedTrade } from '@/lib/regional-feed';
import { getRegionalSaleRowsForFeedFromDb, type FeedSaleRow } from '@/lib/trade-history-read';
import { fetchRentMonthBucketsFromDb, type StoredRentTrade } from '@/lib/rent-history-read';
import { warmupConnections } from '@/lib/prisma';

/** DB에 실거래 이력이 적재된 시도. 소프트런칭 범위와 동일하게 부산뿐이다. */
export const FEED_DB_SIDO_CODE = '26';

/** 이 sidoCode의 "시도 전체" 피드를 DB로 처리할 수 있는가. */
export function isFeedDbBackedSido(sidoCode: string | null | undefined): boolean {
  return sidoCode === FEED_DB_SIDO_CODE;
}

/** YYYYMM 목록이 커버하는 달 경계(UTC). MOLIT 경로가 "겹치는 달 전체"를 가져오는 것과
 * 동일한 범위를 DB 쿼리에 주기 위한 변환 — 날짜 단위로 자르면 allTrades가 달라진다. */
export function monthRangeBounds(months: string[]): { from: Date; to: Date } | null {
  if (months.length === 0) return null;
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const from = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(4, 6)) - 1, 1));
  // 마지막 달의 말일 23:59:59.999 — deal_date는 date 컬럼이지만 상한을 날짜로 끊어도
  // 같은 결과가 되도록 말일 끝으로 둔다.
  const to = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(4, 6)), 0, 23, 59, 59, 999));
  return { from, to };
}

/** 저장된 매매 row → `toFeedTrade()`가 먹는 MOLIT-shape raw item.
 * dashboard의 storedTradeToDashboardTrade와 같은 역할이지만, 피드는 info 문자열/price
 * 라벨을 쓰지 않고(라우트가 formatKoreanPrice로 따로 만든다) toFeedTrade가 읽는 필드만
 * 필요하다 — 쓰이지 않는 파생 문자열을 82,000건마다 만들지 않는다. */
export function storedSaleToFeedRaw(t: FeedSaleRow): Record<string, unknown> {
  return {
    id: `db-sale-${t.id}`,
    name: t.aptName,
    dong: t.dong,
    aptSeq: t.aptSeq,
    dealAmount: t.dealAmount,
    excluUseArea: Number(t.exclusiveArea),
    floorRaw: t.floor,
    dealDate: t.dealDate.toISOString().slice(0, 10),
    dealCanceled: t.dealCanceled,
    typeLabel: '실거래',
  };
}

/** 저장된 전월세 row → MOLIT-shape raw item.
 *
 * `dealCanceled: false`는 새로운 판정이 아니다 — MOLIT 전월세 API 자체에 취소 필드가 없어
 * 기존 라이브 경로도 모든 전월세 row에 대해 항상 false를 만들어 왔고(PHASE A §7),
 * apartment_rent_histories에는 취소 컬럼 자체가 없다. 같은 상수 모양을 맞출 뿐이다. */
export function storedRentToFeedRaw(r: StoredRentTrade): Record<string, unknown> {
  return {
    id: `db-rent-${r.lawdCd}:${r.dealYmd}:${r.aptSeq ?? r.aptName}:${r.exclusiveArea}:${r.deposit}:${r.monthlyRent}:${r.floor ?? 'x'}:${r.dealDate.toISOString().slice(0, 10)}`,
    name: r.aptName,
    dong: r.dong,
    aptSeq: r.aptSeq,
    dealAmount: r.deposit,
    monthlyRent: r.monthlyRent,
    excluUseArea: Number(r.exclusiveArea),
    floorRaw: r.floor,
    dealDate: r.dealDate.toISOString().slice(0, 10),
    dealCanceled: false,
    typeLabel: '전월세',
  };
}

/** 전월세 타입 판정 — 라우트의 MOLIT 경로와 **완전히 동일한 규칙**을 쓴다
 * (`raw.monthlyRent > 0 ? 'wolse' : 'jeonse'`). 저장된 deal_type 컬럼도 같은 규칙으로
 * 만들어졌지만(rent-history-logic.ts classifyRentType), 경로마다 다른 근거를 쓰면
 * 언젠가 갈라진다 — 한 규칙만 남긴다. */
function rentDealType(monthlyRent: number): 'jeonse' | 'wolse' {
  return monthlyRent > 0 ? 'wolse' : 'jeonse';
}

export interface FeedDbLoadResult {
  trades: FeedTrade[];
  saleRowCount: number;
  rentRowCount: number;
}

/**
 * 부산 "시도 전체" 피드의 DB 소스를 읽는다.
 *
 * - 매매: 요청 창의 **모든 달**(부산 매매는 2006-01~ 연속 적재).
 * - 전월세: 호출부가 넘긴 **검증범위 안 월만**(fetchRentMonthBucketsFromDb가 한 번 더
 *   방어적으로 범위를 강제한다 — 이중 안전장치).
 *
 * 두 쿼리를 병렬로 쏘고, 콜드 인스턴스에서 병렬성이 실제로 살아나도록 커넥션을 미리
 * 워밍업한다(PERFORMANCE_V1.2 실측: 워밍업 없으면 병렬이 사실상 순차가 된다).
 */
export async function loadBusanFeedTradesFromDb(
  lawdCds: string[],
  months: string[],
  verifiedRentMonths: string[]
): Promise<FeedDbLoadResult> {
  const bounds = monthRangeBounds(months);
  if (!bounds || lawdCds.length === 0) return { trades: [], saleRowCount: 0, rentRowCount: 0 };

  const [saleRows, rentBuckets] = await Promise.all([
    getRegionalSaleRowsForFeedFromDb(lawdCds, bounds.from, bounds.to),
    verifiedRentMonths.length > 0
      ? fetchRentMonthBucketsFromDb(lawdCds, verifiedRentMonths)
      : Promise.resolve(new Map<string, StoredRentTrade[]>()),
    warmupConnections(2),
  ]);

  const trades: FeedTrade[] = [];
  for (const row of saleRows) {
    const t = toFeedTrade(storedSaleToFeedRaw(row), 'sale', row.lawdCd);
    if (t) trades.push(t);
  }
  let rentRowCount = 0;
  for (const bucket of rentBuckets.values()) {
    for (const row of bucket) {
      rentRowCount++;
      const t = toFeedTrade(storedRentToFeedRaw(row), rentDealType(row.monthlyRent), row.lawdCd);
      if (t) trades.push(t);
    }
  }

  return { trades, saleRowCount: saleRows.length, rentRowCount };
}
