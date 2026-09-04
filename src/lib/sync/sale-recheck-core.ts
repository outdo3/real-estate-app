// SALE_CANCELLATION_COVERAGE_V1 §4/§5/§6 — SALE **late cancellation** recheck sweep.
//
// 문제(RECORD_HIGH_TRUST_V1 §6 실측): daily sale cron의 overlap은 3개월인데 취소 지연의
// p99는 11.8개월이다. 3개월 이후에 취소되는 10.5%는 어떤 정기 작업으로도 다시 확인되지
// 않아 "취소됐지만 DB에는 유효한 거래"로 영구 누적된다(부산 기준 연 ~250건).
//
// 왜 daily overlap을 3 → 12개월로 늘리지 않는가: 16개 구 × 13개월 = 208 cells이고 실측
// 0.54s/cell 기준 약 112초 — Vercel 60초 Function 한도를 구조적으로 넘는다. overlap 상수를
// 키우면 매일 PARTIAL_RUN으로 잘리면서 **최신 3개월 동기화까지 같이 위태로워진다**.
//
// 그래서 이 sweep은 별도 경로다:
//   - fresh(daily sale-sync) : latestComplete-2 ~ 현재월 — 변경 없음, 영향 없음
//   - recheck(이 파일)        : latestComplete-12 ~ latestComplete-3 — 독립 cron, 독립 예산
// 두 경로가 합쳐 12개월을 덮고, 서로의 시간 예산을 잠식하지 않는다.
//
// §4 절대 원칙 준수: 판정 로직을 복제하지 않는다. cell 단위 처리는 sale-sync-core의
// `syncOneSaleCell`을 **그대로** 호출하므로 fetch/pagination completeness/identity/
// write-policy(false→true only, aptSeq gate, conflict skip)가 daily 경로와 100% 동일하다.
import { prisma } from '../prisma';
import { latestCompleteMonth, subtractMonths } from '../../../scripts/rent-trade-history/incremental-sync-completed-month-logic';
import { recordCoverageCells, type CoverageCellRecord } from '../sync-coverage';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { syncOneSaleCell } from './sale-sync-core';
import {
  TimeBudget,
  monthsInRange,
  newRunId,
  orderRecheckCellsByStaleness,
  resolveSaleRecheckBand,
  type CellReport,
  type RecheckCell,
  type SyncMode,
  type SyncRunStatus,
} from './shared';

export { SALE_RECHECK_MIN_MONTHS_BACK, SALE_RECHECK_MAX_MONTHS_BACK } from './shared';

// sale-sync-core와 동일 근거(실측 0.54s/cell, band-scan 재실측 포함). 재시도 폭주 셀을
// 감안해 여유를 크게 잡는다 — 예산을 넘겨 잘리는 것보다 한 셀 덜 하는 편이 안전하다.
const ESTIMATED_CELL_MS = 2500;

export interface SaleRecheckOptions {
  mode: SyncMode;
  lawdCds?: string[];
  minMonthsBack?: number;
  maxMonthsBack?: number;
  /** 이번 실행에서 처리할 셀 수 상한(운영/디버깅용). 기본은 예산이 허용하는 만큼. */
  maxCells?: number;
  budgetMs?: number;
  now?: Date;
}

export interface SaleRecheckSummary {
  status: SyncRunStatus;
  mode: SyncMode;
  runId: string;
  from: string;
  to: string;
  /** band 전체 셀 수. */
  bandCells: number;
  cellsProcessed: number;
  /** band를 한 바퀴 다 돌았는가. false는 정상이다(§6 — 예산 기반 회전 sweep). */
  sweepComplete: boolean;
  /** 한 번도 원천 대조된 적 없는 band 셀 수(이번 실행 시작 시점). */
  neverVerifiedCells: number;
  /** band에서 가장 오래된 검증 시각(이번 실행 시작 시점). */
  oldestVerifiedAt: string | null;
  fetched: number;
  inserted: number;
  /** 승인된 유일한 UPDATE — cancellation false→true flip 수. */
  updated: number;
  blocked: number;
  failed: number;
  coverageRecorded: number;
  durationMs: number;
  reports: CellReport[];
}

/** band 안의 (구 × 월) 셀 전체와, 각 셀의 마지막 원천 대조 시각을 합친다. */
export async function loadRecheckCells(from: string, to: string, lawdCds: string[]): Promise<RecheckCell[]> {
  const months = monthsInRange(from, to);
  const rows = await prisma.syncCoverageCell.findMany({
    where: { dataset: 'SALE', dealYmd: { gte: from, lte: to } },
    select: { lawdCd: true, dealYmd: true, verifiedAt: true },
  });
  const verifiedAt = new Map<string, number>();
  for (const r of rows) verifiedAt.set(`${r.lawdCd}:${r.dealYmd}`, r.verifiedAt.getTime());

  const cells: RecheckCell[] = [];
  for (const dealYmd of months) {
    for (const lawdCd of lawdCds) {
      cells.push({ lawdCd, dealYmd, lastVerifiedAtMs: verifiedAt.get(`${lawdCd}:${dealYmd}`) });
    }
  }
  return cells;
}

export async function runSaleRecheckSweep(opts: SaleRecheckOptions, log: (line: string) => void): Promise<SaleRecheckSummary> {
  const budget = new TimeBudget(opts.budgetMs ?? 45_000);
  const runId = newRunId('sale-recheck');
  const now = opts.now ?? new Date();
  const latestComplete = latestCompleteMonth(now);
  const lawdCds = opts.lawdCds ?? BUSAN_LAWDCD_16;
  const { from, to } = resolveSaleRecheckBand(latestComplete, subtractMonths, {
    minMonthsBack: opts.minMonthsBack,
    maxMonthsBack: opts.maxMonthsBack,
  });

  const cells = await loadRecheckCells(from, to, lawdCds);
  const ordered = orderRecheckCellsByStaleness(cells);
  const neverVerified = cells.filter((c) => c.lastVerifiedAtMs == null).length;
  const verifiedTimes = cells.map((c) => c.lastVerifiedAtMs).filter((v): v is number => v != null);
  const oldestVerifiedAt = verifiedTimes.length ? new Date(Math.min(...verifiedTimes)).toISOString() : null;

  log(
    `START sale-recheck mode=${opts.mode} runId=${runId} band=[${from},${to}] latestComplete=${latestComplete} ` +
      `districts=${lawdCds.length} bandCells=${cells.length} neverVerified=${neverVerified} oldestVerifiedAt=${oldestVerifiedAt ?? 'none'}`
  );

  const reports: CellReport[] = [];
  const coverage: CoverageCellRecord[] = [];
  const limit = Math.min(opts.maxCells ?? ordered.length, ordered.length);
  let budgetExhausted = false;

  for (let i = 0; i < limit; i++) {
    if (!budget.hasRoomFor(ESTIMATED_CELL_MS)) {
      budgetExhausted = true;
      log(`BUDGET_STOP elapsed=${budget.elapsedMs()}ms processed=${reports.length}/${cells.length} — 남은 셀은 다음 실행에서 가장 오래된 순으로 먼저 처리된다`);
      break;
    }
    const cell = ordered[i];
    const report = await syncOneSaleCell(cell.lawdCd, cell.dealYmd, opts.mode, log);
    reports.push(report);
    // band는 전부 latestComplete 이하이므로 §15 현재월 제외 규칙에 걸리는 셀이 없다.
    coverage.push({
      lawdCd: cell.lawdCd,
      dealYmd: cell.dealYmd,
      status: report.status,
      sourceTotalCount: report.sourceTotalCount,
      fetchedCount: report.fetched,
      blockedCount: report.blocked,
      insertedCount: report.inserted,
      updatedCount: report.updated,
    });
  }

  const { recorded } = await recordCoverageCells(opts.mode, 'SALE', runId, coverage);

  const totals = reports.reduce(
    (a, r) => ({
      fetched: a.fetched + r.fetched,
      inserted: a.inserted + r.inserted,
      updated: a.updated + r.updated,
      blocked: a.blocked + r.blocked,
      failed: a.failed + (r.status === 'INVALID' || r.status === 'PARTIAL' ? 1 : 0),
      // TRADE_REGISTRY_DATA_V1.1 §7 — sweep도 같은 syncOneSaleCell을 쓰므로 self-heal이
      // 4~12개월 구간에도 그대로 적용된다. 별도 API 호출/cron 추가 없음.
      registryUpdated: a.registryUpdated + r.registryUpdated,
      registryAmbiguousSkipped: a.registryAmbiguousSkipped + r.registryAmbiguousSkipped,
    }),
    { fetched: 0, inserted: 0, updated: 0, blocked: 0, failed: 0, registryUpdated: 0, registryAmbiguousSkipped: 0 }
  );

  // §6 STATUS SEMANTICS — 이 sweep은 **설계상** 예산에 맞춰 band의 일부만 돌고 다음
  // 실행이 가장 오래된 셀부터 이어받는다. 따라서 "band를 다 못 돌았다"는 것은 실패가
  // 아니라 정상 동작이며 PARTIAL_RUN으로 보고하지 않는다(그렇게 하면 매일 207이 떠서
  // 진짜 문제를 가린다). 대신 sweepComplete/cellsProcessed로 사실을 그대로 노출한다.
  // 다만 셀을 **하나도** 처리하지 못했다면 그것은 진짜 이상 신호다.
  let status: SyncRunStatus = 'SUCCESS';
  if (reports.length === 0) status = 'PARTIAL_RUN';
  else if (totals.failed > 0) status = 'PARTIAL';

  const summary: SaleRecheckSummary = {
    status,
    mode: opts.mode,
    runId,
    from,
    to,
    bandCells: cells.length,
    cellsProcessed: reports.length,
    sweepComplete: !budgetExhausted && reports.length === cells.length,
    neverVerifiedCells: neverVerified,
    oldestVerifiedAt,
    ...totals,
    coverageRecorded: recorded,
    durationMs: budget.elapsedMs(),
    reports,
  };

  log(
    `DONE sale-recheck status=${status} processed=${reports.length}/${cells.length} sweepComplete=${summary.sweepComplete} ` +
      `inserted=${totals.inserted} flips=${totals.updated} registryUpdated=${totals.registryUpdated} ` +
      `registryAmbiguousSkipped=${totals.registryAmbiguousSkipped} blocked=${totals.blocked} failed=${totals.failed} ` +
      `coverageRecorded=${recorded} durationMs=${summary.durationMs}`
  );
  return summary;
}
