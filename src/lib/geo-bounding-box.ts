// SUPABASE_EGRESS_P1_CLEANUP — 반경 검색을 DB에서 1차로 좁히기 위한 순수 지오 유틸.
//
// 왜 필요한가: search-alias-fallback이 geocoded ApartmentMaster **전체**를 읽어 JS에서
// haversine을 돌렸다(감사에서 지목된 무필터 전체 로드). 반경은 80m인데 3,400여 행을
// 전부 가져오는 구조였다.
//
// 안전성이 이 파일의 핵심이다. bounding box는 반드시 원(반경)의 **진짜 superset**이어야
// 한다. 만약 box가 원 안의 어떤 row라도 빠뜨리면, "반경 안 후보가 2개라서 모호 → 채택
// 안 함"이어야 할 상황이 "1개 → 채택"으로 바뀌어 **다른 단지를 잘못 반환**할 수 있다.
// 그 방향의 실수가 가장 위험하므로 margin을 넉넉히 두고, 아래 테스트에서 여러 방위각으로
// 실제 반경 위 점들이 전부 box 안에 들어오는지 검증한다.
//
// box는 1차 필터일 뿐이고, 최종 판정은 기존과 **동일한 haversine**으로 한다 —
// 즉 결과 의미는 바뀌지 않는다.

/** 지구 반지름(m) — haversine 표준값. */
const EARTH_RADIUS_M = 6371000;

/** 위도 1도의 미터 길이(구면 근사). */
const METERS_PER_DEG_LAT = 111320;

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * (lat,lng) 중심 반경 radiusM을 **포함하는** 위경도 사각형.
 *
 * marginFactor 기본 1.3 — 구면 근사 오차와 고위도에서의 경도 수축을 흡수하기 위한
 * 여유다. 조금 넓은 box는 후보를 몇 개 더 읽을 뿐 결과를 바꾸지 않지만, 좁은 box는
 * 판정을 바꿔버린다(위 주석 참고). 그래서 의도적으로 넉넉한 쪽으로 틀렸다.
 */
export function boundingBoxFor(lat: number, lng: number, radiusM: number, marginFactor = 1.3): BoundingBox {
  const r = radiusM * marginFactor;
  const latDelta = r / METERS_PER_DEG_LAT;
  // 경도 1도의 길이는 cos(위도)로 줄어든다. 극지방에서 0으로 나누는 것을 막기 위해
  // 하한을 둔다(한국 위도에서는 무관하지만 방어적으로).
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const lngDelta = r / (METERS_PER_DEG_LAT * cosLat);
  return { minLat: lat - latDelta, maxLat: lat + latDelta, minLng: lng - lngDelta, maxLng: lng + lngDelta };
}

/** 테스트/검증용 — 주어진 방위각(도)으로 distanceM 만큼 떨어진 점. */
export function destinationPoint(lat: number, lng: number, distanceM: number, bearingDeg: number): { lat: number; lng: number } {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const d = distanceM / EARTH_RADIUS_M;
  const br = toRad(bearingDeg);
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}
