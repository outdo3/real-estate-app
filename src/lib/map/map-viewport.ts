// MAP VIEWPORT — "유효 좌표 목록 → 어떤 viewport를 써야 하는가"만 정하는 **순수** 로직.
//
// ── 왜 공용인가 ────────────────────────────────────────────────────────────────
// 같은 버그가 두 화면에서 따로 발견됐다:
//   · 통계 > 공급(입주지도)  — center를 `mapMarkers[0]`으로, zoom을 상수로 잡았다
//     (SUPPLY_MAP_REGION_BOUNDS_FIX_V1, commit 9413ddf)
//   · 통계 > 변동지도        — center를 geocode가 **먼저 돌아온 항목**으로, zoom을
//     상수 9/7로 잡았다(REGION_CHANGE_MAP_BOUNDS_FIX_V1)
// 두 번째를 고치면서 공급 쪽 로직을 그대로 쓰려니 이름이 `resolveSupplyViewport`라
// 변동지도에서 읽으면 무슨 관계인지 알 수 없었다. 그래서 판정 규칙만 여기로 옮기고,
// 화면별 조정값(여백 px, 단일 지점 zoom)은 각 화면 옆에 남겼다. 규칙이 한 곳이라
// 세 번째 지도가 생겨도 같은 실수를 반복하지 않는다.
//
// ── 하는 일 / 하지 않는 일 ────────────────────────────────────────────────────
// 하는 일 : 좌표 유효성 판정 + bounds/center/none 판정.
// 안 하는 일: 좌표를 **만들지 않는다.** Kakao SDK·DOM·React를 import하지 않아 지도
//           없이 테스트할 수 있고, 좌표 상수(위경도 리터럴)가 이 파일에 없다.
//           유효 좌표가 0개면 `none`을 돌려주고, 정직한 빈 상태는 호출부가 담당한다
//           — 다른 항목·다른 지역 좌표로 메우거나 임의 center를 만들지 않는다.

export interface MapPoint {
  lat: number;
  lng: number;
}

/**
 * 지도 계산에 쓸 수 있는 좌표인가.
 *
 * 두 화면의 원천이 모두 이 검사를 필요로 한다:
 *   · 공급  — 서버가 `latitude != null && longitude != null`만 본다.
 *   · 변동지도 — Kakao Geocoder 응답 문자열을 `parseFloat`한 값이라 NaN이 될 수 있다.
 * 어느 쪽이든 하나만 섞여도 bounds가 지구 전체로 벌어져 지도가 무의미해진다.
 *
 * `0,0`은 좌표 없음을 0으로 채운 sentinel로 취급해 배제한다(아프리카 서쪽 바다
 * 한가운데다). 다만 한쪽만 0인 값은 실제 좌표일 수 있어(적도/본초자오선) 남긴다.
 */
export function isValidMapCoord(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

/** 좌표를 가진 항목들에서 유효 좌표만 골라낸다. 원본 배열은 변형하지 않는다 —
 * 좌표가 없거나 망가진 항목은 **지도 계산에서만** 빠지고 목록 데이터는 그대로다. */
export function validMapPoints(items: ReadonlyArray<{ lat: unknown; lng: unknown }>): MapPoint[] {
  const points: MapPoint[] = [];
  for (const item of items) {
    if (isValidMapCoord(item.lat, item.lng)) points.push({ lat: item.lat as number, lng: item.lng as number });
  }
  return points;
}

export interface MapBoundsBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export type MapViewport =
  /** 서로 다른 좌표가 2개 이상 — 전부 들어오도록 `setBounds`. */
  | { kind: 'bounds'; points: MapPoint[]; box: MapBoundsBox; center: MapPoint }
  /** 좌표가 실질적으로 한 지점 — 그 지점을 center로 두고 주어진 zoom. */
  | { kind: 'center'; center: MapPoint; level: number }
  /** 유효 좌표 0개 — 지도를 억지로 그리지 않는다. */
  | { kind: 'none' };

function pointKey(point: MapPoint): string {
  return `${point.lat}|${point.lng}`;
}

/**
 * 유효 좌표 목록에서 viewport를 정한다.
 *
 * `singlePointLevel`은 화면이 정한다 — 분양 단지 한 곳(공급)과 행정구역 버블 하나
 * (변동지도)는 적절한 축척이 다르다.
 *
 * "서로 다른 좌표"를 세는 이유: 좌표가 **완전히 같은** 행이 실제로 존재한다(공급
 * 실측: 조합원 취소분이 본 사업지와 동일 좌표 — 동래 롯데캐슬 시그니처, 더샵
 * 금정위버시티). 그런 것만 남은 스코프를 `setBounds`에 넣으면 폭·높이가 0인 bounds가
 * 되어 지도가 최대 배율로 튄다. 개수가 아니라 **퍼짐**으로 판정해야 한다.
 */
export function resolveMapViewport(points: ReadonlyArray<MapPoint>, singlePointLevel: number): MapViewport {
  if (points.length === 0) return { kind: 'none' };

  const distinct = new Map<string, MapPoint>();
  for (const point of points) distinct.set(pointKey(point), point);

  if (distinct.size === 1) {
    const only = distinct.values().next().value as MapPoint;
    return { kind: 'center', center: only, level: singlePointLevel };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const point of points) {
    if (point.lat < minLat) minLat = point.lat;
    if (point.lat > maxLat) maxLat = point.lat;
    if (point.lng < minLng) minLng = point.lng;
    if (point.lng > maxLng) maxLng = point.lng;
  }

  return {
    kind: 'bounds',
    points: [...points],
    box: { minLat, maxLat, minLng, maxLng },
    // center는 첫 프레임용이다(`setBounds`가 곧 덮어쓴다). 그래도 모서리가 아니라
    // bounds 중심을 주어, 지도 생성과 bounds 적용 사이 한 프레임에도 엉뚱한 곳이
    // 보이지 않게 한다.
    center: { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 },
  };
}

/** 지도를 다시 맞춰야 하는지 판단하는 키. 선택 스코프(지역·기간 등)와 좌표 집합을
 * 함께 식별해, 필터를 바꿨을 때 이전 viewport가 그대로 남지 않게 한다. */
export function mapViewportKey(scope: string, points: ReadonlyArray<MapPoint>): string {
  return `${scope}::${points.map(pointKey).join(',')}`;
}
