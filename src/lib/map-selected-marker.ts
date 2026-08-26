// SEARCH_MAP_PERFORMANCE_V2_2 §13/§14 — SELECTED MARKER FIRST의 순수 판정 로직만
// 분리했다. src/app/map/page.tsx(DB/Kakao SDK/React state 부작용 있음)와 분리해
// 부작용 없이 단위 테스트할 수 있다(scripts/backfill-basic-data-logic.ts와 동일 관례).

export interface AptMarker {
  id: string; // Internal unique id
  aptSeq?: string; // Canonical identity from building hub
  completionYear?: number;
  name: string;
  dong: string;
  price: string;
  hasRecentPrice: boolean; // 최근 거래(가격) 유무 — 없으면 "시세 정보 없음"으로 폴백 표시
  lat: number;
  lng: number;
  hasNewPost?: boolean;
}

export interface AptCluster {
  id: string;
  lat: number;
  lng: number;
  markers: AptMarker[];
}

export interface ApartmentSelectResultForMarker {
  type: 'REGION' | 'APARTMENT';
  name: string;
  lat: number;
  lng: number;
  dong?: string;
  aptSeq?: string | null;
  completionYear?: number | null;
}

// aptSeq + 유효 좌표가 모두 있을 때만 임시 마커를 만든다(name-only identity 금지,
// 다른 아파트로의 fallback 금지 — AGENTS.md 원칙). 가격은 아직 모르므로 값을
// 지어내지 않고 "시세 정보 없음"으로 정직하게 표시한다.
export function buildPendingSelectedApt(result: ApartmentSelectResultForMarker): AptMarker | null {
  if (result.type !== 'APARTMENT') return null;
  if (!result.aptSeq) return null;
  if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) return null;
  return {
    id: result.aptSeq,
    aptSeq: result.aptSeq,
    completionYear: result.completionYear ?? undefined,
    name: result.name,
    dong: result.dong || '',
    price: '시세 정보 없음',
    hasRecentPrice: false,
    lat: result.lat,
    lng: result.lng,
    hasNewPost: false,
  };
}

// 진짜 마커(aptClusters)가 도착했으면 그것을 우선하고, 없을 때만 임시 마커로 폴백한다
// — "temporary marker와 real marker dataset이 도착했을 때 duplicate 없이 reconcile"
// 요구사항의 핵심 판정.
export function resolveSelectedMarker(
  activeMarkerId: string | null,
  aptClusters: AptCluster[],
  pendingSelectedApt: AptMarker | null
): AptMarker | null {
  if (!activeMarkerId) return null;
  for (const cluster of aptClusters) {
    const found = cluster.markers.find((m) => m.id === activeMarkerId);
    if (found) return found;
  }
  if (pendingSelectedApt && pendingSelectedApt.id === activeMarkerId) return pendingSelectedApt;
  return null;
}

// 진짜 데이터가 이미 같은 id를 포함하면 임시 마커는 더 이상 필요 없다(정리 대상).
export function isPendingStillNeeded(aptClusters: AptCluster[], pendingSelectedApt: AptMarker | null): boolean {
  if (!pendingSelectedApt) return false;
  return !aptClusters.some((c) => c.markers.some((m) => m.id === pendingSelectedApt.id));
}
