import React, { useEffect, useState } from 'react';
import { formatEta } from './KakaoPlaces';
import styles from '@/app/apt/[name]/detail.module.css';

interface Props {
  // PERCEIVED_PERFORMANCE_V2_DATAFLOW §2/§3/§4/§9 — 주소 문자열이 아니라 서버가 준
  // canonical 좌표(ApartmentMaster)를 받는다. 예전에는 여기서 SDK 로드 → addressSearch
  // (실측 항상 실패) → keywordSearch 폴백(결과 75건 중 첫 번째 채택) 3단계를 거친 뒤에야
  // /api/transit/bus-stops 요청이 시작됐다 — 버스 지연의 절반 이상이 이 구간이었고,
  // 폴백은 이름 기반 재식별 위험이기도 했다. 이제 좌표가 있으면 곧바로 요청한다.
  coords: { lat: number; lng: number } | null;
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
//
// PERCEIVED_PERFORMANCE_V2_DATAFLOW §3 — 위치 확보에 더 이상 Kakao SDK를 쓰지 않는다.
// 이 컴포넌트는 이제 카카오 SDK를 import조차 하지 않으며(grep으로 재확인 가능),
// 좌표는 상위가 서버에서 받은 canonical 값을 그대로 내려준다.
export default function BusAccessCard({ coords }: Props) {
  const [data, setData] = useState<BusStopData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // §5 — 의존성은 좌표 원시값이다. regionName 같은 표시용 라벨이 뒤늦게 바뀌어도
  // 이 effect는 다시 돌지 않는다(예전에는 이미 떠 있던 버스 정보가 skeleton으로
  // 되돌아갔다).
  const lat = coords?.lat ?? null;
  const lng = coords?.lng ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setData(null);

    if (lat == null || lng == null) {
      // 좌표가 없으면 추측하지 않는다 — 다른 단지의 정류장을 보여주는 것보다
      // 모른다고 말하는 편이 낫다.
      setError('위치 정보를 확인할 수 없어 버스 정보를 표시할 수 없습니다.');
      setLoading(false);
      return () => { cancelled = true; };
    }

    // §9 — 클릭 즉시 요청이 시작된다. Kakao SDK도, 지오코딩도 이 경로에 없다.
    (async () => {
      try {
        const res = await fetch(`/api/transit/bus-stops?lat=${lat}&lng=${lng}`);
        if (cancelled) return;
        if (!res.ok) {
          setError('버스 정보를 불러오지 못했습니다.');
          setLoading(false);
          return;
        }
        const json = await res.json();
        if (cancelled) return;
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
    })();

    return () => { cancelled = true; };
  }, [lat, lng]);

  // UX QA — TAGO(국토교통부 버스정류소정보)는 서버 캐시(6h)가 없는 좌표를 처음 조회할
  // 때 실측 3초 이상 걸릴 수 있다(외부 공공데이터 API 자체 지연, 캐시 적중 시 20ms대로
  // 확인됨 — 프론트 구조 문제가 아니라 최초 방문에서만 발생). 재호출 없이 체감을
  // 개선하기 위해 최종 콘텐츠와 같은 모양의 skeleton으로 대기 상태를 보여준다.
  if (loading) {
    return (
      <div style={{ lineHeight: 1.8 }} aria-busy="true">
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>가장 가까운 정류장</div>
        <div className={styles.skeletonBar} style={{ width: '65%', height: '1.1rem', marginTop: '0.25rem' }} />
        <div style={{ marginTop: '0.6rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>운행 노선</div>
          <div className={styles.skeletonBar} style={{ width: '80%', height: '1rem', marginTop: '0.25rem' }} />
        </div>
      </div>
    );
  }
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
