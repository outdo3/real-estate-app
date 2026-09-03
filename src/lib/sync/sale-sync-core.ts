// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §3/§10/§11/§21 — SALE incremental sync의
// serverless-safe core.
//
// §4대로 판정 로직은 기존 검증된 순수 모듈을 그대로 쓴다:
//   - fetch + pagination + completeness : sale-molit-fetch.ts (classifySaleCellCompleteness)
//   - 정규화/identity/occurrenceIndex   : trade-history-logic.ts
//   - row별 조치 결정                    : write-policy-logic.ts (classifyRow)
//
// §21 SCOPE — 기존 CLI 엔진은 기본이 **전국**(약 250개 시군구 × 3개월 ≈ 753 cells,
// 실측 0.79s/cell ≈ 10분)이라 60초 Function에 절대 들어가지 않는다. Cron 자동화 scope는
// 부산 16개 구로 한정하고, 그래도 빠듯하면 district chunk로 나눠 실행한다(timeout을 무리하게
// 늘리지 않는다). 전국 backfill은 지금처럼 CLI로 계속 수행한다.
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { fetchSaleRegionMonth } from '../../../scripts/sale-molit-fetch';
import { normalizeMolitItemsToTradeRows, type TradeRowInput } from '../../../scripts/trade-history-logic';
import { classifyRow } from '../../../scripts/write-policy-logic';
import { latestCompleteMonth, subtractMonths } from '../../../scripts/rent-trade-history/incremental-sync-completed-month-logic';
import { recordCoverageCells, type CoverageCellRecord } from '../sync-coverage';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { TimeBudget, currentCalendarMonth, monthsInRange, newRunId, resolveSaleRange as resolveSaleRangePure, type CellReport, type SyncMode, type SyncRunStatus, type SyncSummary } from './shared';

export { SALE_DEFAULT_OVERLAP_MONTHS } from './shared';

// 실측 0.79s/cell(scripts/_incremental_sync_nationwide_results/run-2026-09-02T17-08-08-498Z.log,
// 17 cells / 13.5s). 재시도 폭주 셀은 훨씬 오래 걸릴 수 있어 여유를 크게 잡는다.
const ESTIMATED_CELL_MS = 2500;
const CHUNK_SIZE = 500;

function naturalKeyStr(row: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null; occurrenceIndex: number }): string {
  return `${row.groupKeyStr}|${row.dealAmount}|${row.dealDate}|${row.floor}|${row.occurrenceIndex}`;
}

export interface SaleSyncOptions {
  mode: SyncMode;
  lawdCds?: string[];
  overlapMonths?: number;
  from?: string;
  to?: string;
  /** §21 district chunking — 60초 안에 못 들어갈 때 나눠 실행한다. */
  districtOffset?: number;
  districtLimit?: number;
  budgetMs?: number;
  now?: Date;
}

/** §15 — 현재월도 동기화하되 절대 검증 완료로 기록하지 않는다(판정은 shared.ts 순수 함수). */
export function resolveSaleRange(opts: SaleSyncOptions): { from: string; to: string; latestComplete: string } {
  const now = opts.now ?? new Date();
  const latestComplete = latestCompleteMonth(now);
  const { from, to } = resolveSaleRangePure(latestComplete, currentCalendarMonth(now), subtractMonths, opts);
  return { from, to, latestComplete };
}

export async function runSaleSync(opts: SaleSyncOptions, log: (line: string) => void): Promise<SyncSummary> {
  const budget = new TimeBudget(opts.budgetMs ?? 50_000);
  const runId = newRunId('sale');
  const all = opts.lawdCds ?? BUSAN_LAWDCD_16;
  const offset = opts.districtOffset ?? 0;
  const lawdCds = all.slice(offset, offset + (opts.districtLimit ?? all.length));
  const { from, to, latestComplete } = resolveSaleRange(opts);
  const months = monthsInRange(from, to);
  const reports: CellReport[] = [];
  const coverage: CoverageCellRecord[] = [];
  const totalCells = lawdCds.length * months.length;

  log(`START sale mode=${opts.mode} runId=${runId} range=[${from},${to}] latestComplete=${latestComplete} districts=${lawdCds.length}(offset=${offset}) cells=${totalCells}`);

  let budgetExhausted = false;
  for (const lawdCd of lawdCds) {
    for (const dealYmd of months) {
      if (!budget.hasRoomFor(ESTIMATED_CELL_MS)) {
        budgetExhausted = true;
        log(`BUDGET_STOP elapsed=${budget.elapsedMs()}ms — 남은 셀은 다음 실행/chunk에서 처리한다`);
        break;
      }
      const report = await syncOneSaleCell(lawdCd, dealYmd, opts.mode, log);
      reports.push(report);
      // §15 — 진행 중인 현재월은 동기화는 하되 절대 검증 완료로 기록하지 않는다.
      if (dealYmd <= latestComplete) {
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

  const { recorded } = await recordCoverageCells(opts.mode, 'SALE', runId, coverage);

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
  if (budgetExhausted) status = 'PARTIAL_RUN';
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
    needsReview: [],
    reports,
  };
  log(`DONE sale status=${status} processed=${reports.length}/${totalCells} inserted=${totals.inserted} updated=${totals.updated} blocked=${totals.blocked} failed=${totals.failed} coverageRecorded=${recorded} durationMs=${summary.durationMs}`);
  return summary;
}

async function syncOneSaleCell(lawdCd: string, dealYmd: string, mode: SyncMode, log: (line: string) => void): Promise<CellReport> {
  const fetchResult = await fetchSaleRegionMonth(lawdCd, dealYmd);
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

  // §11 — pagination이 끝까지 검증되지 않은 셀은 쓰지 않는다. rent와 동일 원칙.
  if (fetchResult.status === 'INVALID' || fetchResult.status === 'PARTIAL') {
    log(`${fetchResult.status} ${lawdCd}:${dealYmd} fetched=${fetchResult.collectedCount}/${fetchResult.totalCount ?? '?'} — 쓰기 건너뜀, 다음 실행 재시도`);
    return base;
  }

  const { rows, invalid } = normalizeMolitItemsToTradeRows(fetchResult.items, lawdCd, dealYmd);
  base.blocked = invalid.length;
  if (rows.length === 0) return base;

  const existing = await prisma.apartmentTradeHistory.findMany({
    where: { lawdCd, dealYmd },
    select: { id: true, groupKeyStr: true, dealAmount: true, dealDate: true, floor: true, occurrenceIndex: true, dealCanceled: true, aptName: true, dong: true },
  });
  const existingMap = new Map<string, (typeof existing)[number]>();
  for (const e of existing) {
    if (e.floor == null) continue; // 자연키에 floor가 필수(기존 정책과 동일)
    existingMap.set(naturalKeyStr({ groupKeyStr: e.groupKeyStr, dealAmount: e.dealAmount, dealDate: e.dealDate.toISOString().slice(0, 10), floor: e.floor, occurrenceIndex: e.occurrenceIndex }), e);
  }

  const inserts: TradeRowInput[] = [];
  const flips: { id: number; row: TradeRowInput }[] = [];
  for (const row of rows) {
    const match = existingMap.get(naturalKeyStr(row));
    const kind = classifyRow(row, match);
    // §10 — aptSeq 없는 새 row는 insert하지 않는다(reviewRequired). name+dong fallback으로
    // canonical identity를 만들지 않는다. conflict/updateTrueToFalseSkipped도 손대지 않는다.
    if (kind === 'insert') inserts.push(row);
    else if (kind === 'updateFalseToTrue' && match) flips.push({ id: match.id, row });
    else if (kind === 'reviewRequired' || kind === 'conflict') base.reviewCandidates++;
    else base.unchanged++;
  }

  if (mode === 'apply') {
    for (let i = 0; i < inserts.length; i += CHUNK_SIZE) {
      const chunk = inserts.slice(i, i + CHUNK_SIZE);
      const result = await prisma.apartmentTradeHistory.createMany({
        data: chunk.map((row) => ({
          source: 'MOLIT_APT_TRADE',
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
          dealAmount: row.dealAmount,
          dealYear: row.dealYear,
          dealMonth: row.dealMonth,
          dealDay: row.dealDay,
          dealDate: new Date(`${row.dealDate}T00:00:00.000Z`),
          floor: row.floor,
          buildYear: row.buildYear,
          dealCanceled: row.dealCanceled,
          cancelDate: row.cancelDate,
          registryDate: row.registryDate,
          occurrenceIndex: row.occurrenceIndex,
          rawUid: row.rawUid,
          sourceFetchedAt: new Date(),
        })),
        skipDuplicates: true,
      });
      base.inserted += result.count;
    }
    // §10 — 승인된 유일한 UPDATE: 이미 검증된 취소 flip(false→true). 자연키는 불변이고
    // true→false 되돌리기는 write-policy-logic에서 이미 차단된다.
    for (let i = 0; i < flips.length; i += CHUNK_SIZE) {
      const chunk = flips.slice(i, i + CHUNK_SIZE);
      await prisma.$transaction(
        chunk.map((f) =>
          prisma.apartmentTradeHistory.update({
            where: { id: f.id },
            data: { dealCanceled: true, cancelDate: f.row.cancelDate, registryDate: f.row.registryDate, sourceFetchedAt: new Date() },
          })
        )
      );
      base.updated += chunk.length;
    }
  } else {
    base.inserted = inserts.length; // dry-run 예상치
    base.updated = flips.length;
  }

  log(`${fetchResult.status} ${lawdCd}:${dealYmd} fetched=${base.fetched} blocked=${base.blocked} inserted=${base.inserted} flips=${base.updated} review=${base.reviewCandidates}`);
  return base;
}
