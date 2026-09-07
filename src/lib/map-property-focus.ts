// MAP_UX_V2 — 지도의 **매물 종류 포커스 모드**와 **확대 단계별 밀도 규칙**의 순수 로직.
//
// page.tsx에서 분리한 이유는 OFFICETEL_MAP_LAYER_V1의 map-marker-contract와 같다:
// React state/Kakao SDK 없이 단위 테스트할 수 있어야 하고, "어떤 규칙으로 무엇을 숨겼는가"가
// 화면 코드 안에 흩어져 있으면 나중에 아무도 그 근거를 재현할 수 없기 때문이다.
//
// 이 파일은 zero-import를 유지한다(strip-types 테스트 러너 제약).

/** 지도에서 서로 배타적으로 보여주는 매물 종류. 다른 레이어(학교 등)는 여기 없다. */
export type PropertyTypeLayer = 'apt' | 'officetel';

/**
 * §4 FOCUS MODE — 아파트와 오피스텔은 **동시에 켜지지 않는다**.
 *
 * V1에서는 둘 다 독립 토글이라 함께 켤 수 있었고, 부산진구 서면 360px 실측에서 마커가
 * 화면 면적의 80%를 덮어 지도 자체를 읽을 수 없었다. 지도는 "가진 정보를 전부 얹는 면"이
 * 아니라 위치를 찾는 면이다.
 *
 * 이미 활성인 종류를 다시 누르면 **그대로 유지한다**(끄지 않는다). 끄면 어느 매물도 없는
 * 빈 지도가 남는데, 그건 사용자가 의도한 상태가 아니다 — 항상 정확히 하나가 켜져 있다.
 */
export function applyPropertyTypeFocus<L extends Record<string, boolean>>(
  layers: L,
  focus: PropertyTypeLayer
): L {
  // 다른 레이어(school/redevelopment/auction/livingLodging)는 건드리지 않는다 —
  // 포커스 규칙은 아파트·오피스텔 두 종류 사이에만 적용된다(§4).
  return { ...layers, apt: focus === 'apt', officetel: focus === 'officetel' };
}

/** 현재 레이어 상태에서 활성 매물 종류를 읽는다. 항상 정확히 하나가 켜져 있다. */
export function currentPropertyFocus(layers: { apt: boolean; officetel: boolean }): PropertyTypeLayer {
  return layers.officetel ? 'officetel' : 'apt';
}

/**
 * §5 SEARCH OVERRIDE — 검색으로 고른 결과의 종류가 곧 포커스가 된다.
 * 오피스텔을 골랐는데 레이어가 꺼져 있어 아무것도 안 보이는 일이 없어야 한다.
 * REGION 등 매물이 아닌 결과는 현재 포커스를 바꾸지 않는다(null).
 */
export function focusForSearchResult(type: string): PropertyTypeLayer | null {
  if (type === 'APARTMENT') return 'apt';
  if (type === 'OFFICETEL') return 'officetel';
  return null;
}

// ── §6 확대 단계별 밀도 ────────────────────────────────────────────────────────
//
// 카카오맵 레벨은 **숫자가 작을수록 확대**다(1이 가장 가까움). 지도 기본 진입 레벨은 4.
// 아래 임계값은 추측이 아니라 Production 실측에서 나왔다:
//   - 부산진구 서면 / 레벨 3 / 360px: 마커 67개, 화면 면적의 80.0%를 덮음 → FAIL
//   - 부산 서구  / 레벨 4 / 360px: 마커 36개, 34.7~35.7%
// 즉 문제는 "레벨 3에서 개별 이름 칩을 전부 펼치는 것"과 "두 종류를 겹쳐 그리는 것"이었다.

/** 이 레벨보다 축소되면 개별 마커 대신 묶음 마커만 그린다(아파트·오피스텔 공통). */
export const INDIVIDUAL_MARKER_MAX_LEVEL = 3;

/**
 * 오피스텔 칩에 **이름을 붙이는** 확대 한계.
 *
 * "낱개로 그린다"와 "이름을 쓴다"는 다른 문제다. 레벨 3 서면 360px 실측에서 오피스텔을
 * 낱개로 그리는 것 자체는 63개로 감당되지만, 각 칩에 이름(폭 ~112px)을 붙이자 화면
 * 면적의 71.3%를 덮었다 — 위치는 다 보여주되 이름은 한 단계 더 확대해야 나온다.
 * 이름이 없는 단계에서도 아이콘 칩이 위치를 그대로 보여주므로 정보가 사라지지 않는다.
 */
export const OFFICETEL_NAME_MAX_LEVEL = 2;

/** 이 확대 단계에서 오피스텔 칩에 이름을 표시하는가. */
export function showsOfficetelName(zoomLevel: number): boolean {
  return zoomLevel <= OFFICETEL_NAME_MAX_LEVEL;
}

/** 오피스텔 마커를 아예 그리지 않는 축소 한계. 데이터가 시군구 단위라 그보다 넓은 화면에서는
 *  "이 지역만 오피스텔이 있다"는 잘못된 인상을 준다 — 지어내는 대신 확대를 안내한다. */
export const OFFICETEL_MAX_ZOOM_LEVEL = 6;

export type MarkerDensityMode = 'individual' | 'grouped' | 'hidden';

/**
 * 이 확대 단계에서 해당 레이어를 어떻게 그릴지 결정한다.
 *
 * - `individual`: 낱개 마커(아파트=가격 칩, 오피스텔=이름 칩)
 * - `grouped`: 묶음 마커 하나(개수 표시). 누르면 확대된다.
 * - `hidden`: 그리지 않는다(안내 문구로 대체)
 */
export function markerDensityMode(layer: PropertyTypeLayer, zoomLevel: number): MarkerDensityMode {
  if (layer === 'officetel' && zoomLevel > OFFICETEL_MAX_ZOOM_LEVEL) return 'hidden';
  return zoomLevel <= INDIVIDUAL_MARKER_MAX_LEVEL ? 'individual' : 'grouped';
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
