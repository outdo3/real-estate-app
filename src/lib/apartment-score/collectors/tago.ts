// STEP SCORE S2B — 서버 전용 TAGO(국토교통부 버스정류소정보) 수집기.
//
// src/app/api/transit/bus-stops/route.ts가 이미 production에서 검증한 방식(좌표기반
// 근접정류소 목록조회, serviceKey 처리, 짧은 1회 재시도)을 그대로 재사용한다. 그
// route는 Next.js Route Handler라 배치 스크립트에서 직접 import할 수 없어(HTTP 요청이
// 아니라 프로세스 내 호출이 필요), 동일한 로직을 이 모듈로 옮겨 담았다 — 새 API/새
// 엔드포인트가 아니라 같은 검증된 호출 방식의 재사용이다.
import { point, distance as turfDistance } from '@turf/turf';

const TAGO_ENDPOINT = 'https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList';

interface TagoStopRaw {
  citycode: number;
  gpslati: number;
  gpslong: number;
  nodeid: string;
  nodenm: string;
  nodeno?: number | string;
}

export interface TagoBusResult {
  ok: boolean;
  nearestBusStopDistanceM: number | null;
  busStopCount300m: number | null;
  errorCategory?: 'no_key' | 'http_error' | 'result_error' | 'network_error';
  errorDetail?: string;
}

function buildServiceKey(): string {
  const rawKey = process.env.DATA_GO_KR_API_KEY || '';
  if (!rawKey) throw new Error('NO_DATA_GO_KR_KEY');
  return encodeURIComponent(decodeURIComponent(rawKey.trim().replace(/['"]/g, '')));
}

async function fetchTagoStopsOnce(lat: number, lng: number): Promise<TagoStopRaw[]> {
  const serviceKey = buildServiceKey();
  const url = `${TAGO_ENDPOINT}?serviceKey=${serviceKey}&gpsLati=${lat}&gpsLong=${lng}&_type=json&numOfRows=200`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`TAGO HTTP ${res.status}`);

  const json = await res.json();
  const resultCode = json?.response?.header?.resultCode;
  if (resultCode !== '00') {
    throw new Error(`TAGO resultCode ${resultCode ?? 'unknown'}: ${json?.response?.header?.resultMsg ?? ''}`);
  }

  const items = json?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

// bus-stops/route.ts에서 실측 확인된 것과 동일한 정책 재사용: 무한 대기가 아니라 고정
// 1회, 고정 400ms 지연 재시도.
async function fetchTagoStops(lat: number, lng: number): Promise<TagoStopRaw[]> {
  try {
    return await fetchTagoStopsOnce(lat, lng);
  } catch (firstError) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      return await fetchTagoStopsOnce(lat, lng);
    } catch {
      throw firstError;
    }
  }
}

// 완전히 동일한 nodeid 중복만 제거(이름/좌표 기반 임의 병합 안 함, bus-stops/route.ts와
// 동일 정책) — 순수 함수로 분리해 실제 fetch 없이도 검증 가능하게 한다.
export function dedupAndSortStops(lat: number, lng: number, raw: TagoStopRaw[]): { distanceMeters: number }[] {
  const seen = new Set<string>();
  const origin = point([lng, lat]);
  return raw
    .filter((s) => {
      if (seen.has(s.nodeid)) return false;
      seen.add(s.nodeid);
      return true;
    })
    .map((s) => ({
      distanceMeters: Math.round(turfDistance(origin, point([s.gpslong, s.gpslati]), { units: 'meters' })),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export async function collectNearestBusStop(lat: number, lng: number): Promise<TagoBusResult> {
  if (!process.env.DATA_GO_KR_API_KEY) {
    return { ok: false, nearestBusStopDistanceM: null, busStopCount300m: null, errorCategory: 'no_key' };
  }

  try {
    const raw = await fetchTagoStops(lat, lng);
    const withDistance = dedupAndSortStops(lat, lng, raw);

    return {
      ok: true,
      nearestBusStopDistanceM: withDistance[0]?.distanceMeters ?? null,
      busStopCount300m: withDistance.filter((s) => s.distanceMeters <= 300).length,
    };
  } catch (e: any) {
    const message = e?.message ?? String(e);
    return {
      ok: false,
      nearestBusStopDistanceM: null,
      busStopCount300m: null,
      errorCategory: message.includes('HTTP') ? 'http_error' : 'result_error',
      errorDetail: message,
    };
  }
}
