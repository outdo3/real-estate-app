// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §4/§12/§13/§14 — RENT completed-month sync의
// serverless-safe core. Cron route와 (향후) CLI가 이 하나의 구현을 공유한다.
//
// 판정 로직은 전부 기존 검증된 순수 모듈에서 그대로 가져온다(§4) — 이 파일이 새로 정의하는
// 규칙은 없다:
//   - fetch + pagination + completeness : rent-molit-fetch.ts (classifyRentCellCompleteness)
//   - 정규화/identity/occurrenceIndex   : rent-history-logic.ts
//   - 쓰기 허용 여부                     : rent-completeness-logic.ts (shouldPersistCellRows)
//   - 완료월/overlap 계산                : incremental-sync-completed-month-logic.ts
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { MIN_INTERVAL_MS, fetchRentRegionMonth } from '../../../scripts/rent-trade-history/rent-molit-fetch';
import { normalizeMolitRentItemsToRentRows, type RentRowInput } from '../../../scripts/rent-trade-history/rent-history-logic';
import { shouldPersistCellRows } from '../../../scripts/rent-trade-history/rent-completeness-logic';
// RENT_OCCURRENCE_SAFETY_V1 §3 — Option E group insert guard. 판정은 순수 모듈에 있고
// 여기서는 그 계획을 실행만 한다(§4 "판정 규칙을 복제하지 않는다").
import {
  RENT_COMPARE_FIELDS,
  planRentCellWrites,
  type RentCompareField,
} from '../../../scripts/rent-trade-history/rent-group-guard-logic';
import { latestCompleteMonth, subtractMonths } from '../../../scripts/rent-trade-history/incremental-sync-completed-month-logic';
import { recordCoverageCells } from '../sync-coverage';
import { BUSAN_LAWDCD_16, isVerifiedCellStatus } from '../rent-verified-range';
import {
  TimeBudget,
  coverageRecordOf,
  monthsInRange,
  newRunId,
  persistCellCoverage,
  resolveRentRange as resolveRentRangePure,
  type CellReport,
  type RecordCoverageFn,
  type ReviewItem,
  type RunStopReason,
  type SyncMode,
  type SyncRunStatus,
  type SyncSummary,
} from './shared';
import { hasRoomForCell, type RequestDeadline } from './run-deadline';

export { RENT_DEFAULT_OVERLAP_MONTHS } from './shared';

// 실측(dry-run 32 cells / 13.8s, scripts/rent-trade-history/_incremental_sync_results)
// 기준 셀당 약 430ms. 여유를 둬 한 셀 예산을 넉넉히 잡는다.
const ESTIMATED_CELL_MS = 1500;

// 자연키 밖 필드만 비교한다 — 기존 CLI의 COMPARE_FIELDS와 동일해야 한다(§4).
// RENT_OCCURRENCE_SAFETY_V1 — 정의가 두 곳으로 갈라지지 않도록 rent-group-guard-logic.ts를
// 단일 출처로 삼는다. 값/순서는 이전과 완전히 동일하다(이름만 재수출).
const COMPARE_FIELDS = RENT_COMPARE_FIELDS;

/** DB에서 읽어온 기존 row를 자연키 성분까지 포함해 비교 가능한 형태로 정규화한 것. */
interface ExistingRentRow {
  groupKeyStr: string;
  deposit: number;
  monthlyRent: number;
  /** "YYYY-MM-DD" — Prisma Date를 정규화해서 담는다. */
  dealDate: string;
  floor: number | null;
  occurrenceIndex: number;
  aptName: string;
  dong: string;
  jibun: string | null;
  buildYear: number | null;
  contractType: string | null;
  contractTerm: string | null;
  preDeposit: number | null;
  preMonthlyRent: number | null;
  useRenewalRight: boolean | null;
}

type CompareField = RentCompareField;

/** 비교 대상 필드 하나를 읽는다. DB row(ExistingRentRow)와 정규화된 feed row(RentRowInput)는
 * 서로 다른 타입이지만 이 9개 필드의 이름/의미는 같다 — 그 교집합만 안전하게 꺼낸다. */
function compareFieldValue(row: ExistingRentRow | RentRowInput, field: CompareField): unknown {
  return (row as unknown as Record<CompareField, unknown>)[field];
}

export interface RentSyncOptions {
  mode: SyncMode;
  lawdCds?: string[];
  overlapMonths?: number;
  /** 명시하면 latestCompleteMonth 대신 이 범위를 쓴다(테스트/수동 재시도용). */
  from?: string;
  to?: string;
  budgetMs?: number;
  now?: Date;
}

/** §15 — 현재(진행 중) 달은 절대 대상이 아니다. 판정 자체는 shared.ts의 순수 함수에 있다. */
export function resolveRentRange(opts: RentSyncOptions): { from: string; to: string } {
  const latest = latestCompleteMonth(opts.now ?? new Date());
  return resolveRentRangePure(latest, subtractMonths, opts);
}

/** 셀 하나를 처리할 때 코어가 넘기는 실행 문맥. */
export interface RentCellOptions {
  /** CRON_DURABLE_PROGRESS_V1 — 실행의 남은 시간. MOLIT 시도·재시도·backoff가 이 한도를 넘지 않는다. */
  deadline?: RequestDeadline;
}

/** CRON_DURABLE_PROGRESS_V1 — 결정적 테스트용 주입점. 운영 호출(route)은 넘기지 않는다. */
export interface RentSyncDeps {
  syncCell?: (
    lawdCd: string,
    dealYmd: string,
    mode: SyncMode,
    needsReview: ReviewItem[],
    log: (line: string) => void,
    cellOpts: RentCellOptions
  ) => Promise<CellReport>;
  recordCoverage?: RecordCoverageFn;
  clock?: () => number;
}

export async function runRentSync(opts: RentSyncOptions, log: (line: string) => void, deps: RentSyncDeps = {}): Promise<SyncSummary> {
  const syncCell = deps.syncCell ?? syncOneRentCell;
  const record = deps.recordCoverage ?? recordCoverageCells;
  const budget = new TimeBudget(opts.budgetMs ?? 50_000, deps.clock);
  const runId = newRunId('rent');
  const lawdCds = opts.lawdCds ?? BUSAN_LAWDCD_16;
  const { from, to } = resolveRentRange(opts);
  const months = monthsInRange(from, to);
  const reports: CellReport[] = [];
  const needsReview: ReviewItem[] = [];
  const totalCells = lawdCds.length * months.length;

  log(`START rent mode=${opts.mode} runId=${runId} range=[${from},${to}] districts=${lawdCds.length} cells=${totalCells}`);

  let stopReason: RunStopReason | null = null;
  let recorded = 0;
  districts: for (const lawdCd of lawdCds) {
    for (const dealYmd of months) {
      if (!hasRoomForCell(budget, ESTIMATED_CELL_MS, MIN_INTERVAL_MS)) {
        stopReason = 'BUDGET_EXHAUSTED';
        log(`BUDGET_STOP elapsed=${budget.elapsedMs()}ms — 남은 셀은 다음 실행에서 처리한다`);
        break districts;
      }
      const report = await syncCell(lawdCd, dealYmd, opts.mode, needsReview, log, { deadline: budget });
      if (report.deadlineReached) {
        // CRON_DURABLE_PROGRESS_V1 — 시간 한도로 셀 도중 멈춤. 쓰지 않았고 기록하지 않는다(원천 INVALID가 아니다).
        stopReason = 'DEADLINE_REACHED';
        log(`DEADLINE_REACHED during ${lawdCd}:${dealYmd} elapsed=${budget.elapsedMs()}ms — 이 셀과 남은 셀은 다음 실행에서 처리한다`);
        break districts;
      }
      reports.push(report);
      // §14 — 사람이 검토해야 할 변경 후보가 있는 셀은 **아예 기록하지 않는다**: 기록이 없으면 coverage가
      // 전진하지 않고(부재 = 미검증) 다음 실행에서 자연스럽게 재시도된다. PARTIAL로 위장해 기록하는 것보다 정직하다.
      // CRON_DURABLE_PROGRESS_V1 — 그 셀의 쓰기가 커밋된 **직후** 그 셀 하나만 기록한다. 검증된 상태(COMPLETE/EMPTY_VALID)만
      // 기록한다 — INVALID/PARTIAL이 이전 검증 기록을 덮지 않는다(부재·미검증은 검증범위 계산에서 같은 뜻이다).
      if (report.reviewCandidates === 0 && isVerifiedCellStatus(report.status)) {
        const persisted = await persistCellCoverage(record, opts.mode, 'RENT', runId, coverageRecordOf(report));
        if (!persisted.ok) {
          stopReason = 'COVERAGE_PERSIST_FAILED';
          log(`COVERAGE_PERSIST_FAILED ${lawdCd}:${dealYmd} error=${persisted.error} — 진행 상태를 모르는 채 계속하지 않는다(커밋된 행은 그대로, 재실행 멱등)`);
          break districts;
        }
        recorded += persisted.recorded;
      }
    }
  }

  const totals = reports.reduce(
    (a, r) => ({
      fetched: a.fetched + r.fetched,
      inserted: a.inserted + r.inserted,
      updated: a.updated + r.updated,
      blocked: a.blocked + r.blocked,
      failed: a.failed + (r.status === 'INVALID' || r.status === 'PARTIAL' ? 1 : 0),
      // RENT_OCCURRENCE_SAFETY_V1 §5 — group guard가 보류한 INSERT 수. `blocked`
      // (aptSeq 없어 정규화에서 걸러진 행)와 **절대 합치지 않는다** — 서로 다른 사건이다.
      guardedInsertsSkipped: a.guardedInsertsSkipped + (r.guardedInsertsSkipped ?? 0),
    }),
    { fetched: 0, inserted: 0, updated: 0, blocked: 0, failed: 0, guardedInsertsSkipped: 0 }
  );

  let status: SyncRunStatus = 'SUCCESS';
  if (stopReason === 'COVERAGE_PERSIST_FAILED') status = 'FAILED';
  else if (needsReview.length > 0) status = 'NEEDS_REVIEW';
  else if (stopReason) status = 'PARTIAL_RUN';
  else if (totals.failed > 0) status = 'PARTIAL';

  const summary: SyncSummary = {
    status,
    mode: opts.mode,
    runId,
    from,
    to,
    cells: totalCells,
    cellsProcessed: reports.length,
    ...totals,
    // TRADE_REGISTRY_DATA_V1.1 — RENT은 등기/취소 개념이 원천에 아예 없다(PHASE A §7).
    // registry self-heal은 RENT에 **적용되지 않으며**, 이 0은 "해당 없음"이지 "0건 보충"이
    // 아니다. SyncSummary를 sale과 공유하기 때문에 형태상 필요한 값일 뿐이다.
    registryUpdated: 0,
    registryAmbiguousSkipped: 0,
    coverageRecorded: recorded,
    durationMs: budget.elapsedMs(),
    needsReview,
    reports,
    stopReason,
    deadlineReached: stopReason === 'DEADLINE_REACHED',
  };
  log(
    `DONE rent status=${status} processed=${reports.length}/${totalCells} inserted=${totals.inserted} updated=${totals.updated} ` +
      `blocked=${totals.blocked} guardedInsertsSkipped=${totals.guardedInsertsSkipped} failed=${totals.failed} ` +
      `coverageRecorded=${recorded} durationMs=${summary.durationMs} stopReason=${stopReason ?? 'none'}`
  );
  return summary;
}

export async function syncOneRentCell(
  lawdCd: string,
  dealYmd: string,
  mode: SyncMode,
  needsReview: ReviewItem[],
  log: (line: string) => void,
  cellOpts: RentCellOptions = {}
): Promise<CellReport> {
  const fetchResult = await fetchRentRegionMonth(lawdCd, dealYmd, { deadline: cellOpts.deadline });
  const base: CellReport = {
    lawdCd,
    dealYmd,
    status: fetchResult.status,
    sourceTotalCount: fetchResult.totalCount,
    fetched: fetchResult.collectedCount,
    blocked: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    reviewCandidates: 0,
    // RENT에는 등기일자 필드가 존재하지 않는다 — 항상 0(해당 없음).
    registryUpdated: 0,
    registryAmbiguousSkipped: 0,
    // RENT_OCCURRENCE_SAFETY_V1 §5 — group guard가 보류한 INSERT 수.
    guardedInsertsSkipped: 0,
  };

  // CRON_DURABLE_PROGRESS_V1 — 시간 한도로 끝까지 읽지 못한 셀은 원천 판정(INVALID/PARTIAL)으로 보고하지 않는다. 쓰지 않는다.
  if (fetchResult.deadlineReached) {
    log(`DEADLINE_REACHED ${lawdCd}:${dealYmd} fetched=${fetchResult.collectedCount}/${fetchResult.totalCount ?? '?'} — 시간 한도, 쓰기 건너뜀, 다음 실행 재시도`);
    return { ...base, deadlineReached: true };
  }

  if (fetchResult.status === 'INVALID') {
    log(`INVALID ${lawdCd}:${dealYmd} — fetch 실패(재시도 소진). EMPTY_VALID로 기록하지 않는다`);
    return base;
  }

  const { rows, invalid } = normalizeMolitRentItemsToRentRows(fetchResult.items, lawdCd, dealYmd);
  base.blocked = invalid.filter((iv) => iv.reason === 'MISSING_APTSEQ').length;

  // §11/§12 — COMPLETE cell만 쓴다. PARTIAL을 쓰면 잘린 feed가 occurrenceIndex를 재번호해
  // 복구 불가능한 중복 자연키를 만든다(rent-completeness-logic.ts 주석 참고).
  if (!shouldPersistCellRows(fetchResult.status) || rows.length === 0) {
    if (fetchResult.status === 'PARTIAL') {
      log(`PARTIAL ${lawdCd}:${dealYmd} fetched=${fetchResult.collectedCount}/${fetchResult.totalCount ?? '?'} — 쓰기 건너뜀, 다음 실행 재시도`);
    }
    return base;
  }

  const existing = await prisma.apartmentRentHistory.findMany({
    where: { lawdCd, dealYmd },
    select: {
      groupKeyStr: true, deposit: true, monthlyRent: true, dealDate: true, floor: true, occurrenceIndex: true,
      aptName: true, dong: true, jibun: true, buildYear: true, contractType: true, contractTerm: true,
      preDeposit: true, preMonthlyRent: true, useRenewalRight: true,
    },
  });
  const existingRows: ExistingRentRow[] = existing.map((e) => ({ ...e, dealDate: e.dealDate.toISOString().slice(0, 10) }));

  // §13 RENT FIRST MUTATION GUARD — 기존 row의 내용이 달라졌다면 자동으로 덮어쓰지 **않는다**.
  // 첫 사례는 반드시 사람이 보고 정책을 정해야 한다 — 필드명과 전후 값만 보고한다(개인정보 없음).
  //
  // RENT_OCCURRENCE_SAFETY_V1 §3/§5 — 여기에 Option E가 더해졌다: review candidate가 있는
  // 자연 그룹은 **그 그룹의 INSERT까지** 함께 보류한다. 예전에는 UPDATE만 막고 INSERT를
  // 그대로 진행해, 늦게 추가된 형제가 슬롯을 밀어낸 그룹에서 기존 행 내용의 복제본이
  // 생기고 신규 행의 진짜 내용은 저장되지 않는 오염이 발생했다(2026-09-05 실측 2건).
  const plan = planRentCellWrites(rows, existingRows);
  const toInsert: RentRowInput[] = plan.inserts;
  base.unchanged = plan.unchanged;
  base.reviewCandidates = plan.reviewCandidateFieldCount;
  base.guardedInsertsSkipped = plan.skippedInserts.length;

  for (const diff of plan.reviewDiffs) {
    for (const f of diff.fields) {
      needsReview.push({
        lawdCd,
        dealYmd,
        identity: `aptSeq=${diff.row.aptSeq} area=${diff.row.exclusiveArea} deposit=${diff.row.deposit} monthlyRent=${diff.row.monthlyRent} dealDate=${diff.row.dealDate} floor=${diff.row.floor} occ=${diff.row.occurrenceIndex}`,
        field: f,
        oldValue: compareFieldValue(diff.match, f) == null ? null : String(compareFieldValue(diff.match, f)),
        newValue: compareFieldValue(diff.row, f) == null ? null : String(compareFieldValue(diff.row, f)),
      });
    }
  }
  if (plan.guardedGroups.length > 0) {
    log(
      `GROUP_GUARD ${lawdCd}:${dealYmd} guardedGroups=${plan.guardedGroups.length} insertsSkipped=${plan.skippedInserts.length} — ` +
        `review candidate가 있는 자연 그룹의 INSERT를 보류했다(사람 확인 전까지 이 셀은 coverage가 전진하지 않는다)`
    );
    for (const g of plan.guardedGroups) log(`GROUP_GUARD_DETAIL ${lawdCd}:${dealYmd} group=${g}`);
  }

  if (mode === 'apply' && toInsert.length > 0) {
    // §12 — 신규 row INSERT만 허용된다. createMany + skipDuplicates는 구조적으로 기존 row를
    // 덮어쓸 수 없어(§13 mutation guard와 이중으로 맞물린다) 동시 실행에도 안전하다(§22 —
    // 자연키 unique constraint가 최종 안전망).
    const result = await prisma.apartmentRentHistory.createMany({
      data: toInsert.map((row) => ({
        source: 'MOLIT_APT_RENT',
        lawdCd: row.lawdCd,
        dealYmd: row.dealYmd,
        aptSeq: row.aptSeq,
        identityKey: row.identityKey,
        dealType: row.dealType,
        groupKeyStr: row.groupKeyStr,
        aptName: row.aptName,
        dong: row.dong,
        jibun: row.jibun,
        exclusiveArea: new Prisma.Decimal(row.exclusiveArea),
        deposit: row.deposit,
        monthlyRent: row.monthlyRent,
        dealYear: row.dealYear,
        dealMonth: row.dealMonth,
        dealDay: row.dealDay,
        dealDate: new Date(`${row.dealDate}T00:00:00.000Z`),
        floor: row.floor,
        buildYear: row.buildYear,
        contractType: row.contractType,
        contractTerm: row.contractTerm,
        preDeposit: row.preDeposit,
        preMonthlyRent: row.preMonthlyRent,
        useRenewalRight: row.useRenewalRight,
        occurrenceIndex: row.occurrenceIndex,
        sourceFetchedAt: new Date(),
      })),
      skipDuplicates: true,
    });
    base.inserted = result.count;
  } else {
    base.inserted = mode === 'apply' ? 0 : toInsert.length; // dry-run은 예상치
  }

  log(
    `${fetchResult.status} ${lawdCd}:${dealYmd} fetched=${base.fetched} blocked=${base.blocked} inserted=${base.inserted} ` +
      `unchanged=${base.unchanged} review=${base.reviewCandidates} guardedInsertsSkipped=${base.guardedInsertsSkipped}`
  );
  return base;
}
