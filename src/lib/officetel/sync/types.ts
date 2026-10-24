// OFFICETEL_INCREMENTAL_SYNC_V1 — 오피스텔 증분 sync 공통 타입. 순수 타입 모듈(부작용 없음).

export type OfficetelSyncDataset = 'OFFICETEL_SALE' | 'OFFICETEL_RENT';
export type OfficetelCellStatus = 'COMPLETE' | 'PARTIAL' | 'INVALID';
export type OfficetelFailureReason = 'API_ERROR' | 'TIMEOUT' | 'QUOTA' | 'PARSE_ERROR' | 'DB_ERROR' | 'PARTIAL_PAGINATION';
export type OfficetelSyncMode = 'dry-run' | 'apply';

/** 한 셀 = 데이터셋 × 구 × 계약월. */
export interface OfficetelCellKey {
  dataset: OfficetelSyncDataset;
  lawdCd: string;
  dealYmd: string;
}

/** 원천 응답 한 행(XML 태그 -> 문자열). 값은 파싱하지 않은 원본이다. */
export type RawOfficetelRow = Record<string, unknown>;

export interface MasterRef {
  id: number;
  sggCd: string;
  normalizedUmdNm: string;
  normalizedJibun: string;
}

/** createMany에 그대로 들어가는 공통 필드. exclusiveArea는 원본 문자열(Decimal 변환은 DB 어댑터가 한다). */
export interface PreparedCommon {
  source: string;
  officetelMasterId: number | null;
  canonicalKey: string;
  lawdCd: string;
  dealYmd: string;
  umdNm: string;
  jibun: string;
  offiNm: string;
  exclusiveArea: string;
  dealYear: number;
  dealMonth: number;
  dealDay: number;
  /** YYYY-MM-DD */
  dealDate: string;
  floor: number;
  buildYear: number | null;
  occurrenceIndex: number;
  sourceFetchedAt: Date;
}

export interface PreparedSale extends PreparedCommon {
  dealAmount: number;
  dealingGbn: string | null;
  buyerGbn: string | null;
  sellerGbn: string | null;
  estateAgentSggNm: string | null;
  dealCanceled: boolean;
  cancelDate: string | null;
}

export interface PreparedRent extends PreparedCommon {
  deposit: number;
  monthlyRent: number;
  contractTerm: string | null;
  contractType: string | null;
  preDeposit: number | null;
  preMonthlyRent: number | null;
  useRenewalRight: boolean | null;
}

/** 기존 DB 행에서 자연키 비교와 취소 대조에 필요한 필드만. */
export interface ExistingSaleRow {
  id: number;
  canonicalKey: string;
  dealDate: Date;
  exclusiveArea: string;
  dealAmount: number;
  floor: number;
  occurrenceIndex: number;
  dealCanceled: boolean;
}

export interface ExistingRentRow {
  canonicalKey: string;
  dealDate: Date;
  exclusiveArea: string;
  deposit: number;
  monthlyRent: number;
  floor: number;
  occurrenceIndex: number;
}

export interface SaleCancelUpdate {
  id: number;
  cancelDate: string | null;
  sourceFetchedAt: Date;
}

/** officetel_sync_cells 한 행에 기록되는 값. */
export interface OfficetelCellRecord extends OfficetelCellKey {
  status: OfficetelCellStatus;
  failureReason: OfficetelFailureReason | null;
  sourceTotalCount: number | null;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  duplicateCount: number;
  unresolvedCount: number;
  invalidRowCount: number;
  runId: string;
  attemptedAt: Date;
  /** COMPLETE일 때만 attemptedAt과 같고, 아니면 null(= 이전 검증 시각을 지우지 않는다). */
  verifiedAt: Date | null;
}

export interface OfficetelCellState {
  lawdCd: string;
  dealYmd: string;
  verifiedAt: Date | null;
}

/** sync core가 쓰는 DB 포트. 운영 구현은 db.ts, 테스트는 메모리 fake. */
export interface OfficetelSyncDb {
  loadMasters(lawdCd: string): Promise<MasterRef[]>;
  loadExistingSale(lawdCd: string, dealYmd: string): Promise<ExistingSaleRow[]>;
  loadExistingRent(lawdCd: string, dealYmd: string): Promise<ExistingRentRow[]>;
  /** skipDuplicates createMany. 실제로 들어간 행 수를 돌려준다. */
  insertSale(rows: PreparedSale[]): Promise<number>;
  insertRent(rows: PreparedRent[]): Promise<number>;
  /** 취소 반영. 행을 삭제하거나 되돌리지 않고 dealCanceled=true / cancelDate만 갱신한다. */
  cancelSale(updates: SaleCancelUpdate[]): Promise<number>;
  loadCellStates(dataset: OfficetelSyncDataset, dealYmds: string[]): Promise<OfficetelCellState[]>;
  recordCell(record: OfficetelCellRecord): Promise<void>;
}
