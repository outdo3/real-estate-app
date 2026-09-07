// MAP_LAYER_TOGGLE_V1 — 지도의 **매물 종류 레이어 토글**과 **확대 단계별 밀도 규칙**의
// 순수 로직(이전 이름: MAP_UX_V2 포커스 모드).
//
// page.tsx에서 분리한 이유는 OFFICETEL_MAP_LAYER_V1의 map-marker-contract와 같다:
// React state/Kakao SDK 없이 단위 테스트할 수 있어야 하고, "어떤 규칙으로 무엇을 숨겼는가"가
// 화면 코드 안에 흩어져 있으면 나중에 아무도 그 근거를 재현할 수 없기 때문이다.
//
// 이 파일은 zero-import를 유지한다(strip-types 테스트 러너 제약).

/** 지도에서 독립적으로 켜고 끌 수 있는 매물 종류. 다른 레이어(학교 등)는 여기 없다. */
export type PropertyTypeLayer = 'apt' | 'officetel';

export interface PropertyLayerState {
  apt: boolean;
  officetel: boolean;
}

/**
 * §2 INDEPENDENT TOGGLE — 아파트와 오피스텔은 **서로 독립적으로** 켜고 끈다.
 *
 * MAP_UX_V2는 둘을 배타적(포커스 모드)으로 묶었다. 그때의 목적은 밀도였는데, 밀도는
 * 확대 단계별 규칙과 묶음 마커로 이미 해결됐다 — 배타성까지 유지하면 "둘 다 보고 싶다"는
 * 정당한 요구를 막을 뿐이다. 학교/재개발 레이어와 같은 모델로 되돌린다.
 *
 * 네 조합이 모두 유효하다: 아파트만 / 오피스텔만 / 둘 다 / 둘 다 끔(빈 지도).
 * **빈 지도를 막는 로직을 두지 않는다** — 사용자가 의도적으로 끈 상태다(§3/§14).
 */
export function togglePropertyLayer<L extends Record<string, boolean>>(layers: L, key: PropertyTypeLayer): L {
  return { ...layers, [key]: !layers[key] };
}

/**
 * §9 SEARCH — 검색으로 고른 결과의 레이어는 **반드시 켠다**. 다만 반대편 종류는
 * 건드리지 않는다(끄지 않는다). 고른 결과가 안 보이는 상태로 끝나지 않으면서,
 * 사용자가 켜둔 다른 레이어를 임의로 없애지도 않는다.
 */
export function ensurePropertyLayerVisible<L extends Record<string, boolean>>(
  layers: L,
  key: PropertyTypeLayer
): L {
  return layers[key] ? layers : { ...layers, [key]: true };
}

/** 두 매물 종류가 동시에 켜져 있는가(= 혼합 모드). 밀도 예산이 달라진다(§6). */
export function isMixedPropertyMode(layers: PropertyLayerState): boolean {
  return layers.apt && layers.officetel;
}

/** 매물 레이어가 하나도 켜져 있지 않은가(§14 — 기본 지도만 보여주는 정상 상태). */
export function hasNoPropertyLayer(layers: PropertyLayerState): boolean {
  return !layers.apt && !layers.officetel;
}

/**
 * §9 — 검색 결과 종류를 레이어 키로 옮긴다. REGION 등 매물이 아닌 결과는 null이며
 * 어떤 레이어도 켜지 않는다.
 */
export function propertyLayerForSearchResult(type: string): PropertyTypeLayer | null {
  if (type === 'APARTMENT') return 'apt';
  if (type === 'OFFICETEL') return 'officetel';
  return null;
}

// ── §6 확대 단계별 밀도 ────────────────────────────────────────────────────────
//
// 카카오맵 레벨은 **숫자가 작을수록 확대**다(1이 가장 가까움). 지도 기본 진입 레벨은 4.
// 아래 임계값은 추측이 아니라 Production 실측에서 나왔다(부산진구 서면 / 360px):
//   - 레벨 3, 두 종류를 낱개+이름으로 전부 그림: 마커 67개 / 화면 면적 80.0% → FAIL
//   - 레벨 3, 아파트 단독: 9개 / 15.2%
//   - 레벨 3, 오피스텔 단독(아이콘 칩): 63개 / 25.4%
// 단독 두 값을 그냥 더하면 ~40%로 §6의 선호 목표(<=40%) 경계에 걸린다. 그래서 혼합
// 모드에서는 **오피스텔 쪽 예산만 한 단계 더 조인다**(아래 MIXED_* 상수).

/** 이 레벨보다 축소되면 개별 마커 대신 묶음 마커만 그린다(아파트·오피스텔 공통). */
export const INDIVIDUAL_MARKER_MAX_LEVEL = 3;

/**
 * 혼합 모드에서 **오피스텔**의 낱개 한계. 한 단계 더 조인다.
 *
 * 왜 오피스텔만 조이는가: 이 확대 단계의 오피스텔 칩은 아이콘만 있고(이름도 가격도 없음)
 * 아파트 칩은 가격을 담고 있다. MAP_UX_V2에서 세운 원칙 그대로 — 두 종류가 화면을
 * 나눠 써야 하면 **정보가 적은 쪽을 먼저 묶는다**. 아파트 가격 칩은 그대로 남는다.
 */
export const MIXED_OFFICETEL_INDIVIDUAL_MAX_LEVEL = 2;

/**
 * 오피스텔 칩에 **이름을 붙이는** 확대 한계.
 *
 * "낱개로 그린다"와 "이름을 쓴다"는 다른 문제다. 레벨 3 서면 360px 실측에서 오피스텔을
 * 낱개로 그리는 것 자체는 63개로 감당되지만, 각 칩에 이름(폭 ~112px)을 붙이자 화면
 * 면적의 71.3%를 덮었다 — 위치는 다 보여주되 이름은 한 단계 더 확대해야 나온다.
 * 이름이 없는 단계에서도 아이콘 칩이 위치를 그대로 보여주므로 정보가 사라지지 않는다.
 */
export const OFFICETEL_NAME_MAX_LEVEL = 2;

/** 혼합 모드에서는 이름도 한 단계 더 조인다(같은 이유 — 라벨 폭이 밀도의 주범이다). */
export const MIXED_OFFICETEL_NAME_MAX_LEVEL = 1;

/** 이 확대 단계에서 오피스텔 칩에 이름을 표시하는가. */
export function showsOfficetelName(zoomLevel: number, mixed = false): boolean {
  return zoomLevel <= (mixed ? MIXED_OFFICETEL_NAME_MAX_LEVEL : OFFICETEL_NAME_MAX_LEVEL);
}

/** 오피스텔 마커를 아예 그리지 않는 축소 한계. 데이터가 시군구 단위라 그보다 넓은 화면에서는
 *  "이 지역만 오피스텔이 있다"는 잘못된 인상을 준다 — 지어내는 대신 확대를 안내한다. */
export const OFFICETEL_MAX_ZOOM_LEVEL = 6;

export type MarkerDensityMode = 'individual' | 'grouped' | 'hidden';

/**
 * 이 확대 단계에서 해당 레이어를 어떻게 그릴지 결정한다.
 *
 * - `individual`: 낱개 마커(아파트=가격 칩, 오피스텔=아이콘/이름 칩)
 * - `grouped`: 묶음 마커 하나(개수 표시). 누르면 확대된다.
 * - `hidden`: 그리지 않는다(안내 문구로 대체)
 *
 * `mixed`가 참이면 두 종류가 화면을 나눠 쓰는 상태이므로 오피스텔 예산을 한 단계 조인다.
 * 단독 모드의 동작은 바뀌지 않는다(§6 — 단독 모드를 불필요하게 나쁘게 만들지 않는다).
 */
export function markerDensityMode(
  layer: PropertyTypeLayer,
  zoomLevel: number,
  mixed = false
): MarkerDensityMode {
  if (layer === 'officetel' && zoomLevel > OFFICETEL_MAX_ZOOM_LEVEL) return 'hidden';
  const threshold =
    mixed && layer === 'officetel' ? MIXED_OFFICETEL_INDIVIDUAL_MAX_LEVEL : INDIVIDUAL_MARKER_MAX_LEVEL;
  return zoomLevel <= threshold ? 'individual' : 'grouped';
}

/**
 * §8 MIXED OVERLAP — 혼합 모드에서 아파트 마커와 오피스텔 마커가 화면상 같은 지점에
 * 놓이면 서로를 가린다. 두 종류를 **합성 마커로 합치지 않고**(identity 병합 금지),
 * 오피스텔 오버레이만 화면에서 조금 내려 그린다.
 *
 * 아파트 칩은 yAnchor=1(점 위에 말풍선), 오피스텔은 yAnchor=0.5(점 중앙)라 이미 서로
 * 다른 위치에 놓이지만, 좁은 화면에서는 그 차이가 충분하지 않다. 좌표/식별자/클릭
 * 대상은 전혀 바뀌지 않는다 — CSS 위치만 이동한다.
 */
export const MIXED_OFFICETEL_OFFSET_Y = 16;

export function mixedOverlapOffsetY(mixed: boolean): number {
  return mixed ? MIXED_OFFICETEL_OFFSET_Y : 0;
}

// ── §8 동일 좌표 다중 master ──────────────────────────────────────────────────

/**
 * 좌표가 **완전히 같은** 항목들을 하나의 표시 그룹으로 묶는다(부산 실측: 32그룹 79건,
 * 최대 5개). 확대해도 절대 갈라지지 않는 겹침이므로 낱개로 부채꼴 전개해봐야 서로를 가릴
 * 뿐이다 — 하나의 묶음 마커로 그리고, 누르면 목록에서 고르게 한다.
 *
 * **데이터를 합치지 않는다.** 각 멤버는 자기 identity를 그대로 유지하며, 그룹은 순전히
 * 표시 단위다(§18 DATA: separate / PRESENTATION: may group).
 *
 * 좌표 키는 원본 숫자를 그대로 쓴다 — 반올림해서 묶으면 "가까운 다른 건물"까지 같은
 * 좌표로 취급해 서로 다른 위치를 하나로 만들어버린다.
 */
export function groupByExactCoordinate<T extends { lat: number; lng: number; id: string }>(
  items: T[]
): { id: string; lat: number; lng: number; members: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = `${item.lat}|${item.lng}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  const out: { id: string; lat: number; lng: number; members: T[] }[] = [];
  for (const members of buckets.values()) {
    out.push({
      // 그룹 id는 멤버 id들로 만든다 — 같은 좌표에 무엇이 있는지 바뀌면 키도 바뀐다.
      id: members.length === 1 ? members[0].id : `grp:${members.map((m) => m.id).join(',')}`,
      lat: members[0].lat,
      lng: members[0].lng,
      members,
    });
  }
  return out;
}

/** 이 표시 그룹이 목록 카드로 펼쳐져야 하는가(= 같은 좌표에 여러 건물). */
export function isMultiMasterGroup(group: { members: unknown[] }): boolean {
  return group.members.length > 1;
}

/**
 * §12 SEARCH HANDOFF — 검색으로 고른 오피스텔을 도착한 마커 안에서 찾는다.
 *
 * **정확히 같은 master id만** 매칭한다. 이름/부분주소/최근접 좌표/첫 마커로 대신
 * 고르지 않는다 — 못 찾으면 null을 주고, 호출부는 아무것도 선택하지 않는다.
 * 좌표가 같은 이웃을 대신 선택하면 사용자는 자기가 고른 건물을 보고 있다고 믿게 된다.
 */
export function findExactOfficetelMarker<T extends { officetelId: number }>(
  markers: T[],
  officetelId: number | null | undefined
): T | null {
  if (typeof officetelId !== 'number' || !Number.isFinite(officetelId)) return null;
  return markers.find((m) => m.officetelId === officetelId) ?? null;
}

/**
 * §12 — 검색 결과의 좌표를 지도가 쓸 수 있는가. `officetel_masters`에 좌표가 없는
 * master(부산 실측 8건)는 0,0으로 내려오며, 그건 "원점"이 아니라 "모름"이다.
 * 런타임 지오코딩으로 채우지 않는다.
 */
export function hasUsableHandoffCoords(result: { lat: number; lng: number }): boolean {
  const { lat, lng } = result;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return !(lat === 0 && lng === 0);
}
