import { NextResponse } from 'next/server';
import { point, distance } from '@turf/turf';
import { getOrSetCache } from '@/lib/server-cache';

// 국토교통부_(TAGO)_버스정류소정보 "좌표기반근접정류소 목록조회" — 좌표 반경 내 정류소만
// 돌려주는 고정 반경 오퍼레이션이라(공식 문서·실측 모두 별도 radius 파라미터 없음, 실측
// 결과 최대 거리 항상 500m 이하) radius를 직접 요청하지 않는다. 문서(44번)에서 Kakao Local은
// 시내버스 정류장을 아예 검색하지 못함을 확인했고, 여기서 그 대안으로 채택한 API다.
const TAGO_ENDPOINT = 'https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList';
// 같은 서비스(국토교통부_(TAGO)_버스정류소정보, data.go.kr/data/15098534) 내 별도 오퍼레이션 —
// 정류소경유노선 목록조회. 활용신청은 서비스 단위라 기존 승인만으로 호출 가능(STEP 47 조사,
// 별도 신청 불필요 확인).
const TAGO_ROUTES_ENDPOINT = 'https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getSttnThrghRouteList';

interface TagoStopRaw {
  citycode: number;
  gpslati: number;
  gpslong: number;
  nodeid: string;
  nodenm: string;
  nodeno?: number | string;
}

interface TagoRouteRaw {
  routeid: string;
  routeno: number | string;
  routetp: string;
  startnodenm: string;
  endnodenm: string;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 정류소 위치는 자주 바뀌지 않는다
const ROUTES_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 노선 구성도 자주 바뀌지 않는다

// PERCEIVED_PERFORMANCE_V2 §3 — CDN(공유) 캐시 정책.
//
// 왜 필요한가: 위 getOrSetCache는 `src/lib/server-cache.ts`의 모듈 전역 Map이라
// **서버리스 인스턴스 하나의 수명 동안만** 유효하다. 실측(감사 V1 §4.5)에서 TAGO
// cold는 1,426 / 3,226 / 3,769 / 7,901ms, warm은 50~82ms였다 — 인스턴스가 재활용되거나
// 요청이 다른 인스턴스로 가면 사용자는 다시 cold를 만난다. 즉 "6시간 TTL"은 실제로
// "6시간 또는 이 인스턴스가 죽을 때까지 중 짧은 쪽"이었다.
//
// 이 응답은 CDN 공유 캐시에 담기에 적합하다:
//   - 캐시 키는 URL 전체이고, 결과에 영향을 주는 파라미터는 lat/lng 둘뿐이다
//     (아래 GET은 그 외 어떤 입력도 읽지 않는다) → 위치 간 오염이 구조적으로 불가능하다.
//   - 사용자별 데이터가 전혀 없다. 쿠키/세션/인증을 읽지 않는다.
//   - 내용은 공공데이터(정류소 위치·경유 노선)이며 개인정보가 아니다.
//
// TTL 6시간(21600s)은 위 in-memory TTL과 **같은 값·같은 근거**를 쓴다(정류소 위치와
// 노선 구성은 자주 바뀌지 않는다). 새로운 신선도 기준을 임의로 만들지 않았다.
// stale-while-revalidate 24시간은 TTL이 지난 직후 한 명이 cold를 뒤집어쓰는 것을 막는다
// — 이 데이터는 시세/실거래가 아니라 정류소 위치라서 잠깐 이전 값이 나가도 의미가
// 훼손되지 않는다.
const SUCCESS_CACHE_CONTROL = 'public, s-maxage=21600, stale-while-revalidate=86400';

// 실패/불완전 응답은 **절대 공유 캐시에 담지 않는다**. 담기면 한 번의 TAGO 장애가
// 6시간 동안 모든 사용자에게 박제된다(같은 이유로 in-memory 캐시도 노선 조회 실패를
// 정류소 캐시와 분리해 두었다 — 아래 §노선 조회 주석 참고).
const NO_STORE_CACHE_CONTROL = 'no-store';

function buildServiceKey(): string {
  const rawKey = process.env.DATA_GO_KR_API_KEY || '';
  if (!rawKey) throw new Error('DATA_GO_KR_API_KEY not configured');
  return encodeURIComponent(decodeURIComponent(rawKey.trim().replace(/['"]/g, '')));
}

async function fetchTagoStopsOnce(lat: number, lng: number): Promise<TagoStopRaw[]> {
  const serviceKey = buildServiceKey();

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

// STEP 47 조사 결과: 요청 파라미터명이 반드시 소문자 "nodeid"여야 한다 — 문서에 흔한 표기인
// camelCase "nodeId"로 보내면 TAGO가 그 파라미터를 조용히 무시하고 cityCode 전체 노선
// 목록(부산 302개)을 돌려준다(에러 없이 resultCode "00"으로 응답해 실수로 놓치기 쉽다).
// 실제 호출로 직접 검증했다 — 다른 정류장의 노선을 대신 표시하는 사고를 막기 위한 핵심 주의점.
async function fetchTagoRoutesOnce(cityCode: number, nodeid: string): Promise<TagoRouteRaw[]> {
  const serviceKey = buildServiceKey();

  const url = `${TAGO_ROUTES_ENDPOINT}?serviceKey=${serviceKey}&cityCode=${cityCode}&nodeid=${encodeURIComponent(nodeid)}&_type=json&numOfRows=50`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`TAGO routes HTTP ${res.status}`);

  const json = await res.json();
  const resultCode = json?.response?.header?.resultCode;
  if (resultCode !== '00') {
    throw new Error(`TAGO routes resultCode ${resultCode ?? 'unknown'}: ${json?.response?.header?.resultMsg ?? ''}`);
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

async function fetchTagoRoutes(cityCode: number, nodeid: string): Promise<TagoRouteRaw[]> {
  try {
    return await fetchTagoRoutesOnce(cityCode, nodeid);
  } catch (firstError) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      return await fetchTagoRoutesOnce(cityCode, nodeid);
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
    return NextResponse.json(
      { success: false, error: 'lat/lng required' },
      { status: 400, headers: { 'Cache-Control': NO_STORE_CACHE_CONTROL } }
    );
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

      const nearest = withDistance[0] ?? null;

      return {
        nearestBusStop: nearest,
        busStopCountWithin300m: withDistance.filter((s) => s.distanceMeters <= 300).length,
        busStopCountWithin500m: withDistance.filter((s) => s.distanceMeters <= 500).length,
        totalCount: withDistance.length,
      };
    });

    // [UI-C3-3] 노선번호는 "가장 가까운 정류장" 1곳만 조회한다(§9 호출량 최적화 지시) — 주변
    // 40여 곳 전부를 조회하지 않는다. 정류소 위치 캐시(6h)와 별도 캐시 키로 분리했다 — 같은
    // getOrSetCache 안에 묶으면 노선 조회가 일시적으로 실패했을 때 그 실패가 정류소 위치
    // 캐시 전체에 6시간 동안 박제돼(재배포 없이는 재시도가 안 됨) 나중에 TAGO가 복구돼도
    // 계속 잘못된 결과를 준다 — 실측으로 이 문제를 직접 재현해 분리했다. getOrSetCache는
    // fetcher가 throw하면 아무것도 캐시하지 않으므로(server-cache.ts 참고), 노선 조회
    // 실패는 캐시되지 않고 다음 요청에서 자연히 재시도된다.
    let routes: { routeNo: string; routeType: string }[] | null = null;
    if (data.nearestBusStop) {
      const { cityCode, stopId } = data.nearestBusStop;
      try {
        routes = await getOrSetCache(`bus-routes:${cityCode}:${stopId}`, ROUTES_CACHE_TTL_MS, async () => {
          const rawRoutes = await fetchTagoRoutes(cityCode, stopId);
          return rawRoutes.map((r) => ({ routeNo: String(r.routeno), routeType: r.routetp }));
        });
      } catch (error) {
        console.error('TAGO route lookup failed', error);
        routes = null;
      }
    }

    const responseData = {
      ...data,
      nearestBusStop: data.nearestBusStop ? { ...data.nearestBusStop, routes } : null,
    };

    // PERCEIVED_PERFORMANCE_V2 §3 — "완전히 성공한 응답"만 공유 캐시에 담는다.
    //
    // 정류소가 있는데 routes === null 이면 노선 조회가 실패한 것이다(정류장 자체는
    // 정상). 그 부분 실패 상태를 CDN에 6시간 박제하면, TAGO가 복구된 뒤에도 사용자는
    // 계속 노선 없는 화면을 보게 된다 — in-memory 캐시가 이미 같은 이유로 노선 실패를
    // 캐시하지 않는데(getOrSetCache는 throw 시 아무것도 담지 않는다) CDN이 그 원칙을
    // 무력화해서는 안 된다.
    //
    // totalCount === 0(반경 내 정류소 없음)은 실패가 아니라 **검증된 진짜 0건**이므로
    // 정상적으로 캐시한다 — E-JIP 데이터 원칙상 성공적인 0은 "없음"이 맞다.
    const isFullySuccessful = data.nearestBusStop === null || routes !== null;

    return NextResponse.json(
      { success: true, data: responseData },
      { headers: { 'Cache-Control': isFullySuccessful ? SUCCESS_CACHE_CONTROL : NO_STORE_CACHE_CONTROL } }
    );
  } catch (error) {
    console.error('TAGO bus-stops lookup failed', error);
    return NextResponse.json(
      { success: false, error: 'bus stop lookup failed' },
      { status: 502, headers: { 'Cache-Control': NO_STORE_CACHE_CONTROL } }
    );
  }
}
