// CRON_DURABLE_PROGRESS_V1 — cron 실행 시간 한도를 MOLIT 요청 단위까지 내려보내는 순수 모듈.
//
// 문제(GYEONGGI_SALE_CRON_INCOMPLETE_ROOT_CAUSE_AUDIT_V1 §5): 예산은 셀 **사이**에서만 확인했다. 셀 하나가
// 10s 타임아웃 × 6회 + backoff ≈ 70s까지 늘어질 수 있어, 셀을 시작한 뒤에는 60s 플랫폼 한도를 넘는 것을
// 막을 방법이 없었다.
//
// 시간 모델(route maxDuration = 60s):
//   0 ─ 작업 예산(sale·rent 50s, recheck 45s) ─┬─ 정리 예비(≥ 10s): 콜드스타트·요약·로그·응답 ─ 60s
//   - 요청 시도는 "대기 + 시도 타임아웃 + 셀 커밋 예비"가 남은 예산 안에 들어올 때만 시작한다.
//   - 시도 타임아웃은 기본 10s이고, 예산 끝에서는 남은 시간만큼 줄인다(최소 MIN_ATTEMPT_TIMEOUT_MS).
//   - 셀 커밋 예비는 마지막 응답 뒤 그 셀의 DB 쓰기 + coverage upsert 몫이다.
//   → 마지막 MOLIT 시도는 예산 − 커밋 예비 이전에 끝나고, 그 셀의 커밋까지 예산 안에서 끝난다.
//
// deadline을 넘기지 않은 호출(CLI backfill 등)은 예전과 똑같이 10s 타임아웃 · 6회 재시도로 동작한다.

/** 한 번의 MOLIT 요청 시도 최대 타임아웃(기존 AbortSignal.timeout(10000) 그대로). */
export const MOLIT_ATTEMPT_TIMEOUT_MS = 10_000;
/** 이보다 짧은 타임아웃으로는 시도하지 않는다. 정상 MOLIT 응답 ≈ 0.3–0.5s, 느린 밤 ≈ 1.5s. */
export const MIN_ATTEMPT_TIMEOUT_MS = 2_000;
/** 응답을 받은 뒤 그 셀의 DB 쓰기와 coverage upsert에 남겨두는 시간. 정상 셀 전체 ≈ 0.8s. */
export const CELL_COMMIT_RESERVE_MS = 2_000;

/** 남은 작업 시간을 알려주는 것(TimeBudget이 구현한다). */
export interface RequestDeadline {
  remainingMs(): number;
}

export type AttemptPlan = { ok: true; timeoutMs: number } | { ok: false; reason: 'DEADLINE_REACHED'; remainingMs: number };

/**
 * `preWaitMs`(최소 간격 대기·backoff) 뒤에 요청 시도를 시작해도 되는가, 된다면 타임아웃은 얼마인가.
 * deadline이 없으면 항상 기본 타임아웃으로 허용한다(기존 동작).
 */
export function planRequestAttempt(deadline: RequestDeadline | undefined, preWaitMs: number): AttemptPlan {
  if (!deadline) return { ok: true, timeoutMs: MOLIT_ATTEMPT_TIMEOUT_MS };
  const remainingMs = deadline.remainingMs();
  const usable = remainingMs - Math.max(0, preWaitMs) - CELL_COMMIT_RESERVE_MS;
  if (usable < MIN_ATTEMPT_TIMEOUT_MS) return { ok: false, reason: 'DEADLINE_REACHED', remainingMs };
  return { ok: true, timeoutMs: Math.min(MOLIT_ATTEMPT_TIMEOUT_MS, usable) };
}

/**
 * 새 셀을 시작할 여유가 있는가. 기존 셀 추정치 확인에 더해, 그 셀의 **첫 시도**가 deadline에 걸리지 않는지 본다.
 * 그래서 정상적인 예산 끝은 요청 0회인 셀 경계 정지(BUDGET_STOP)로 끝나고, DEADLINE_REACHED는
 * 이미 시작한 셀의 재시도·다음 쪽이 잘렸을 때만 나온다.
 */
export function hasRoomForCell(
  budget: RequestDeadline & { hasRoomFor(estimatedCellMs: number): boolean },
  estimatedCellMs: number,
  minIntervalMs: number
): boolean {
  return budget.hasRoomFor(estimatedCellMs) && planRequestAttempt(budget, minIntervalMs).ok;
}
