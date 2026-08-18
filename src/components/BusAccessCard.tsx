import React, { useEffect, useState } from 'react';
import { formatEta } from './KakaoPlaces';

interface Props {
  address: string;
}

interface BusRoute {
  routeNo: string;
  routeType: string;
}

interface BusStopData {
  nearestBusStop: {
    stopId: string;
    stopName: string;
    stopNo: string | null;
    distanceMeters: number;
    routes: BusRoute[] | null;
  } | null;
  // [UI-C3-3] 300m/500m 정류장 개수는 사용자 판단에 도움이 되지 않아 화면에서 제거했다
  // (§1 지시) — 다만 향후 교통점수/이집 브리핑용으로 API 응답 자체에는 계속 유지한다.
  busStopCountWithin300m: number;
  busStopCountWithin500m: number;
  totalCount: number;
}

const MAX_VISIBLE_ROUTES = 4;

// TAGO routeno는 "11"처럼 숫자형과 "A01"처럼 문자형이 섞여 온다(원본 응답 자체가 그렇다,
// route.ts 참고) — 화면에는 숫자가 작은 순으로 먼저 보이는 편이 자연스러워 숫자 우선 정렬한다.
function sortRoutes(routes: BusRoute[]): BusRoute[] {
  return [...routes].sort((a, b) => {
    const na = parseInt(a.routeNo, 10);
    const nb = parseInt(b.routeNo, 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    if (Number.isFinite(na) !== Number.isFinite(nb)) return Number.isFinite(na) ? -1 : 1;
    return a.routeNo.localeCompare(b.routeNo);
  });
}

function formatRoutes(routes: BusRoute[]): string {
  const sorted = sortRoutes(routes);
  const visible = sorted.slice(0, MAX_VISIBLE_ROUTES).map((r) => r.routeNo);
  const rest = sorted.length - visible.length;
  return rest > 0 ? `${visible.join(' · ')} 외 ${rest}개` : visible.join(' · ');
}

// STEP 44에서 확인했듯 Kakao Local은 일반 시내버스 정류장을 검색하지 못해(문서
// docs/development/44-apartment-detail-bus-access.md 참고), 국토교통부(TAGO)
// 버스정류소정보 API(/api/transit/bus-stops)로 좌표 기반 근접 정류장을 조회한다.
// 위치 확보는 KakaoPlaces.tsx/KakaoMapEmbed.tsx와 동일하게 Kakao Geocoder를 쓴다
// (client에서는 REST 직접 호출 시 Origin 헤더를 임의로 못 넣으므로 JS SDK 필요).
export default function BusAccessCard({ address }: Props) {
  const [data, setData] = useState<BusStopData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);

    const run = async () => {
      const geocoder = new window.kakao.maps.services.Geocoder();
      const ps = new window.kakao.maps.services.Places();

      const fetchBusStops = async (lat: number, lng: number) => {
        if (cancelled) return;
        try {
          const res = await fetch(`/api/transit/bus-stops?lat=${lat}&lng=${lng}`);
          if (cancelled) return;
          if (!res.ok) {
            setError('버스 정보를 불러오지 못했습니다.');
            setLoading(false);
            return;
          }
          const json = await res.json();
          if (!json.success) {
            setError('버스 정보를 불러오지 못했습니다.');
          } else if (json.data.totalCount === 0) {
            setError('검색 반경 내 버스정류장 정보가 없습니다.');
          } else {
            setData(json.data);
          }
        } catch {
          if (!cancelled) setError('버스 정보를 불러오지 못했습니다.');
        } finally {
          if (!cancelled) setLoading(false);
        }
      };

      geocoder.addressSearch(address, (result: any, status: any) => {
        if (cancelled) return;
        if (status === window.kakao.maps.services.Status.OK) {
          fetchBusStops(parseFloat(result[0].y), parseFloat(result[0].x));
        } else {
          ps.keywordSearch(address, (res: any, status2: any) => {
            if (cancelled) return;
            if (status2 === window.kakao.maps.services.Status.OK) {
              fetchBusStops(parseFloat(res[0].y), parseFloat(res[0].x));
            } else {
              setError('위치를 찾을 수 없어 버스 정보를 검색할 수 없습니다.');
              setLoading(false);
            }
          });
        }
      });
    };

    const loadAndRun = () => {
      window.kakao.maps.load(() => {
        setTimeout(run, 100);
      });
    };

    if (window.kakao && window.kakao.maps) {
      loadAndRun();
      return () => {
        cancelled = true;
      };
    }

    const scriptId = 'kakao-map-script-main';
    let script = document.getElementById(scriptId) as HTMLScriptElement;

    if (!script) {
      const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
      if (!apiKey) {
        setError('지도 API 키가 설정되지 않았습니다.');
        setLoading(false);
        return () => {
          cancelled = true;
        };
      }
      script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer,drawing&autoload=false`;
      document.head.appendChild(script);
    }

    script.addEventListener('load', loadAndRun);
    return () => {
      cancelled = true;
      script.removeEventListener('load', loadAndRun);
    };
  }, [address]);

  if (loading) return <div>검색 중입니다...</div>;
  if (error) return <div style={{ color: 'var(--text-muted)' }}>{error}</div>;
  if (!data) return null;

  if (!data.nearestBusStop) return null;
  const { stopName, distanceMeters, routes } = data.nearestBusStop;

  return (
    <div style={{ lineHeight: 1.8 }}>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>가장 가까운 정류장</div>
      <div>
        <b>{stopName}</b>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginLeft: '0.5rem' }}>
          {distanceMeters}m · {formatEta(distanceMeters)}
        </span>
      </div>
      {/* routes === null: 노선 조회 실패(정류장 자체는 정상) — 조용히 생략, 잘못된 값을
          보여주지 않는다. routes.length === 0: 조회는 성공했지만 경유 노선이 없는 정류장. */}
      {routes && routes.length > 0 && (
        <div style={{ marginTop: '0.5rem', wordBreak: 'keep-all' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>운행 노선</div>
          <div>{formatRoutes(routes)}</div>
        </div>
      )}
      {routes && routes.length === 0 && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          경유 노선 정보가 없습니다.
        </div>
      )}
    </div>
  );
}
