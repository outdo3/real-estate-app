// OFFICETEL_NEARBY_V1 — 주변 오피스텔 READ 계층(읽기 전용). 쓰기 없음, 스키마 변경 없음.
//
// 기존 OfficetelMaster / OfficetelTradeHistory / OfficetelRentHistory만 읽는다. 아파트 테이블과 MOLIT 실시간 호출은 쓰지 않는다
// (오피스텔은 MOLIT를 요청 시점에 호출하지 않는다 — 적재된 DB만 본다. 그래서 응답이 "언제 수집됐는지"를 함께 말해야 한다).
//
// 쿼리 수는 입력과 무관하게 고정이다: master 1 + 매매 1 + 전월세 1 + 귀속 집계 2 + 데이터셋 최신성 2 (+ 귀속이 필요한 master당 1, 최대 limit개).
import { prisma } from '../prisma';
import { officetelFallbackDisplayName } from './detail-contract';
import { resolveAttribution, officetelAttributionNote } from './attribution';
import {
  NEARBY_MAX_CANDIDATES,
  NEARBY_MAX_TRADE_ROWS,
  boundingBox,
  buildOfficetelNearbyResponse,
  rankNearbyMasters,
  windowStartDate,
  type NearbyMasterInput,
  type NearbyMasterRow,
  type OfficetelNearbyQuery,
  type RentTradeRow,
  type SaleTradeRow,
} from './nearby-contract';

const dec = (v: unknown): number => Number(v);
const day = (d: Date): string => d.toISOString().slice(0, 10);

export async function getNearbyOfficetels(query: OfficetelNearbyQuery, now: Date = new Date()) {
  const box = boundingBox(query.lat, query.lng, query.radiusKm);

  const candidates = await prisma.officetelMaster.findMany({
    where: { latitude: { gte: box.latMin, lte: box.latMax }, longitude: { gte: box.lngMin, lte: box.lngMax } },
    select: {
      id: true, officetelName: true, umdNm: true, jibun: true, buildingDong: true, roadAddress: true,
      buildYear: true, hoCnt: true, latitude: true, longitude: true, canonicalKey: true, sggCd: true,
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
  const ids = chosen.map((c) => c.id);

  const since = new Date(`${windowStartDate(now, query.months)}T00:00:00.000Z`);
  const wantSale = query.kinds !== 'rent';
  const wantRent = query.kinds !== 'sale';

  // 같은 master에 귀속된 거래만 — 귀속되지 않은 행은 어느 오피스텔에도 붙이지 않는다(attribution.ts).
  const [saleRows, rentRows, saleTotals, rentTotals, saleMax, rentMax] = await Promise.all([
    wantSale && ids.length > 0
      ? prisma.officetelTradeHistory.findMany({
          where: { officetelMasterId: { in: ids }, dealDate: { gte: since }, dealCanceled: false },
          select: { officetelMasterId: true, dealDate: true, dealAmount: true, exclusiveArea: true, floor: true },
          orderBy: [{ dealDate: 'desc' }, { id: 'desc' }],
          take: NEARBY_MAX_TRADE_ROWS + 1,
        })
      : Promise.resolve([]),
    wantRent && ids.length > 0
      ? prisma.officetelRentHistory.findMany({
          where: { officetelMasterId: { in: ids }, dealDate: { gte: since } },
          select: { officetelMasterId: true, dealDate: true, deposit: true, monthlyRent: true, exclusiveArea: true, floor: true },
          orderBy: [{ dealDate: 'desc' }, { id: 'desc' }],
          take: NEARBY_MAX_TRADE_ROWS + 1,
        })
      : Promise.resolve([]),
    ids.length > 0
      ? prisma.officetelTradeHistory.groupBy({ by: ['officetelMasterId'], where: { officetelMasterId: { in: ids } }, _count: { _all: true } })
      : Promise.resolve([]),
    ids.length > 0
      ? prisma.officetelRentHistory.groupBy({ by: ['officetelMasterId'], where: { officetelMasterId: { in: ids } }, _count: { _all: true } })
      : Promise.resolve([]),
    prisma.officetelTradeHistory.aggregate({ _max: { sourceFetchedAt: true, dealDate: true } }),
    prisma.officetelRentHistory.aggregate({ _max: { sourceFetchedAt: true, dealDate: true } }),
  ]);

  const tradeRowsTruncated = saleRows.length > NEARBY_MAX_TRADE_ROWS || rentRows.length > NEARBY_MAX_TRADE_ROWS;
  const sale = new Map<number, SaleTradeRow[]>();
  for (const r of saleRows.slice(0, NEARBY_MAX_TRADE_ROWS)) {
    if (r.officetelMasterId === null) continue;
    const list = sale.get(r.officetelMasterId) ?? [];
    list.push({ dealDate: day(r.dealDate), dealAmount: r.dealAmount, exclusiveArea: dec(r.exclusiveArea), floor: r.floor });
    sale.set(r.officetelMasterId, list);
  }
  const rent = new Map<number, RentTradeRow[]>();
  for (const r of rentRows.slice(0, NEARBY_MAX_TRADE_ROWS)) {
    if (r.officetelMasterId === null) continue;
    const list = rent.get(r.officetelMasterId) ?? [];
    list.push({ dealDate: day(r.dealDate), deposit: r.deposit, monthlyRent: r.monthlyRent, exclusiveArea: dec(r.exclusiveArea), floor: r.floor });
    rent.set(r.officetelMasterId, list);
  }
  const linkedSale = new Map(saleTotals.map((g) => [g.officetelMasterId as number, g._count._all]));
  const linkedRent = new Map(rentTotals.map((g) => [g.officetelMasterId as number, g._count._all]));

  const masters: NearbyMasterInput[] = [];
  for (const m of chosen) {
    const src = byId.get(m.id)!;
    const ls = linkedSale.get(m.id) ?? 0;
    const lr = linkedRent.get(m.id) ?? 0;
    let attribution = resolveAttribution({ linkedSale: ls, linkedRent: lr, unlinkedSale: 0, unlinkedRent: 0, mastersAtAddress: 1 });
    if (ls + lr === 0) {
      // 연결된 거래가 하나도 없을 때만 "없음"인지 "구분 불가"인지 확인한다(detail-read.ts와 같은 질의).
      const [row] = await prisma.$queryRaw<{ unlinked_sale: number; unlinked_rent: number; masters_at_address: number }[]>`
        SELECT
          (SELECT COUNT(*) FROM officetel_trade_histories WHERE officetel_master_id IS NULL AND lawd_cd = ${src.sggCd} AND umd_nm = ${src.umdNm} AND jibun = ${src.jibun})::int AS unlinked_sale,
          (SELECT COUNT(*) FROM officetel_rent_histories  WHERE officetel_master_id IS NULL AND lawd_cd = ${src.sggCd} AND umd_nm = ${src.umdNm} AND jibun = ${src.jibun})::int AS unlinked_rent,
          (SELECT COUNT(*) FROM officetel_masters WHERE sgg_cd = ${src.sggCd} AND umd_nm = ${src.umdNm} AND jibun = ${src.jibun})::int AS masters_at_address`;
      attribution = resolveAttribution({
        linkedSale: 0, linkedRent: 0, unlinkedSale: row?.unlinked_sale ?? 0, unlinkedRent: row?.unlinked_rent ?? 0, mastersAtAddress: row?.masters_at_address ?? 1,
      });
    }
    masters.push({
      master: m,
      sale: sale.get(m.id) ?? [],
      rent: rent.get(m.id) ?? [],
      attribution: { status: attribution.status, note: officetelAttributionNote(attribution) },
    });
  }

  return buildOfficetelNearbyResponse({
    query, now, withinRadius, candidatesTruncated, tradeRowsTruncated, masters,
    dataset: {
      sale: { lastFetchedAt: saleMax._max.sourceFetchedAt ? saleMax._max.sourceFetchedAt.toISOString() : null, lastDealDate: saleMax._max.dealDate ? day(saleMax._max.dealDate) : null },
      rent: { lastFetchedAt: rentMax._max.sourceFetchedAt ? rentMax._max.sourceFetchedAt.toISOString() : null, lastDealDate: rentMax._max.dealDate ? day(rentMax._max.dealDate) : null },
    },
  });
}
