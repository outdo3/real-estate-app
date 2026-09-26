// GYEONGGI_PUBLIC_BETA_BLOCKER_FIX_PREP_V1 — 지도 아파트 레이어 하단 안내(순수).
//
// 지도는 네 가지 상태를 서로 다른 말로 해야 한다:
//   · 실패(FAILED)          — "불러오지 못했습니다"
//   · 부분 실패(PARTIAL)    — "실제보다 적게 표시될 수 있습니다"
//   · 공개되지 않은 지역     — "아직 지원하지 않는 지역" (서버가 regionUnsupported로 명시)
//   · 검증된 0건(ZERO)      — "표시할 아파트가 없습니다"
// 공개되지 않은 지역을 0건 문구로 말하면 "이 지역엔 아파트/거래가 없다"는 거짓 주장이 된다
// (GYEONGGI_CRON_AND_PUBLIC_READINESS_AUDIT_V1 §10-1: 분당 41135 옆 경기 beta 구에서 실측).
// 판정은 서버 응답의 regionUnsupported 하나만 본다 — 지역 코드를 클라이언트에서 추측하지 않는다.

import { isPublicRegionAllowed } from '../region/enablement';

export type AptMapNoticeTone = 'info' | 'error';
export interface AptMapNotice {
  text: string;
  tone: AptMapNoticeTone;
}

// 상단 지역 안내(아래 MAP_REGION_NOTICE_*)와 같은 화면에 함께 뜰 수 있으므로 같은 문장을 반복하지 않고,
// 하단은 "레이어 상태"만 짧게 말한다. 닫을 수 있는 상단 안내와 달리 이 줄은 지역을 옮길 때까지 남는다.
export const APT_MAP_UNSUPPORTED_REGION_MESSAGE = '아직 지원하지 않는 지역이라 아파트를 표시하지 않습니다.';
export const APT_MAP_ZERO_MESSAGE = '현재 지도 범위에 표시할 아파트가 없습니다.';
export const APT_MAP_ERROR_MESSAGE = '아파트 정보를 불러오지 못했습니다.';
export const APT_MAP_PARTIAL_MESSAGE = '일부 거래 정보를 불러오지 못해 아파트가 실제보다 적게 표시될 수 있습니다.';

export function resolveAptMapNotice(input: {
  layerOn: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
  partial: boolean;
  regionUnsupported: boolean;
  markerCount: number;
}): AptMapNotice | null {
  if (!input.layerOn) return null;
  if (input.status === 'error') return { text: APT_MAP_ERROR_MESSAGE, tone: 'error' };
  if (input.status !== 'ready') return null;
  // 공개되지 않은 지역은 0건보다 먼저 판정한다 — 서버는 이때 빈 배열을 주므로
  // 순서가 바뀌면 곧바로 "표시할 아파트가 없습니다"로 떨어진다.
  if (input.regionUnsupported) return { text: APT_MAP_UNSUPPORTED_REGION_MESSAGE, tone: 'info' };
  if (input.partial) return { text: APT_MAP_PARTIAL_MESSAGE, tone: 'info' };
  if (input.markerCount === 0) return { text: APT_MAP_ZERO_MESSAGE, tone: 'info' };
  return null;
}

// ── 지도 상단 지역 안내(OutOfBusanNotice) ────────────────────────────────────
//
// 예전 판정은 "좌표가 부산 bounding box 밖인가"였고, 문구는 "현재 위치는 부산 외 지역입니다 …
// 부산 지역 데이터를 우선 제공"이었다. 서울 beta 8구가 열린 뒤로는 마커가 정상으로 뜨는 서울에서도
// 이 안내가 떴다(경기 beta도 같은 문제). 이제 **지도가 실제로 조회한 구(lawdCd)의 `map` 축**으로
// 판정한다 — 공개 지역이면 안내하지 않고, 공개되지 않은 지역이면 특정 시도를 말하지 않는 중립 문구를 쓴다.
// 네트워크 호출은 늘지 않는다(lawdCd는 마커 조회가 이미 알아낸 값이다).

export const MAP_REGION_NOTICE_TITLE = '이 지역은 아직 이집에서 지원하지 않습니다.';
export const MAP_REGION_NOTICE_BODY = '이집은 현재 지원 지역의 실거래·단지 정보를 제공하고 있습니다.';

/** 상단 지역 안내를 띄울 지역인가. lawdCd를 아직 모르면(null) 띄우지 않는다 — 모르는 것을 "미지원"이라 하지 않는다. */
export function shouldShowMapRegionNotice(
  lawdCd: string | null | undefined,
  // 테스트가 beta 스위치 조합을 시뮬레이션할 때만 바꾼다(런타임은 항상 isPublicRegionAllowed).
  isAllowed: (lawdCd: string, feature: 'map') => boolean = isPublicRegionAllowed
): boolean {
  if (!lawdCd) return false;
  return !isAllowed(lawdCd, 'map');
}
