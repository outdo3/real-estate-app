// GYEONGGI_CRON_EXPANSION_V1 — 매매 cron(부산·서울·경기 공통)의 MOLIT 일일 한도 예약분 가드. 순수 함수.
//
// 예전 cron은 응답 헤더 x-ratelimit-remaining을 **관측만** 했다(sale-molit-fetch.ts saleQuotaObserved).
// 같은 API 키를 라이브 조회·backfill이 함께 쓰므로, cron이 예약분(2,000)까지 파먹으면 그날 사용자 화면과
// 긴급 재조회가 막힌다. backfill CLI는 이미 예약분에서 멈춘다(backfill-seoul-sale-logic quotaDecision) —
// 같은 개념을 cron 경로에 **분리된 작은 모듈로** 둔다(backfill 코드와 결합하지 않는다).
//
// 경계(정확히):
//   remaining  >  reserve → 진행(2,001이면 요청 1회 가능)
//   remaining <=  reserve → 중단(2,000·1,999 모두 중단) — QUOTA_RESERVE_REACHED
//   관측 없음 · 다른 KST 날짜의 관측 → 진행. 한도를 알려면 요청을 해야 하는데, 한도를 묻기 위한 요청은
//     하지 않는다(그 자체가 한도를 쓴다). 날짜가 다르면 이미 리셋된 한도이므로 어제 값으로 막지 않는다
//     (서버리스 인스턴스가 따뜻하게 남아 있으면 모듈 상태가 다음 날까지 살아 있을 수 있다).

/** MOLIT 일일 한도 중 cron이 절대 쓰지 않는 예약분. */
export const CRON_MOLIT_QUOTA_RESERVE = 2000;

export interface QuotaObservation {
  /** 마지막으로 관측한 x-ratelimit-remaining. 관측 전이면 null. */
  remaining: number | null;
  /** 그 관측 시각(epoch ms). */
  at: number | null;
}

export type QuotaDecision =
  | { proceed: true; reason: 'UNKNOWN' | 'STALE_OTHER_KST_DAY' | 'ABOVE_RESERVE'; remaining: number | null }
  | { proceed: false; reason: 'QUOTA_RESERVE_REACHED'; remaining: number };

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** epoch ms → KST 달력 날짜 'YYYY-MM-DD'. */
export function kstDateOf(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 다음 MOLIT 요청을 보내도 되는가. 새 요청을 만들지 않고 이미 관측한 값만 쓴다. */
export function molitQuotaDecision(
  obs: QuotaObservation,
  nowMs: number,
  reserve: number = CRON_MOLIT_QUOTA_RESERVE
): QuotaDecision {
  if (obs.remaining == null || obs.at == null || !Number.isFinite(obs.remaining)) {
    return { proceed: true, reason: 'UNKNOWN', remaining: null };
  }
  if (kstDateOf(obs.at) !== kstDateOf(nowMs)) {
    return { proceed: true, reason: 'STALE_OTHER_KST_DAY', remaining: null };
  }
  if (obs.remaining <= reserve) {
    return { proceed: false, reason: 'QUOTA_RESERVE_REACHED', remaining: obs.remaining };
  }
  return { proceed: true, reason: 'ABOVE_RESERVE', remaining: obs.remaining };
}
