// OFFICETEL_NEARBY_V1 — 주변 오피스텔 READ 계층(읽기 전용). 쓰기 없음, 스키마 변경 없음.
//
// 기존 OfficetelMaster / OfficetelTradeHistory / OfficetelRentHistory만 읽는다. 아파트 테이블과 MOLIT 실시간 호출은 쓰지 않는다
// (오피스텔은 MOLIT를 요청 시점에 호출하지 않는다 — 적재된 DB만 본다. 그래서 응답이 "언제 수집됐는지"를 함께 말해야 한다).
//
// 거래는 detail-read.ts와 **같은 범위 조건**(building-level history key + officetelMasterId)으로 읽는다. history key는 인덱스(canonicalKey, dealDate)를 타고,
// officetelMasterId로 다시 좁혀서 다른 동의 거래가 섞이지 않는다. 건수는 DB count()로 세며 "불러온 행 수"에 좌우되지 않는다.
// 쿼리 수: master 1 + 최신성 2 + master당 4(매매/전월세 각각 count + 최근 3건) + (기간 내 거래가 0건인 master만) 귀속 확인 최대 5.
import { prisma } from '../prisma';
import { officetelFallbackDisplayName } from './detail-contract';
import { buildOfficetelHistoryKey } from './identity';
import { resolveAttribution, officetelAttributionNote } from './attribution';
import {
  NEARBY_MAX_CANDIDATES,
  NEARBY_RECENT_TRADES_PER_KIND,
  boundingBox,
  buildOfficetelNearbyResponse,
  rankNearbyMasters,
  windowStartDate,
  type NearbyMasterInput,
  type NearbyMasterRow,
  type OfficetelNearbyQuery,
} from './nearby-contract';

const dec = (v: unknown): number => Number(v);
const day = (d: Date): string => d.toISOString().slice(0, 10);

export async function getNearbyOfficetels(query: OfficetelNearbyQuery, now: Date = new Date()) {
  const box = boundingBox(query.lat, query.lng, query.radiusKm);

  const candidates = await prisma.officetelMaster.findMany({
    where: { latitude: { gte: box.latMin, lte: box.latMax }, longitude: { gte: box.lngMin, lte: box.lngMax } },
    select: {
      id: true, officetelName: true, umdNm: true, jibun: true, buildingDong: true, roadAddress: true,
      buildYear: true, hoCnt: true, latitude: true, longitude: true, sggCd: true,
    },
    take: NEARBY_MAX_CANDIDATES + 1,
  });
  const candidatesTruncated = candidates.length > NEARBY_MAX_CANDIDATES;
  const pool = candidatesTruncated ? candidates.slice(0, NEARBY_MAX_CANDIDATES) : candidates;

  const byId = new Map(pool.map((m) => [m.id, m]));
  const rows: NearbyMasterRow[] = pool.map((m) => ({
    id: m.id,
    displayName: officetelFallbackDisplayName({ officetelName: m.officetelName, umdNm: m.umdNm, jibun: m.jibun }),
    umdNm: m.umdNm, jibun: m.jibun, buildingDong: m.buildingDong, roadAddress: m.roadAddress,
    buildYear: m.buildYear, hoCnt: m.hoCnt, latitude: m.latitude, longitude: m.longitude,
  }));
  const { ranked, withinRadius } = rankNearbyMasters(rows, query);
  const chosen = ranked.slice(0, query.limit);

  const since = new Date(`${windowStartDate(now, query.months)}T00:00:00.000Z`);
  const wantSale = query.kinds !== 'rent';
  const wantRent = query.kinds !== 'sale';
  const areaWhere = query.area === null ? {} : { exclusiveArea: { gte: query.area - query.areaTolerance, lte: query.area + query.areaTolerance } };

  const [saleMax, rentMax] = await Promise.all([
    prisma.officetelTradeHistory.aggregate({ _max: { sourceFetchedAt: true, dealDate: true } }),
    prisma.officetelRentHistory.aggregate({ _max: { sourceFetchedAt: true, dealDate: true } }),
  ]);

  const masters: NearbyMasterInput[] = await Promise.all(
    chosen.map(async (m): Promise<NearbyMasterInput> => {
      const src = byId.get(m.id)!;
      const key = buildOfficetelHistoryKey({ sggCd: src.sggCd, umdNm: src.umdNm, jibun: src.jibun });
      // 키를 만들 수 없으면 거래를 읽지 않는다(detail-read.ts와 같은 규칙). 추측하지 않는다.
      if (!key.ok) {
        return { master: m, saleSummary: { count: 0, latestDealDate: null, recent: [] }, rentSummary: { count: 0, latestDealDate: null, recent: [] }, attribution: { status: 'NO_TRANSACTIONS', note: null } };
      }
      const scope = { canonicalKey: key.key, officetelMasterId: m.id };
      const saleWhere = { ...scope, ...areaWhere, dealDate: { gte: since }, dealCanceled: false };
      const rentWhere = { ...scope, ...areaWhere, dealDate: { gte: since } };

      const [saleCount, saleRecent, rentCount, rentRecent] = await Promise.all([
        wantSale ? prisma.officetelTradeHistory.count({ where: saleWhere }) : Promise.resolve(0),
        wantSale
          ? prisma.officetelTradeHistory.findMany({ where: saleWhere, select: { dealDate: true, dealAmount: true, exclusiveArea: true, floor: true }, orderBy: [{ dealDate: 'desc' }, { id: 'desc' }], take: NEARBY_RECENT_TRADES_PER_KIND })
          : Promise.resolve([]),
        wantRent ? prisma.officetelRentHistory.count({ where: rentWhere }) : Promise.resolve(0),
        wantRent
          ? prisma.officetelRentHistory.findMany({ where: rentWhere, select: { dealDate: true, deposit: true, monthlyRent: true, exclusiveArea: true, floor: true }, orderBy: [{ dealDate: 'desc' }, { id: 'desc' }], take: NEARBY_RECENT_TRADES_PER_KIND })
          : Promise.resolve([]),
      ]);

      const saleSummary = {
        count: saleCount,
        latestDealDate: saleRecent[0] ? day(saleRecent[0].dealDate) : null,
        recent: saleRecent.map((r) => ({ dealDate: day(r.dealDate), dealAmount: r.dealAmount, exclusiveArea: dec(r.exclusiveArea), floor: r.floor })),
      };
      const rentSummary = {
        count: rentCount,
        latestDealDate: rentRecent[0] ? day(rentRecent[0].dealDate) : null,
        recent: rentRecent.map((r) => ({ dealDate: day(r.dealDate), deposit: r.deposit, monthlyRent: r.monthlyRent, exclusiveArea: dec(r.exclusiveArea), floor: r.floor })),
      };

      // 기간·면적 조건 안에 거래가 있으면 귀속은 이미 확인된 것이다. 하나도 없을 때만 "없음"인지 "동 구분 불가"인지 본다.
      if (saleCount + rentCount > 0) return { master: m, saleSummary, rentSummary, attribution: { status: 'ATTRIBUTED', note: null } };

      const [linkedSale, linkedRent] = await Promise.all([
        prisma.officetelTradeHistory.count({ where: scope }),
        prisma.officetelRentHistory.count({ where: scope }),
      ]);
      let attribution = resolveAttribution({ linkedSale, linkedRent, unlinkedSale: 0, unlinkedRent: 0, mastersAtAddress: 1 });
      if (linkedSale + linkedRent === 0) {
        const [row] = await prisma.$queryRaw<{ unlinked_sale: number; unlinked_rent: number; masters_at_address: number }[]>`
          SELECT
            (SELECT COUNT(*) FROM officetel_trade_histories WHERE officetel_master_id IS NULL AND lawd_cd = ${src.sggCd} AND umd_nm = ${src.umdNm} AND jibun = ${src.jibun})::int AS unlinked_sale,
            (SELECT COUNT(*) FROM officetel_rent_histories  WHERE officetel_master_id IS NULL AND lawd_cd = ${src.sggCd} AND umd_nm = ${src.umdNm} AND jibun = ${src.jibun})::int AS unlinked_rent,
            (SELECT COUNT(*) FROM officetel_masters WHERE sgg_cd = ${src.sggCd} AND umd_nm = ${src.umdNm} AND jibun = ${src.jibun})::int AS masters_at_address`;
        attribution = resolveAttribution({
          linkedSale: 0, linkedRent: 0, unlinkedSale: row?.unlinked_sale ?? 0, unlinkedRent: row?.unlinked_rent ?? 0, mastersAtAddress: row?.masters_at_address ?? 1,
        });
      }
      return { master: m, saleSummary, rentSummary, attribution: { status: attribution.status, note: officetelAttributionNote(attribution) } };
    })
  );

  return buildOfficetelNearbyResponse({
    query, now, withinRadius, candidatesTruncated, tradeRowsTruncated: false, masters,
    dataset: {
      sale: { lastFetchedAt: saleMax._max.sourceFetchedAt ? saleMax._max.sourceFetchedAt.toISOString() : null, lastDealDate: saleMax._max.dealDate ? day(saleMax._max.dealDate) : null },
      rent: { lastFetchedAt: rentMax._max.sourceFetchedAt ? rentMax._max.sourceFetchedAt.toISOString() : null, lastDealDate: rentMax._max.dealDate ? day(rentMax._max.dealDate) : null },
    },
  });
}
