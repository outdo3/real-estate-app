// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §3/§4/§5 — Cron/CLI가 공유하는 sync core의 공통 타입과
// 유틸.
//
// §4 절대 원칙: "CLI와 Cron이 서로 다른 계산/identity logic을 갖지 않게 한다." 그래서 이
// core는 fetch/정규화/completeness/identity 판정을 **기존에 검증된 순수 모듈에서 그대로
// import**한다(scripts/**의 rent-molit-fetch, rent-history-logic, rent-completeness-logic,
// sale-molit-fetch, trade-history-logic, write-policy-logic). 여기서 새로 쓰는 것은
// 오케스트레이션과 serverless-safe 영속화뿐이다 — 판정 규칙을 복제하지 않는다.
//
// 왜 CLI 스크립트를 직접 import하지 않는가: 그 진입점들은 dotenv + __dirname + process.argv +
// process.exit + fs 로거 + module-level `new PrismaClient()`를 전제로 짜여 있어 Next.js
// Function에서 module load 자체가 실패한다(Phase 2 감사 §B6). 반면 위의 순수 모듈들은 그런
// 부작용이 전혀 없어 그대로 재사용할 수 있음을 확인했다.

export type SyncMode = 'dry-run' | 'apply';

/** §19 HTTP status policy — 무조건 200 금지. 호출부가 이 값으로 상태 코드를 정한다. */
export type SyncRunStatus =
  | 'SUCCESS' // 모든 셀 완전 검증 + 적용 완료
  | 'PARTIAL' // 일부 셀이 PARTIAL/INVALID — 다음 실행에서 재시도
  | 'NEEDS_REVIEW' // 사람이 봐야 하는 사건 발생(예: rent 첫 true mutation)
  | 'PARTIAL_RUN' // 시간 예산 초과로 남은 셀을 처리하지 못함
  | 'FAILED';

export interface CellReport {
  lawdCd: string;
  dealYmd: string;
  status: 'COMPLETE' | 'EMPTY_VALID' | 'PARTIAL' | 'INVALID';
  sourceTotalCount: number | null;
  fetched: number;
  blocked: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** 이 셀에서 발견된, 자동 적용이 금지된 변경 후보 수(rent first-mutation guard). */
  reviewCandidates: number;
}

export interface SyncSummary {
  status: SyncRunStatus;
  mode: SyncMode;
  runId: string;
  from: string;
  to: string;
  cells: number;
  cellsProcessed: number;
  fetched: number;
  inserted: number;
  updated: number;
  blocked: number;
  failed: number;
  coverageRecorded: number;
  durationMs: number;
  needsReview: ReviewItem[];
  reports: CellReport[];
}

/** §13 — 자동 적용하지 않고 사람에게 보고하는 변경 후보. 개인정보는 담지 않는다
 * (identity는 aptSeq/자연키 수준, 값은 필드명과 전후 값만). */
export interface ReviewItem {
  lawdCd: string;
  dealYmd: string;
  identity: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/**
 * §21 TIMEOUT — Vercel Function의 maxDuration에 맞춰 시간 예산을 강제한다. 무리하게 timeout을
 * 늘리는 대신, 예산을 넘기 전에 **깨끗하게 멈추고** 남은 셀을 다음 실행으로 넘긴다.
 * 셀 단위 경계에서만 멈추므로 부분 기록으로 인한 불일치가 생기지 않는다.
 */
export class TimeBudget {
  // NOTE: TS "parameter property"(constructor(private x))를 쓰지 않는다 — node의
  // --experimental-strip-types(strip-only)가 지원하지 않아 테스트가 실행되지 않는다.
  private readonly startedAt: number;
  private readonly budgetMs: number;
  constructor(budgetMs: number) {
    this.budgetMs = budgetMs;
    this.startedAt = Date.now();
  }
  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }
  /** 다음 셀을 시작해도 되는가. 한 셀의 통상 소요시간을 여유로 남겨둔다. */
  hasRoomFor(estimatedCellMs: number): boolean {
    return this.elapsedMs() + estimatedCellMs < this.budgetMs;
  }
}

export function monthsInRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  for (let i = 0; i < 240 && cur <= to; i++) {
    out.push(cur);
    const y = Number(cur.slice(0, 4));
    const m = Number(cur.slice(4, 6));
    cur = m === 12 ? `${y + 1}01` : `${y}${String(m + 1).padStart(2, '0')}`;
  }
  return out;
}

export function newRunId(prefix: string): string {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

/** §12 — rent overlap은 최근 2개월. §10 — sale overlap은 최근 3개월(취소 반영 지연 p90). */
export const RENT_DEFAULT_OVERLAP_MONTHS = 2;
export const SALE_DEFAULT_OVERLAP_MONTHS = 3;

export function currentCalendarMonth(now: Date): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * §15 — RENT는 **완료된 달만** 대상이다. 진행 중인 현재월은 어떤 경로로도 포함되지 않는다
 * (명시 범위를 줘도 latestCompleteMonth로 clamp한다 — 단일 실패 지점에 의존하지 않는다).
 */
export function resolveRentRange(
  latestComplete: string,
  subtract: (ym: string, n: number) => string,
  opts: { from?: string; to?: string; overlapMonths?: number }
): { from: string; to: string } {
  if (opts.from && opts.to) {
    return { from: opts.from, to: opts.to > latestComplete ? latestComplete : opts.to };
  }
  const overlap = opts.overlapMonths ?? RENT_DEFAULT_OVERLAP_MONTHS;
  return { from: subtract(latestComplete, overlap - 1), to: latestComplete };
}

/**
 * SALE은 rent와 달리 **진행 중인 현재월도 동기화한다** — 매매 최신성이 제품의 핵심이라
 * 현재월 거래를 늦게 반영할 이유가 없다. 다만 §15에 따라 현재월은 절대 "검증 완료"로
 * 기록되지 않는다(coverage 기록에서 제외) — 동기화하는 것과 완료로 선언하는 것은 다르다.
 */
export function resolveSaleRange(
  latestComplete: string,
  nowMonth: string,
  subtract: (ym: string, n: number) => string,
  opts: { from?: string; to?: string; overlapMonths?: number }
): { from: string; to: string } {
  if (opts.from && opts.to) return { from: opts.from, to: opts.to };
  const overlap = opts.overlapMonths ?? SALE_DEFAULT_OVERLAP_MONTHS;
  return { from: subtract(latestComplete, overlap - 1), to: nowMonth };
}

/** §19 — run status를 HTTP 상태 코드로 옮긴다. 성공이 아닌 것을 200으로 감추지 않는다. */
export function httpStatusForRun(status: SyncRunStatus): number {
  if (status === 'SUCCESS') return 200;
  if (status === 'FAILED') return 500;
  // PARTIAL / NEEDS_REVIEW / PARTIAL_RUN — Cron이 성공으로 오인하면 안 된다.
  return 207;
}
