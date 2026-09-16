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
import {
  buildRegistryOnlyUpdateFields,
  classifyRow,
  reconcileGroupCancellation,
  isRegistrySupplementUnambiguous,
  occurrenceGroupKey,
} from '../../../scripts/write-policy-logic';
import { latestCompleteMonth, subtractMonths } from '../../../scripts/rent-trade-history/incremental-sync-completed-month-logic';
import { recordCoverageCells, type CoverageCellRecord } from '../sync-coverage';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { TimeBudget, currentCalendarMonth, monthsInRange, newRunId, resolveSaleRange as resolveSaleRangePure, type CellReport, type SyncMode, type SyncRunStatus, type SyncSummary } from './shared';

export { SALE_DEFAULT_OVERLAP_MONTHS } from './shared';

// 실측 0.79s/cell(scripts/_incremental_sync_nationwide_results/run-2026-09-02T17-08-08-498Z.log,
// 17 cells / 13.5s). 재시도 폭주 셀은 훨씬 오래 걸릴 수 있어 여유를 크게 잡는다.
const ESTIMATED_CELL_MS = 2500;
const CHUNK_SIZE = 500;

/**
 * CANCELLATION_RATCHET_PREVENTION_FIX_V1 §15 — 과다 취소 치유(true→false) 쓰기 스위치.
 * 기본 꺼짐. 예방(새 과다 취소 방지)은 이 값과 무관하게 항상 동작한다.
 */
function isCancelRestoreEnabled(): boolean {
  return process.env.SALE_CANCEL_RESTORE_ENABLED === '1';
}

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
      registryUpdated: a.registryUpdated + r.registryUpdated,
      registryAmbiguousSkipped: a.registryAmbiguousSkipped + r.registryAmbiguousSkipped,
      cancelRestored: a.cancelRestored + (r.cancelRestored ?? 0),
      cancelRestorePending: a.cancelRestorePending + (r.cancelRestorePending ?? 0),
      cancelReconcileSkipped: a.cancelReconcileSkipped + (r.cancelReconcileSkipped ?? 0),
    }),
    { fetched: 0, inserted: 0, updated: 0, blocked: 0, failed: 0, registryUpdated: 0, registryAmbiguousSkipped: 0, cancelRestored: 0, cancelRestorePending: 0, cancelReconcileSkipped: 0 }
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
  log(
    `DONE sale status=${status} processed=${reports.length}/${totalCells} inserted=${totals.inserted} updated=${totals.updated} ` +
      `cancelRestored=${totals.cancelRestored} cancelRestorePending=${totals.cancelRestorePending} cancelReconcileSkipped=${totals.cancelReconcileSkipped} ` +
      `registryUpdated=${totals.registryUpdated} registryAmbiguousSkipped=${totals.registryAmbiguousSkipped} ` +
      `blocked=${totals.blocked} failed=${totals.failed} coverageRecorded=${recorded} durationMs=${summary.durationMs}`
  );
  return summary;
}

/**
 * SALE_CANCELLATION_COVERAGE_V1 §4 — recheck sweep이 **이 함수를 그대로 재사용한다**.
 * fetch/completeness/identity/write-policy 판정을 복제하지 않기 위해 export만 추가했고
 * 본문은 변경하지 않았다(shared.ts §4 원칙: "두 경로가 서로 다른 판정 로직을 갖지 않는다").
 */
export async function syncOneSaleCell(lawdCd: string, dealYmd: string, mode: SyncMode, log: (line: string) => void): Promise<CellReport> {
  const fetchResult = await fetchSaleRegionMonth(lawdCd, dealYmd);
  const base: CellReport = {
    lawdCd,
    dealYmd,
    status: fetchResult.status,
    sourceTotalCount: fetchResult.totalCount,
    fetched: fetchResult.collectedCount,
    registryUpdated: 0,
    registryAmbiguousSkipped: 0,
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
    // TRADE_REGISTRY_DATA_V1.1 — registryDate는 self-heal 판정에 필수라 반드시 select한다.
    select: { id: true, groupKeyStr: true, dealAmount: true, dealDate: true, floor: true, occurrenceIndex: true, dealCanceled: true, cancelDate: true, aptName: true, dong: true, registryDate: true },
  });
  const existingMap = new Map<string, (typeof existing)[number]>();
  for (const e of existing) {
    if (e.floor == null) continue; // 자연키에 floor가 필수(기존 정책과 동일)
    existingMap.set(naturalKeyStr({ groupKeyStr: e.groupKeyStr, dealAmount: e.dealAmount, dealDate: e.dealDate.toISOString().slice(0, 10), floor: e.floor, occurrenceIndex: e.occurrenceIndex }), e);
  }

  // TRADE_REGISTRY_DATA_V1.1 §4 — 같은 자연키 그룹(occurrenceIndex 제외)의 형제 row를
  // 미리 모아둔다. 형제들의 registryDate가 엇갈리면 순서 흔들림에 취약하므로 보충하지 않는다.
  const siblingsByGroup = new Map<string, TradeRowInput[]>();
  for (const row of rows) {
    const key = occurrenceGroupKey(row);
    const list = siblingsByGroup.get(key);
    if (list) list.push(row);
    else siblingsByGroup.set(key, [row]);
  }

  // CANCELLATION_RATCHET_PREVENTION_FIX_V1 — DB 형제도 그룹 키로 모은다(occurrenceIndex 제외).
  // 원천/DB 양쪽을 **순서 무관**하게 그룹으로 세워야 취소 개수를 대조할 수 있다.
  const existingSiblingsByGroup = new Map<string, typeof existing>();
  for (const e of existing) {
    if (e.floor == null) continue;
    const key = occurrenceGroupKey({
      groupKeyStr: e.groupKeyStr,
      dealAmount: e.dealAmount,
      dealDate: e.dealDate.toISOString().slice(0, 10),
      floor: e.floor,
    });
    const list = existingSiblingsByGroup.get(key);
    if (list) list.push(e);
    else existingSiblingsByGroup.set(key, [e]);
  }

  // 취소 상태는 **그룹 단위 개수**로만 정한다(결함 A 근절). 원천 응답 순서에 의존하지 않으므로
  // 순서가 흔들려도 결과가 바뀌지 않는다. 이 시점에서 셀은 이미 COMPLETE/EMPTY_VALID다(§11 가드).
  const restoreEnabled = isCancelRestoreEnabled();
  const cancelFlips: { id: number; cancelDate: string | null }[] = [];
  const cancelRestores: number[] = [];
  const reconcileTouched = new Set<number>();
  let cancelReconcileSkipped = 0;
  for (const [key, srcSiblings] of siblingsByGroup) {
    const dbSiblings = existingSiblingsByGroup.get(key);
    // 아직 적재되지 않은 그룹(insert 대기)은 이번 실행에서 판정하지 않는다 — insert가
    // 원천 상태를 그대로 넣으므로 개수는 맞고, 다음 실행부터 정상적으로 대조된다.
    if (!dbSiblings || dbSiblings.length === 0) continue;
    // identity가 어긋난 그룹은 손대지 않는다(기존 conflict 원칙과 동일).
    const srcName = srcSiblings[0].aptName;
    const srcDong = srcSiblings[0].dong;
    if (
      srcSiblings.some((r) => r.aptName !== srcName || r.dong !== srcDong) ||
      dbSiblings.some((e) => e.aptName !== srcName || e.dong !== srcDong)
    ) {
      base.reviewCandidates++;
      cancelReconcileSkipped++;
      continue;
    }
    const result = reconcileGroupCancellation(srcSiblings, dbSiblings);
    if (result.kind === 'skipped') {
      cancelReconcileSkipped++;
      continue;
    }
    if (result.kind === 'noChange') continue;
    for (const c of result.toCancel) {
      cancelFlips.push(c);
      reconcileTouched.add(c.id);
    }
    for (const r of result.toRestore) {
      cancelRestores.push(r.id);
      reconcileTouched.add(r.id);
    }
  }

  const inserts: TradeRowInput[] = [];
  const registrySupplements: { id: number; registryDate: string }[] = [];
  for (const row of rows) {
    const match = existingMap.get(naturalKeyStr(row));
    const kind = classifyRow(row, match);
    // §10 — aptSeq 없는 새 row는 insert하지 않는다(reviewRequired). name+dong fallback으로
    // canonical identity를 만들지 않는다.
    // 취소 관련 분류(updateFalseToTrue / updateTrueToFalseSkipped)는 더 이상 쓰기를 만들지
    // 않는다 — 취소는 위 그룹 reconciliation이 전담한다.
    if (kind === 'insert') inserts.push(row);
    else if (kind === 'reviewRequired' || kind === 'conflict') base.reviewCandidates++;
    else if (kind === 'updateRegistryOnly' && match && !reconcileTouched.has(match.id)) {
      // §4 OCCURRENCE SAFETY — 형제 registryDate가 전부 같을 때만 보충한다.
      if (!isRegistrySupplementUnambiguous(siblingsByGroup.get(occurrenceGroupKey(row)) ?? [row])) {
        base.registryAmbiguousSkipped++;
        base.unchanged++;
        continue;
      }
      // §3 WRITE CONTRACT — 분류와 독립적으로 전제를 다시 검사한다(이중 안전장치).
      const data = buildRegistryOnlyUpdateFields(row, match);
      if (!data) {
        base.unchanged++;
        continue;
      }
      registrySupplements.push({ id: match.id, registryDate: data.registryDate });
    } else base.unchanged++;
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
    // CANCELLATION_RATCHET_PREVENTION_FIX_V1 — 취소 UPDATE는 그룹 reconciliation 결과만
    // 반영한다. 자연키(groupKey/금액/계약일/층/occurrenceIndex)는 여전히 불변이고,
    // deal_canceled와 cancel_date **둘만** 쓴다.
    //
    // registryDate를 함께 쓰지 않는 이유: 어떤 형제를 취소로 둘지는 이제 원천 응답의
    // 특정 행이 아니라 그룹 개수로 정해지므로, 그 행에 특정 원천 행의 등기일자를 옮겨
    // 적을 근거가 없다(등기일자 보충은 아래 전용 경로가 형제 전원 동일할 때만 한다).
    for (let i = 0; i < cancelFlips.length; i += CHUNK_SIZE) {
      const chunk = cancelFlips.slice(i, i + CHUNK_SIZE);
      await prisma.$transaction(
        chunk.map((f) =>
          prisma.apartmentTradeHistory.update({
            where: { id: f.id },
            data: { dealCanceled: true, cancelDate: f.cancelDate, sourceFetchedAt: new Date() },
          })
        )
      );
      base.updated += chunk.length;
    }
    // 과다 취소 치유(true→false). 원천이 COMPLETE이고 형제 수가 일치할 때만 여기 도달한다.
    //
    // CANCELLATION_RATCHET_PREVENTION_FIX_V1 §15 — 치유는 **기본 꺼짐**이다.
    // 이 정책은 본질적으로 자가 치유적이라, 켜두면 배포 직후 cron이 기존 과다 취소
    // (REPAIR_AUDIT_V1 확정 21행)를 자동으로 되돌린다. 예방과 기존 데이터 repair는
    // 분리해 승인받기로 했으므로, 예방만 먼저 배포하고 치유는 명시적으로 켠다.
    // 끈 상태에서도 **예방은 완전히 동작한다** — toCancel이 원천 취소 개수를 넘을 수
    // 없으므로 새로운 과다 취소가 생기지 않는다. 대기 건수는 metric으로만 남긴다.
    if (!restoreEnabled) {
      base.cancelRestorePending = cancelRestores.length;
      if (cancelRestores.length > 0) {
        log(`CANCEL_RESTORE_PENDING ${lawdCd}:${dealYmd} rows=${cancelRestores.length} — SALE_CANCEL_RESTORE_ENABLED=1 이 아니라 쓰지 않음`);
      }
    }
    for (let i = 0; restoreEnabled && i < cancelRestores.length; i += CHUNK_SIZE) {
      const chunk = cancelRestores.slice(i, i + CHUNK_SIZE);
      await prisma.$transaction(
        chunk.map((id) =>
          prisma.apartmentTradeHistory.update({
            where: { id },
            data: { dealCanceled: false, cancelDate: null, sourceFetchedAt: new Date() },
          })
        )
      );
      base.cancelRestored = (base.cancelRestored ?? 0) + chunk.length;
    }
    // TRADE_REGISTRY_DATA_V1.1 §3 — 승인된 두 번째 UPDATE: registryDate NULL→value 보충.
    // data에 registryDate 외 어떤 필드도 넣지 않는다(취소 필드/자연키/sourceFetchedAt 전부 제외)
    // — 자연키와 취소 의미론에 손대지 않는다는 것이 이 write의 계약이다.
    for (let i = 0; i < registrySupplements.length; i += CHUNK_SIZE) {
      const chunk = registrySupplements.slice(i, i + CHUNK_SIZE);
      await prisma.$transaction(
        chunk.map((s) =>
          prisma.apartmentTradeHistory.update({
            where: { id: s.id },
            data: { registryDate: s.registryDate },
          })
        )
      );
      base.registryUpdated += chunk.length;
    }
  } else {
    base.inserted = inserts.length; // dry-run 예상치
    base.updated = cancelFlips.length;
    if (restoreEnabled) base.cancelRestored = cancelRestores.length;
    else base.cancelRestorePending = cancelRestores.length;
    base.registryUpdated = registrySupplements.length;
  }
  base.cancelReconcileSkipped = cancelReconcileSkipped;

  log(
    `${fetchResult.status} ${lawdCd}:${dealYmd} fetched=${base.fetched} blocked=${base.blocked} inserted=${base.inserted} ` +
      `flips=${base.updated} cancelRestored=${base.cancelRestored ?? 0} cancelRestorePending=${base.cancelRestorePending ?? 0} cancelReconcileSkipped=${cancelReconcileSkipped} ` +
      `registry=${base.registryUpdated} registryAmbiguous=${base.registryAmbiguousSkipped} review=${base.reviewCandidates}`
  );
  return base;
}
