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
  /** TRADE_REGISTRY_DATA_V1.1 §5 — registryDate만 보충한 row 수.
   * `updated`(취소 flip)와 **절대 합치지 않는다** — 서로 다른 사건이다. */
  registryUpdated: number;
  /** 형제 occurrence의 registryDate가 엇갈려 보충을 건너뛴 row 수(§4). */
  registryAmbiguousSkipped: number;
  /** RENT_OCCURRENCE_SAFETY_V1 §5 — Option E group guard가 보류한 INSERT 수(RENT 전용).
   * `blocked`(aptSeq 없어 정규화 단계에서 걸러진 행)와 **절대 합치지 않는다** — 서로 다른
   * 사건이다. SALE 경로에는 이 가드가 없어 항상 undefined다(0건이 아니라 "해당 없음"). */
  guardedInsertsSkipped?: number;
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
  /** TRADE_REGISTRY_DATA_V1.1 §5 — 취소 flip(`updated`)과 분리된 별도 metric. */
  registryUpdated: number;
  registryAmbiguousSkipped: number;
  /** RENT_OCCURRENCE_SAFETY_V1 §5 — group guard가 보류한 INSERT 총합(RENT 전용, CellReport 참고). */
  guardedInsertsSkipped?: number;
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

/**
 * SALE_CANCELLATION_COVERAGE_V1 §3 — daily overlap(3개월)이 구조적으로 놓치는 구간.
 *
 * RECORD_HIGH_TRUST_V1 §6 실측(검증된 C구간 취소 4,727건, `cancelDate - dealDate`):
 *   p50 0.7 / p75 1.8 / p90 3.1 / p95 4.4 / **p99 11.8** / max 20.6 개월.
 * 즉 3개월 overlap은 p90까지만 덮고 **10.5%가 3개월 이후**에 취소된다. 그 10.5%는 어떤
 * 정기 작업으로도 다시 확인되지 않아 부산 기준 연 ~250건씩 "취소됐지만 DB에는 유효"로
 * 누적된다. p99를 덮으려면 12개월이 필요하다.
 *
 * band는 daily overlap **바로 바깥**에서 시작한다(3개월 전 ~ 12개월 전). 중복 fetch를
 * 만들지 않으면서 12개월 전체를 두 경로가 나눠 덮는다:
 *   fresh(daily)  : latestComplete-2 ~ 현재월
 *   recheck(sweep): latestComplete-12 ~ latestComplete-3
 */
export const SALE_RECHECK_MIN_MONTHS_BACK = 3;
export const SALE_RECHECK_MAX_MONTHS_BACK = 12;

/**
 * recheck band를 계산한다. 전부 `latestComplete` 이하이므로 **완료된 달만** 대상이며,
 * 진행 중인 현재월은 어떤 경로로도 이 band에 들어올 수 없다.
 */
export function resolveSaleRecheckBand(
  latestComplete: string,
  subtract: (ym: string, n: number) => string,
  opts: { minMonthsBack?: number; maxMonthsBack?: number } = {}
): { from: string; to: string } {
  const min = opts.minMonthsBack ?? SALE_RECHECK_MIN_MONTHS_BACK;
  const max = opts.maxMonthsBack ?? SALE_RECHECK_MAX_MONTHS_BACK;
  // min > max로 호출되면 빈 band가 되도록 그대로 둔다(monthsInRange가 빈 배열을 준다).
  return { from: subtract(latestComplete, max), to: subtract(latestComplete, min) };
}

export interface RecheckCell {
  lawdCd: string;
  dealYmd: string;
  /** 이 셀이 마지막으로 원천 대조된 시각(epoch ms). 기록이 없으면 undefined. */
  lastVerifiedAtMs?: number;
}

/**
 * SALE_CANCELLATION_COVERAGE_V1 §5 — **least-recently-verified-first** 정렬.
 *
 * 왜 day-of-year rotation이 아닌가: rotation은 셀 수/구 수가 바뀌거나 실행이 하루 걸러
 * 실패하면 특정 셀이 조용히 굶는다(starvation). 반면 `sync_coverage_cells.verifiedAt`은
 * 이미 durable하게 저장되고 있으므로, "가장 오래 확인 안 된 셀부터"를 그대로 쓰면
 * 상태 저장 없이 균등 커버리지가 **자기 교정적으로** 보장된다. 실행이 며칠 밀려도
 * 밀린 셀이 자동으로 맨 앞에 온다.
 *
 * 한 번도 검증된 적 없는 셀이 항상 최우선이다. 동률은 결정적으로 깬다(최신 달 우선 —
 * 취소가 아직 더 들어올 여지가 큰 쪽, 그 다음 lawdCd 오름차순).
 */
export function orderRecheckCellsByStaleness(cells: RecheckCell[]): RecheckCell[] {
  return [...cells].sort((a, b) => {
    const av = a.lastVerifiedAtMs;
    const bv = b.lastVerifiedAtMs;
    if (av == null && bv != null) return -1;
    if (av != null && bv == null) return 1;
    if (av != null && bv != null && av !== bv) return av - bv;
    if (a.dealYmd !== b.dealYmd) return a.dealYmd > b.dealYmd ? -1 : 1;
    return a.lawdCd < b.lawdCd ? -1 : a.lawdCd > b.lawdCd ? 1 : 0;
  });
}

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
