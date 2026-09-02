// RENT_TRADE_HISTORY_V1 PHASE D — 전월세(jeonse/wolse) DB-first 공통 read layer.
// trade-history-read.ts(매매)와 같은 원칙: 이 파일은 fetchMolitData/molit-stats-helpers를
// import하지 않는다(grep으로 재확인 가능) — MOLIT 호출 없이 apartment_rent_histories만
// 읽는다.
//
// PHASE C가 검증한 범위는 "오늘 기준 최근 24개월"이 아니라 **고정된 과거 스냅샷**
// (202408~202607, 부산 16/16)이다 — sale(2006-01~, 매일 갱신되는 nationwide incremental
// sync 존재)과 근본적으로 다르다. dashboard의 `last12Months`는 항상 `now` 기준 rolling
// window라서, 이 스냅샷이 고정된 채로 시간이 흐르면 window 뒤쪽(현재월 + 직전월)이
// 검증범위 밖으로 밀려난다 — 이 파일은 그 경계를 명시적으로 정의하고, 호출부가 반드시
// splitVerifiedMonths()로 verified/unverified를 나눠 verified만 이 파일에 묻도록 강제한다.
import { prisma } from './prisma';
import { RENT_VERIFIED_FROM, RENT_VERIFIED_TO } from './rent-verified-range';

export { RENT_VERIFIED_FROM, RENT_VERIFIED_TO, splitVerifiedMonths } from './rent-verified-range';

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
 * 안 된 기간을 "DB complete"로 가장하지 않기 위한 이중 안전장치, PHASE D §5/§16). */
export async function fetchRentMonthBucketsFromDb(lawdCds: string[], months: string[]): Promise<Map<string, StoredRentTrade[]>> {
  const buckets = new Map<string, StoredRentTrade[]>(months.map((m) => [m, []]));
  const inRange = months.filter((m) => m >= RENT_VERIFIED_FROM && m <= RENT_VERIFIED_TO);
  if (inRange.length === 0 || lawdCds.length === 0) return buckets;

  const sorted = [...inRange].sort();
  const from = ymStartDate(sorted[0]);
  const to = ymEndDate(sorted[sorted.length - 1]);

  // PERFORMANCE_V1.1_AREA84_INDEX/PERFORMANCE_V1.1_B가 이미 실측한 교훈 재적용 — Prisma의
  // 모델 매핑 findMany는 select를 좁혀도(48,768 rows 기준 8.0s→3.86s) 여전히 raw SQL
  // (동일 조건, 동일 row 수, 2.34s)보다 느리다. gapInvest/jeonseRate/volumeSummaryByPeriod
  // 전부 dealDate 단위(월 집계로 대체 불가능한 일 단위 range 비교, 예: 최근 7일/30일)
  // 개별 row가 필요해 SQL aggregate로 완전히 대체할 수는 없지만(§ dashboard/route.ts
  // 상단 주석 참고), row 자체는 반드시 옮겨야 하므로 최소한 "옮기는 방식"만 더 빠르게 한다.
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
