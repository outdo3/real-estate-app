// RENT_TRADE_HISTORY_V1 PHASE D — 순수 함수(zero-import, DB/네트워크 없음). 이 repo의
// `.test.mjs` 관례(`node --experimental-strip-types --test`)는 `./prisma`처럼 확장자
// 없는 상대 import를 해석하지 못한다(trade-history-read.ts도 동일 문제, EJIP_SCORE_V2_
// PHASE2의 score-card-presenter.ts와 같은 이유로 순수 로직만 분리) — rent-history-read.ts는
// 이 파일에서 상수/함수를 그대로 re-export해서 쓴다.
//
// PHASE C가 검증한 범위는 "오늘 기준 최근 24개월"이 아니라 **고정된 과거 스냅샷**
// (202408~202607, 부산 16/16)이다 — sale(2006-01~, 매일 갱신되는 nationwide incremental
// sync 존재)과 근본적으로 다르다. dashboard의 `last12Months`는 항상 `now` 기준 rolling
// window라서, 이 스냅샷이 고정된 채로 시간이 흐르면 window 뒤쪽(현재월 + 직전월)이
// 검증범위 밖으로 밀려난다.
export const RENT_VERIFIED_FROM = '202408';
export const RENT_VERIFIED_TO = '202607';

/** 요청된 월(YYYYMM) 목록을 PHASE C 검증범위 안/밖으로 나눈다. 입력이 정렬돼 있지
 * 않아도 안전하다 — 각 원소를 독립적으로 판정한다. */
export function splitVerifiedMonths(months: string[]): { verified: string[]; unverified: string[] } {
  const verified: string[] = [];
  const unverified: string[] = [];
  for (const m of months) {
    if (m >= RENT_VERIFIED_FROM && m <= RENT_VERIFIED_TO) verified.push(m);
    else unverified.push(m);
  }
  return { verified, unverified };
}
