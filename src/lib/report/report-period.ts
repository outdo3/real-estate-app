// REPORT-2 §3 — 리포트 기본 기간.
//
// 왜 "최근 30일"인가: 당월만 쓰면 sync_coverage_cells에 당월 셀이 아직 없어
// (PRECHECK 실측: 202609 셀 0개) 리포트가 항상 UNVERIFIED로 뜬다. 최근 30일은
// 대부분 검증이 끝난 직전 월을 함께 덮으므로 실제로 쓸 수 있는 기본값이다.
// 완전성이 부족하면 숨기지 않고 envelope의 trust로 그대로 드러낸다.
//
// 종료일은 "오늘"이 아니라 **어제**로 둔다. 오늘자 수집은 cron(19:00 UTC = 04:00 KST)
// 이후에야 들어오므로, 오늘을 포함하면 시간대에 따라 마지막 하루가 비어 보인다.

export const DEFAULT_PERIOD_DAYS = 30;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface ResolvedPeriod {
  start: string;
  end: string;
  label: string;
  days: number;
}

/** 허용 기간(일). 임의 값을 URL로 받지 않는다 — 캐시 키 파편화와 과도한 스캔을 막는다. */
export const ALLOWED_PERIOD_DAYS = [30, 90, 365] as const;
export type AllowedPeriodDays = (typeof ALLOWED_PERIOD_DAYS)[number];

export function isAllowedPeriodDays(n: number): n is AllowedPeriodDays {
  return (ALLOWED_PERIOD_DAYS as readonly number[]).includes(n);
}

const LABEL: Record<number, string> = { 30: '최근 30일', 90: '최근 90일', 365: '최근 1년' };

/** now 기준 기간을 만든다(테스트 결정론을 위해 now를 주입할 수 있다). */
export function resolvePeriod(days: number = DEFAULT_PERIOD_DAYS, now: Date = new Date()): ResolvedPeriod {
  const d = isAllowedPeriodDays(days) ? days : DEFAULT_PERIOD_DAYS;
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 1); // 어제까지
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (d - 1));
  return { start: ymd(start), end: ymd(end), label: LABEL[d] ?? `최근 ${d}일`, days: d };
}

/** ?period=90 같은 쿼리를 안전하게 해석한다. 이상한 값은 조용히 기본값으로. */
export function parsePeriodParam(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isFinite(n) && isAllowedPeriodDays(n) ? n : DEFAULT_PERIOD_DAYS;
}
