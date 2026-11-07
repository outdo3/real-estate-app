// SELLFLOW_DATA_API_V1.3 — `SellflowContextDb` 포트의 Prisma 구현. **읽기 전용**(findUnique/findMany/groupBy/aggregate만).
//
// 필요한 SELECT 권한: apartment_masters(이미 있음) · redevelopment_projects · presales. SELLFLOW 읽기 전용 역할에는 앞의 것만 있으므로 뒤의 둘은 권한이
// 부여되기 전까지 42501(permission denied)로 실패하고, 서비스 계층이 그것을 'ACCESS_DENIED'로 따로 알린다(자료 없음으로 바꾸지 않는다).
import { prisma } from '@/lib/prisma';
import type { ComplexAttributesRow, PresaleRows, RedevelopmentRows, SellflowContextDb } from './context';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const day = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

export const prismaSellflowContextDb: SellflowContextDb = {
  async getComplexAttributes(aptSeq): Promise<ComplexAttributesRow | null> {
    const m = await prisma.apartmentMaster.findUnique({
      where: { aptSeq },
      select: { parkingCount: true, floorAreaRatio: true, buildingCoverageRatio: true, mainBuildingCount: true, useApprovalDate: true, basicSpecSource: true, updatedAt: true },
    });
    if (!m) return null;
    return { ...m, updatedAt: iso(m.updatedAt) };
  },

  async listRedevelopment({ sido, sigungu, take }): Promise<RedevelopmentRows> {
    const where = { sido, sigungu };
    const [groups, items, agg] = await Promise.all([
      prisma.redevelopmentProject.groupBy({ by: ['stage', 'businessType', 'projectStatus', 'needsReview'], where, _count: { _all: true } }),
      // 확인이 필요한(needsReview) 사업은 사실로 쓰지 않으므로 목록에서 뺀다. 개수는 groups로 따로 알린다.
      prisma.redevelopmentProject.findMany({
        where: { ...where, needsReview: false },
        orderBy: [{ updatedAt: 'desc' }, { canonicalName: 'asc' }],
        take,
        select: { canonicalName: true, businessType: true, stage: true, projectStatus: true, householdCount: true, primarySource: true, updatedAt: true },
      }),
      prisma.redevelopmentProject.aggregate({ where, _max: { sourceUpdatedAt: true, collectedAt: true } }),
    ]);
    return {
      groups: groups.map((g) => ({ stage: g.stage, businessType: g.businessType, projectStatus: g.projectStatus, needsReview: g.needsReview, count: g._count._all })),
      items: items.map((p) => ({ name: p.canonicalName, businessType: p.businessType, stage: p.stage, projectStatus: p.projectStatus, householdCount: p.householdCount, primarySource: p.primarySource, dataUpdatedAt: p.updatedAt.toISOString() })),
      latestSourceUpdatedAt: iso(agg._max.sourceUpdatedAt),
      latestCollectedAt: iso(agg._max.collectedAt),
    };
  },

  async listPresales({ sidoShort, addressPrefix, take }): Promise<PresaleRows> {
    // 시도는 청약홈의 공급지역명(예: '부산'), 시군구는 공고 소재지가 '<시도 전체 이름> <시군구> …'로 시작하는 것으로 가린다(지어낸 매칭 없음).
    const where = { subscriptionAreaName: sidoShort, locationAddress: { startsWith: addressPrefix } };
    const [total, rows, agg] = await Promise.all([
      prisma.presale.count({ where }),
      prisma.presale.findMany({
        where,
        orderBy: [{ receiptStartDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        take,
        select: { houseName: true, houseType: true, totalSupplyHouseholds: true, announcementDate: true, receiptStartDate: true, receiptEndDate: true, moveInExpectedYm: true, minPrice: true, maxPrice: true, pblancUrl: true, locationAddress: true },
      }),
      prisma.presale.aggregate({ where, _max: { updatedAt: true } }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({ ...r, houseType: String(r.houseType), announcementDate: day(r.announcementDate), receiptStartDate: iso(r.receiptStartDate), receiptEndDate: iso(r.receiptEndDate) })),
      lastCollectedAt: iso(agg._max.updatedAt),
    };
  },
};
