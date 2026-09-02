// RENT_TRADE_HISTORY_V1 PHASE D.2 — 순수 함수(zero-import, DB/네트워크 없음)만 분리한다.
// incremental-sync-completed-month.ts가 이 파일에서 그대로 re-export해서 쓴다(이
// repo의 `.test.mjs` 관례가 확장자 없는 상대 import(`./sync-rent-history` → prisma)를
// 해석하지 못하는 것과 같은 이유, rent-verified-range.ts와 동일 패턴).

/** 직전 완료월(YYYYMM). 진행 중인 현재월은 절대 포함하지 않는다. */
export function latestCompleteMonth(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m0 = now.getUTCMonth(); // 0-based: 현재월의 인덱스
  const prev = new Date(Date.UTC(y, m0 - 1, 1));
  return `${prev.getUTCFullYear()}${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** ym에서 n개월 전(YYYYMM). */
export function subtractMonths(ym: string, n: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4, 6));
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
