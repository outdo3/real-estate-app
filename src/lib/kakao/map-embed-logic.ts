// OFFICETEL_V1 STEP 6 §2/§6/§7 — 지도 임베드의 **결정 로직**만 담은 순수 모듈.
//
// 왜 분리하나: "저장된 좌표 모드가 정말 지오코딩을 건너뛰는가"는 이 기능의 신뢰
// 계약 그 자체다(§6 — 잘못된 지도는 지도가 없는 것보다 나쁘다). 그 판단을 카카오
// SDK가 필요한 컴포넌트 안에 두면 테스트할 수 없다. 여기에는 import가 하나도 없다.

/** 지도를 어떻게 띄울지 — 두 모드는 **명시적**이며 섞이지 않는다. */
export type MapEmbedInput =
  | { mode: 'address'; address: string; jibunAddress?: string }
  | { mode: 'coordinate'; latitude: number; longitude: number };

/** 위 입력을 실제 좌표 확보 계획으로 바꾼 결과. */
export type MapEmbedPlan =
  /** 저장된 좌표가 곧 정답 — 지오코딩/키워드검색을 **하지 않는다**. */
  | { kind: 'USE_STORED_COORDINATE'; latitude: number; longitude: number }
  /** 런타임 주소 해석이 필요 — 기존 아파트 경로. */
  | { kind: 'RESOLVE_BY_ADDRESS'; address: string; jibunAddress?: string }
  /** 입력이 성립하지 않음 — 지도를 그리지 않는다(다른 좌표로 대체하지 않는다). */
  | { kind: 'UNRESOLVABLE'; reason: 'INVALID_COORDINATE' | 'EMPTY_ADDRESS' };

/**
 * 부산 안팎을 따지지 않는다 — 그건 적재 시점(STEP 5B)에서 이미 검증됐다.
 * 여기서는 "숫자로서 지구 위의 좌표인가"만 본다. 0,0(널섬)은 데이터 사고의
 * 전형적인 신호라 좌표로 인정하지 않는다.
 */
export function isRenderableCoordinate(lat: unknown, lng: unknown): lat is number {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** §2 — 모드별로 단 하나의 계획만 나온다. 좌표 모드에서 주소 폴백은 존재하지 않는다. */
export function planMapEmbed(input: MapEmbedInput): MapEmbedPlan {
  if (input.mode === 'coordinate') {
    if (!isRenderableCoordinate(input.latitude, input.longitude)) {
      // 좌표가 이상하면 주소로 **떨어지지 않는다**. 떨어지면 두 모드가 조용히 섞인다.
      return { kind: 'UNRESOLVABLE', reason: 'INVALID_COORDINATE' };
    }
    return { kind: 'USE_STORED_COORDINATE', latitude: input.latitude, longitude: input.longitude };
  }
  const address = input.address?.trim();
  if (!address) return { kind: 'UNRESOLVABLE', reason: 'EMPTY_ADDRESS' };
  return { kind: 'RESOLVE_BY_ADDRESS', address, jibunAddress: input.jibunAddress };
}

/** 계획이 런타임 지오코딩을 유발하는가 — 테스트가 직접 물어보는 질문. */
export function planUsesGeocoding(plan: MapEmbedPlan): boolean {
  return plan.kind === 'RESOLVE_BY_ADDRESS';
}

/** §7 — 오피스텔 위치 카드가 가질 수 있는 상태. */
export type OfficetelLocationState = 'MAP_READY' | 'NO_COORDINATE';

/**
 * 좌표가 없는 8개 master는 **빈 지도를 그리지 않는다**. 재시도 지오코딩도 없고
 * 근처 건물/다른 master 좌표로 대체하지도 않는다 — 그냥 없다고 말한다.
 */
export function officetelLocationState(
  coordinates: { latitude: number; longitude: number } | null | undefined
): OfficetelLocationState {
  if (!coordinates) return 'NO_COORDINATE';
  return isRenderableCoordinate(coordinates.latitude, coordinates.longitude) ? 'MAP_READY' : 'NO_COORDINATE';
}

/** 카드 안에서 지도↔로드뷰는 서로를 오갈 뿐, 페이지를 떠나지 않는다(§5). */
export type LocationView = 'map' | 'roadview';

export function toggleLocationView(current: LocationView): LocationView {
  return current === 'map' ? 'roadview' : 'map';
}

/** SDK 로더가 던진 코드 → 사용자에게 보일 문구. 원인을 뭉개지 않는다. */
export function kakaoSdkErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : String(err);
  switch (code) {
    case 'KAKAO_SDK_NO_KEY':
      return '지도 API 키가 설정되지 않았습니다.';
    case 'KAKAO_SDK_SCRIPT_ERROR':
      return '카카오 지도 스크립트 로드에 실패했습니다.';
    case 'KAKAO_SDK_TIMEOUT':
      return '카카오 지도를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
    default:
      return '지도를 표시할 수 없습니다.';
  }
}
