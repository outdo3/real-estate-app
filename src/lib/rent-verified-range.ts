// RENT_TRADE_HISTORY_V1 PHASE D — 순수 함수(zero-import, DB/네트워크 없음). 이 repo의
// `.test.mjs` 관례(`node --experimental-strip-types --test`)는 `./prisma`처럼 확장자
// 없는 상대 import를 해석하지 못한다(trade-history-read.ts도 동일 문제, EJIP_SCORE_V2_
// PHASE2의 score-card-presenter.ts와 같은 이유로 순수 로직만 분리) — rent-history-read.ts는
// 이 파일에서 상수/함수를 그대로 re-export해서 쓴다.
//
// 검증범위는 "오늘 기준 최근 N개월"이 아니라 **실제 sync/completeness 증거로 확정된
// 고정 스냅샷**이다 — sale(2006-01~, 매일 갱신되는 nationwide incremental sync 존재)과
// 근본적으로 다르다. dashboard의 `last12Months`는 항상 `now` 기준 rolling window라서,
// 이 스냅샷이 고정된 채로 시간이 흐르면 window 뒤쪽(현재월 + 아직 sync 안 된 완료월)이
// 검증범위 밖으로 밀려난다 — PHASE D.2의 completed-month incremental sync가 바로
// 이 경계(RENT_VERIFIED_TO)를 매달 증거 기반으로 전진시키는 역할을 한다.
//
// PROVENANCE(마지막 갱신 — rolling 재계산 아님, 매번 실제 sync 결과로만 갱신):
//   from: 202408, to: 202608
//   verifiedAt: 2026-09-02T03:29:25.618Z (202608 --apply DONE, PHASE D.2)
//   districts: 부산 16/16, cells: 16/16 COMPLETE(202608 단독) — 24개월 누적 기준
//     PHASE C(384/384) + PHASE D.2(16/16) = 400/400 COMPLETE
//   sync version: scripts/rent-trade-history/sync-rent-history.ts(PHASE B, 무변경)
export const RENT_VERIFIED_FROM = '202408';
export const RENT_VERIFIED_TO = '202608';

/** 요청된 월(YYYYMM) 목록을 검증범위 안/밖으로 나눈다. 입력이 정렬돼 있지 않아도
 * 안전하다 — 각 원소를 독립적으로 판정한다. */
export function splitVerifiedMonths(months: string[]): { verified: string[]; unverified: string[] } {
  const verified: string[] = [];
  const unverified: string[] = [];
  for (const m of months) {
    if (m >= RENT_VERIFIED_FROM && m <= RENT_VERIFIED_TO) verified.push(m);
    else unverified.push(m);
  }
  return { verified, unverified };
}

/** RENT_VERIFIED_TO 월의 마지막 날짜(UTC 자정) — SQL 쿼리 범위를 검증범위로 clip할 때
 * 쓴다(예: 오늘까지 뻗는 "최근 7일" 구간의 일부만 verified). trade-history-read.ts의
 * `candidateFromDate()`와 동일하게 UTC 자정 고정(§BOUNDARY-FIX와 같은 클래스의 day
 * 경계 버그를 피하기 위함). */
export function verifiedToDateInclusive(): Date {
  const y = Number(RENT_VERIFIED_TO.slice(0, 4));
  const m = Number(RENT_VERIFIED_TO.slice(4, 6));
  return new Date(Date.UTC(y, m, 0)); // m(1-based)의 다음 달 0일 = m월의 마지막 날
}

/** RENT_VERIFIED_FROM 월의 첫째 날짜(UTC 자정). */
export function verifiedFromDateInclusive(): Date {
  const y = Number(RENT_VERIFIED_FROM.slice(0, 4));
  const m = Number(RENT_VERIFIED_FROM.slice(4, 6));
  return new Date(Date.UTC(y, m - 1, 1));
}

/** 임의의 [from,to] 날짜 range를 검증범위 [verifiedFrom,verifiedTo]로 clip한다. 겹치는
 * 부분이 전혀 없으면 null(호출부가 "이 range는 DB에서 셀 수 있는 부분이 0"으로 처리).
 * PHASE D.2 §16 hybrid routing(verified 부분=SQL aggregate, 나머지=MOLIT row count)의
 * 핵심 유틸 — 대시보드의 7일/30일/3개월 비교처럼 "현재"쪽 range가 항상 오늘(=현재
 * 진행중이라 미검증)까지 뻗는 경우, clip된 부분만 DB에 묻고 나머지는 호출부가 이미
 * 갖고 있는 미검증월 MOLIT row에서 직접 세도록 경계를 알려준다. */
export function clipDateRangeToVerified(from: Date, to: Date): { from: Date; to: Date } | null {
  const vFrom = verifiedFromDateInclusive();
  const vTo = verifiedToDateInclusive();
  const clippedFrom = from < vFrom ? vFrom : from;
  const clippedTo = to > vTo ? vTo : to;
  if (clippedFrom > clippedTo) return null;
  return { from: clippedFrom, to: clippedTo };
}
