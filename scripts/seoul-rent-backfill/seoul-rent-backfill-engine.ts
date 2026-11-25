/**
 * E-JIP 서울 25개 구 전월세 백필 엔진 V3
 *
 * 부산의 검증된 전월세 수집 엔진(rent-history-logic, rent-group-guard-logic, rent-completeness-logic)을
 * 100% 재사용하여 서울 25개 구(3개 shard: seoul-a, seoul-b, seoul-c)의 안전한 백필을 지원합니다.
 *
 * 핵심 안전 불변식:
 * 1. Dry-run 기본값 (DB 쓰기 원천 차단)
 * 2. Checkpoint 기반 중단/재개 (Resume) — 이미 완료된 셀은 재호출 생략
 * 3. Option E 그룹 인서트 가드 — 취소/정정/충돌 시 해당 그룹 격리
 * 4. Completeness 검증 — COMPLETE 상태인 셀만 persist 허용 (PARTIAL/INVALID 쓰기 금지)
 * 5. Deterministic occurrenceIndex 정렬 부여 — 자연키 중복 방지
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  RawMolitRentItem,
  normalizeMolitRentItemsToRentRows,
  RentRowInput,
} from '../rent-trade-history/rent-history-logic';
import {
  planRentCellWrites,
  RentCellWritePlan,
  RentComparableRow,
} from '../rent-trade-history/rent-group-guard-logic';
import {
  classifyRentCellCompleteness,
  shouldPersistCellRows,
  RentCellStatus,
  CompletenessInput,
} from '../rent-trade-history/rent-completeness-logic';
import {
  resolveRentSyncScope,
  SEOUL_RENT_SYNC_LAWDCDS_A,
  SEOUL_RENT_SYNC_LAWDCDS_B,
  SEOUL_RENT_SYNC_LAWDCDS_C,
  SEOUL_RENT_ALL_25_LAWDCDS,
} from '../../src/lib/sync/rent-sync-scope';

export const SEOUL_DISTRICT_NAMES: Record<string, string> = {
  '11110': '종로구',
  '11140': '중구',
  '11170': '용산구',
  '11200': '성동구',
  '11215': '광진구',
  '11230': '동대문구',
  '11260': '중랑구',
  '11290': '성북구',
  '11305': '강북구',
  '11320': '도봉구',
  '11350': '노원구',
  '11380': '은평구',
  '11410': '서대문구',
  '11440': '마포구',
  '11470': '양천구',
  '11500': '강서구',
  '11530': '구로구',
  '11545': '금천구',
  '11560': '영등포구',
  '11590': '동작구',
  '11620': '관악구',
  '11650': '서초구',
  '11680': '강남구',
  '11710': '송파구',
  '11740': '강동구',
};

export interface BackfillEngineOptions {
  scope: 'seoul-a' | 'seoul-b' | 'seoul-c' | 'seoul-all' | string[];
  fromYmd: string; // YYYYMM (e.g. '202501')
  toYmd: string;   // YYYYMM (e.g. '202512')
  dryRun?: boolean;
  checkpointPath?: string;
  delayMs?: number;
  maxRetries?: number;
}

export interface CellExecutionRecord {
  cellKey: string; // `${lawdCd}:${dealYmd}`
  lawdCd: string;
  districtName?: string;
  dealYmd: string;
  executionMode: 'DRY_RUN' | 'APPLIED';
  status: RentCellStatus;
  totalCount: number | null;
  collectedCount: number;
  plannedInserts: number;
  skippedGuarded: number;
  unchanged: number;
  reviewDiffCount: number;
  persistedCount: number;
  durationMs: number;
  errorMessage?: string;
  processedAt: string;
}

export interface CheckpointData {
  version: 1;
  scope: string;
  fromYmd: string;
  toYmd: string;
  lastUpdated: string;
  completedCellCount: number;
  totalCellCount: number;
  cells: Record<string, CellExecutionRecord>;
}

export interface RentFetcherResult {
  items: RawMolitRentItem[];
  totalCount: number | null;
  firstPageFailed: boolean;
  anyLaterPageFailed: boolean;
  errorMessage?: string;
}

export interface RentFetcher {
  fetchCell(lawdCd: string, dealYmd: string): Promise<RentFetcherResult>;
}

export interface RentDbStore {
  findExistingRows(lawdCd: string, dealYmd: string): Promise<RentComparableRow[]>;
  persistCellRows(lawdCd: string, dealYmd: string, rows: RentComparableRow[]): Promise<number>;
}

export interface EngineSummary {
  scope: string;
  targetLawdCodes: string[];
  months: string[];
  totalCells: number;
  skippedByCheckpoint: number;
  executedCells: number;
  completedCells: number;
  partialCells: number;
  invalidCells: number;
  emptyValidCells: number;
  totalCollectedRows: number;
  totalPlannedInserts: number;
  totalPersistedRows: number;
  totalGuardedSkipped: number;
  totalUnchangedRows: number;
  totalDurationMs: number;
  dryRun: boolean;
  records: CellExecutionRecord[];
}

/**
 * YYYYMM 범위의 월 리스트 생성 ('202501' ~ '202503' -> ['202501', '202502', '202503'])
 */
export function generateMonthList(fromYmd: string, toYmd: string): string[] {
  const result: string[] = [];
  let curYear = parseInt(fromYmd.slice(0, 4), 10);
  let curMonth = parseInt(fromYmd.slice(4, 6), 10);
  const endYear = parseInt(toYmd.slice(0, 4), 10);
  const endMonth = parseInt(toYmd.slice(4, 6), 10);

  while (curYear < endYear || (curYear === endYear && curMonth <= endMonth)) {
    result.push(`${curYear}${String(curMonth).padStart(2, '0')}`);
    curMonth++;
    if (curMonth > 12) {
      curYear++;
      curMonth = 1;
    }
  }
  return result;
}

/**
 * Raw MOLIT XML 파싱 후 아이템들을 RentComparableRow 형태로 정규화
 * 기존 rent-history-logic.ts의 normalizeMolitRentItemsToRentRows를 재사용
 */
export function normalizeRawMolitRentItems(
  rawItems: RawMolitRentItem[],
  lawdCd: string,
  dealYmd: string
): RentComparableRow[] {
  const normalized = normalizeMolitRentItemsToRentRows(rawItems, lawdCd, dealYmd);
  return normalized.rows as RentComparableRow[];
}

/**
 * 서울 전월세 백필 엔진 클래스
 */
export class SeoulRentBackfillEngine {
  private options: Required<BackfillEngineOptions>;
  private fetcher: RentFetcher;
  private dbStore?: RentDbStore;
  private checkpoint: CheckpointData;

  constructor(
    options: BackfillEngineOptions,
    fetcher: RentFetcher,
    dbStore?: RentDbStore
  ) {
    this.options = {
      scope: options.scope,
      fromYmd: options.fromYmd,
      toYmd: options.toYmd,
      dryRun: options.dryRun ?? true, // 기본값: 안전한 Dry-run
      checkpointPath: options.checkpointPath || path.join(process.cwd(), 'tmp', 'seoul-rent-backfill-checkpoint.json'),
      delayMs: options.delayMs ?? 300,
      maxRetries: options.maxRetries ?? 3,
    };
    this.fetcher = fetcher;
    this.dbStore = dbStore;
    this.checkpoint = this.loadOrCreateCheckpoint();
  }

  private loadOrCreateCheckpoint(): CheckpointData {
    const cpPath = this.options.checkpointPath;
    if (fs.existsSync(cpPath)) {
      try {
        const raw = fs.readFileSync(cpPath, 'utf-8');
        return JSON.parse(raw) as CheckpointData;
      } catch (err) {
        console.warn(`[Checkpoint] Failed to parse existing checkpoint at ${cpPath}. Creating backup and new.`);
        try {
          const corruptBackup = `${cpPath}.corrupt.${Date.now()}`;
          fs.renameSync(cpPath, corruptBackup);
        } catch {}
      }
    }
    return {
      version: 1,
      scope: Array.isArray(this.options.scope) ? this.options.scope.join(',') : this.options.scope,
      fromYmd: this.options.fromYmd,
      toYmd: this.options.toYmd,
      lastUpdated: new Date().toISOString(),
      completedCellCount: 0,
      totalCellCount: 0,
      cells: {},
    };
  }

  private saveCheckpoint(): void {
    const cpPath = this.options.checkpointPath;
    try {
      const dir = path.dirname(cpPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.checkpoint.lastUpdated = new Date().toISOString();
      let completed = 0;
      for (const c of Object.values(this.checkpoint.cells)) {
        if (c.status === 'EMPTY_VALID' || (c.status === 'COMPLETE' && (c.executionMode === 'APPLIED' || c.plannedInserts === 0))) {
          completed++;
        }
      }
      this.checkpoint.completedCellCount = completed;
      // 원자적 파일 쓰기: 임시 파일 생성 후 rename 교체로 프로세스 강제 중단 시 파일 손상 방지
      const tmpPath = `${cpPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.checkpoint, null, 2), 'utf-8');
      fs.renameSync(tmpPath, cpPath);
    } catch (err) {
      console.warn(`[Checkpoint] Warning: Failed to write checkpoint to ${cpPath}`, err);
    }
  }

  /**
   * Checkpoint 스킵 적격성 판정:
   * - Dry-run 모드에서는 DRY_RUN 또는 APPLIED로 이미 수집 검증된 셀이면 스킵
   * - Apply 모드에서는 실제 DB 적재(APPLIED)가 완료된 셀만 스킵!
   *   (DRY_RUN으로만 완료되었거나 실제 DB에 미적재된 셀은 스킵하지 않고 실제 DB 적재를 수행)
   */
  public isCellEligibleForSkip(existingCp?: CellExecutionRecord, isDryRun: boolean = true): boolean {
    if (!existingCp) return false;
    if (existingCp.status === 'EMPTY_VALID') return true;
    if (existingCp.status !== 'COMPLETE') return false;

    if (isDryRun) {
      return true;
    } else {
      return existingCp.executionMode === 'APPLIED' && (existingCp.persistedCount > 0 || existingCp.plannedInserts === 0);
    }
  }

  public resolveTargetLawdCodes(): { lawdCd: string; name?: string }[] {
    const scope = this.options.scope;
    if (Array.isArray(scope)) {
      return scope.map((code) => ({
        lawdCd: code,
        name: SEOUL_DISTRICT_NAMES[code] || undefined,
      }));
    }

    if (scope === 'seoul-all') {
      return SEOUL_RENT_ALL_25_LAWDCDS.map((code) => ({
        lawdCd: code,
        name: SEOUL_DISTRICT_NAMES[code] || undefined,
      }));
    }

    const resolved = resolveRentSyncScope(scope as 'seoul-a' | 'seoul-b' | 'seoul-c');
    if (resolved.ok && resolved.lawdCds) {
      return resolved.lawdCds.map((code) => ({
        lawdCd: code,
        name: SEOUL_DISTRICT_NAMES[code] || undefined,
      }));
    }

    return [];
  }

  /**
   * 단일 셀(lawdCd + dealYmd) 처리
   */
  public async executeCell(lawdCd: string, dealYmd: string, districtName?: string): Promise<CellExecutionRecord> {
    const startTime = Date.now();
    const cellKey = `${lawdCd}:${dealYmd}`;

    // Checkpoint 확인 (Dry-run과 Apply의 스킵 적격성 엄격 분리)
    const existingCp = this.checkpoint.cells[cellKey];
    if (this.isCellEligibleForSkip(existingCp, this.options.dryRun)) {
      return existingCp;
    }

    try {
      // 1. MOLIT API Fetch (Pagination 포함)
      const fetchResult = await this.fetcher.fetchCell(lawdCd, dealYmd);

      // 2. Completeness 판정
      const completenessInput: CompletenessInput = {
        firstPageFailed: fetchResult.firstPageFailed,
        totalCount: fetchResult.totalCount,
        collectedCount: fetchResult.items.length,
        anyLaterPageFailed: fetchResult.anyLaterPageFailed,
      };
      const status = classifyRentCellCompleteness(completenessInput);

      const executionMode = this.options.dryRun ? 'DRY_RUN' : 'APPLIED';

      if (status === 'EMPTY_VALID') {
        const record: CellExecutionRecord = {
          cellKey,
          lawdCd,
          districtName,
          dealYmd,
          executionMode,
          status: 'EMPTY_VALID',
          totalCount: 0,
          collectedCount: 0,
          plannedInserts: 0,
          skippedGuarded: 0,
          unchanged: 0,
          reviewDiffCount: 0,
          persistedCount: 0,
          durationMs: Date.now() - startTime,
          processedAt: new Date().toISOString(),
        };
        this.checkpoint.cells[cellKey] = record;
        this.saveCheckpoint();
        return record;
      }

      if (status !== 'COMPLETE') {
        const record: CellExecutionRecord = {
          cellKey,
          lawdCd,
          districtName,
          dealYmd,
          executionMode,
          status,
          totalCount: fetchResult.totalCount,
          collectedCount: fetchResult.items.length,
          plannedInserts: 0,
          skippedGuarded: 0,
          unchanged: 0,
          reviewDiffCount: 0,
          persistedCount: 0,
          errorMessage: fetchResult.errorMessage || `Cell incomplete status: ${status}`,
          durationMs: Date.now() - startTime,
          processedAt: new Date().toISOString(),
        };
        this.checkpoint.cells[cellKey] = record;
        this.saveCheckpoint();
        return record;
      }

      // 3. COMPLETE 상태: 정규화 및 occurrenceIndex 부여
      const sourceRows = normalizeRawMolitRentItems(fetchResult.items, lawdCd, dealYmd);

      // 4. DB 기존 데이터 조회 및 Group Guard 판정
      let existingRows: RentComparableRow[] = [];
      if (this.dbStore) {
        existingRows = await this.dbStore.findExistingRows(lawdCd, dealYmd);
      }

      const plan: RentCellWritePlan<RentComparableRow, RentComparableRow> = planRentCellWrites(
        sourceRows,
        existingRows
      );

      // 5. DB 쓰기 실행 (dryRun이 false이고 shouldPersistCellRows가 true일 때만)
      let persistedCount = 0;
      if (!this.options.dryRun && this.dbStore && shouldPersistCellRows(status)) {
        if (plan.inserts.length > 0) {
          persistedCount = await this.dbStore.persistCellRows(lawdCd, dealYmd, plan.inserts);
        }
      }

      const record: CellExecutionRecord = {
        cellKey,
        lawdCd,
        districtName,
        dealYmd,
        executionMode,
        status: 'COMPLETE',
        totalCount: fetchResult.totalCount,
        collectedCount: sourceRows.length,
        plannedInserts: plan.inserts.length,
        skippedGuarded: plan.skippedInserts.length,
        unchanged: plan.unchanged,
        reviewDiffCount: plan.reviewCandidateFieldCount,
        persistedCount,
        durationMs: Date.now() - startTime,
        processedAt: new Date().toISOString(),
      };

      this.checkpoint.cells[cellKey] = record;
      this.saveCheckpoint();
      return record;
    } catch (err: any) {
      const record: CellExecutionRecord = {
        cellKey,
        lawdCd,
        districtName,
        dealYmd,
        executionMode: this.options.dryRun ? 'DRY_RUN' : 'APPLIED',
        status: 'INVALID',
        totalCount: null,
        collectedCount: 0,
        plannedInserts: 0,
        skippedGuarded: 0,
        unchanged: 0,
        reviewDiffCount: 0,
        persistedCount: 0,
        errorMessage: err?.message || String(err),
        durationMs: Date.now() - startTime,
        processedAt: new Date().toISOString(),
      };
      this.checkpoint.cells[cellKey] = record;
      this.saveCheckpoint();
      return record;
    }
  }

  /**
   * 전체 스코프 백필 실행
   */
  public async run(): Promise<EngineSummary> {
    const startTime = Date.now();
    const targets = this.resolveTargetLawdCodes();
    const months = generateMonthList(this.options.fromYmd, this.options.toYmd);
    const totalCells = targets.length * months.length;

    this.checkpoint.totalCellCount = totalCells;

    const records: CellExecutionRecord[] = [];
    let skippedByCheckpoint = 0;
    let completedCells = 0;
    let partialCells = 0;
    let invalidCells = 0;
    let emptyValidCells = 0;
    let totalCollectedRows = 0;
    let totalPlannedInserts = 0;
    let totalPersistedRows = 0;
    let totalGuardedSkipped = 0;
    let totalUnchangedRows = 0;

    for (const district of targets) {
      for (const ymd of months) {
        const cellKey = `${district.lawdCd}:${ymd}`;
        const existingCp = this.checkpoint.cells[cellKey];
        if (this.isCellEligibleForSkip(existingCp, this.options.dryRun)) {
          skippedByCheckpoint++;
          records.push(existingCp);
          if (existingCp.status === 'COMPLETE') completedCells++;
          if (existingCp.status === 'EMPTY_VALID') emptyValidCells++;
          totalCollectedRows += existingCp.collectedCount;
          totalPlannedInserts += existingCp.plannedInserts;
          totalPersistedRows += existingCp.persistedCount;
          totalGuardedSkipped += existingCp.skippedGuarded;
          totalUnchangedRows += existingCp.unchanged;
          continue;
        }

        // Pacing delay (MOLIT rate limit 보호)
        if (this.options.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
        }

        const rec = await this.executeCell(district.lawdCd, ymd, district.name);
        records.push(rec);

        if (rec.status === 'COMPLETE') completedCells++;
        else if (rec.status === 'EMPTY_VALID') emptyValidCells++;
        else if (rec.status === 'PARTIAL') partialCells++;
        else invalidCells++;

        totalCollectedRows += rec.collectedCount;
        totalPlannedInserts += rec.plannedInserts;
        totalPersistedRows += rec.persistedCount;
        totalGuardedSkipped += rec.skippedGuarded;
        totalUnchangedRows += rec.unchanged;
      }
    }

    return {
      scope: Array.isArray(this.options.scope) ? this.options.scope.join(',') : this.options.scope,
      targetLawdCodes: targets.map((t) => t.lawdCd),
      months,
      totalCells,
      skippedByCheckpoint,
      executedCells: totalCells - skippedByCheckpoint,
      completedCells,
      partialCells,
      invalidCells,
      emptyValidCells,
      totalCollectedRows,
      totalPlannedInserts,
      totalPersistedRows,
      totalGuardedSkipped,
      totalUnchangedRows,
      totalDurationMs: Date.now() - startTime,
      dryRun: this.options.dryRun,
      records,
    };
  }
}
