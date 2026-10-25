// SELLFLOW_DATA_API_V1 — 건물 검색 / 거래 조회 / 요약의 **오케스트레이션**. DB는 `SellflowDb` 포트로만 만난다(테스트에서 가짜로 바꾼다).
// 쓰기 없음. 실패는 예외로 전파한다 — 어떤 실패도 빈 결과로 바꾸지 않는다(거래 0건과 수집/조회 실패는 다른 값).
import {
  SEARCH_MAX_CANDIDATES,
  SUMMARY_MAX_ROWS,
  SellflowApiError,
  buildSummaryStatistics,
  BUILDING_SOURCE,
  computeContentGuidance,
  computeVerification,
  recentMonths,
  transactionSource,
  formatMasterId,
  mapTransaction,
  parseMasterId,
  resultStateFor,
  type ContentGuidance,
  type SourceInfo,
  type Verification,
  type PropertyType,
  type RawTx,
  type ResultState,
  type SearchQuery,
  type SummaryStatistics,
  type TransactionDto,
  type TransactionsQuery,
  type WindowQuery,
} from './contract';

// ------------------------------------------------------------------ port
export type MasterMatchStatus = 'MATCHED' | 'UNRESOLVED';
export type UnresolvedReason = 'MULTI_MASTER_ADDRESS' | 'NO_HISTORY_KEY' | null;

/** 어댑터가 두 master 테이블을 이 모양으로 맞춰 준다. */
export interface MasterRow {
  propertyType: PropertyType;
  /** apartment: aptSeq, officetel: 숫자 id. */
  key: string | number;
  name: string | null;
  normalizedName: string;
  lawdCd: string;
  sigungu: string | null;
  dong: string | null;
  jibun: string | null;
  buildingDong: string | null;
  roadAddress: string | null;
  jibunAddress: string | null;
  buildYear: number | null;
  unitCount: number | null;
  unitCountBasis: 'households' | 'ho' | null;
  /** 같은 지번에 등록된 master 수(오피스텔). 2 이상이면 거래를 동별로 귀속할 수 없다. */
  mastersAtAddress: number;
  /** 오피스텔: 거래 이력 키를 만들 수 있는가. */
  historyKeyOk: boolean;
}

export interface TxFilter {
  master: MasterRow;
  window: WindowQuery;
  includeCanceled: boolean;
}

export interface SellflowDb {
  searchMasters(input: { propertyType: PropertyType; lawdCd: string; dong: string | null; qNormalized: string | null; take: number }): Promise<MasterRow[]>;
  getMaster(parsed: ReturnType<typeof parseMasterId>): Promise<MasterRow | null>;
  listTransactions(filter: TxFilter, skip: number, take: number): Promise<{ rows: RawTx[]; total: number }>;
  listForSummary(filter: TxFilter, maxRows: number): Promise<{ rows: RawTx[]; overflow: boolean; canceledExcluded: number | null }>;
  /** 검증된 달만. 키는 YYYY-MM, 값은 마지막 검증 시각(ISO). */
  getVerifiedMonths(input: { propertyType: PropertyType; transactionType: WindowQuery['transactionType']; lawdCd: string; months: string[] }): Promise<Record<string, string>>;
  /** 같은 주소에 master에 연결되지 않은 거래 수(오피스텔). */
  countUnattributed(master: MasterRow, transactionType: WindowQuery['transactionType']): Promise<number>;
}

// ------------------------------------------------------------------ mapping
export interface BuildingDto {
  masterId: string | null;
  propertyType: PropertyType;
  name: string | null;
  masterMatchStatus: MasterMatchStatus;
  unresolvedReason: UnresolvedReason;
  location: {
    lawdCd: string;
    sigungu: string | null;
    dong: string | null;
    jibun: string | null;
    buildingDong: string | null;
    roadAddress: string | null;
    jibunAddress: string | null;
  };
  buildYear: number | null;
  unitCount: number | null;
  unitCountBasis: 'households' | 'ho' | null;
}

export function matchStatusOf(m: MasterRow): { status: MasterMatchStatus; reason: UnresolvedReason } {
  if (m.propertyType === 'officetel') {
    if (!m.historyKeyOk) return { status: 'UNRESOLVED', reason: 'NO_HISTORY_KEY' };
    // 같은 지번에 master가 둘 이상이면 원천이 동을 구분해 주지 않아 거래가 어느 master에도 연결되지 않는다(연결 규칙: master가 정확히 1건일 때만).
    if (m.mastersAtAddress > 1) return { status: 'UNRESOLVED', reason: 'MULTI_MASTER_ADDRESS' };
  }
  return { status: 'MATCHED', reason: null };
}

export function mapBuilding(m: MasterRow): BuildingDto {
  const { status, reason } = matchStatusOf(m);
  return {
    masterId: formatMasterId(m.propertyType, m.key),
    propertyType: m.propertyType,
    name: m.name,
    masterMatchStatus: status,
    unresolvedReason: reason,
    location: {
      lawdCd: m.lawdCd,
      sigungu: m.sigungu,
      dong: m.dong,
      jibun: m.jibun,
      buildingDong: m.buildingDong,
      roadAddress: m.roadAddress,
      jibunAddress: m.jibunAddress,
    },
    buildYear: m.buildYear,
    unitCount: m.unitCount,
    unitCountBasis: m.unitCountBasis,
  };
}

// ------------------------------------------------------------------ search
function matchRank(normalizedName: string, q: string | null): number {
  if (q === null) return 3;
  const n = normalizedName.toLowerCase();
  const t = q.toLowerCase();
  if (n === t) return 0;
  if (n.startsWith(t)) return 1;
  return n.includes(t) ? 2 : 3;
}

export interface SearchResult {
  data: { items: BuildingDto[]; truncated: boolean; query: { lawdCd: string; dong: string | null; q: string | null; propertyTypes: PropertyType[]; limit: number } };
  rowCount: number;
}

export async function searchBuildings(query: SearchQuery, db: SellflowDb): Promise<SearchResult> {
  const lists = await Promise.all(
    query.propertyTypes.map((propertyType) =>
      db.searchMasters({ propertyType, lawdCd: query.lawdCd, dong: query.dong, qNormalized: query.qNormalized, take: SEARCH_MAX_CANDIDATES + 1 }),
    ),
  );
  let overflow = false;
  const pool: MasterRow[] = [];
  for (const l of lists) {
    if (l.length > SEARCH_MAX_CANDIDATES) overflow = true;
    pool.push(...l.slice(0, SEARCH_MAX_CANDIDATES));
  }
  pool.sort(
    (a, b) =>
      matchRank(a.normalizedName, query.qNormalized) - matchRank(b.normalizedName, query.qNormalized) ||
      (a.name ?? '').localeCompare(b.name ?? '', 'ko') ||
      String(a.key).localeCompare(String(b.key)),
  );
  const items = pool.slice(0, query.limit).map(mapBuilding);
  return {
    data: {
      items,
      truncated: overflow || pool.length > query.limit,
      query: { lawdCd: query.lawdCd, dong: query.dong, q: query.q, propertyTypes: query.propertyTypes, limit: query.limit },
    },
    rowCount: items.length,
  };
}

// ------------------------------------------------------------------ shared
async function loadMaster(masterIdRaw: string, allowed: PropertyType[], db: SellflowDb): Promise<MasterRow> {
  const parsed = parseMasterId(masterIdRaw);
  if (!allowed.includes(parsed.propertyType)) throw new SellflowApiError(403, 'FORBIDDEN', '이 키로 조회할 수 없는 유형입니다.');
  const master = await db.getMaster(parsed);
  if (!master) throw new SellflowApiError(404, 'MASTER_NOT_FOUND', '해당 건물을 찾을 수 없습니다.');
  return master;
}

async function verificationFor(master: MasterRow, window: WindowQuery, db: SellflowDb, now: Date): Promise<Verification> {
  const recent = recentMonths(now);
  const months = Array.from(new Set([...window.months, ...recent]));
  const verified = await db.getVerifiedMonths({ propertyType: master.propertyType, transactionType: window.transactionType, lawdCd: master.lawdCd, months });
  return computeVerification(window.months, recent, verified, now);
}

interface Sources {
  transactions: SourceInfo;
  building: SourceInfo;
}
const sourcesFor = (m: MasterRow, tt: WindowQuery['transactionType']): Sources => ({ transactions: transactionSource(m.propertyType, tt), building: BUILDING_SOURCE });

const echoWindow = (w: WindowQuery) => ({
  transactionType: w.transactionType,
  fromMonth: w.fromMonth,
  toMonth: w.toMonth,
  minArea: w.minArea,
  maxArea: w.maxArea,
});

/** 오피스텔 매매·전월세 모두 master에 연결된 거래만 읽는다. 귀속 불가 주소는 읽지 않고 건수만 센다. */
function unattributedNote(count: number): { unattributedAtAddressCount: number; note: string } {
  return { unattributedAtAddressCount: count, note: '같은 지번에 여러 동이 등록돼 원천이 동을 구분하지 않으므로, 이 주소의 거래는 어느 건물에도 귀속하지 않았습니다.' };
}

// ------------------------------------------------------------------ transactions
export interface TransactionsResult {
  data: {
    building: BuildingDto;
    query: ReturnType<typeof echoWindow> & { includeCanceled: boolean };
    resultState: ResultState;
    items: TransactionDto[];
    pagination: { page: number; pageSize: number; totalItems: number; totalPages: number; hasMore: boolean };
    verification: Verification;
    sources: Sources;
    unattributed: { unattributedAtAddressCount: number; note: string } | null;
  };
  asOf: string;
  rowCount: number;
}

export async function getTransactions(masterIdRaw: string, query: TransactionsQuery, allowed: PropertyType[], db: SellflowDb, now: Date): Promise<TransactionsResult> {
  const master = await loadMaster(masterIdRaw, allowed, db);
  const building = mapBuilding(master);
  const verification = await verificationFor(master, query, db, now);
  const sources = sourcesFor(master, query.transactionType);
  const echo = { ...echoWindow(query), includeCanceled: query.includeCanceled };

  const match = matchStatusOf(master);
  if (match.status === 'UNRESOLVED') {
    // 이 master에 연결된 거래가 없다. 같은 주소의 미연결 거래를 이 건물 것으로 내보내지 않는다.
    const count = await db.countUnattributed(master, query.transactionType);
    return {
      data: {
        building,
        query: echo,
        resultState: 'UNATTRIBUTED_AT_ADDRESS',
        items: [],
        pagination: { page: query.page, pageSize: query.pageSize, totalItems: 0, totalPages: 0, hasMore: false },
        verification,
        sources,
        unattributed: unattributedNote(count),
      },
      asOf: now.toISOString(),
      rowCount: 0,
    };
  }

  const masterId = building.masterId as string;
  const { rows, total } = await db.listTransactions({ master, window: query, includeCanceled: query.includeCanceled }, (query.page - 1) * query.pageSize, query.pageSize);
  const items = rows.map((r) => mapTransaction(r, { propertyType: master.propertyType, masterId, transactionType: query.transactionType }));
  const totalPages = Math.ceil(total / query.pageSize);
  return {
    data: {
      building,
      query: echo,
      resultState: resultStateFor(total, verification, false),
      items,
      pagination: { page: query.page, pageSize: query.pageSize, totalItems: total, totalPages, hasMore: query.page < totalPages },
      verification,
      sources,
      unattributed: null,
    },
    asOf: now.toISOString(),
    rowCount: items.length,
  };
}

// ------------------------------------------------------------------ summary
export interface SummaryResult {
  data: {
    building: BuildingDto;
    period: { fromMonth: string; toMonth: string };
    query: ReturnType<typeof echoWindow>;
    resultState: ResultState;
    statistics: SummaryStatistics;
    verification: Verification;
    sources: Sources;
    contentGuidance: ContentGuidance;
    masterMatchStatus: MasterMatchStatus;
    unattributed: { unattributedAtAddressCount: number; note: string } | null;
  };
  asOf: string;
  rowCount: number;
}

export async function getSummary(masterIdRaw: string, query: WindowQuery, allowed: PropertyType[], db: SellflowDb, now: Date): Promise<SummaryResult> {
  const master = await loadMaster(masterIdRaw, allowed, db);
  const building = mapBuilding(master);
  const verification = await verificationFor(master, query, db, now);
  const sources = sourcesFor(master, query.transactionType);
  const match = matchStatusOf(master);

  if (match.status === 'UNRESOLVED') {
    const count = await db.countUnattributed(master, query.transactionType);
    const emptyStats = buildSummaryStatistics([], query.transactionType, null);
    return {
      data: {
        building,
        period: { fromMonth: query.fromMonth, toMonth: query.toMonth },
        query: echoWindow(query),
        resultState: 'UNATTRIBUTED_AT_ADDRESS',
        statistics: emptyStats,
        verification,
        sources,
        contentGuidance: computeContentGuidance({ matched: false, sampleStatus: emptyStats.sampleStatus, distinctAreaCount: 0, verification }),
        masterMatchStatus: 'UNRESOLVED',
        unattributed: unattributedNote(count),
      },
      asOf: now.toISOString(),
      rowCount: 0,
    };
  }

  const { rows, overflow, canceledExcluded } = await db.listForSummary({ master, window: query, includeCanceled: false }, SUMMARY_MAX_ROWS);
  if (overflow) {
    throw new SellflowApiError(400, 'RANGE_TOO_LARGE', `조건에 맞는 거래가 ${SUMMARY_MAX_ROWS}건을 넘어 통계를 만들 수 없습니다. 기간이나 면적 범위를 좁혀 주세요.`);
  }
  const statistics = buildSummaryStatistics(rows, query.transactionType, canceledExcluded);
  return {
    data: {
      building,
      period: { fromMonth: query.fromMonth, toMonth: query.toMonth },
      query: echoWindow(query),
      resultState: resultStateFor(rows.length, verification, false),
      statistics,
      verification,
      sources,
      contentGuidance: computeContentGuidance({ matched: true, sampleStatus: statistics.sampleStatus, distinctAreaCount: statistics.distinctAreaCount, verification }),
      masterMatchStatus: 'MATCHED',
      unattributed: null,
    },
    asOf: now.toISOString(),
    rowCount: rows.length,
  };
}
