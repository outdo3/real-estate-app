// OFFICETEL_MAP_LAYER_V1 §3/§4 — 메인 지도 오피스텔 레이어의 **순수 로직**(DB/네트워크 없음).
// zero-import 유지(strip-types 테스트 러너 제약 — detail-contract.ts / search-contract.ts와 동일).
//
// 이 레이어의 데이터 원천은 오직 `officetel_masters`에 **이미 저장된 좌표**다.
// 런타임 지오코딩(주소/지번/건물명/Kakao keywordSearch)은 금지이며(§3), 좌표가 없는
// master는 마커에서 조용히 빠지는 것이 아니라 "제외됨"으로 세어 보고한다(§11).
//
// 좌표가 같다는 이유로 서로 다른 master를 하나로 합치지 않는다(§10) — 동일 좌표 79건은
// 오류가 아니라 SITE_LEVEL 좌표 공유이며, identity(master id / canonicalKey)는 각자 유지된다.

/** 한 번의 레이어 조회가 다루는 행정 단위 = 시군구(lawdCd 5자리). 아파트 레이어와 같은 관례. */
export function parseOfficetelMarkerLawdCd(raw: string | null): string {
  const s = (raw ?? '').trim();
  if (!/^\d{5}$/.test(s)) throw new OfficetelMarkerQueryError('lawdCd는 5자리 숫자여야 합니다.');
  return s;
}

export class OfficetelMarkerQueryError extends Error {}

/** 지도 마커 하나. 거래 이력/가격은 절대 담지 않는다(§4/§7). */
export interface OfficetelMapMarker {
  /** 지도 내부 마커 id. 아파트 마커 id와 절대 충돌하지 않도록 접두사를 붙인다. */
  id: string;
  /** 정확한 identity — 상세 이동은 반드시 이 값으로 한다(§9). */
  officetelId: number;
  canonicalKey: string;
  /** 표시 전용 라벨(빈 이름은 "법정동 지번 오피스텔"). DB에 쓰지 않는다(§8). */
  displayName: string;
  lat: number;
  lng: number;
  dong: string;
  jibun: string;
  buildingDong: string | null;
  roadAddress: string | null;
  /** 규모는 **호** 단위다. 세대수가 아니다. 없으면 null(=정보 없음). */
  hoCnt: number | null;
  propertyType: 'officetel';
}

export const OFFICETEL_MARKER_ID_PREFIX = 'offi-';

/** 아파트 마커 id(aptSeq 또는 `dong-name`)와 절대 겹치지 않는 지도 내부 id. */
export function officetelMarkerId(officetelId: number): string {
  return `${OFFICETEL_MARKER_ID_PREFIX}${officetelId}`;
}

export function isOfficetelMarkerId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(OFFICETEL_MARKER_ID_PREFIX);
}

export interface OfficetelMarkerSourceRow {
  id: number;
  canonicalKey: string;
  umdNm: string;
  jibun: string;
  buildingDong: string | null;
  roadAddress: string | null;
  hoCnt: number | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * 저장된 좌표가 **실제로 쓸 수 있을 때만** 마커를 만든다. null/NaN/Infinity/0,0은 제외한다 —
 * 값이 없다는 사실을 (0,0) 같은 그럴듯한 좌표로 덮지 않는다(§3 "wrong map > no map").
 *
 * `displayName`은 호출부가 detail-contract의 officetelFallbackDisplayName()으로 계산해
 * 넘긴다 — 검색/상세와 **같은 폴백 규칙 하나**를 쓰기 위해 이 파일이 규칙을 재구현하지 않는다.
 */
export function buildOfficetelMapMarker(
  row: OfficetelMarkerSourceRow,
  displayName: string
): OfficetelMapMarker | null {
  const lat = row.latitude;
  const lng = row.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return {
    id: officetelMarkerId(row.id),
    officetelId: row.id,
    canonicalKey: row.canonicalKey,
    displayName,
    lat,
    lng,
    dong: row.umdNm,
    jibun: row.jibun,
    buildingDong: row.buildingDong,
    roadAddress: row.roadAddress,
    hoCnt: row.hoCnt,
    propertyType: 'officetel',
  };
}

/** 마커 클릭 카드에 쓰는 주소 한 줄. 도로명이 있으면 우선하고, 없으면 지번 주소를 만든다. */
export function officetelMarkerAddressLine(m: {
  roadAddress: string | null;
  dong: string;
  jibun: string;
}): string | null {
  const road = (m.roadAddress ?? '').trim();
  if (road !== '') return road;
  const parts = [(m.dong ?? '').trim(), (m.jibun ?? '').trim()].filter((s) => s !== '');
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * §19 — 한 화면에 그리는 마커 수 상한. 넘으면 **말없이 자르지 않고** 몇 곳을 못 그렸는지
 * 화면에 알린다(silent truncation 금지).
 */
export const OFFICETEL_RENDER_CAP = 400;

/**
 * §7/§19 — 이 확대 단계보다 축소하면 오피스텔 마커를 그리지 않는다. 부산진구(845건)처럼
 * 밀집한 구에서 시 전체 축소 상태로 수백 개 칩을 펼치면 서로 완전히 겹쳐 아무것도 고를 수
 * 없게 되고 DOM도 불필요하게 커진다 — "안 보이는 마커"를 만드는 대신 확대를 안내한다.
 * (카카오맵 레벨은 숫자가 작을수록 확대. 지도 기본 진입 레벨은 4라 기본 상태에선 항상 보인다.)
 */
export const OFFICETEL_MAX_ZOOM_LEVEL = 6;

/** 오피스텔 레이어의 화면 상태 — FAILED와 ZERO를 절대 같은 값으로 접지 않는다(§14). */
export type OfficetelLayerStatus = 'idle' | 'loading' | 'ready' | 'error';
