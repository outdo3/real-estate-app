// E-JIP FINAL DEVICE UX FIX V1 — /map 첫 진입 위치 확정.
//
// 실기기(Android Chrome) 재현: 지도 버튼 → 부산 서구청 근처가 잠깐 보임 → 잠시 후 현재 위치로 이동.
//
// 원인(코드 기준):
//  1) center 초기값이 DEFAULT_MAP_CENTER(35.0979, 129.0244 = 부산 서구청, map-marker-share.ts
//     하드코딩)였다. 저장된 위치가 아니라 상수다.
//  2) 지오로케이션은 마운트 effect에서 시작하지만, 지도 렌더 게이트는 Kakao SDK 준비
//     (isMapReady)만 기다렸다. SDK(실측 약 1.5s)가 GPS보다 먼저 준비되면 KakaoMap이 서구청으로
//     먼저 그려지고, GPS 응답이 오면 setCenter로 옮겨졌다 — 이것이 flash다.
//  3) 같은 순간 최초 마커 로드도 기본 center(= 서구 lawdCd)로 나갔고, 지오로케이션의 setCenter는
//     레이어를 다시 부르지 않았다 — 지도는 현재 위치로 옮겨졌는데 마커는 서구 것이 남을 수 있었다.
//  4) URL 동기화도 isMapReady 이후면 바로 기본 center를 URL에 썼다. 그 사이 새로고침/뒤로가기로
//     돌아오면 그 URL이 "복원 상태"로 읽혀 지오로케이션을 건너뛰고 서구청이 다시 보였다.
//
// 해결: 위치를 먼저 확정한 뒤에 지도를 그린다. 확정 전에는 "현재 위치를 확인하고 있어요" 로더를
// 보이고, 확정 결과의 출처(gps/ip/default)를 함께 넘겨 기본 지역이 현재 위치처럼 보이지 않게 한다.
// 위치 정책 자체(GPS → IP → 기본 지역, 공유/복원 링크는 지오로케이션 생략)는 바꾸지 않는다.

export interface LatLng {
  lat: number;
  lng: number;
}

/** url = 공유/복원 링크의 center(지오로케이션을 하지 않는다). */
export type InitialLocationSource = 'url' | 'gps' | 'ip' | 'default';
export type PermissionStateLike = 'granted' | 'denied' | 'prompt' | 'unknown';

export interface PositionLike {
  coords: { latitude: number; longitude: number };
}

export interface InitialLocationDeps {
  /** navigator.geolocation.getCurrentPosition. 지원하지 않으면 null. */
  getCurrentPosition:
    | ((ok: (pos: PositionLike) => void, err: (e: unknown) => void, options: PositionOptions) => void)
    | null;
  /** Permissions API 조회. 지원하지 않거나 실패하면 'unknown'. */
  queryPermission: () => Promise<PermissionStateLike>;
  /** 기존 IP 기반 위치 조회(실패 시 null). 호출부가 자체 timeout을 건다. */
  lookupIp: () => Promise<LatLng | null>;
  setTimer: (fn: () => void, ms: number) => () => void;
}

export interface InitialLocationCallbacks {
  onResolved: (center: LatLng, source: Exclude<InitialLocationSource, 'url'>) => void;
  /** 대기 상한 뒤 대체 위치로 이미 그렸는데 GPS가 늦게 도착한 경우. */
  onLateGps: (center: LatLng) => void;
}

/** 기존 마운트 effect의 옵션 그대로. */
export const INITIAL_GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10000,
  maximumAge: 300000,
};

/**
 * 권한이 이미 허용된 경우의 최대 대기. GPS가 느리면 로더에 계속 묶어두지 않고 대체 위치로
 * 그린다(늦게 온 GPS는 사용자가 아직 지도를 안 움직였을 때만 반영).
 * 권한 프롬프트가 떠 있을 수 있는 상태('prompt'/'unknown')에서는 상한을 걸지 않는다 —
 * 사용자가 "허용"을 누르기 전에 기본 지역이 먼저 그려지면 이번에 고치려는 flash가 그대로 난다.
 * 그 경우는 브라우저의 geolocation timeout(허용 이후부터 계산)이 상한이다.
 */
export const GRANTED_GPS_WAIT_CAP_MS = 4000;
export const IP_LOOKUP_TIMEOUT_MS = 3000;

export const MAP_LOCATING_MESSAGE = '현재 위치를 확인하고 있어요';

export function isValidLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== 'object') return false;
  const { lat, lng } = value as LatLng;
  return (
    typeof lat === 'number' && typeof lng === 'number'
    && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

export function sameLatLng(a: LatLng | null | undefined, b: LatLng | null | undefined): boolean {
  return !!a && !!b && a.lat === b.lat && a.lng === b.lng;
}

/** ipinfo 응답의 "lat,lng" 문자열 → 좌표. 해석할 수 없으면 null(기본 지역으로 넘어간다). */
export function parseIpLoc(loc: unknown): LatLng | null {
  if (typeof loc !== 'string') return null;
  const [lat, lng] = loc.split(',').map((part) => parseFloat(part));
  const value = { lat, lng };
  return isValidLatLng(value) ? value : null;
}

/**
 * 첫 진입 위치를 확정한다. 반환값은 취소 함수(언마운트 시 호출).
 *
 * - 권한 거부 / geolocation 미지원 → IP → 기본 지역.
 * - GPS 성공 → gps. GPS 실패 → IP → 기본 지역.
 * - 권한 'granted'인데 GPS가 GRANTED_GPS_WAIT_CAP_MS 안에 안 오면 → IP → 기본 지역으로 확정하고,
 *   그 뒤 도착한 GPS는 onLateGps로 알린다.
 * - onResolved는 정확히 한 번만 부른다.
 */
export function locateInitialCenter(
  fallback: LatLng,
  deps: InitialLocationDeps,
  callbacks: InitialLocationCallbacks
): () => void {
  let cancelled = false;
  let resolved = false;
  let fallbackStarted = false;
  let cancelCap: () => void = () => {};

  const resolve = (center: LatLng, source: Exclude<InitialLocationSource, 'url'>) => {
    if (cancelled || resolved) return;
    resolved = true;
    cancelCap();
    callbacks.onResolved(center, source);
  };

  const runFallback = async () => {
    if (cancelled || resolved || fallbackStarted) return;
    fallbackStarted = true;
    let ip: LatLng | null = null;
    try {
      ip = await deps.lookupIp();
    } catch {
      ip = null;
    }
    if (isValidLatLng(ip)) resolve(ip, 'ip');
    else resolve(fallback, 'default');
  };

  void (async () => {
    let permission: PermissionStateLike = 'unknown';
    try {
      permission = await deps.queryPermission();
    } catch {
      permission = 'unknown';
    }
    if (cancelled) return;

    if (!deps.getCurrentPosition || permission === 'denied') {
      await runFallback();
      return;
    }

    if (permission === 'granted') {
      cancelCap = deps.setTimer(() => { void runFallback(); }, GRANTED_GPS_WAIT_CAP_MS);
    }

    deps.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        const center = { lat: pos?.coords?.latitude, lng: pos?.coords?.longitude };
        if (!isValidLatLng(center)) {
          void runFallback();
          return;
        }
        if (resolved) callbacks.onLateGps(center);
        else resolve(center, 'gps');
      },
      () => { void runFallback(); },
      INITIAL_GEOLOCATION_OPTIONS
    );
  })();

  return () => {
    cancelled = true;
    cancelCap();
  };
}

/**
 * 대체 위치(IP/기본 지역)로 그렸을 때만 그 사실을 말한다. 사용자가 지도를 옮기면(center가 바뀌면)
 * 더 이상 "지금 보이는 곳 = 대체 위치"가 아니므로 숨긴다.
 */
export function initialLocationNotice(
  source: InitialLocationSource | null,
  resolvedCenter: LatLng | null,
  currentCenter: LatLng
): string | null {
  if (!sameLatLng(resolvedCenter, currentCenter)) return null;
  if (source === 'ip') return '현재 위치를 확인하지 못해 접속 지역 기준으로 보여드려요.';
  if (source === 'default') return '현재 위치를 확인하지 못해 기본 지역(부산 서구)을 보여드려요.';
  return null;
}

/** 늦게 온 GPS는 사용자가 아직 대체 위치를 그대로 보고 있을 때만 반영한다(사용자 조작을 덮지 않는다). */
export function shouldApplyLateGps(
  source: InitialLocationSource | null,
  resolvedCenter: LatLng | null,
  currentCenter: LatLng
): boolean {
  return (source === 'ip' || source === 'default') && sameLatLng(resolvedCenter, currentCenter);
}
