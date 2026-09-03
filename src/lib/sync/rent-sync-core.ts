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
import { fetchRentRegionMonth } from '../../../scripts/rent-trade-history/rent-molit-fetch';
import { normalizeMolitRentItemsToRentRows, type RentRowInput } from '../../../scripts/rent-trade-history/rent-history-logic';
import { shouldPersistCellRows } from '../../../scripts/rent-trade-history/rent-completeness-logic';
import { latestCompleteMonth, subtractMonths } from '../../../scripts/rent-trade-history/incremental-sync-completed-month-logic';
import { recordCoverageCells, type CoverageCellRecord } from '../sync-coverage';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { TimeBudget, monthsInRange, newRunId, resolveRentRange as resolveRentRangePure, type CellReport, type ReviewItem, type SyncMode, type SyncRunStatus, type SyncSummary } from './shared';

export { RENT_DEFAULT_OVERLAP_MONTHS } from './shared';

// 실측(dry-run 32 cells / 13.8s, scripts/rent-trade-history/_incremental_sync_results)
// 기준 셀당 약 430ms. 여유를 둬 한 셀 예산을 넉넉히 잡는다.
const ESTIMATED_CELL_MS = 1500;

// 자연키 밖 필드만 비교한다 — 기존 CLI의 COMPARE_FIELDS와 동일해야 한다(§4).
const COMPARE_FIELDS = ['aptName', 'dong', 'jibun', 'buildYear', 'contractType', 'contractTerm', 'preDeposit', 'preMonthlyRent', 'useRenewalRight'] as const;

interface ExistingRentRow {
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

function naturalKeyStrOf(row: { groupKeyStr: string; deposit: number; monthlyRent: number; dealDate: string; floor: number; occurrenceIndex: number }): string {
  return `${row.groupKeyStr}::${row.deposit}::${row.monthlyRent}::${row.dealDate}::${row.floor}::${row.occurrenceIndex}`;
}

type CompareField = (typeof COMPARE_FIELDS)[number];

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

export async function runRentSync(opts: RentSyncOptions, log: (line: string) => void): Promise<SyncSummary> {
  const budget = new TimeBudget(opts.budgetMs ?? 50_000);
  const runId = newRunId('rent');
  const lawdCds = opts.lawdCds ?? BUSAN_LAWDCD_16;
  const { from, to } = resolveRentRange(opts);
  const months = monthsInRange(from, to);
  const reports: CellReport[] = [];
  const needsReview: ReviewItem[] = [];
  const coverage: CoverageCellRecord[] = [];
  const totalCells = lawdCds.length * months.length;

  log(`START rent mode=${opts.mode} runId=${runId} range=[${from},${to}] districts=${lawdCds.length} cells=${totalCells}`);

  let budgetExhausted = false;
  for (const lawdCd of lawdCds) {
    for (const dealYmd of months) {
      if (!budget.hasRoomFor(ESTIMATED_CELL_MS)) {
        budgetExhausted = true;
        log(`BUDGET_STOP elapsed=${budget.elapsedMs()}ms — 남은 셀은 다음 실행에서 처리한다`);
        break;
      }
      const report = await syncOneRentCell(lawdCd, dealYmd, opts.mode, needsReview, log);
      reports.push(report);
      // §14 — 검증 상태를 그대로 기록한다. 단, 사람이 검토해야 할 변경 후보가 있는 셀은
      // **아예 기록하지 않는다**: 기록이 없으면 coverage가 전진하지 않고(부재 = 미검증)
      // 다음 실행에서 자연스럽게 재시도된다. PARTIAL로 위장해 기록하는 것보다 정직하다.
      if (report.reviewCandidates === 0) {
        coverage.push({
          lawdCd,
          dealYmd,
          status: report.status,
          sourceTotalCount: report.sourceTotalCount,
          fetchedCount: report.fetched,
          blockedCount: report.blocked,
          insertedCount: report.inserted,
          updatedCount: report.updated,
        });
      }
    }
    if (budgetExhausted) break;
  }

  // §5/§14 — dry-run은 recordCoverageCells 내부에서도 다시 한 번 차단된다(이중 안전장치).
  const { recorded } = await recordCoverageCells(opts.mode, 'RENT', runId, coverage);

  const totals = reports.reduce(
    (a, r) => ({
      fetched: a.fetched + r.fetched,
      inserted: a.inserted + r.inserted,
      updated: a.updated + r.updated,
      blocked: a.blocked + r.blocked,
      failed: a.failed + (r.status === 'INVALID' || r.status === 'PARTIAL' ? 1 : 0),
    }),
    { fetched: 0, inserted: 0, updated: 0, blocked: 0, failed: 0 }
  );

  let status: SyncRunStatus = 'SUCCESS';
  if (needsReview.length > 0) status = 'NEEDS_REVIEW';
  else if (budgetExhausted) status = 'PARTIAL_RUN';
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
    coverageRecorded: recorded,
    durationMs: budget.elapsedMs(),
    needsReview,
    reports,
  };
  log(`DONE rent status=${status} processed=${reports.length}/${totalCells} inserted=${totals.inserted} updated=${totals.updated} blocked=${totals.blocked} failed=${totals.failed} coverageRecorded=${recorded} durationMs=${summary.durationMs}`);
  return summary;
}

async function syncOneRentCell(
  lawdCd: string,
  dealYmd: string,
  mode: SyncMode,
  needsReview: ReviewItem[],
  log: (line: string) => void
): Promise<CellReport> {
  const fetchResult = await fetchRentRegionMonth(lawdCd, dealYmd);
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
  };

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
  const existingMap = new Map<string, ExistingRentRow>();
  for (const e of existing) {
    if (e.floor == null) continue;
    existingMap.set(
      naturalKeyStrOf({ groupKeyStr: e.groupKeyStr, deposit: e.deposit, monthlyRent: e.monthlyRent, dealDate: e.dealDate.toISOString().slice(0, 10), floor: e.floor, occurrenceIndex: e.occurrenceIndex }),
      e
    );
  }

  const toInsert: RentRowInput[] = [];
  for (const row of rows) {
    const match = existingMap.get(naturalKeyStrOf(row));
    if (!match) {
      toInsert.push(row);
      continue;
    }
    // §13 RENT FIRST MUTATION GUARD — 기존 row의 내용이 달라졌다면 자동으로 덮어쓰지
    // **않는다**. Production에서 rent row의 true mutation은 아직 한 번도 관측된 적이 없다.
    // 첫 사례는 반드시 사람이 보고 정책을 정해야 한다 — 필드명과 전후 값만 보고한다
    // (개인정보 없음).
    const diffs = COMPARE_FIELDS.filter((f) => compareFieldValue(match, f) !== compareFieldValue(row, f));
    if (diffs.length === 0) {
      base.unchanged++;
      continue;
    }
    base.reviewCandidates += diffs.length;
    for (const f of diffs) {
      needsReview.push({
        lawdCd,
        dealYmd,
        identity: `aptSeq=${row.aptSeq} area=${row.exclusiveArea} deposit=${row.deposit} monthlyRent=${row.monthlyRent} dealDate=${row.dealDate} floor=${row.floor} occ=${row.occurrenceIndex}`,
        field: f,
        oldValue: compareFieldValue(match, f) == null ? null : String(compareFieldValue(match, f)),
        newValue: compareFieldValue(row, f) == null ? null : String(compareFieldValue(row, f)),
      });
    }
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

  log(`${fetchResult.status} ${lawdCd}:${dealYmd} fetched=${base.fetched} blocked=${base.blocked} inserted=${base.inserted} unchanged=${base.unchanged} review=${base.reviewCandidates}`);
  return base;
}
