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
  };
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
