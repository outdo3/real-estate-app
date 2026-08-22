import { point, distance } from '@turf/turf';
import { prisma } from '@/lib/prisma';
import { finalSchoolTypeBucket } from '../../../scripts/education/lib/school-type-taxonomy';

// SCHOOL V2-D1 — 부모용 "가까운 유치원"/"가까운 고등학교" 서버 전용 read-only 조회.
// School V2-C6-B의 attendance-zone.ts와 동일 원칙: DB 접근이 있는 코드는 여기(서버
// 전용)에만 두고, client component가 직접 import하지 않는다. 최근접 학교 fallback을
// 통학구역 대신 쓰지 않는다는 원칙(C6-B)과 별개로, 여기서 만드는 "가까운 유치원/
// 고등학교" 자체는 원래부터 "최근접 목록"이 목적이라 fallback 개념이 아니다.
if (typeof window !== 'undefined') {
  throw new Error('src/lib/education/nearby-education.ts는 서버 전용입니다 — client component에서 import하지 마세요.');
}

const RADIUS_KM = 2;
const KM_PER_DEG_LAT = 111;

export interface NearbyKindergartenItem {
  id: number;
  name: string;
  establishmentType: string | null;
  distanceM: number;
  capacity: number | null;
  enrollment: number | null;
  classCount: number | null;
}

// nearby-apartments.ts(P2-D4-B1)와 동일한 bbox 사전필터 + turf 실거리 계산 패턴 재사용.
export async function findNearbyKindergartens(lat: number, lng: number, limit = 5): Promise<NearbyKindergartenItem[]> {
  const latDelta = RADIUS_KM / KM_PER_DEG_LAT;
  const lngDelta = RADIUS_KM / (KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

  const candidates = await prisma.kindergarten.findMany({
    where: {
      latitude: { gte: lat - latDelta, lte: lat + latDelta },
      longitude: { gte: lng - lngDelta, lte: lng + lngDelta },
      isActive: true,
    },
    select: {
      id: true,
      kindergartenName: true,
      establishmentType: true,
      latitude: true,
      longitude: true,
      stats: { orderBy: { referenceYear: 'desc' }, take: 1, select: { capacity: true, enrollment: true, classCount: true } },
    },
  });

  const from = point([lng, lat]);
  const withDistance = candidates
    .filter((c) => c.latitude != null && c.longitude != null)
    .map((c) => ({
      id: c.id,
      name: c.kindergartenName,
      establishmentType: c.establishmentType,
      distanceM: Math.round(distance(from, point([c.longitude!, c.latitude!]), { units: 'kilometers' }) * 1000),
      capacity: c.stats[0]?.capacity ?? null,
      enrollment: c.stats[0]?.enrollment ?? null,
      classCount: c.stats[0]?.classCount ?? null,
    }))
    .filter((c) => c.distanceM <= RADIUS_KM * 1000)
    .sort((a, b) => a.distanceM - b.distanceM);

  return withDistance.slice(0, limit);
}

export interface CanonicalHighSchoolMatch {
  establishmentType: string | null;
}

// Kakao POI로 찾은 고등학교 이름을 canonical School과 "안전하게만" 매칭한다 —
// 이름 완전일치 + 같은 lawdCd + HIGH 버킷일 때만 채택(fuzzy matching 금지, C2B-A/
// C6-A와 동일 원칙 재사용). 매칭 실패 시 null(추정하지 않음).
export async function matchCanonicalHighSchool(poiName: string, lawdCd: string): Promise<CanonicalHighSchoolMatch | null> {
  if (!lawdCd) return null;
  const candidates = await prisma.school.findMany({
    where: { schoolName: poiName, sigunguCode: lawdCd },
    select: { schoolName: true, schoolLevel: true, establishmentType: true },
  });
  const highOnly = candidates.filter((c) => finalSchoolTypeBucket(c.schoolLevel) === 'HIGH');
  if (highOnly.length !== 1) return null;
  return { establishmentType: highOnly[0].establishmentType };
}
