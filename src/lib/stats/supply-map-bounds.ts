// SUPPLY_MAP_REGION_BOUNDS_FIX_V1 — 공급(입주지도) viewport 결정 **순수** 로직.
//
// ── 고친 문제 ──────────────────────────────────────────────────────────────────
// 지역이 "부산광역시 전체"인데 지도는 기장/울산 경계 부근에 치우쳐 열렸다. 원인은
// 지도 center를 `mapMarkers[0]`으로 잡고 zoom을 상수로 고정한 것이다. `mapMarkers`는
// 서버가 `orderBy` 없이 읽은 순서(= id 순)라 첫 원소는 **아무 단지**다. 실측(2026-09-12,
// 부산·향후 2년, 좌표 확인 26건):
//
//   mapMarkers[0] = 부산 장안지구 B-2블록 중흥S-클래스(기장군) 35.32036, 129.24011
//   실제 좌표 bounds  lat 35.09287~35.32036 / lng 128.93527~129.24012
//   bounds 중심       35.20661, 129.08769   ← 부산 중앙
//
// 즉 center가 부산의 **북동 끝 모서리**였고, 거기에 level 8(구 단위 축척)이 고정돼
// 있어 부산 대부분이 화면 밖이었다. 목록은 부산 전역을 보여주는데 지도만 한쪽을 보고
// 있었던 것 — 데이터가 아니라 viewport 계산의 문제다.
//
// ── 이 파일이 하는 일 / 하지 않는 일 ──────────────────────────────────────────
// 하는 일 : "유효 좌표 목록 → 어떤 viewport를 써야 하는가"만 판정한다. Kakao SDK를
//           import하지 않아 DOM/지도 없이 테스트할 수 있다.
// 안 하는 일: 좌표를 **만들지 않는다.** 좌표가 0개면 `none`을 돌려주고, 호출부가
//           정직한 빈 상태를 보여준다. 다른 단지·다른 지역 좌표로 메우지 않고,
//           지역 canonical center 상수를 새로 발명하지도 않는다(§4 — 없는 위치를
//           있는 것처럼 가리키는 지도보다 "위치 확인된 단지가 없어요"가 정직하다).

export interface SupplyPoint {
  lat: number;
  lng: number;
}

/**
 * `setBounds`에 줄 여백(px). 마커는 지름 최대 18px 원 + 2px 흰 테두리라 bounds 경계에
 * 놓인 마커는 절반이 잘린다. 여백은 그 반지름(≈10px)보다 넉넉해야 하고, 기존
 * presale-nearby-map.tsx가 검증해 쓰는 40px과 같은 계열 값을 쓴다(340px 높이 지도에서
 * 상하 합쳐 96px을 여백으로 쓰면 너무 좁아지므로 48을 넘기지 않는다).
 */
export const SUPPLY_MAP_BOUNDS_PADDING = 48;

/**
 * 단지가 하나뿐일 때의 zoom. 같은 데이터(분양/입주예정 단지) 지도인
 * `presale-nearby-map.tsx`가 쓰는 level 5와 같은 값을 쓴다 — 새 값을 발명하지 않는다.
 */
export const SUPPLY_SINGLE_POINT_LEVEL = 5;

/**
 * 지도 계산에 쓸 수 있는 좌표인가.
 *
 * 서버는 `latitude != null && longitude != null`만 보고 내려준다. 그것만으로는
 * NaN/Infinity, 범위 밖 값, `0,0`(좌표 없음을 0으로 채운 sentinel — 아프리카 서쪽
 * 바다 한가운데다)을 걸러내지 못한다. 하나라도 섞이면 bounds가 지구 전체로 벌어져
 * 지도가 무의미해지므로, 지도 쪽에서 한 번 더 막는다.
 *
 * 실측(2026-09-12, 부산 26건): 위반 0건. 지금 데이터가 깨끗하다는 뜻이고, 이 가드는
 * 나중에 들어올 값을 위한 것이다 — 깨끗하다는 이유로 검사를 생략하지 않는다.
 */
export function isValidSupplyCoord(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

/** 마커 목록에서 유효 좌표만 골라낸다. 좌표가 없거나 망가진 항목은 **지도 계산에서만**
 * 빠지고, 목록 데이터는 호출부에서 그대로 유지된다(§7 — "위치 미확인"으로 표시). */
export function validSupplyPoints(markers: ReadonlyArray<{ lat: unknown; lng: unknown }>): SupplyPoint[] {
  const points: SupplyPoint[] = [];
  for (const m of markers) {
    if (isValidSupplyCoord(m.lat, m.lng)) points.push({ lat: m.lat as number, lng: m.lng as number });
  }
  return points;
}

export interface SupplyBoundsBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export type SupplyViewport =
  /** 서로 다른 좌표가 2개 이상 — 전부 들어오도록 `setBounds`. */
  | { kind: 'bounds'; points: SupplyPoint[]; box: SupplyBoundsBox; center: SupplyPoint }
  /** 좌표가 실질적으로 한 지점 — 그 지점을 center로 두고 적당한 zoom. */
  | { kind: 'center'; center: SupplyPoint; level: number }
  /** 유효 좌표 0개 — 지도를 억지로 그리지 않는다. */
  | { kind: 'none' };

function pointKey(p: SupplyPoint): string {
  return `${p.lat}|${p.lng}`;
}

/**
 * 유효 좌표 목록에서 viewport를 정한다.
 *
 * "서로 다른 좌표"를 세는 이유: 같은 사업지의 조합원 취소분처럼 **좌표가 완전히 같은**
 * 행이 실제로 존재한다(실측: 동래 롯데캐슬 시그니처 id 127/576, 더샵 금정위버시티
 * id 428/694가 각각 동일 좌표). 그런 2건만 남는 구/군(예: 금정구)을 `setBounds`에 넣으면
 * 폭·높이가 0인 bounds가 되어 지도가 최대 배율로 튄다. 개수가 아니라 **퍼짐**으로
 * 판정해야 한다.
 */
export function resolveSupplyViewport(points: ReadonlyArray<SupplyPoint>): SupplyViewport {
  if (points.length === 0) return { kind: 'none' };

  const distinct = new Map<string, SupplyPoint>();
  for (const p of points) distinct.set(pointKey(p), p);

  if (distinct.size === 1) {
    const only = distinct.values().next().value as SupplyPoint;
    return { kind: 'center', center: only, level: SUPPLY_SINGLE_POINT_LEVEL };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
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

/** 지도를 다시 맞춰야 하는지 판단하는 키. 지역/기간/전국 토글이 바뀌면 이전 viewport가
 * 그대로 남지 않도록, 요청 스코프와 좌표 집합을 함께 식별한다(§5). */
export function supplyViewportKey(scope: string, points: ReadonlyArray<SupplyPoint>): string {
  return `${scope}::${points.map(pointKey).join(',')}`;
}
