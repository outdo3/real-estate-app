// E-JIP MOLIT PARTIAL FAILURE REDUCTION V1 — 프로세스 단일 MOLIT 요청 게이트.
//
// 원인(실측, docs/development/MOLIT_PARTIAL_FAILURE_REDUCTION_V1.md):
//  - 최근 7일 error_logs의 MOLIT_PARTIAL 97건은 전부 /api/apt/[name]에서 났고, 그중
//    91건(93.8%)의 사유가 "초당 서비스 요청제한 횟수 초과"였다. 요청한 4,440개월 중
//    1,721개월(38.8%)이 실패했다.
//  - 동시성 6 / 슬롯당 200ms 게이트는 molit-stats-helpers.ts 안에만 있었고, 상세 라우트는
//    이를 거치지 않고 12개월씩 동시에(페이싱·재시도 없이) 쐈다. 상세페이지 1회 = 이 라우트
//    3회 동시 호출이라, 캐시가 차가운 지역에서는 순간 36건이 한꺼번에 나갔다.
//  - 같은 60개월 조회를 "게이트 없음"으로 쏘면 100% 실패(0.2s), 동시성 6 / 200ms로
//    쏘면 0% 실패(3.3s)였다. 60개월 3건 동시(180콜)도 공유 게이트 하나로 0% 실패였다.
//  - 제한을 한 번 넘기면 **서비스 키 전체가 약 60초 잠긴다**(실측: 버스트 뒤 1초 간격
//    단일 요청이 59.7s까지 전부 거절, 이후 회복). 키는 모든 인스턴스가 공유하므로 한 곳의
//    버스트가 전 인스턴스를 1분간 막는다. 잠긴 동안의 즉시 재시도는 성공하지 못하고
//    쿼터와 시간만 쓴다(실측: 다른 인스턴스 버스트와 충돌 시 재시도 171회, 53s, 95% 실패).
//
// 그래서 이 모듈은
//  1) fetchMolitData의 **모든** 호출(상세·거래목록·학교·분양·통계·점수)이 하나의
//     세마포어(인스턴스당 동시성 4 / 250ms)를 공유하게 해 제한 자체를 넘지 않게 하고
//     (= 실제 해결책),
//  2) 그래도 제한을 맞으면 인스턴스 단위 차단기(circuit breaker)를 열어 잠긴 동안
//     네트워크로 나가는 요청을 probe 1건으로 줄이고, 각 월 요청은 정해진 예산 안에서만
//     기다린 뒤 정직하게 실패(partial)로 끝낸다.
//
// 한계: 이 게이트/차단기는 **프로세스(서버리스 인스턴스) 단위**다. Vercel이 인스턴스를
// 여러 개 띄우면 인스턴스마다 동시성 6이 따로 존재하고, 한 인스턴스가 연 차단기를 다른
// 인스턴스는 모른다(각자 첫 제한 응답을 받고서야 연다). 전역 조율에는 외부 저장소
// (Redis/KV)가 필요하며 이는 이번 STEP의 범위 밖(승인 필요)이다.

export type MolitFailureClass = 'RATE_LIMIT' | 'TIMEOUT' | 'AUTH' | 'BAD_REQUEST' | 'OTHER';

// 공공데이터포털 게이트웨이의 초당 제한 응답. 한글 원문(returnAuthMsg)과 영문 코드
// (LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR)를 모두 인식한다.
// 일일 한도 초과(LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR)는 기다려도 풀리지
// 않으므로 "초당"/"PER_SECOND"가 있는 경우만 RATE_LIMIT으로 본다.
const RATE_LIMIT_PATTERN = /초당\s*서비스\s*요청\s*제한|PER_SECOND_EXCEEDS/i;
const TIMEOUT_PATTERN = /timeout|timed out|aborted|TimeoutError/i;
const AUTH_PATTERN = /SERVICE_KEY|등록되지\s*않은\s*서비스키|인증|DATA_GO_KR_API_KEY is not defined|SERVICE_ACCESS_DENIED/i;
const BAD_REQUEST_PATTERN = /지원하지 않는 거래 유형|INVALID_REQUEST|잘못된\s*요청|NO_OPENAPI_SERVICE/i;

export function classifyMolitFailure(message: unknown): MolitFailureClass {
  const text = typeof message === 'string' ? message : String((message as Error)?.message ?? message ?? '');
  // 인증/요청 오류를 먼저 본다 — 재시도해도 절대 회복되지 않는 부류를 RATE_LIMIT으로
  // 오분류해 쿼터만 더 쓰는 일이 없게 한다.
  if (AUTH_PATTERN.test(text)) return 'AUTH';
  if (BAD_REQUEST_PATTERN.test(text)) return 'BAD_REQUEST';
  if (RATE_LIMIT_PATTERN.test(text)) return 'RATE_LIMIT';
  if (TIMEOUT_PATTERN.test(text)) return 'TIMEOUT';
  return 'OTHER';
}

/** 재시도 대상은 초당 제한뿐이다. 타임아웃/인증/요청/데이터 없음/파싱 실패는 재시도하지 않는다. */
export function isRetryableMolitFailure(cls: MolitFailureClass): boolean {
  return cls === 'RATE_LIMIT';
}

// ── 정책 상수 ────────────────────────────────────────────────────────────
// 동시성/페이싱(인스턴스당). 서비스 키 한도는 실측상 합산 약 22~33 rps 사이다:
//   인스턴스 1개 × 6/200ms  → 0% 제한 (60개월 3.3s)
//   인스턴스 2개 × 6/200ms  → 83~84% 제한 (키 잠김)
//   인스턴스 2개 × 4/250ms  → 0% 제한 (각 ~11 rps, 합산 ~22 rps)
//   인스턴스 3개 × 4/250ms  → 93% 제한 (합산 ~33 rps)
//   인스턴스 2개 × 3/300ms  → 0% 제한 (각 ~7.5 rps)
// 인스턴스 1개일 때는 6/200도 안전했지만, 서버리스에서 동시에 뜨거운 인스턴스가 2개가
// 되는 순간 키 전체가 60초 잠기므로 4/250으로 낮춘다(60개월 콜드 조회 3.3s → 5.6s).
// 3개 이상 동시에 콜드 조회를 돌리는 상황은 인스턴스 단위로는 막을 수 없다(문서 참고).
export const MOLIT_CONCURRENCY = 4;
export const MOLIT_BASE_PACING_MS = 250;

// 재시도: 최초 1회 + 재시도 3회 = 최대 4회. 재시도 사이 최소 대기는 아래 backoff이고,
// 차단기가 열려 있으면 그보다 더 기다린다. 한 월 요청이 제한 때문에 기다릴 수 있는 총량은
// MOLIT_RETRY_BUDGET_MS로 묶는다 — 60초 잠금을 끝까지 기다리면 화면이 수십 초 멈추므로,
// 예산을 넘기면 기다리지 않고 실패(partial)로 정직하게 돌려준다.
export const MOLIT_MAX_ATTEMPTS = 4;
export const MOLIT_RETRY_BUDGET_MS = 8_000;
export const MOLIT_BACKOFF_STEPS_MS: ReadonlyArray<readonly [number, number]> = [
  [500, 800],
  [1000, 1600],
  [2000, 3200],
];

// 차단기: 제한을 맞으면 이 간격 동안 이 인스턴스에서 MOLIT로 나가는 요청을 멈추고,
// 간격이 지나면 probe 1건만 보내 잠금이 풀렸는지 확인한다(half-open). 잠금 중 1초 간격
// 단일 요청은 잠금을 늘리지 않았으므로(실측) 5초 간격 probe는 그보다 안전한 쪽이다.
export const MOLIT_BREAKER_PROBE_MS = 5_000;
export const MOLIT_BREAKER_WAIT_MESSAGE = '초당 서비스 요청제한 횟수 초과 에러 — 제한 해제 대기 중이라 요청을 보내지 않음';

// 적응형 쿨다운: 제한을 맞으면 잠금이 풀린 뒤에도 한동안 신규 슬롯 간격을 넓힌다.
export const MOLIT_COOLDOWN_WINDOW_MS = 10_000;
export const MOLIT_COOLDOWN_STEP_MS = 200;
export const MOLIT_COOLDOWN_MAX_EXTRA_MS = 800;
export const MOLIT_COOLDOWN_RECOVERY_SUCCESSES = 20;

/** retryIndex(1부터)번째 재시도 전 최소 대기 시간. 구간 안에서 균등 jitter. */
export function molitBackoffDelayMs(retryIndex: number, random: () => number = Math.random): number {
  const step = MOLIT_BACKOFF_STEPS_MS[Math.min(Math.max(retryIndex, 1), MOLIT_BACKOFF_STEPS_MS.length) - 1];
  const [lo, hi] = step;
  const r = Math.min(Math.max(random(), 0), 1);
  return Math.round(lo + (hi - lo) * r);
}

// ── 대기열 lane (FINAL PRE-LAUNCH REGRESSION AUDIT V2) ─────────────────────
//
// 발견: 게이트가 하나의 FIFO였다. 부산 전체 갭투자 통계 콜드 조회는 MOLIT 384건
// (16구 × 12개월 × 매매/전월세)을 한꺼번에 줄 세우고(프로덕션 실측 34s), 같은 인스턴스에서
// 그 뒤에 온 상세페이지의 전월세 60개월 조회는 384건이 다 빠질 때까지 기다렸다 —
// 게이트를 모든 호출이 공유하게 한 V1이 만든 교차 지연이다.
//
// 그래서 대기열을 둘로 나눈다. 동시성 총량(4)과 페이싱은 그대로다 — 순서만 바뀐다.
//  - interactive: 사용자가 지금 보는 화면 하나의 조회(상세/거래목록/학교/분양 등, 기본값)
//  - bulk: 여러 구·월을 한꺼번에 도는 통계 집계(molit-stats-helpers)
// 슬롯이 비면 interactive를 먼저 준다. 단 bulk가 굶지 않도록 둘 다 기다리는 동안에는
// MOLIT_BULK_SLOT_EVERY번째마다 bulk에 준다.
export type MolitLane = 'interactive' | 'bulk';
export const MOLIT_BULK_SLOT_EVERY = 4;

/** 대기열 항목. dedup으로 합류한 interactive 요청이 queued bulk 항목을 끌어올릴 수 있도록 객체로 둔다. */
export interface MolitTicket {
  lane: MolitLane;
  waiter: (() => void) | null;
}

// ── 게이트 상태 (모듈 레벨 = 프로세스 단일) ───────────────────────────────
interface GateState {
  active: number;
  peak: number;
  queues: Record<MolitLane, MolitTicket[]>;
  /** 둘 다 기다릴 때 interactive에 연속으로 준 슬롯 수. */
  interactiveStreak: number;
  cooldownUntil: number;
  extraPacingMs: number;
  successStreak: number;
  /** 이 시각 전까지는 네트워크로 나가지 않는다. */
  breakerUntil: number;
  /** 제한 이후 아직 성공을 못 봤다 — 한 번에 probe 1건만 내보낸다. */
  halfOpen: boolean;
  probeInFlight: boolean;
  /** 차단기 때문에 네트워크 호출 없이 끝난 요청 수(계측용). */
  shortCircuited: number;
  /** 마지막으로 제한 응답을 받은 시각. 이보다 먼저 출발한 시도의 성공은 잠금 해제 증거가 아니다. */
  lastTripAt: number;
  /** 지금 이어지고 있는 잠금 구간이 시작된 시각(첫 제한 응답). */
  episodeStart: number;
}

function initialState(): GateState {
  return {
    active: 0,
    peak: 0,
    queues: { interactive: [], bulk: [] },
    interactiveStreak: 0,
    cooldownUntil: 0,
    extraPacingMs: 0,
    successStreak: 0,
    breakerUntil: 0,
    halfOpen: false,
    probeInFlight: false,
    shortCircuited: 0,
    lastTripAt: Number.NEGATIVE_INFINITY,
    episodeStart: Number.NEGATIVE_INFINITY,
  };
}

let state: GateState = initialState();

function acquire(ticket: MolitTicket): Promise<void> {
  if (state.active < MOLIT_CONCURRENCY) {
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    ticket.waiter = () => {
      ticket.waiter = null;
      state.active++;
      state.peak = Math.max(state.peak, state.active);
      resolve();
    };
    state.queues[ticket.lane].push(ticket);
  });
}

function nextTicket(): MolitTicket | undefined {
  const { interactive, bulk } = state.queues;
  if (interactive.length && bulk.length) {
    if (state.interactiveStreak >= MOLIT_BULK_SLOT_EVERY - 1) {
      state.interactiveStreak = 0;
      return bulk.shift();
    }
    state.interactiveStreak++;
    return interactive.shift();
  }
  state.interactiveStreak = 0;
  return interactive.shift() ?? bulk.shift();
}

function release(): void {
  state.active--;
  const next = nextTicket();
  if (next?.waiter) next.waiter();
}

/**
 * dedup으로 interactive 요청이 이미 줄 서 있는 bulk 요청에 합류하면, 그 항목을 interactive로
 * 올린다(우선순위 역전 방지 — 상세 조회가 같은 월의 통계 대기 뒤에 묶이지 않게).
 */
export function promoteMolitTicket(ticket: MolitTicket): void {
  if (ticket.lane === 'interactive') return;
  ticket.lane = 'interactive';
  const idx = state.queues.bulk.indexOf(ticket);
  if (idx >= 0) {
    state.queues.bulk.splice(idx, 1);
    state.queues.interactive.push(ticket);
  }
}

export function currentMolitPacingMs(now: number = Date.now()): number {
  return MOLIT_BASE_PACING_MS + (now < state.cooldownUntil ? state.extraPacingMs : 0);
}

function noteRateLimited(now: number, probeMs: number): void {
  state.successStreak = 0;
  state.extraPacingMs = Math.min(state.extraPacingMs + MOLIT_COOLDOWN_STEP_MS, MOLIT_COOLDOWN_MAX_EXTRA_MS);
  // 새 잠금 구간인가: 닫혀 있었거나, 마지막 제한 확인이 오래돼(트래픽이 끊겨 probe가
  // 없던 동안) 이어지는 구간이라고 볼 수 없는 경우.
  if (!state.halfOpen || now - state.lastTripAt > probeMs * 2) state.episodeStart = now;
  state.halfOpen = true;
  state.lastTripAt = now;
  state.breakerUntil = Math.max(state.breakerUntil, now + probeMs);
  // 잠금이 풀린 뒤에도 한동안 넓은 페이싱을 유지해 곧바로 다시 걸리지 않게 한다.
  state.cooldownUntil = Math.max(state.cooldownUntil, state.breakerUntil + MOLIT_COOLDOWN_WINDOW_MS);
}

function noteSucceeded(now: number, startedAt: number): void {
  // 제한 이전에 출발해 뒤늦게 돌아온 성공은 "지금 잠금이 풀렸다"는 증거가 아니다 —
  // 그걸로 half-open을 닫으면 대기 중인 요청이 잠긴 키로 한꺼번에 몰려간다.
  if (startedAt >= state.lastTripAt) state.halfOpen = false;
  if (state.extraPacingMs === 0) return;
  if (now >= state.cooldownUntil) {
    state.extraPacingMs = 0;
    state.successStreak = 0;
    return;
  }
  state.successStreak++;
  if (state.successStreak >= MOLIT_COOLDOWN_RECOVERY_SUCCESSES) {
    state.extraPacingMs = Math.max(0, state.extraPacingMs - MOLIT_COOLDOWN_STEP_MS);
    state.successStreak = 0;
  }
}

/** 한 번의 시도 결과. ok=false면 message로 분류한다. */
export type MolitAttemptOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

export interface MolitRequestStats {
  /** 실제 네트워크로 나간 시도 수. */
  attempts: number;
  rateLimitHits: number;
  finalFailureClass: MolitFailureClass | null;
  /** 차단기가 예산 안에 풀리지 않아 호출 없이 끝났다. */
  shortCircuited: boolean;
}

export interface MolitGuardDeps {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  /** 테스트 전용 조정값. 운영 호출부는 넘기지 않는다(기본 상수 사용). */
  breakerProbeMs?: number;
  retryBudgetMs?: number;
  /** 대기열 lane. 기본 interactive. 여러 구·월을 한꺼번에 도는 통계 집계만 bulk. */
  lane?: MolitLane;
  /** dedup이 만든 대기열 항목(우선순위 승격용). 호출부가 직접 넘기지 않는다. */
  ticket?: MolitTicket;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function breakerEngaged(t: number): boolean {
  return t < state.breakerUntil || state.halfOpen || state.probeInFlight;
}

// 차단기가 허락할 때까지 기다린다. deadline을 넘겨야만 허락된다면 기다리지 않고
// 'expired'를 돌려준다(잠금 60초를 끝까지 붙잡고 있지 않기 위해).
// 'probe'는 이 시도가 half-open 상태의 유일한 probe라는 뜻이다.
//
// 예산은 요청마다가 아니라 **잠금 구간** 기준으로도 본다. 상세 라우트는 12개월 청크를
// 순서대로 보내므로 요청마다 8초씩 기다리게 하면 청크 5개가 차례로 8초씩 써서 60개월
// 조회가 35초 걸렸다(실측). 확인된 잠금이 이미 예산보다 오래 이어지고 있으면 새 요청은
// 기다리지 않고 바로 실패한다 — probe 자리(5초마다 1건)는 계속 열어 회복을 감지한다.
async function waitForBreaker(
  deadline: number,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  budgetMs: number,
  probeMs: number
): Promise<'ready' | 'probe' | 'expired'> {
  // 무한 루프 방어: 정상 경로에서는 몇 번 안에 끝난다.
  for (let guard = 0; guard < 10_000; guard++) {
    const t = now();
    if (t >= state.breakerUntil && !state.probeInFlight) {
      if (!state.halfOpen) return 'ready';
      state.probeInFlight = true;
      return 'probe';
    }
    const lockConfirmedRecently = state.halfOpen && t - state.lastTripAt <= probeMs * 2;
    if (lockConfirmedRecently && t - state.episodeStart > budgetMs) return 'expired';
    const wakeAt = t < state.breakerUntil ? state.breakerUntil : t + 100;
    if (wakeAt > deadline) return 'expired';
    await sleep(Math.max(wakeAt - t, 1));
  }
  return 'expired';
}

/**
 * 한 (lawdCd, 월, 유형) 요청을 게이트 + 차단기 + rate-limit 전용 bounded retry로 실행한다.
 *
 * - 시도마다 슬롯을 잡고, 페이싱까지 슬롯을 쥔 채 기다린 뒤 놓는다(전역 동시 요청 수가
 *   실제로 제한되도록 — 기존 fetchMonthGated와 같은 방식).
 * - 재시도 대기(backoff/차단기) 동안에는 슬롯을 **놓는다** — 쉬는 요청이 다른 요청의
 *   자리를 막으면 처리량이 무너진다.
 * - 차단기가 열려 있으면 네트워크로 나가지 않는다. 예산 안에 풀리지 않으면 호출 없이
 *   RATE_LIMIT 실패로 끝낸다(실패를 성공으로 위장하지 않고, 잠긴 키를 두드리지도 않는다).
 * - 성공한 시도는 다시 부르지 않는다. 재시도는 실패한 이 한 단위에만 적용된다.
 */
export async function runMolitGuarded<T>(
  attempt: () => Promise<MolitAttemptOutcome<T>>,
  deps: MolitGuardDeps = {}
): Promise<{ outcome: MolitAttemptOutcome<T>; stats: MolitRequestStats }> {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const now = deps.now ?? Date.now;
  const probeMs = deps.breakerProbeMs ?? MOLIT_BREAKER_PROBE_MS;
  const budgetMs = deps.retryBudgetMs ?? MOLIT_RETRY_BUDGET_MS;
  const stats: MolitRequestStats = { attempts: 0, rateLimitHits: 0, finalFailureClass: null, shortCircuited: false };
  const ticket: MolitTicket = deps.ticket ?? { lane: deps.lane ?? 'interactive', waiter: null };

  // 예산은 "제한 때문에 기다리기 시작한 시점"부터 센다. 정상 대기열(동시성 4) 대기는
  // 예산을 쓰지 않는다 — 부하가 큰 정상 조회를 실패로 만들면 안 된다.
  let deadline = Number.POSITIVE_INFINITY;
  let last: MolitAttemptOutcome<T> | null = null;

  for (let i = 0; i < MOLIT_MAX_ATTEMPTS; i++) {
    if (i > 0) await sleep(molitBackoffDelayMs(i, random));

    if (!Number.isFinite(deadline) && breakerEngaged(now())) deadline = now() + budgetMs;
    const gate = await waitForBreaker(deadline, sleep, now, budgetMs, probeMs);
    if (gate === 'expired') {
      state.shortCircuited++;
      stats.shortCircuited = true;
      stats.finalFailureClass = 'RATE_LIMIT';
      // 이미 받은 제한 응답이 있으면 그 원문을, 없으면 "보내지 않았다"는 사실을 남긴다.
      const outcome: MolitAttemptOutcome<T> =
        last && !last.ok && classifyMolitFailure(last.message) === 'RATE_LIMIT'
          ? last
          : { ok: false, message: MOLIT_BREAKER_WAIT_MESSAGE };
      return { outcome, stats };
    }
    const isProbe = gate === 'probe';

    let current: MolitAttemptOutcome<T>;
    await acquire(ticket);
    try {
      stats.attempts++;
      const startedAt = now();
      try {
        current = await attempt();
      } catch (e) {
        current = { ok: false, message: String((e as Error)?.message ?? e) };
      }
      const t = now();
      if (current.ok) noteSucceeded(t, startedAt);
      else if (classifyMolitFailure(current.message) === 'RATE_LIMIT') noteRateLimited(t, probeMs);
      else if (isProbe) state.halfOpen = false; // 제한이 아닌 응답도 "잠금은 풀렸다"는 증거다.
      await sleep(currentMolitPacingMs(t));
    } finally {
      if (isProbe) state.probeInFlight = false;
      release();
    }
    last = current;

    if (current.ok) return { outcome: current, stats };

    const cls = classifyMolitFailure(current.message);
    stats.finalFailureClass = cls;
    if (cls === 'RATE_LIMIT') {
      stats.rateLimitHits++;
      if (!Number.isFinite(deadline)) deadline = now() + budgetMs;
    }
    if (!isRetryableMolitFailure(cls)) break;
  }
  return { outcome: last ?? { ok: false, message: '알 수 없는 오류' }, stats };
}

/** 테스트/계측 전용 — 게이트 상태 스냅샷. */
export function molitGateSnapshot() {
  return {
    active: state.active,
    queued: state.queues.interactive.length + state.queues.bulk.length,
    queuedInteractive: state.queues.interactive.length,
    queuedBulk: state.queues.bulk.length,
    peak: state.peak,
    extraPacingMs: state.extraPacingMs,
    cooldownUntil: state.cooldownUntil,
    breakerUntil: state.breakerUntil,
    halfOpen: state.halfOpen,
    shortCircuited: state.shortCircuited,
  };
}

/** 테스트 전용 — 모듈 상태 초기화. 운영 코드에서 호출하지 않는다. */
export function __resetMolitGateForTest(): void {
  state = initialState();
}

// ── in-flight dedup ───────────────────────────────────────────────────────
// 같은 프로세스에서 같은 (유형, lawdCd, 월) 요청이 **진행 중**이면 네트워크 호출을 한 번만
// 만든다(예: 같은 지역의 통계와 상세가 동시에 같은 월을 요청). 결과를 저장하지 않으므로
// TTL/신선도 정책은 전혀 바뀌지 않는다 — 완료 즉시 map에서 지운다. 실패도 공유되지만
// 저장되지 않으므로 다음 요청은 새로 시도한다.
//
// 각 대기자는 **자기만의 사본**(배열 + 평평한 item 객체 얕은 복사)을 받는다. 예전에는
// 통계 호출부들이 배열을 독점했으므로, 한 호출부의 in-place 정렬/필드 추가가 다른
// 호출부에 새지 않도록 한다.
//
// 대기열 lane: 먼저 온 요청의 lane으로 줄을 선다. 뒤에 interactive 요청이 합류하면 그 항목을
// interactive로 올린다 — 상세 조회가 같은 월의 통계(bulk) 대기 뒤에 묶이지 않게.
const inFlight = new Map<string, { promise: Promise<unknown>; ticket: MolitTicket }>();

function cloneItems<T>(value: T): T {
  if (!Array.isArray(value)) return value;
  return value.map((o) => (o && typeof o === 'object' ? { ...o } : o)) as unknown as T;
}

export async function dedupMolitInFlight<T>(
  key: string,
  lane: MolitLane,
  run: (ticket: MolitTicket) => Promise<T>
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    if (lane === 'interactive') promoteMolitTicket(existing.ticket);
    return cloneItems((await existing.promise) as T);
  }
  const ticket: MolitTicket = { lane, waiter: null };
  const promise = (async () => {
    try {
      return await run(ticket);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, { promise, ticket });
  return cloneItems(await promise);
}

export function molitInFlightSize(): number {
  return inFlight.size;
}
