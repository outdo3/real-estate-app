import { NextResponse } from 'next/server';
import { point, distance } from '@turf/turf';
import { prisma } from '@/lib/prisma';

// P2-D4-B1 — adaptive radius 정책(docs/development/16-presale-nearby-market-design.md §6~7).
// 1km에서 5개 이상이면 그대로, 부족하면 1.5km→2km→3km까지 단계적으로 넓힌다. 3km에서도
// 5개 미만이면 넓히지 않고 있는 만큼만 반환한다("주변"의 의미를 지키기 위한 상한).
const RADIUS_STEPS_KM = [1, 1.5, 2, 3];
const MIN_CANDIDATES = 5;
const MAX_ITEMS = 5;

// 최대 반경(3km)을 대략적인 위경도 범위로 환산해 DB 쿼리 단계에서 먼저 후보를 좁힌다
// (bounding box prefilter). 정밀한 거리 판정은 이후 turf distance()로 다시 계산하므로,
// 여기서는 넉넉하게(위도 오차만큼 더) 잡아 실제 반경 내 후보가 잘리지 않게 한다.
const MAX_RADIUS_KM = RADIUS_STEPS_KM[RADIUS_STEPS_KM.length - 1];
const KM_PER_DEG_LAT = 111;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const presaleId = Number(id);

  if (!Number.isInteger(presaleId) || presaleId <= 0) {
    return NextResponse.json({ success: false, error: '잘못된 분양정보 id입니다.' }, { status: 400 });
  }

  try {
    const presale = await prisma.presale.findUnique({
      where: { id: presaleId },
      select: { id: true, latitude: true, longitude: true },
    });

    if (!presale) {
      return NextResponse.json({ success: false, error: '분양정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    // 좌표가 없으면 반경 검색 기준점 자체가 없다 — 행정구역 대표좌표 등 임의 좌표를
    // 만들지 않고(M4-B/P2-D4-A 정책), 정상 응답으로 "위치정보 없음"만 명시한다.
    if (presale.latitude == null || presale.longitude == null) {
      return NextResponse.json({
        success: true,
        data: { presaleId, locationAvailable: false, radiusKm: null, totalCandidates: 0, items: [] },
      });
    }

    const lat = presale.latitude;
    const lng = presale.longitude;

    const latDelta = MAX_RADIUS_KM / KM_PER_DEG_LAT;
    const lngDelta = MAX_RADIUS_KM / (KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));

    // ApartmentMaster만 검색 대상으로 한다(legacy Apartment/Property 미사용, 요청 원칙).
    // 좌표가 신뢰 가능하게 저장된(latitude/longitude not null) row만 대상 — 좌표 재지오코딩,
    // 자동 보정, 행정구역 대표좌표 대체를 일절 하지 않는다(M4-B "성공률보다 정확도" 원칙).
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

    // 행정구역(sigungu/sggCd) 필터를 전혀 쓰지 않는다 — 분양이 동래구여도 실제 거리상
    // 가까운 연제구 단지가 그대로 후보가 될 수 있어야 한다는 요청 원칙(§10)을 그대로 반영.
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
    const items = sorted.slice(0, MAX_ITEMS).map((m) => ({
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

    return NextResponse.json({
      success: true,
      data: {
        presaleId,
        locationAvailable: true,
        radiusKm: chosenRadius,
        totalCandidates: candidatesAtRadius.length,
        items,
      },
    });
  } catch (error) {
    console.error('Failed to fetch nearby apartments:', error);
    return NextResponse.json({ success: false, error: '주변 아파트 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
