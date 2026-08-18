import { NextResponse } from 'next/server';
import { point, distance } from '@turf/turf';
import { getOrSetCache } from '@/lib/server-cache';

// 국토교통부_(TAGO)_버스정류소정보 "좌표기반근접정류소 목록조회" — 좌표 반경 내 정류소만
// 돌려주는 고정 반경 오퍼레이션이라(공식 문서·실측 모두 별도 radius 파라미터 없음, 실측
// 결과 최대 거리 항상 500m 이하) radius를 직접 요청하지 않는다. 문서(44번)에서 Kakao Local은
// 시내버스 정류장을 아예 검색하지 못함을 확인했고, 여기서 그 대안으로 채택한 API다.
const TAGO_ENDPOINT = 'https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList';

interface TagoStopRaw {
  citycode: number;
  gpslati: number;
  gpslong: number;
  nodeid: string;
  nodenm: string;
  nodeno?: number | string;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 정류소 위치는 자주 바뀌지 않는다

async function fetchTagoStopsOnce(lat: number, lng: number): Promise<TagoStopRaw[]> {
  const rawKey = process.env.DATA_GO_KR_API_KEY || '';
  if (!rawKey) throw new Error('DATA_GO_KR_API_KEY not configured');
  const serviceKey = encodeURIComponent(decodeURIComponent(rawKey.trim().replace(/['"]/g, '')));

  const url = `${TAGO_ENDPOINT}?serviceKey=${serviceKey}&gpsLati=${lat}&gpsLong=${lng}&_type=json&numOfRows=200`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`TAGO HTTP ${res.status}`);

  const json = await res.json();
  const resultCode = json?.response?.header?.resultCode;
  // "00"만 정상 — 그 외(키 오류, 트래픽 초과, 일시 장애 등)는 "0건"과 구분해 실패로 취급한다.
  if (resultCode !== '00') {
    throw new Error(`TAGO resultCode ${resultCode ?? 'unknown'}: ${json?.response?.header?.resultMsg ?? ''}`);
  }

  const items = json?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

// data.go.kr가 짧은 간격의 연속 호출에 타임아웃/비정상 응답으로 반응하는 경우를 실측으로
// 확인했다(같은 프로세스에서 6개 좌표를 연달아 호출하니 4곳 실패, 2초 간격을 두니 전부
// 성공) — 정상적인 페이지 방문(단지당 1회 호출)에서는 거의 발생하지 않지만, 재배포 직후
// 캐시가 비어 있을 때 등 우연히 순간 트래픽이 겹치는 경우를 대비해 1회만 짧게 재시도한다.
// "무한 대기"가 아니라 고정 1회, 고정 지연이다.
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = parseFloat(searchParams.get('lat') || '');
  const lng = parseFloat(searchParams.get('lng') || '');

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ success: false, error: 'lat/lng required' }, { status: 400 });
  }

  const cacheKey = `bus-stops:${lat.toFixed(4)}:${lng.toFixed(4)}`;

  try {
    const data = await getOrSetCache(cacheKey, CACHE_TTL_MS, async () => {
      const raw = await fetchTagoStops(lat, lng);

      // 완전히 동일한 정류소ID 중복 응답만 제거한다(§10) — 이름/좌표 기준의 임의 병합은
      // 하지 않는다. 행정구역 경계 인근에서는 동일 물리 정류장이 인접 지자체 시스템에도
      // 별도 nodeid로 등록돼 있어(citycode가 다름) 중복처럼 보일 수 있는데, 이는 이름/좌표
      // 기반으로 병합하지 않기로 한 정책상 의도적으로 남겨두고 문서에만 한계로 기록한다.
      const seen = new Set<string>();
      const origin = point([lng, lat]);
      const withDistance = raw
        .filter((s) => {
          if (seen.has(s.nodeid)) return false;
          seen.add(s.nodeid);
          return true;
        })
        .map((s) => ({
          stopId: s.nodeid,
          stopName: s.nodenm,
          stopNo: s.nodeno != null ? String(s.nodeno) : null,
          cityCode: s.citycode,
          distanceMeters: Math.round(distance(origin, point([s.gpslong, s.gpslati]), { units: 'meters' })),
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters);

      return {
        nearestBusStop: withDistance[0] ?? null,
        busStopCountWithin300m: withDistance.filter((s) => s.distanceMeters <= 300).length,
        busStopCountWithin500m: withDistance.filter((s) => s.distanceMeters <= 500).length,
        totalCount: withDistance.length,
      };
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('TAGO bus-stops lookup failed', error);
    return NextResponse.json({ success: false, error: 'bus stop lookup failed' }, { status: 502 });
  }
}
