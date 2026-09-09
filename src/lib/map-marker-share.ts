// MAP MARKER UX V2 §21~24 — 지도 공유 URL의 center/zoom/lawdCd/selected apartment
// 관련 순수 로직. map/page.tsx(DOM/window 부작용 있음)와 분리해 단위 테스트한다.
import type { AptMarker } from './map-selected-marker';

// 선택된 단지를 공유 URL에 실을 때 쓰는 identity. §22 우선순위: 1) aptSeq
// 2) lawdCd(이미 다른 파라미터로 포함) + dong + name. name-only는 절대 쓰지
// 않는다(AGENTS.md 아파트 canonical identity 원칙 — dong이 항상 함께 있어야
// 함).
export type RestoreIdentity = { aptSeq: string } | { dong: string; name: string };

export interface MapShareParams {
  lat: string;
  lng: string;
  zoom: string;
  lawdCd: string;
  aptSeq?: string;
  dong?: string;
  name?: string;
  // ShareAction의 params prop(Record<string, string | null | undefined>)에 그대로
  // 넘기기 위한 index signature — 위 명시적 필드들과 호환된다.
  [key: string]: string | undefined;
}

export function buildMapShareParams(
  center: { lat: number; lng: number },
  zoomLevel: number,
  lawdCd: string,
  selected: AptMarker | null
): MapShareParams {
  const base: MapShareParams = {
    lat: String(center.lat),
    lng: String(center.lng),
    zoom: String(zoomLevel),
    lawdCd,
  };
  if (!selected) return base;
  if (selected.aptSeq) return { ...base, aptSeq: selected.aptSeq };
  if (selected.dong && selected.name) return { ...base, dong: selected.dong, name: selected.name };
  return base;
}

export interface ParsedMapState {
  center: { lat: number; lng: number };
  zoomLevel: number;
  lawdCd: string;
  restoreIdentity: RestoreIdentity | null;
  /**
   * PERCEIVED_PERFORMANCE_V2_1 §1 — URL에 layers 파라미터가 있을 때만 켜진 레이어 키
   * 목록. 없으면 null이며, 그때 호출부는 기존 기본 레이어 상태를 그대로 쓴다
   * (공유 링크 계약은 바뀌지 않는다 — 예전 링크에는 이 파라미터가 없다).
   */
  layers: string[] | null;
}

// 공유 링크의 쿼리스트링에서 지도 초기 상태를 복원한다. lat/lng가 없으면 공유
// 링크가 아니라고 보고 null을 반환한다(기존 readInitialMapStateFromUrl과 동일
// 계약, §9-b 이전 STEP에서 이미 검증됨) — window 접근은 호출부에서 하고 이
// 함수는 순수하게 URLSearchParams만 받아 테스트하기 쉽게 만든다.
export function parseMapStateFromSearchParams(params: URLSearchParams): ParsedMapState | null {
  const lat = parseFloat(params.get('lat') || '');
  const lng = parseFloat(params.get('lng') || '');
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  const zoom = parseInt(params.get('zoom') || '', 10);
  const lawdCd = params.get('lawdCd') || '26140';

  const aptSeq = params.get('aptSeq');
  const dong = params.get('dong');
  const name = params.get('name');
  const restoreIdentity: RestoreIdentity | null = aptSeq
    ? { aptSeq }
    : dong && name
      ? { dong, name }
      : null;

  return {
    center: { lat, lng },
    zoomLevel: Number.isFinite(zoom) && zoom > 0 ? zoom : 4,
    lawdCd,
    restoreIdentity,
    layers: parseLayerParam(params.get('layers')),
  };
}

// ── PERCEIVED_PERFORMANCE_V2_1 §1 — 지도 view 상태 복원 ──────────────────────
//
// 문제: 지도 -> 마커 -> 상세 -> back 하면 지도가 사용자가 보던 곳이 아니라 기본
// 지역(26140/서구)으로 돌아갔다. 복원 장치가 없어서가 아니라, 위 parse 함수가 읽는
// **URL에 아무도 현재 상태를 쓰지 않았기** 때문이다(이 파라미터들은 지금까지 공유
// 버튼으로만 만들어졌다). 그래서 back으로 돌아오면 쿼리가 비어 있고 초기값이 그대로
// 쓰였다.
//
// 해결: 지도가 움직일 때마다 같은 파라미터를 history.replaceState로 URL에 반영한다.
// 복원 로직/우선순위/ identity 규칙은 이미 있는 것을 그대로 재사용하므로 새 상태
// 저장소를 만들지 않는다.

/** 켜진 레이어만 정렬해 직렬화한다. 값이 없으면 빈 문자열(=모두 꺼짐)이 아니라 '-'로 쓴다. */
export function serializeLayers(layers: Record<string, boolean>): string {
  const on = Object.keys(layers).filter((k) => layers[k]).sort();
  return on.length > 0 ? on.join(',') : '-';
}

/**
 * layers 파라미터를 켜진 키 목록으로 되돌린다.
 * - 파라미터 자체가 없으면 null(= "URL이 레이어에 대해 말하지 않음" → 기본값 유지)
 * - '-'는 "전부 꺼짐"이라는 명시적 상태이므로 빈 배열을 돌려준다(null과 다르다).
 */
export function parseLayerParam(raw: string | null): string[] | null {
  if (raw == null || raw === '') return null;
  if (raw === '-') return [];
  return raw.split(',').map((k) => k.trim()).filter(Boolean);
}

/**
 * 현재 지도 상태를 URL 파라미터로 만든다. 공유용 buildMapShareParams를 그대로 쓰고
 * (identity 우선순위/name-only 금지가 이미 강제됨) 레이어 상태만 덧붙인다 —
 * 공유 URL 계약은 건드리지 않는다.
 */
export function buildMapRestoreParams(
  center: { lat: number; lng: number },
  zoomLevel: number,
  lawdCd: string,
  selected: AptMarker | null,
  layers: Record<string, boolean>
): MapShareParams {
  return { ...buildMapShareParams(center, zoomLevel, lawdCd, selected), layers: serializeLayers(layers) };
}

/** 파라미터 객체를 쿼리스트링으로. 값이 없는 키는 넣지 않는다. */
export function mapParamsToQueryString(params: MapShareParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && v.length > 0) sp.set(k, v);
  }
  return sp.toString();
}

// §24 WRONG MATCH 방지 — 실제로 방금 fetch한 markers 배열 안에서 정확히
// 일치하는 것을 찾을 때만 복원한다. 못 찾으면 null(선택 없음)을 반환할 뿐,
// 다른 단지로 대체하지 않는다.
export function matchRestoreIdentity(
  identity: RestoreIdentity | null,
  markers: AptMarker[]
): AptMarker | null {
  if (!identity) return null;
  if ('aptSeq' in identity) {
    return markers.find((m) => m.aptSeq === identity.aptSeq) || null;
  }
  return markers.find((m) => m.dong === identity.dong && m.name === identity.name) || null;
}
