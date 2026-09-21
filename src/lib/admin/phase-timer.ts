// ADMIN_OPS_LATENCY_INSTRUMENTATION_V1 — 성공 경로의 구간별 소요 시간 계측.
//
// 왜 만들었나: `/api/admin/ops`의 cache rebuild가 5.4~6.1초인데 **어디가 먹는지 몰랐다.**
// 직전 STEP에서 취소 count를 인덱스로 2,286ms → 8.4ms로 없앴는데도 재조합 시간은
// 그대로였다(OPS_CANCEL_INDEX_APPLY_V1 §10~11). 짐작으로 후보를 재봤지만
// DB 블록 639ms · region 프록시 0.11~0.18s로 둘 다 5초를 설명하지 못했다.
// **추측으로 다음 최적화를 하지 않기 위해** 계측을 먼저 붙인다.
//
// 설계 제약
//  - **DB에 쓰지 않는다.** error_logs는 오류용이고 성능 로그를 담을 자리가 아니다(§3).
//    느린 요청일 때만 서버 로그(console)로 남긴다. 새 스키마/테이블 없음.
//  - **로그 폭주 금지.** 임계치 미만은 아무것도 남기지 않는다.
//  - **민감정보 금지.** 남기는 것은 구간 이름·밀리초·요청 상관 id(난수)뿐이다.
//  - 순수 모듈 — 시계를 주입받아 테스트한다.

/** 한 구간의 측정 결과. */
export interface PhaseTiming {
  phase: string;
  ms: number;
}

/** 1500ms 이상 걸린 요청만 기록한다 — 정상 요청으로 로그를 채우지 않는다(§3). */
export const SLOW_REQUEST_THRESHOLD_MS = 1500;

/**
 * 구간별 시간을 재는 타이머.
 *
 * 같은 이름으로 여러 번 track하면 **합산**된다(예: 반복 호출되는 지표).
 * 중첩 호출은 상위 구간에도 포함되므로, 보고할 때 합계가 total을 넘을 수 있다 —
 * 그래서 아래 `unaccountedMs`는 **최상위 구간만** 기준으로 계산한다.
 */
export class PhaseTimer {
  private readonly startedAt: number;
  private readonly totals = new Map<string, number>();
  private readonly order: string[] = [];
  private depth = 0;
  /** 최상위(depth 0)에서 측정된 구간만 — 합계가 total과 비교 가능한 집합이다. */
  private readonly topLevel = new Map<string, number>();

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.startedAt = clock();
  }

  private add(phase: string, ms: number, wasTopLevel: boolean): void {
    if (!this.totals.has(phase)) this.order.push(phase);
    this.totals.set(phase, (this.totals.get(phase) ?? 0) + ms);
    if (wasTopLevel) this.topLevel.set(phase, (this.topLevel.get(phase) ?? 0) + ms);
  }

  /** async 구간. 예외가 나도 시간은 기록하고 그대로 다시 던진다. */
  async track<T>(phase: string, run: () => Promise<T>): Promise<T> {
    const wasTopLevel = this.depth === 0;
    this.depth++;
    const t = this.clock();
    try {
      return await run();
    } finally {
      this.depth--;
      this.add(phase, this.clock() - t, wasTopLevel);
    }
  }

  /** 동기 구간(파일 읽기·직렬화 등). */
  trackSync<T>(phase: string, run: () => T): T {
    const wasTopLevel = this.depth === 0;
    this.depth++;
    const t = this.clock();
    try {
      return run();
    } finally {
      this.depth--;
      this.add(phase, this.clock() - t, wasTopLevel);
    }
  }

  /** 타이머 생성 이후 지금까지. */
  get totalMs(): number {
    return round(this.clock() - this.startedAt);
  }

  /** 측정 순서대로. */
  phases(): PhaseTiming[] {
    return this.order.map((phase) => ({ phase, ms: round(this.totals.get(phase) ?? 0) }));
  }

  /**
   * 어느 구간에도 잡히지 않은 시간 — **계측이 놓친 곳**을 드러낸다.
   * 중첩 구간을 이중으로 빼지 않도록 최상위 구간만 더한다.
   */
  unaccountedMs(): number {
    let top = 0;
    for (const ms of this.topLevel.values()) top += ms;
    return round(this.clock() - this.startedAt - top);
  }
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** `phase=ms` 나열. 로그 한 줄에 싣는 형식이다. */
export function formatPhases(phases: readonly PhaseTiming[]): string {
  return phases.map((p) => `${p.phase}=${p.ms}`).join(' ');
}

/**
 * 느린 요청만 한 줄로 요약한다. 임계치 미만이면 **null**(= 아무것도 남기지 않는다).
 *
 * 개인정보·쿼리 내용·연결 문자열은 싣지 않는다. 남는 것은 구간 이름과 ms뿐이다.
 */
export function buildSlowSummary(input: {
  endpoint: string;
  requestId: string;
  totalMs: number;
  phases: readonly PhaseTiming[];
  unaccountedMs: number;
  thresholdMs?: number;
  extra?: Record<string, string | number | boolean | null>;
}): string | null {
  const threshold = input.thresholdMs ?? SLOW_REQUEST_THRESHOLD_MS;
  if (input.totalMs < threshold) return null;
  const extra = input.extra
    ? ' ' +
      Object.entries(input.extra)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
    : '';
  return `[ADMIN_OPS_SLOW] ${input.endpoint} rid=${input.requestId} total=${Math.round(input.totalMs)} unaccounted=${Math.round(input.unaccountedMs)}${extra} | ${formatPhases(input.phases)}`;
}

/**
 * 요청 상관 id. **개인정보가 아니다** — 난수 8자이며 사용자/세션과 연결되지 않는다.
 * 같은 요청의 여러 로그 줄을 잇는 용도뿐이다.
 */
export function newRequestId(): string {
  try {
    return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}
