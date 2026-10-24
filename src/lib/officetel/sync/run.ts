// OFFICETEL_INCREMENTAL_SYNC_V1 — 한 번의 실행(cron 한 호출 / catch-up 한 번)의 셀 오케스트레이션.
//
// 아파트 sync 프레임워크에서 재사용하는 것(복제하지 않고 import):
//   - TimeBudget · RunStopReason · SyncRunStatus · httpStatusForRun  (sync/shared.ts)
//   - hasRoomForCell · planRequestAttempt                             (sync/run-deadline.ts)
//   - molitQuotaDecision                                              (sync/molit-quota-guard.ts)
//   - orderRecheckCellsByStaleness (least-recently-verified-first)    (sync/shared.ts)
// 아파트 core(sale-sync-core 등)를 직접 호출하지 않는 이유: 그 core는 aptSeq identity·Apartment* 테이블·
// SyncDataset enum에 묶여 있다. 오피스텔은 canonicalKey identity와 별도 테이블을 쓰므로 셀 단위 로직만 따로 둔다.
import { hasRoomForCell } from '../../sync/run-deadline';
import { molitQuotaDecision } from '../../sync/molit-quota-guard';
import { orderRecheckCellsByStaleness, TimeBudget, type RunStopReason, type SyncRunStatus } from '../../sync/shared';
import { OFFICETEL_MIN_INTERVAL_MS, officetelQuotaObserved } from './molit-fetch';
import { syncOfficetelCell, type OfficetelCellDeps, type OfficetelCellReport } from './cell-sync';
import type { OfficetelSyncDataset, OfficetelSyncDb, OfficetelSyncMode } from './types';

/** 정상 셀 한 개 ≈ 0.8–1.5s(요청 간격 420ms + 응답 + DB). 새 셀을 시작할 여유를 판단하는 추정치. */
export const OFFICETEL_CELL_ESTIMATE_MS = 1500;
/** route maxDuration 60s 중 작업 예산. 나머지는 콜드스타트·요약·응답 예비(아파트 sale·rent와 같다). */
export const OFFICETEL_SYNC_BUDGET_MS = 50_000;
export const OFFICETEL_RECHECK_BUDGET_MS = 45_000;

export type OfficetelRunStopReason = RunStopReason;

export interface OfficetelRunOptions {
  dataset: OfficetelSyncDataset;
  mode: OfficetelSyncMode;
  lawdCds: readonly string[];
  /** 대상 계약월(YYYYMM). 호출부(cron/catch-up)가 months.ts로 만든다. */
  months: readonly string[];
  runId: string;
  budgetMs: number;
  /** 같은 키를 쓰는 라이브 조회 몫을 남기는 예약분 가드 사용 여부(기본 true). */
  useQuotaGuard?: boolean;
}

export interface OfficetelRunSummary {
  status: SyncRunStatus;
  mode: OfficetelSyncMode;
  dataset: OfficetelSyncDataset;
  runId: string;
  cells: number;
  cellsProcessed: number;
  cellStatusCounts: Record<string, number>;
  fetched: number;
  inserted: number;
  updated: number;
  unresolved: number;
  invalidRows: number;
  failed: number;
  planned: { inserts: number; cancelUpdates: number };
  cancelRestorePending: number;
  dbOnlyRows: number;
  coverageRecorded: number;
  stopReason: OfficetelRunStopReason | null;
  /** 상태 테이블을 읽지 못해(마이그레이션 전 등) 정렬 없이 진행했는가(dry-run에서만 허용). */
  stateUnavailable: boolean;
  durationMs: number;
  reports: OfficetelCellReport[];
  error?: string;
}

export interface OfficetelRunDeps extends Omit<OfficetelCellDeps, 'masterCache'> {
  now?: () => number;
  log?: (line: string) => void;
  budget?: TimeBudget;
}

export async function runOfficetelSync(opts: OfficetelRunOptions, deps: OfficetelRunDeps): Promise<OfficetelRunSummary> {
  const log = deps.log ?? (() => undefined);
  const budget = deps.budget ?? new TimeBudget(opts.budgetMs, deps.now);
  const summary: OfficetelRunSummary = {
    status: 'SUCCESS', mode: opts.mode, dataset: opts.dataset, runId: opts.runId,
    cells: 0, cellsProcessed: 0, cellStatusCounts: {}, fetched: 0, inserted: 0, updated: 0, unresolved: 0, invalidRows: 0, failed: 0,
    planned: { inserts: 0, cancelUpdates: 0 }, cancelRestorePending: 0, dbOnlyRows: 0, coverageRecorded: 0,
    stopReason: null, stateUnavailable: false, durationMs: 0, reports: [],
  };

  const cellList = opts.lawdCds.flatMap((lawdCd) => opts.months.map((dealYmd) => ({ lawdCd, dealYmd })));
  summary.cells = cellList.length;

  // 가장 오래 검증되지 않은 셀부터(한 번도 없으면 최우선). 상태가 durable하게 저장되므로 커서 없이도 굶지 않는다.
  let ordered = cellList;
  try {
    const states = await deps.db.loadCellStates(opts.dataset, [...opts.months]);
    const at = new Map(states.map((s) => [`${s.lawdCd}:${s.dealYmd}`, s.verifiedAt ? s.verifiedAt.getTime() : undefined]));
    ordered = orderRecheckCellsByStaleness(cellList.map((c) => ({ ...c, lastVerifiedAtMs: at.get(`${c.lawdCd}:${c.dealYmd}`) })));
  } catch (e) {
    summary.stateUnavailable = true;
    // apply는 셀 상태를 기록할 수 없으면 시작하지 않는다 — 진행 상태를 모르는 채 쓰지 않는다.
    if (opts.mode === 'apply') {
      summary.status = 'FAILED';
      summary.error = 'officetel_sync_cells unavailable (migration not applied?)';
      log(`ABORT apply: ${summary.error}`);
      return summary;
    }
    log('NOTE officetel_sync_cells unavailable — dry-run proceeds without staleness ordering');
  }

  const masterCache = new Map();
  const started = (deps.now ?? Date.now)();
  for (const cell of ordered) {
    if (!hasRoomForCell(budget, OFFICETEL_CELL_ESTIMATE_MS, OFFICETEL_MIN_INTERVAL_MS)) {
      summary.stopReason = 'BUDGET_EXHAUSTED';
      break;
    }
    if (opts.useQuotaGuard !== false && !molitQuotaDecision(officetelQuotaObserved, (deps.now ?? Date.now)()).proceed) {
      summary.stopReason = 'QUOTA_RESERVE_REACHED';
      break;
    }
    const res = await syncOfficetelCell(
      { dataset: opts.dataset, lawdCd: cell.lawdCd, dealYmd: cell.dealYmd, mode: opts.mode, runId: opts.runId },
      { ...deps, masterCache }
    );
    if (res.kind === 'STOPPED') {
      summary.stopReason = res.stop;
      break;
    }
    const r = res.report;
    summary.cellsProcessed++;
    summary.reports.push(r);
    summary.cellStatusCounts[r.status] = (summary.cellStatusCounts[r.status] ?? 0) + 1;
    summary.fetched += r.fetched; summary.inserted += r.inserted; summary.updated += r.updated;
    summary.unresolved += r.unresolved; summary.invalidRows += r.invalidRows;
    summary.planned.inserts += r.planned.inserts; summary.planned.cancelUpdates += r.planned.cancelUpdates;
    summary.cancelRestorePending += r.cancelRestorePending; summary.dbOnlyRows += r.dbOnlyRows;
    if (r.recorded) summary.coverageRecorded++;
    if (r.status !== 'COMPLETE') summary.failed++;
    log(
      `CELL ${opts.dataset} ${cell.lawdCd} ${cell.dealYmd} ${r.status}${r.failureReason ? `(${r.failureReason})` : ''} ` +
        `src=${r.sourceTotalCount ?? 'null'} fetched=${r.fetched} +${r.inserted}/plan${r.planned.inserts} upd=${r.updated}/plan${r.planned.cancelUpdates} unresolved=${r.unresolved} invalid=${r.invalidRows}`
    );
    // 이 셀 상태를 durable하게 남기지 못했다면 다음 셀로 가지 않는다(커밋된 데이터는 멱등이라 재실행 안전).
    if (res.persistFailed) {
      summary.stopReason = 'COVERAGE_PERSIST_FAILED';
      summary.error = 'cell state persist failed';
      log(`STOP cell state persist failed (${cell.lawdCd} ${cell.dealYmd})`);
      break;
    }
  }
  summary.durationMs = (deps.now ?? Date.now)() - started;

  summary.status = decideStatus(summary);
  log(`RUN ${summary.status} cells=${summary.cellsProcessed}/${summary.cells} +${summary.inserted} upd=${summary.updated} failed=${summary.failed} stop=${summary.stopReason ?? 'none'}`);
  return summary;
}

function decideStatus(s: OfficetelRunSummary): SyncRunStatus {
  if (s.stopReason === 'COVERAGE_PERSIST_FAILED') return 'FAILED';
  // 처리한 셀이 하나도 없는데 멈췄다면 아무 일도 못 한 것이다.
  if (s.cellsProcessed === 0 && s.stopReason) return s.stopReason === 'BUDGET_EXHAUSTED' ? 'PARTIAL_RUN' : 'FAILED';
  if (s.failed > 0) return 'PARTIAL';
  if (s.stopReason) return 'PARTIAL_RUN';
  return 'SUCCESS';
}
