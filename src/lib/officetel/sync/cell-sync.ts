// OFFICETEL_INCREMENTAL_SYNC_V1 — 셀 하나(데이터셋 × 구 × 계약월)의 동기화.
//
// 흐름: MOLIT fetch -> 정규화 -> 기존 DB 행과 자연키 대조 -> (apply) 신규 insert + 매매 취소 반영 -> 셀 상태 기록.
//
// 쓰기 원칙(운영 데이터 보호):
//   - 삭제하지 않는다. 원천에서 사라진 행도 그대로 둔다(dbOnlyRows로 보고만 한다).
//   - insert는 자연키 기준 skipDuplicates라 멱등이다. 이미 있는 행은 건드리지 않는다.
//   - 갱신은 매매의 "취소 반영" 하나뿐이다: dealCanceled=true, cancelDate, sourceFetchedAt.
//     원천이 취소가 더 적다고 말해도(DB 취소 > 원천 취소) 되돌리지 않는다 — cancelRestorePending으로 보고만 한다.
//     오피스텔은 rgstDate가 없어 아파트처럼 등기로 검증할 수 없으므로(cancellation 신뢰도 LIMITED) 자동 되돌림은 하지 않는다.
//   - 전월세는 원천에 취소 필드가 없으므로 insert만 한다.
//   - 부분 실패(페이지 누락·한도·시간 초과)한 셀은 아무것도 쓰지 않는다. 일부 페이지만으로는 취소 대조가 틀린다.
import { officetelRentGroupKey, officetelSaleGroupKey } from '../natural-key';
import type { OfficetelFetchOutcome } from './molit-fetch';
import { buildMasterIndex, prepareRentRows, prepareSaleRows, type MasterIndex } from './normalize';
import type {
  ExistingRentRow,
  ExistingSaleRow,
  OfficetelCellRecord,
  OfficetelCellStatus,
  OfficetelFailureReason,
  OfficetelSyncDataset,
  OfficetelSyncDb,
  OfficetelSyncMode,
  PreparedRent,
  PreparedSale,
  SaleCancelUpdate,
} from './types';

const day = (d: Date): string => d.toISOString().slice(0, 10);

// ------------------------------------------------------------------ 자연키 대조 (순수)

const saleKeyOfPrepared = (r: PreparedSale): string =>
  `${officetelSaleGroupKey({ canonicalKey: r.canonicalKey, dealDate: r.dealDate, exclusiveArea: r.exclusiveArea, dealAmount: r.dealAmount, floor: r.floor })}#${r.occurrenceIndex}`;
const saleGroupOfExisting = (r: ExistingSaleRow): string =>
  officetelSaleGroupKey({ canonicalKey: r.canonicalKey, dealDate: day(r.dealDate), exclusiveArea: r.exclusiveArea, dealAmount: r.dealAmount, floor: r.floor });

const rentKeyOfPrepared = (r: PreparedRent): string =>
  `${officetelRentGroupKey({ canonicalKey: r.canonicalKey, dealDate: r.dealDate, exclusiveArea: r.exclusiveArea, deposit: r.deposit, monthlyRent: r.monthlyRent, floor: r.floor })}#${r.occurrenceIndex}`;
const rentKeyOfExisting = (r: ExistingRentRow): string =>
  `${officetelRentGroupKey({ canonicalKey: r.canonicalKey, dealDate: day(r.dealDate), exclusiveArea: r.exclusiveArea, deposit: r.deposit, monthlyRent: r.monthlyRent, floor: r.floor })}#${r.occurrenceIndex}`;

export interface SaleReconcilePlan {
  inserts: PreparedSale[];
  cancelUpdates: SaleCancelUpdate[];
  /** DB의 취소 행이 원천보다 많은 그룹의 초과분 합. 쓰지 않고 보고만 한다. */
  cancelRestorePending: number;
  /** 취소를 반영해야 하는데 후보 행이 없어 보류한 건수. */
  cancelShortage: number;
  /** 원천에는 없고 DB에만 있는 행 수. 삭제하지 않는다. */
  dbOnlyRows: number;
}

/**
 * 매매 신규 insert와 취소 반영 계획. 자연키 그룹(= occurrenceIndex를 뺀 키) 단위로 대조한다.
 *
 * 취소는 두 가지 모양으로 들어온다.
 *   - TYPE B: 같은 거래의 취소 사본이 한 행 더 생김 -> 그룹 크기가 늘어 새 occurrence가 insert된다.
 *   - 원본 행이 취소로 바뀜 -> 그룹 크기는 같고 취소 행 수만 늘어난다 -> 기존 행을 취소로 갱신한다.
 * 두 경우 모두 "원천의 취소 행 수 > (DB 취소 행 수 + 이번에 insert할 취소 행 수)"일 때만 그 차이만큼 갱신하며,
 * 갱신 후보는 DB에 이미 있는 비취소 행 중 occurrenceIndex가 낮은 것부터다(그룹 내 행은 자연키가 모두 같다).
 */
export function planSaleReconcile(source: PreparedSale[], existing: ExistingSaleRow[], fetchedAt: Date): SaleReconcilePlan {
  const dbKeys = new Set(existing.map((r) => `${saleGroupOfExisting(r)}#${r.occurrenceIndex}`));
  const inserts = source.filter((r) => !dbKeys.has(saleKeyOfPrepared(r)));
  const insertKeys = new Set(inserts.map(saleKeyOfPrepared));

  const srcByGroup = new Map<string, PreparedSale[]>();
  for (const r of source) {
    const g = saleKeyOfPrepared(r).replace(/#\d+$/, '');
    const l = srcByGroup.get(g);
    if (l) l.push(r); else srcByGroup.set(g, [r]);
  }
  const dbByGroup = new Map<string, ExistingSaleRow[]>();
  for (const r of existing) {
    const g = saleGroupOfExisting(r);
    const l = dbByGroup.get(g);
    if (l) l.push(r); else dbByGroup.set(g, [r]);
  }

  const cancelUpdates: SaleCancelUpdate[] = [];
  let cancelRestorePending = 0;
  let cancelShortage = 0;
  for (const [g, src] of srcByGroup) {
    const db = dbByGroup.get(g) ?? [];
    const srcCanceled = src.filter((r) => r.dealCanceled);
    const insertedCanceled = src.filter((r) => r.dealCanceled && insertKeys.has(saleKeyOfPrepared(r)));
    const dbCanceled = db.filter((r) => r.dealCanceled).length;
    const after = dbCanceled + insertedCanceled.length;
    if (srcCanceled.length > after) {
      const need = srcCanceled.length - after;
      const candidates = db.filter((r) => !r.dealCanceled).sort((a, b) => a.occurrenceIndex - b.occurrenceIndex);
      // 새로 insert되는 취소 행이 이미 가져가는 취소일자는 제외하고 남은 것을 배정한다.
      const usedDates = insertedCanceled.map((r) => r.cancelDate);
      const dates = srcCanceled.map((r) => r.cancelDate);
      for (const u of usedDates) { const i = dates.indexOf(u); if (i >= 0) dates.splice(i, 1); }
      const take = Math.min(need, candidates.length);
      for (let i = 0; i < take; i++) cancelUpdates.push({ id: candidates[i].id, cancelDate: dates[dates.length - take + i] ?? null, sourceFetchedAt: fetchedAt });
      cancelShortage += need - take;
    } else if (after > srcCanceled.length) {
      cancelRestorePending += after - srcCanceled.length;
    }
  }
  let dbOnlyRows = 0;
  for (const [g, db] of dbByGroup) dbOnlyRows += Math.max(0, db.length - (srcByGroup.get(g)?.length ?? 0));
  return { inserts, cancelUpdates, cancelRestorePending, cancelShortage, dbOnlyRows };
}

export function planRentInserts(source: PreparedRent[], existing: ExistingRentRow[]): { inserts: PreparedRent[]; dbOnlyRows: number } {
  const dbKeys = new Set(existing.map(rentKeyOfExisting));
  const srcKeys = new Set(source.map(rentKeyOfPrepared));
  return {
    inserts: source.filter((r) => !dbKeys.has(rentKeyOfPrepared(r))),
    dbOnlyRows: existing.filter((r) => !srcKeys.has(rentKeyOfExisting(r))).length,
  };
}

// ------------------------------------------------------------------ 셀 실행

export interface OfficetelCellReport {
  dataset: OfficetelSyncDataset;
  lawdCd: string;
  dealYmd: string;
  status: OfficetelCellStatus;
  failureReason: OfficetelFailureReason | null;
  sourceTotalCount: number | null;
  fetched: number;
  /** 실제로 insert된 행 수(dry-run에서는 0). */
  inserted: number;
  /** 실제로 취소 반영한 행 수(dry-run에서는 0). */
  updated: number;
  duplicate: number;
  unresolved: number;
  invalidRows: number;
  invalidReasons: Record<string, number>;
  /** dry-run/apply 공통: 대조 결과 쓰게 될(된) 계획 수치. */
  planned: { inserts: number; cancelUpdates: number };
  cancelRestorePending: number;
  cancelShortage: number;
  dbOnlyRows: number;
  recorded: boolean;
}

export type OfficetelCellResult =
  | { kind: 'REPORT'; report: OfficetelCellReport; persistFailed: string | null }
  | { kind: 'STOPPED'; stop: 'QUOTA_RESERVE_REACHED' | 'DEADLINE_REACHED' };

export interface OfficetelCellParams {
  dataset: OfficetelSyncDataset;
  lawdCd: string;
  dealYmd: string;
  mode: OfficetelSyncMode;
  runId: string;
}

export interface OfficetelCellDeps {
  db: OfficetelSyncDb;
  fetchCell: (dataset: OfficetelSyncDataset, lawdCd: string, dealYmd: string) => Promise<OfficetelFetchOutcome>;
  clock?: () => Date;
  /** 같은 실행 안에서 구별 master 색인을 재사용한다. */
  masterCache?: Map<string, MasterIndex>;
}

const blank = (p: OfficetelCellParams): OfficetelCellReport => ({
  dataset: p.dataset, lawdCd: p.lawdCd, dealYmd: p.dealYmd,
  status: 'PARTIAL', failureReason: null, sourceTotalCount: null,
  fetched: 0, inserted: 0, updated: 0, duplicate: 0, unresolved: 0, invalidRows: 0, invalidReasons: {},
  planned: { inserts: 0, cancelUpdates: 0 }, cancelRestorePending: 0, cancelShortage: 0, dbOnlyRows: 0, recorded: false,
});

async function persist(p: OfficetelCellParams, report: OfficetelCellReport, attemptedAt: Date, db: OfficetelSyncDb): Promise<string | null> {
  // dry-run은 셀 상태를 기록하지 않는다(쓰기 0).
  if (p.mode !== 'apply') return null;
  const rec: OfficetelCellRecord = {
    dataset: p.dataset, lawdCd: p.lawdCd, dealYmd: p.dealYmd,
    status: report.status, failureReason: report.failureReason,
    sourceTotalCount: report.sourceTotalCount,
    fetchedCount: report.fetched, insertedCount: report.inserted, updatedCount: report.updated,
    duplicateCount: report.duplicate, unresolvedCount: report.unresolved, invalidRowCount: report.invalidRows,
    runId: p.runId, attemptedAt,
    verifiedAt: report.status === 'COMPLETE' ? attemptedAt : null,
  };
  try {
    await db.recordCell(rec);
    report.recorded = true;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function syncOfficetelCell(p: OfficetelCellParams, deps: OfficetelCellDeps): Promise<OfficetelCellResult> {
  const clock = deps.clock ?? (() => new Date());
  const report = blank(p);

  const outcome = await deps.fetchCell(p.dataset, p.lawdCd, p.dealYmd);
  if (outcome.kind === 'STOPPED') return { kind: 'STOPPED', stop: outcome.stop };

  const fetchedAt = clock();
  if (outcome.kind === 'FAILED') {
    // 실패는 "거래 없음"이 아니다: totalCount를 아는 만큼만 남기고 PARTIAL로 기록한다.
    report.status = 'PARTIAL';
    report.failureReason = outcome.reason;
    report.sourceTotalCount = outcome.totalCount;
    report.fetched = outcome.fetchedCount;
    const err = await persist(p, report, fetchedAt, deps.db);
    return { kind: 'REPORT', report, persistFailed: err };
  }

  report.sourceTotalCount = outcome.totalCount;
  report.fetched = outcome.items.length;

  try {
    let masters = deps.masterCache?.get(p.lawdCd);
    if (!masters) {
      masters = buildMasterIndex(await deps.db.loadMasters(p.lawdCd));
      deps.masterCache?.set(p.lawdCd, masters);
    }

    if (p.dataset === 'OFFICETEL_SALE') {
      const prep = prepareSaleRows(p.lawdCd, p.dealYmd, outcome.items, masters, fetchedAt);
      if (prep.structuralInvalid) {
        report.status = 'INVALID'; report.failureReason = 'PARSE_ERROR';
        report.invalidReasons = { STRUCTURAL: 1 };
        const err = await persist(p, report, fetchedAt, deps.db);
        return { kind: 'REPORT', report, persistFailed: err };
      }
      report.invalidRows = prep.invalidRowCount; report.invalidReasons = prep.invalidReasons;
      const existing = await deps.db.loadExistingSale(p.lawdCd, p.dealYmd);
      const plan = planSaleReconcile(prep.rows, existing, fetchedAt);
      report.planned = { inserts: plan.inserts.length, cancelUpdates: plan.cancelUpdates.length };
      report.cancelRestorePending = plan.cancelRestorePending; report.cancelShortage = plan.cancelShortage; report.dbOnlyRows = plan.dbOnlyRows;
      // 이번에 새로 들어올 행만 unresolved로 센다(이미 적재된 행을 매일 다시 세지 않는다).
      report.unresolved = plan.inserts.filter((r) => r.officetelMasterId === null).length;
      if (p.mode === 'apply') {
        report.inserted = plan.inserts.length ? await deps.db.insertSale(plan.inserts) : 0;
        report.duplicate = plan.inserts.length - report.inserted;
        report.updated = plan.cancelUpdates.length ? await deps.db.cancelSale(plan.cancelUpdates) : 0;
      }
    } else {
      const prep = prepareRentRows(p.lawdCd, p.dealYmd, outcome.items, masters, fetchedAt);
      if (prep.structuralInvalid) {
        report.status = 'INVALID'; report.failureReason = 'PARSE_ERROR';
        report.invalidReasons = { STRUCTURAL: 1 };
        const err = await persist(p, report, fetchedAt, deps.db);
        return { kind: 'REPORT', report, persistFailed: err };
      }
      report.invalidRows = prep.invalidRowCount; report.invalidReasons = prep.invalidReasons;
      const existing = await deps.db.loadExistingRent(p.lawdCd, p.dealYmd);
      const plan = planRentInserts(prep.rows, existing);
      report.planned = { inserts: plan.inserts.length, cancelUpdates: 0 };
      report.dbOnlyRows = plan.dbOnlyRows;
      report.unresolved = plan.inserts.filter((r) => r.officetelMasterId === null).length;
      if (p.mode === 'apply') {
        report.inserted = plan.inserts.length ? await deps.db.insertRent(plan.inserts) : 0;
        report.duplicate = plan.inserts.length - report.inserted;
      }
    }
  } catch (e) {
    // DB 읽기/쓰기 실패. 이미 일부가 쓰였을 수 있으나 멱등이라 다음 실행이 이어서 맞춘다. COMPLETE로 기록하지 않는다.
    report.status = 'PARTIAL';
    report.failureReason = 'DB_ERROR';
    const err = await persist(p, report, fetchedAt, deps.db);
    return { kind: 'REPORT', report, persistFailed: err };
  }

  // 정상 0건도 COMPLETE다(sourceTotalCount=0, fetched=0). 깨진 행이 있으면 COMPLETE라고 말하지 않는다.
  if (report.invalidRows > 0) {
    report.status = 'PARTIAL';
    report.failureReason = 'PARSE_ERROR';
  } else {
    report.status = 'COMPLETE';
    report.failureReason = null;
  }
  const err = await persist(p, report, fetchedAt, deps.db);
  return { kind: 'REPORT', report, persistFailed: err };
}
