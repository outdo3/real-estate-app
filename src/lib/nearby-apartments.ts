import { point, distance } from '@turf/turf';
import { prisma } from '@/lib/prisma';

// P2-D4-B1(docs/development/16-presale-nearby-market-design.md §6~7)이 확정한 adaptive
// radius 정책. B1 API(src/app/api/presales/[id]/nearby-apartments/route.ts)와 B2가 동일
// 로직을 공유한다 — 이 파일을 바꾸면 두 API 모두에 반영된다.
const RADIUS_STEPS_KM = [1, 1.5, 2, 3];
const MIN_CANDIDATES = 5;
const MAX_ITEMS = 5;
const MAX_RADIUS_KM = RADIUS_STEPS_KM[RADIUS_STEPS_KM.length - 1];
const KM_PER_DEG_LAT = 111;

export interface NearbyApartmentItem {
  id: number;
  aptSeq: string | null;
  name: string;
  distanceKm: number;
  latitude: number | null;
  longitude: number | null;
  roadAddress: string | null;
  jibunAddress: string | null;
  sido: string | null;
  sigungu: string | null;
  sggCd: string | null;
  umdCd: string | null;
  buildYear: number | null;
  totalHouseholds: number | null;
  mainBuildingCount: number | null;
}

export interface NearbyApartmentsResult {
  radiusKm: number;
  totalCandidates: number;
  items: NearbyApartmentItem[];
}

// Presale 좌표(lat/lng) 기준으로 신뢰 가능한 좌표를 가진 ApartmentMaster 중 실제 거리가
// 가까운 후보를 찾는다. 행정구역(sigungu/sggCd) 필터는 쓰지 않는다 — 실측으로 확인된
// 지역경계 사례(남구 분양 반경 1km 내 수영구 단지 포함, 문서17 §7)를 놓치지 않기 위함.
export async function findNearbyApartments(lat: number, lng: number): Promise<NearbyApartmentsResult> {
  const latDelta = MAX_RADIUS_KM / KM_PER_DEG_LAT;
  const lngDelta = MAX_RADIUS_KM / (KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

  const boundingBoxCandidates = await prisma.apartmentMaster.findMany({
    where: {
      latitude: { gte: lat - latDelta, lte: lat + latDelta },
      longitude: { gte: lng - lngDelta, lte: lng + lngDelta },
    },
    select: {
      id: true, aptSeq: true, name: true, latitude: true, longitude: true,
      roadAddress: true, jibunAddress: true, sido: true, sigungu: true, sggCd: true, umdCd: true,
      buildYear: true, totalHouseholds: true, mainBuildingCount: true,
    },
  });

  const fromPoint = point([lng, lat]);
  const withDistance = boundingBoxCandidates.map((m) => ({
    ...m,
    distanceKm: distance(fromPoint, point([m.longitude!, m.latitude!]), { units: 'kilometers' }),
  }));

  let chosenRadius = MAX_RADIUS_KM;
  let candidatesAtRadius = withDistance.filter((m) => m.distanceKm <= MAX_RADIUS_KM);
  for (const radius of RADIUS_STEPS_KM) {
    const atThisRadius = withDistance.filter((m) => m.distanceKm <= radius);
    if (atThisRadius.length >= MIN_CANDIDATES || radius === MAX_RADIUS_KM) {
      chosenRadius = radius;
      candidatesAtRadius = atThisRadius;
      break;
    }
  }

  const sorted = candidatesAtRadius.sort((a, b) => a.distanceKm - b.distanceKm || a.id - b.id);
  const items: NearbyApartmentItem[] = sorted.slice(0, MAX_ITEMS).map((m) => ({
    id: m.id,
    aptSeq: m.aptSeq,
    name: m.name,
    distanceKm: Math.round(m.distanceKm * 1000) / 1000,
    latitude: m.latitude,
    longitude: m.longitude,
    roadAddress: m.roadAddress,
    jibunAddress: m.jibunAddress,
    sido: m.sido,
    sigungu: m.sigungu,
    sggCd: m.sggCd,
    umdCd: m.umdCd,
    buildYear: m.buildYear,
    totalHouseholds: m.totalHouseholds,
    mainBuildingCount: m.mainBuildingCount,
  }));

  return { radiusKm: chosenRadius, totalCandidates: candidatesAtRadius.length, items };
}
