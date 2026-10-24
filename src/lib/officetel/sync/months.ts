// OFFICETEL_INCREMENTAL_SYNC_V1 — 계약월 계산. 순수 함수.
//
// 한국 기준 달력월을 쓴다: cron이 UTC 19~01시에 돌아 KST 날짜가 UTC보다 하루 앞서기 때문에, UTC 달력월을
// 쓰면 월말·월초에 새 달 거래가 하루 늦게 들어온다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 'YYYYMM' (KST 달력월). */
export function kstYearMonth(now: Date): string {
  const k = new Date(now.getTime() + KST_OFFSET_MS);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function subtractMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6));
  const idx = y * 12 + (m - 1) - n;
  const ny = Math.floor(idx / 12);
  return `${ny}${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** from..to(포함) 월 목록. from > to면 빈 배열. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let cur = from, i = 0; cur <= to && i < 240; i++) {
    out.push(cur);
    cur = subtractMonths(cur, -1);
  }
  return out;
}

export const INCREMENTAL_LOOKBACK_MONTHS = 2;

/** 평시 증분: 현재월과 직전월(lookbackMonths=2). */
export function incrementalMonths(now: Date, lookbackMonths: number = INCREMENTAL_LOOKBACK_MONTHS): string[] {
  const cur = kstYearMonth(now);
  return monthRange(subtractMonths(cur, Math.max(1, lookbackMonths) - 1), cur);
}

/** 매매 재확인 band 기본값: 증분이 덮는 달 바로 바깥(현재월-2 ~ 현재월-12). 겹침도 틈도 없다. */
export const RECHECK_MIN_MONTHS_BACK = INCREMENTAL_LOOKBACK_MONTHS;
export const RECHECK_MAX_MONTHS_BACK = 12;

export function recheckMonths(now: Date, minBack: number = RECHECK_MIN_MONTHS_BACK, maxBack: number = RECHECK_MAX_MONTHS_BACK): string[] {
  const cur = kstYearMonth(now);
  return monthRange(subtractMonths(cur, maxBack), subtractMonths(cur, minBack));
}

/** 부산 16개 구·군 (lawdCd). 오피스텔 master/history가 적재된 범위와 같다. */
export const OFFICETEL_BUSAN_LAWD_CDS: readonly string[] = [
  '26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
  '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710',
];
