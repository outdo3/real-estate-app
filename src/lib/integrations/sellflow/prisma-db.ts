// SELLFLOW_DATA_API_V1 — `SellflowDb` 포트의 Prisma 구현. **읽기 전용**(find/count/aggregate/queryRaw SELECT만). 스키마·기존 쿼리 경로는 건드리지 않는다.
//
// 거래를 master에 묶는 방식은 기존 읽기 경로와 동일하다:
//   * 아파트: ApartmentMaster.aptSeq == 거래.aptSeq (이름으로 재식별하지 않는다). 아파트 거래 테이블은 master FK가 없다.
//   * 오피스텔: 거래.canonicalKey(건물 단위 history key) AND 거래.officetelMasterId == master.id (detail/nearby와 같은 범위 조건).
import { prisma } from '@/lib/prisma';
import { buildOfficetelHistoryKey } from '@/lib/officetel/identity';
import { officetelDisplayName } from '@/lib/officetel/detail-contract';
import { toYmd, type RawTx, type TransactionType } from './contract';
import type { MasterRow, SellflowDb, TxFilter } from './service';

const dec = (v: unknown): number => Number(v);
const day = (d: Date): string => d.toISOString().slice(0, 10);
const dateOnly = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
const ymFromYmd = (ymd: string): string => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}`;

const SALE_SELECT = {
  dealDate: true, dealAmount: true, exclusiveArea: true, floor: true, dealCanceled: true, cancelDate: true, sourceFetchedAt: true,
} as const;

// ------------------------------------------------------------------ masters
type AptMasterDb = Awaited<ReturnType<typeof prisma.apartmentMaster.findFirst>>;
type OffiMasterDb = Awaited<ReturnType<typeof prisma.officetelMaster.findFirst>>;

function aptRow(m: NonNullable<AptMasterDb>): MasterRow {
  // 좌표(latitude/longitude)는 SELLFLOW 계약에 포함하지 않는다(Kakao 좌표의 서비스 간 재제공 조건 미확정).
  return {
    propertyType: 'apartment',
    key: m.aptSeq as string,
    name: m.name,
    normalizedName: m.normalizedName,
    lawdCd: m.sggCd ?? '',
    sigungu: m.sigungu,
    dong: m.umdName,
    jibun: m.jibun,
    buildingDong: null,
    roadAddress: m.roadAddress,
    jibunAddress: m.jibunAddress,
    buildYear: m.buildYear,
    unitCount: m.totalHouseholds,
    unitCountBasis: m.totalHouseholds != null ? 'households' : null,
    mastersAtAddress: 1,
    historyKeyOk: true,
  };
}

function offiRow(m: NonNullable<OffiMasterDb>, mastersAtAddress: number): MasterRow {
  return {
    propertyType: 'officetel',
    key: m.id,
    // 표시명이 없는 master(약 7.7%)는 이름을 지어내지 않고 null로 낸다.
    name: officetelDisplayName(m.officetelName) as string | null,
    normalizedName: m.normalizedName,
    lawdCd: m.sggCd,
    sigungu: null,
    dong: m.umdNm,
    jibun: m.jibun,
    buildingDong: m.buildingDong,
    roadAddress: m.roadAddress,
    jibunAddress: null,
    buildYear: m.buildYear,
    unitCount: m.hoCnt,
    unitCountBasis: m.hoCnt != null ? 'ho' : null,
    mastersAtAddress,
    historyKeyOk: buildOfficetelHistoryKey({ sggCd: m.sggCd, umdNm: m.umdNm, jibun: m.jibun }).ok,
  };
}

async function mastersAtAddressMap(rows: { sggCd: string; umdNm: string; jibun: string }[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (rows.length === 0) return map;
  const uniq = new Map(rows.map((r) => [`${r.sggCd}|${r.umdNm}|${r.jibun}`, r]));
  const groups = await prisma.officetelMaster.groupBy({
    by: ['sggCd', 'umdNm', 'jibun'],
    where: { OR: Array.from(uniq.values()).map((r) => ({ sggCd: r.sggCd, umdNm: r.umdNm, jibun: r.jibun })) },
    _count: { _all: true },
  });
  for (const g of groups) map.set(`${g.sggCd}|${g.umdNm}|${g.jibun}`, g._count._all);
  return map;
}

// ------------------------------------------------------------------ transactions
function dealDateWhere(w: TxFilter['window']) {
  return { gte: dateOnly(w.dateFrom), lt: dateOnly(w.dateToExclusive) };
}
function areaWhere(w: TxFilter['window']) {
  if (w.minArea === null && w.maxArea === null) return {};
  return { exclusiveArea: { ...(w.minArea !== null ? { gte: w.minArea } : {}), ...(w.maxArea !== null ? { lte: w.maxArea } : {}) } };
}

type Scope = { kind: 'apt-sale' | 'apt-rent' | 'offi-sale' | 'offi-rent'; where: Record<string, unknown> };

function scopeFor(f: TxFilter, forCancelCount = false): Scope {
  const { master, window: w } = f;
  const common = { dealDate: dealDateWhere(w), ...areaWhere(w) };
  const tt: TransactionType = w.transactionType;
  if (master.propertyType === 'apartment') {
    if (tt === 'sale') {
      const canceled = forCancelCount ? { dealCanceled: true } : f.includeCanceled ? {} : { dealCanceled: false };
      return { kind: 'apt-sale', where: { aptSeq: String(master.key), dealType: 'sale', ...canceled, ...common } };
    }
    return { kind: 'apt-rent', where: { aptSeq: String(master.key), dealType: tt, ...common } };
  }
  const key = buildOfficetelHistoryKey({ sggCd: master.lawdCd, umdNm: master.dong ?? '', jibun: master.jibun ?? '' });
  // 키를 만들 수 없으면 서비스 계층이 이미 UNRESOLVED로 걸러 여기 오지 않는다. 그래도 도달하면 아무것도 매칭하지 않는 조건을 둔다.
  const scope = { canonicalKey: key.ok ? key.key : '\u0000', officetelMasterId: Number(master.key) };
  if (tt === 'sale') {
    const canceled = forCancelCount ? { dealCanceled: true } : f.includeCanceled ? {} : { dealCanceled: false };
    return { kind: 'offi-sale', where: { ...scope, ...canceled, ...common } };
  }
  return { kind: 'offi-rent', where: { ...scope, monthlyRent: tt === 'wolse' ? { gt: 0 } : 0, ...common } };
}

const ORDER = [{ dealDate: 'desc' as const }, { id: 'desc' as const }];

function saleRaw(r: { dealDate: Date; dealAmount: number; exclusiveArea: unknown; floor: number | null; dealCanceled: boolean; cancelDate: string | null; sourceFetchedAt: Date }): RawTx {
  return {
    dealDate: day(r.dealDate), price: r.dealAmount, deposit: null, monthlyRent: null, exclusiveArea: dec(r.exclusiveArea), floor: r.floor,
    dealCanceled: r.dealCanceled, cancelDateRaw: r.cancelDate, contractType: null, sourceFetchedAt: r.sourceFetchedAt.toISOString(),
  };
}
function rentRaw(r: { dealDate: Date; deposit: number; monthlyRent: number; exclusiveArea: unknown; floor: number | null; contractType: string | null; sourceFetchedAt: Date }): RawTx {
  return {
    dealDate: day(r.dealDate), price: null, deposit: r.deposit, monthlyRent: r.monthlyRent, exclusiveArea: dec(r.exclusiveArea), floor: r.floor,
    dealCanceled: null, cancelDateRaw: null, contractType: r.contractType, sourceFetchedAt: r.sourceFetchedAt.toISOString(),
  };
}

const RENT_SELECT = { dealDate: true, deposit: true, monthlyRent: true, exclusiveArea: true, floor: true, contractType: true, sourceFetchedAt: true } as const;

async function fetchRows(scope: Scope, skip: number, take: number): Promise<RawTx[]> {
  const base = { where: scope.where, orderBy: ORDER, skip, take };
  switch (scope.kind) {
    case 'apt-sale': return (await prisma.apartmentTradeHistory.findMany({ ...base, select: SALE_SELECT })).map(saleRaw);
    case 'offi-sale': return (await prisma.officetelTradeHistory.findMany({ ...base, select: SALE_SELECT })).map(saleRaw);
    case 'apt-rent': return (await prisma.apartmentRentHistory.findMany({ ...base, select: RENT_SELECT })).map(rentRaw);
    case 'offi-rent': return (await prisma.officetelRentHistory.findMany({ ...base, select: RENT_SELECT })).map(rentRaw);
  }
}

async function countRows(scope: Scope): Promise<number> {
  switch (scope.kind) {
    case 'apt-sale': return prisma.apartmentTradeHistory.count({ where: scope.where });
    case 'offi-sale': return prisma.officetelTradeHistory.count({ where: scope.where });
    case 'apt-rent': return prisma.apartmentRentHistory.count({ where: scope.where });
    case 'offi-rent': return prisma.officetelRentHistory.count({ where: scope.where });
  }
}

export const prismaSellflowDb: SellflowDb = {
  async searchMasters({ propertyType, lawdCd, dong, qNormalized, take }) {
    if (propertyType === 'apartment') {
      const rows = await prisma.apartmentMaster.findMany({
        where: {
          sggCd: lawdCd,
          aptSeq: { not: null },
          ...(dong ? { umdName: dong } : {}),
          ...(qNormalized ? { normalizedName: { contains: qNormalized, mode: 'insensitive' as const } } : {}),
        },
        orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
        take,
      });
      return rows.map(aptRow);
    }
    const rows = await prisma.officetelMaster.findMany({
      where: {
        sggCd: lawdCd,
        ...(dong ? { umdNm: dong } : {}),
        ...(qNormalized ? { normalizedName: { contains: qNormalized, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ normalizedName: 'asc' }, { id: 'asc' }],
      take,
    });
    const counts = await mastersAtAddressMap(rows);
    return rows.map((m) => offiRow(m, counts.get(`${m.sggCd}|${m.umdNm}|${m.jibun}`) ?? 1));
  },

  async getMaster(parsed) {
    if (parsed.propertyType === 'apartment') {
      const m = await prisma.apartmentMaster.findUnique({ where: { aptSeq: parsed.aptSeq } });
      return m ? aptRow(m) : null;
    }
    const m = await prisma.officetelMaster.findUnique({ where: { id: parsed.id } });
    if (!m) return null;
    const counts = await mastersAtAddressMap([m]);
    return offiRow(m, counts.get(`${m.sggCd}|${m.umdNm}|${m.jibun}`) ?? 1);
  },

  async listTransactions(filter, skip, take) {
    const scope = scopeFor(filter);
    const [rows, total] = await Promise.all([fetchRows(scope, skip, take), countRows(scope)]);
    return { rows, total };
  },

  async listForSummary(filter, maxRows) {
    const scope = scopeFor({ ...filter, includeCanceled: false });
    const rows = await fetchRows(scope, 0, maxRows + 1);
    const overflow = rows.length > maxRows;
    const canceledExcluded = filter.window.transactionType === 'sale' ? await countRows(scopeFor(filter, true)) : null;
    return { rows: overflow ? rows.slice(0, maxRows) : rows, overflow, canceledExcluded };
  },

  async getVerifiedMonths({ propertyType, transactionType, lawdCd, months }) {
    const yms = months.map(toYmd);
    const out: Record<string, string> = {};
    if (propertyType === 'apartment') {
      const cells = await prisma.syncCoverageCell.findMany({
        where: { dataset: transactionType === 'sale' ? 'SALE' : 'RENT', lawdCd, dealYmd: { in: yms }, status: { in: ['COMPLETE', 'EMPTY_VALID'] } },
        select: { dealYmd: true, verifiedAt: true },
      });
      for (const c of cells) out[ymFromYmd(c.dealYmd)] = c.verifiedAt.toISOString();
      return out;
    }
    // 오피스텔 셀은 "마지막 시도"와 "마지막 검증 성공"을 분리해 저장한다. 실패한 시도가 이전 검증 시각을 지우지 않으므로 verifiedAt 자체를 본다.
    const cells = await prisma.officetelSyncCell.findMany({
      where: { dataset: transactionType === 'sale' ? 'OFFICETEL_SALE' : 'OFFICETEL_RENT', lawdCd, dealYmd: { in: yms }, verifiedAt: { not: null } },
      select: { dealYmd: true, verifiedAt: true },
    });
    for (const c of cells) if (c.verifiedAt) out[ymFromYmd(c.dealYmd)] = c.verifiedAt.toISOString();
    return out;
  },

  async countUnattributed(master, transactionType) {
    if (master.propertyType !== 'officetel') return 0;
    const sgg = master.lawdCd;
    const umd = master.dong ?? '';
    const jibun = master.jibun ?? '';
    if (transactionType === 'sale') {
      return prisma.officetelTradeHistory.count({ where: { officetelMasterId: null, lawdCd: sgg, umdNm: umd, jibun } });
    }
    return prisma.officetelRentHistory.count({
      where: { officetelMasterId: null, lawdCd: sgg, umdNm: umd, jibun, monthlyRent: transactionType === 'wolse' ? { gt: 0 } : 0 },
    });
  },
};

