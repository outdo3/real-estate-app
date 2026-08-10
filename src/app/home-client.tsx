'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Map, CustomOverlayMap } from 'react-kakao-maps-sdk';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import RegionSelectModal from '@/components/RegionSelectModal';
import { useRegion, RegionState } from '@/contexts/RegionContext';
import { resolveRegionNameByLawdCd } from '@/lib/region-utils';
import styles from './page.module.css';

// 배포 환경에 따라 변수명이 다르게 설정된 경우까지 대비한 방어적 조회
const apiKey =
  process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY ||
  process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

const LAST_POSITION_KEY = 'realEstateApp:lastPosition';

const normalizeAptName = (name: string) => {
  if (!name) return '';
  return name.replace(/\s+/g, '').replace(/아파트$/, '');
};

// 마커 상태별 스타일: 기존(파랑) / 신축 5년 이내(에메랄드 그린) / 분양권(주황)
const MARKER_STYLES: Record<string, { border: string; bg: string; glow?: string; badge?: string }> = {
  normal: { border: '#1d4ed8', bg: '#1d4ed8' },
  new: { border: '#059669', bg: '#10b981', glow: '0 0 10px rgba(16, 185, 129, 0.55)', badge: '✨' },
  presale: { border: '#ea580c', bg: '#f97316', badge: '🏗️' },
};

// 화면 픽셀 기준 이 거리 안에 있는 칩들은 하나로 묶는다. 서구 원도심처럼 오래된 소규모
// 단지가 밀집한 지역에서는 칩(대략 90x50px)이 서로 완전히 겹쳐 뒤에 깔린 단지가 실제로는
// 존재해도 "마커가 안 보인다"는 문제로 이어진다 — 데이터가 없어서가 아니라 화면에서
// 물리적으로 가려진 것(/map 페이지에 먼저 적용했던 것과 동일한 수정을 홈 미니맵에도 적용).
const CLUSTER_PIXEL_RADIUS = 55;

interface MarkerCluster {
  id: string;
  lat: number;
  lng: number;
  markers: any[];
}

export default function Home() {
  const router = useRouter();
  const { region, setRegion, openRegionModal } = useRegion();

  const [markers, setMarkers] = useState<any[]>([]);
  const [clusters, setClusters] = useState<MarkerCluster[]>([]);
  const mapRef = useRef<any>(null);
  const [mapInstanceReady, setMapInstanceReady] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  const [mapLoadAttempt, setMapLoadAttempt] = useState(0);
  const [center, setCenter] = useState({ lat: 37.4979, lng: 127.0276 }); // 기본: 서울특별시 강남구
  const [mapLevel, setMapLevel] = useState(5);
  const [mapBounds, setMapBounds] = useState<{ sw: { lat: number; lng: number }; ne: { lat: number; lng: number } } | null>(null);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [highlightedMarkerName, setHighlightedMarkerName] = useState<string | null>(null);

  const [dynamicData, setDynamicData] = useState<any[]>([]); // 탭 변경 시 데이터
  const [visibleCount, setVisibleCount] = useState(15); // 리스트 모드 15개 단위 페이징

  // 지도에 이미 로드된 마커 중 검색어와 이름이 일치하는 것이 있으면 그 마커의 실좌표로
  // 이동시키고 펄스 강조를 적용한다(공유 지역 선택 모달의 키워드 검색이 처리하지 못하는
  // "이미 로드된 단지" 케이스를 홈 화면이 직접 가로채 처리).
  const handleKeywordMatch = (keyword: string): boolean => {
    const normalizedKeyword = normalizeAptName(keyword);
    const matched = markers.find((m) => {
      const normalizedName = normalizeAptName(m.name);
      return normalizedName.includes(normalizedKeyword) || normalizedKeyword.includes(normalizedName);
    });
    if (!matched) return false;
    setCenter({ lat: matched.lat, lng: matched.lng });
    setHighlightedMarkerName(matched.name);
    // 클러스터 배지 뒤에 묻히지 않고 개별 칩으로 확실히 보이도록 확대(/map 페이지와 동일한 처리).
    setMapLevel((lvl) => Math.min(lvl, 3));
    return true;
  };

  // 지역 선택 모달에서 지역이 확정되면(그리드 선택 또는 키워드 역지오코딩), 지도 중심을
  // 해당 지역으로 이동시킨다. 검색 강조는 새 지역과 무관해지므로 해제.
  const handleRegionFinalize = (next: RegionState) => {
    setHighlightedMarkerName(null);
    if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
      const geocoder = new window.kakao.maps.services.Geocoder();
      geocoder.addressSearch(next.displayRegionName, (result: any, status: any) => {
        if (status === window.kakao.maps.services.Status.OK && result[0]) {
          setCenter({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
        }
      });
    }
  };

  // region.lawdCd의 최신값을 참조하기 위한 ref. useCallback(fn, [])으로 고정한 핸들러
  // (Map의 onCreate/onIdle) 안에서도 최신 값을 읽을 수 있도록 한다.
  const regionLawdCdRef = useRef(region.lawdCd);
  useEffect(() => {
    regionLawdCdRef.current = region.lawdCd;
  }, [region.lawdCd]);

  // 좌표를 행정구역(시/군/구, lawdCd)으로 역지오코딩하여 전역 지역 상태를 갱신한다.
  // 지역이 바뀌면 기존 데이터 fetch useEffect가 자동으로 해당 지역의 실거래가를
  // 재요청하므로, 여기서는 상태만 갱신하면 된다. force가 없으면 현재와 같은
  // 시군구일 때는 불필요한 상태 갱신(및 리스트 리셋)을 건너뛴다.
  const applyRegionFromCoords = useCallback((lat: number, lng: number, force?: boolean) => {
    if (!window.kakao || !window.kakao.maps || !window.kakao.maps.services) return;
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.coord2RegionCode(lng, lat, (result: any, status: any) => {
      if (status !== window.kakao.maps.services.Status.OK) return;
      const kakaoRegion = result.find((r: any) => r.region_type === 'B');
      if (!kakaoRegion) return;
      const newLawdCd = kakaoRegion.code.substring(0, 5);
      if (!force && newLawdCd === regionLawdCdRef.current) return;
      setHighlightedMarkerName(null);
      resolveRegionNameByLawdCd(newLawdCd).then((resolved) => {
        setRegion({
          lawdCd: newLawdCd,
          dong: 'all',
          sido: resolved?.sido || kakaoRegion.address_name,
          sigungu: resolved?.sigungu || '',
          displayRegionName: kakaoRegion.address_name,
        });
      });
    });
  }, [setRegion]);

  // GPS로 사용자 현재 위치를 가져와 지도 중심을 이동시키고, 해당 좌표의 행정구역을
  // 역지오코딩해 상단 표시와 실거래가 데이터를 즉시 갱신한다.
  const goToMyLocation = () => {
    if (!navigator.geolocation) {
      console.warn('[GPS] 이 브라우저는 위치 정보를 지원하지 않습니다.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setCenter({ lat: latitude, lng: longitude });
        applyRegionFromCoords(latitude, longitude, true);
      },
      (err) => {
        console.error('[GPS] 위치 정보를 가져오지 못했습니다.', err);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  };

  // Map의 onCreate/onIdle 핸들러: react-kakao-maps-sdk는 이 prop의 참조가 바뀔 때마다
  // 다시 호출하므로, 매 렌더마다 새로 만들어지는 인라인 함수를 넘기면
  // 호출 -> setState -> 리렌더 -> 새 함수 참조 -> 재호출 이 무한 반복되며
  // "Maximum update depth exceeded" 런타임 에러로 이어진다. useCallback으로
  // 참조를 고정해 이 무한 루프를 방지한다.
  const updateMapBounds = useCallback((map: any) => {
    const b = map.getBounds();
    setMapBounds({
      sw: { lat: b.getSouthWest().getLat(), lng: b.getSouthWest().getLng() },
      ne: { lat: b.getNorthEast().getLat(), lng: b.getNorthEast().getLng() },
    });
    // LocalStorage에서 다른 지역의 마지막 위치를 복원한 경우, 지도는 그 위치를
    // 보여주지만 region.lawdCd는 여전히 기본값일 수 있으므로 최초 생성 시점에도
    // 실제 중심 좌표 기준으로 지역을 맞춰준다.
    const c = map.getCenter();
    applyRegionFromCoords(c.getLat(), c.getLng());
  }, [applyRegionFromCoords]);

  const handleMapIdle = useCallback((map: any) => {
    const b = map.getBounds();
    setMapBounds({
      sw: { lat: b.getSouthWest().getLat(), lng: b.getSouthWest().getLng() },
      ne: { lat: b.getNorthEast().getLat(), lng: b.getNorthEast().getLng() },
    });
    const level = map.getLevel();
    setMapLevel(level);
    const c = map.getCenter();
    try {
      localStorage.setItem(LAST_POSITION_KEY, JSON.stringify({ lat: c.getLat(), lng: c.getLng(), level }));
    } catch (e) {
      console.error('[LocalStorage] 위치 저장 실패', e);
    }
    // 지도 중심이 다른 시/군/구로 넘어간 경우에만 지역/데이터를 자동 재요청
    applyRegionFromCoords(c.getLat(), c.getLng());
  }, [applyRegionFromCoords]);

  // markers를 현재 지도 줌/중심 기준 화면 픽셀 좌표로 투영해서 서로 가까운 칩끼리 묶는다.
  // 실제 kakao.maps.Map 인스턴스의 projection API가 필요해서(react-kakao-maps-sdk 프롭이
  // 아니라 원본 SDK 기능) mapRef를 직접 사용한다(/map 페이지와 동일한 방식).
  const recomputeClusters = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.kakao?.maps || markers.length === 0) {
      setClusters([]);
      return;
    }
    const projection = map.getProjection();
    if (!projection) return;

    const points = markers.map((m) => {
      const p = projection.containerPointFromCoords(new window.kakao.maps.LatLng(m.lat, m.lng));
      return { marker: m, x: p.x, y: p.y };
    });

    const used = new Array(points.length).fill(false);
    const result: MarkerCluster[] = [];

    points.forEach((p, i) => {
      if (used[i]) return;
      const group = [p];
      used[i] = true;
      points.forEach((q, j) => {
        if (used[j] || i === j) return;
        if (Math.hypot(p.x - q.x, p.y - q.y) <= CLUSTER_PIXEL_RADIUS) {
          group.push(q);
          used[j] = true;
        }
      });
      const avgLat = group.reduce((s, g) => s + g.marker.lat, 0) / group.length;
      const avgLng = group.reduce((s, g) => s + g.marker.lng, 0) / group.length;
      result.push({
        id: group.map((g) => g.marker.id).join(','),
        lat: avgLat,
        lng: avgLng,
        markers: group.map((g) => g.marker),
      });
    });

    setClusters(result);
  }, [markers]);

  // react-kakao-maps-sdk의 <Map ref={mapRef}>는 실제 kakao.maps.Map 인스턴스를 자기 내부
  // useEffect에서 비동기로 생성한 뒤에야 ref에 채워준다 — "로딩 게이트를 지난 그 커밋"에서
  // 곧바로 mapRef.current를 참조하면 항상 null을 보고 조기 종료된다(ref 자체는 리액트 렌더
  // 트리거가 아니라 effect 재실행도 안 됨). 짧은 폴링으로 실제 인스턴스 생성을 기다린다.
  useEffect(() => {
    if (!isMapReady) return;
    if (mapRef.current) {
      setMapInstanceReady(true);
      return;
    }
    const checkMapInstance = setInterval(() => {
      if (mapRef.current) {
        clearInterval(checkMapInstance);
        setMapInstanceReady(true);
      }
    }, 100);
    return () => clearInterval(checkMapInstance);
  }, [isMapReady]);

  // 지도 인스턴스가 준비된 뒤 줌/드래그가 끝날 때마다(native 'idle' 이벤트) 클러스터를 다시
  // 계산한다. recomputeClusters는 markers가 바뀌면 참조도 바뀌므로(useCallback deps),
  // 데이터가 새로 들어왔을 때도 이 effect가 재실행되며 같은 화면 상태 기준으로 즉시
  // 재계산된다.
  useEffect(() => {
    if (!mapInstanceReady || !mapRef.current || !window.kakao?.maps?.event) return;
    const map = mapRef.current;
    const handleIdle = () => recomputeClusters();
    window.kakao.maps.event.addListener(map, 'idle', handleIdle);
    recomputeClusters();
    return () => {
      window.kakao.maps.event.removeListener(map, 'idle', handleIdle);
    };
  }, [mapInstanceReady, recomputeClusters]);

  const handleClusterClick = (cluster: MarkerCluster) => {
    const map = mapRef.current;
    if (!map || !window.kakao?.maps) return;
    const anchor = new window.kakao.maps.LatLng(cluster.lat, cluster.lng);
    map.setLevel(Math.max(1, map.getLevel() - 2), { anchor });
  };

  // 마지막 탐색 위치(위도/경도/레벨) 복원: 저장된 값이 있으면 기본 위치(강남구) 대신 사용
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_POSITION_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      if (typeof parsed?.lat === 'number' && typeof parsed?.lng === 'number') {
        setCenter({ lat: parsed.lat, lng: parsed.lng });
      }
      if (typeof parsed?.level === 'number') {
        setMapLevel(parsed.level);
      }
    } catch (e) {
      console.error('[LocalStorage] 이전 위치 복원 실패', e);
    }
  }, []);

  // 카카오맵 스크립트 로드
  // - script.onerror 및 타임아웃을 추가해, 로드(또는 kakao.maps.load 콜백)가
  //   영영 끝나지 않아도 흰 화면으로 묻히지 않고 재시도 UI를 보여줄 수 있도록 처리
  // - 페이지 전역에 중복 <script> 태그가 있으면 kakao.maps.load() 콜백이 아예 호출되지
  //   않는 문제가 있었으므로(layout.tsx의 beforeInteractive 스크립트 제거로 해결),
  //   이 effect가 유일한 로더가 되도록 보장한다.
  useEffect(() => {
    if (!apiKey) {
      console.error(
        '[KakaoMap] API 키가 없습니다. NEXT_PUBLIC_KAKAO_MAP_API_KEY(또는 NEXT_PUBLIC_KAKAO_MAP_KEY) 환경변수를 확인하세요.'
      );
      setMapLoadFailed(true);
      return;
    }

    setMapLoadFailed(false);
    let ready = false;
    let failed = false;

    const markReady = () => {
      if (ready || failed) return;
      ready = true;
      setIsMapReady(true);
    };

    const markFailed = (reason: string) => {
      if (ready || failed) return;
      failed = true;
      console.error(`[KakaoMap] 지도 로드 실패: ${reason}`);
      setMapLoadFailed(true);
    };

    const scriptId = 'kakao-map-script-main';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer&autoload=false`;
      script.async = true;
      script.onerror = () => markFailed('SDK 스크립트 요청 자체가 실패했습니다 (네트워크 차단/잘못된 키 가능성)');
      document.head.appendChild(script);
    }

    const checkKakao = setInterval(() => {
      try {
        if (!window.kakao || !window.kakao.maps) return;
        clearInterval(checkKakao);

        if (window.kakao.maps.services) {
          markReady();
        } else if (typeof window.kakao.maps.load === 'function') {
          window.kakao.maps.load(markReady);
        } else {
          markFailed('window.kakao.maps.load 함수를 찾을 수 없습니다');
        }
      } catch (e) {
        markFailed(`초기화 중 예외 발생: ${e}`);
      }
    }, 200);

    // 10초 안에 준비되지 않으면(예: 도메인 미등록으로 load 콜백이 호출되지 않는 경우)
    // 무한 로딩 대신 재시도 UI를 노출
    const timeoutId = setTimeout(() => {
      markFailed('10초 내에 초기화가 완료되지 않았습니다 (Kakao 개발자 콘솔의 플랫폼 도메인 등록 여부 확인 필요)');
      clearInterval(checkKakao);
    }, 10000);

    return () => {
      clearInterval(checkKakao);
      clearTimeout(timeoutId);
    };
  }, [mapLoadAttempt]);

  // 실거래가 데이터 로드 (매매 + 분양권) 및 상태별 마커 분류
  // region.lawdCd는 최초 마운트 직후 곧바로(기본값 -> 역지오코딩된 실제 지역) 다시 바뀔 수 있어
  // (예: LocalStorage에 저장된 다른 지역 위치 복원), 이전 지역 요청이 새 지역 요청보다
  // 늦게 응답하면 최신 상태를 되돌려쓰는 경쟁 상태가 생길 수 있다. cancelled 플래그로
  // 이미 무효화된(effect가 재실행된) 요청의 응답은 무시하도록 방어한다.
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const dongParam = region.dong && region.dong !== 'all' ? `&dong=${encodeURIComponent(region.dong)}` : '';

        const [aptRes, silvRes] = await Promise.all([
          fetch(`/api/transactions?type=apt&lawdCd=${region.lawdCd}${dongParam}`),
          fetch(`/api/transactions?type=silv&lawdCd=${region.lawdCd}${dongParam}`).catch(() => null),
        ]);

        const data = await aptRes.json();
        if (cancelled) return;
        setDynamicData(data);
        setVisibleCount(15);

        const currentYear = new Date().getFullYear();
        const aptMarkers = data
          .filter((item: any) => item.lat && item.lng)
          .map((item: any) => {
            const buildYear = parseInt(item.buildYear, 10);
            const isNew = !isNaN(buildYear) && currentYear - buildYear >= 0 && currentYear - buildYear <= 5;
            return {
              id: item.id,
              name: item.name,
              price: item.price,
              lat: item.lat,
              lng: item.lng,
              status: isNew ? 'new' : 'normal',
            };
          });

        let presaleMarkers: any[] = [];
        if (silvRes && silvRes.ok) {
          const silvData = await silvRes.json();
          presaleMarkers = (Array.isArray(silvData) ? silvData : [])
            .filter((item: any) => item.lat && item.lng)
            .map((item: any) => ({
              id: item.id,
              name: item.name,
              price: item.price,
              lat: item.lat,
              lng: item.lng,
              status: 'presale',
            }));
        }

        if (cancelled) return;
        setMarkers([...aptMarkers, ...presaleMarkers]);
      } catch (error) {
        if (!cancelled) console.error('Failed to fetch map data:', error);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [region.lawdCd, region.dong]);

  // 지도 이동/축소로 bounds가 바뀌면 리스트 페이징을 처음부터 다시 보여준다
  useEffect(() => {
    setVisibleCount(15);
  }, [mapBounds]);

  // 컴팩트 시장 동향 바용 요약: 동별 거래량 집계 (실데이터 기반, 더미 수치 없음)
  const dongCounts: Record<string, number> = {};
  dynamicData.forEach((item: any) => {
    const d = item.dong || '기타';
    dongCounts[d] = (dongCounts[d] || 0) + 1;
  });
  const topDongs = Object.entries(dongCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

  // 리스트 모드: 현재 지도 화면(bounds) 안에 들어온 단지의 실거래만 노출
  const boundsFilteredList = mapBounds
    ? dynamicData.filter(
        (item: any) =>
          item.lat &&
          item.lng &&
          item.lat >= mapBounds.sw.lat &&
          item.lat <= mapBounds.ne.lat &&
          item.lng >= mapBounds.sw.lng &&
          item.lng <= mapBounds.ne.lng
      )
    : dynamicData;

  if (!apiKey) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        카카오맵 API 키가 설정되지 않았습니다. 환경변수 <code>NEXT_PUBLIC_KAKAO_MAP_API_KEY</code>를 확인해주세요.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header
        hideMobileNav
        searchSlot={
          <div
            onClick={openRegionModal}
            style={{
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'var(--background)',
              border: '1px solid var(--border-color)',
              borderRadius: '999px',
              padding: '0.45rem 0.9rem',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            <span>🔍</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>단지명, 동이름, 지역명 검색</span>
          </div>
        }
      />

      <div style={{ position: 'relative', flex: 1, minHeight: '450px' }}>
        {/* 지도 레이어 */}
        {viewMode === 'map' && mapLoadFailed && (
          <div className={styles.mapFallback}>
            <div style={{ fontSize: '2rem' }}>🗺️</div>
            <div>지도를 불러오지 못했습니다.</div>
            <button
              className={styles.mapRetryBtn}
              onClick={() => {
                setMapLoadFailed(false);
                setMapLoadAttempt(n => n + 1);
              }}
            >
              다시 시도
            </button>
          </div>
        )}

        {viewMode === 'map' && !mapLoadFailed && !isMapReady && (
          <div className={styles.mapFallback}>
            지도를 불러오는 중입니다...
          </div>
        )}

        {viewMode === 'map' && isMapReady && (
          <div className={styles.mapWrapper}>
            <Map
              ref={mapRef}
              center={center}
              style={{ width: '100%', height: '100%' }}
              level={mapLevel}
              onCreate={updateMapBounds}
              onIdle={handleMapIdle}
            >
              {clusters.map((cluster) => {
                if (cluster.markers.length > 1) {
                  return (
                    <CustomOverlayMap key={cluster.id} position={{ lat: cluster.lat, lng: cluster.lng }} yAnchor={0.5}>
                      <div
                        onClick={() => handleClusterClick(cluster)}
                        title={cluster.markers.map((m) => m.name).join(', ')}
                        style={{
                          width: '46px',
                          height: '46px',
                          borderRadius: '50%',
                          background: 'var(--primary-color)',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 800,
                          fontSize: '0.95rem',
                          boxShadow: '0 4px 8px rgba(0,0,0,0.25)',
                          cursor: 'pointer',
                          border: '3px solid white',
                        }}
                      >
                        {cluster.markers.length}
                      </div>
                    </CustomOverlayMap>
                  );
                }

                const marker = cluster.markers[0];
                const style = MARKER_STYLES[marker.status] || MARKER_STYLES.normal;
                const isHighlighted = marker.name === highlightedMarkerName;
                return (
                  <CustomOverlayMap
                    key={marker.id}
                    position={{ lat: marker.lat, lng: marker.lng }}
                    yAnchor={1}
                  >
                    <div
                      onClick={() => router.push(`/apt/${encodeURIComponent(marker.name)}?lawdCd=${region.lawdCd}`)}
                      className={isHighlighted ? styles.markerHighlight : undefined}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        cursor: 'pointer',
                        transform: 'translateY(-5px)',
                        borderRadius: '8px',
                        boxShadow: style.glow,
                      }}
                    >
                      <div style={{
                        background: 'white',
                        border: `1px solid ${style.border}`,
                        borderTopLeftRadius: '6px',
                        borderTopRightRadius: '6px',
                        padding: '4px 8px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        color: '#1e293b',
                        whiteSpace: 'nowrap'
                      }}>
                        {style.badge && <span style={{ marginRight: '2px' }}>{style.badge}</span>}
                        {marker.name}
                      </div>
                      <div style={{
                        background: style.bg,
                        color: 'white',
                        borderBottomLeftRadius: '6px',
                        borderBottomRightRadius: '6px',
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        position: 'relative'
                      }}>
                        {marker.price}
                        <div style={{
                          position: 'absolute',
                          bottom: '-6px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          width: '0',
                          height: '0',
                          borderLeft: '5px solid transparent',
                          borderRight: '5px solid transparent',
                          borderTop: `6px solid ${style.bg}`
                        }} />
                      </div>
                    </div>
                  </CustomOverlayMap>
                );
              })}
            </Map>

            {/* 마커 색상 범례 */}
            <div className={styles.markerLegend}>
              <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: MARKER_STYLES.normal.bg }} /> 기존</span>
              <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: MARKER_STYLES.new.bg }} /> 신축 5년↓</span>
              <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: MARKER_STYLES.presale.bg }} /> 분양권</span>
            </div>
          </div>
        )}

        {/* 슬림 리스트 레이어: 지도 대신 부산 서구 아파트 실거래 목록을 한 줄 컴팩트 형태로 표시 */}
        {viewMode === 'list' && (
          <div className={styles.listWrapper}>
            <div className={styles.listGrid}>
              {boundsFilteredList.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
                  {mapBounds ? '현재 지도 범위 내에 표시할 단지 정보가 없습니다.' : '표시할 단지 정보가 없습니다.'}
                </div>
              ) : (
                <>
                  {boundsFilteredList.slice(0, visibleCount).map((item: any) => {
                    const dateLabel = item.tradeDate ? item.tradeDate.slice(5).replace('-', '.') : '';
                    return (
                      <div
                        key={item.id}
                        className={styles.listRow}
                        onClick={() =>
                          router.push(
                            `/apt/${encodeURIComponent(item.name)}?lawdCd=${region.lawdCd}${item.dong ? `&dong=${encodeURIComponent(item.dong)}` : ''}`
                          )
                        }
                      >
                        <span className={styles.listRowName}>{item.name}</span>
                        <span className={styles.listRowMeta}>
                          {item.pyung ? `${item.pyung}평` : ''}{item.floor ? ` ${item.floor}층` : ''}
                        </span>
                        <span className={styles.listRowPrice}>{item.price}</span>
                        <span className={styles.listRowDate}>{dateLabel}</span>
                      </div>
                    );
                  })}

                  {visibleCount < boundsFilteredList.length && (
                    <button className={styles.loadMoreBtn} onClick={() => setVisibleCount((n) => n + 15)}>
                      실거래가 더보기 ({Math.min(visibleCount, boundsFilteredList.length)}/전체 {boundsFilteredList.length}건)
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* 상단 떠있는 UI 레이어 */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, pointerEvents: 'none', display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>

            {/* 현재 위치: 클릭 시 지역 선택 모달 오픈 (검색창은 상단 헤더로 이동) */}
            <div
              onClick={openRegionModal}
              style={{ pointerEvents: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.95)', padding: '10px 16px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', cursor: 'pointer' }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                현재 위치: {region.displayRegionName} <span style={{ color: '#22c55e' }}>📍</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); goToMyLocation(); }}
                  aria-label="내 위치로 이동"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--text-secondary)' }}
                >
                  🎯
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); window.location.reload(); }}
                  aria-label="새로고침"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--text-secondary)' }}
                >
                  🔄
                </button>
              </div>
            </div>

            {/* 컴팩트 시장 동향 바: 한 줄 스와이프 칩 (기존 대형 카드 대체) */}
            <div style={{ pointerEvents: 'auto', background: 'white', borderRadius: '999px', padding: '0.7rem 1.15rem', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                <strong>최근 거래량 {dynamicData.length}건</strong>
                {topDongs.length > 0 && (
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {' | 동별 TOP: '}
                    {topDongs.map(([name, count], i) => (
                      <span key={name}>
                        {i > 0 && ', '}
                        {name} {count}건
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </div>

            {/* 지도/리스트 모드 전환: 시장 동향 바로 바로 아래, 우측에 밀착된 플로팅 필 (지도 중앙을 가리지 않음) */}
            <div style={{ pointerEvents: 'auto', alignSelf: 'flex-end', display: 'flex', background: 'white', borderRadius: '999px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              <button
                onClick={() => setViewMode('map')}
                style={{ padding: '8px 14px', background: viewMode === 'map' ? 'var(--primary-color)' : 'white', border: 'none', fontWeight: 700, color: viewMode === 'map' ? 'white' : 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                🗺️ 지도
              </button>
              <button
                onClick={() => setViewMode('list')}
                style={{ padding: '8px 14px', background: viewMode === 'list' ? 'var(--primary-color)' : 'white', border: 'none', fontWeight: 700, color: viewMode === 'list' ? 'white' : 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                📋 리스트
              </button>
            </div>

          </div>

          {/* 하단 여백 및 네비게이션을 위해 flex-1 */}
          <div style={{ flex: 1 }}></div>

          {/* 우측 하단 컨트롤 */}
          <div style={{ pointerEvents: 'auto', alignSelf: 'flex-end', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              onClick={goToMyLocation}
              aria-label="내 위치로 이동"
              style={{ width: '40px', height: '40px', background: 'white', border: '1px solid var(--border-color)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.1)', cursor: 'pointer' }}
            >
              🎯
            </button>
            <button style={{ width: '40px', height: '40px', background: 'white', border: '1px solid var(--border-color)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.1)', cursor: 'pointer' }}>
              📏
            </button>
          </div>

          {/* 하단 네비게이션 바: 실거래가(/) / 시장 통계(/stats) / 학군 정보(/school) / 부동산 도구(/tools) / 커뮤니티(/community) */}
          <div style={{ pointerEvents: 'auto', background: 'white', display: 'flex', justifyContent: 'space-around', padding: '10px 0', borderTop: '1px solid var(--border-color)', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
            <Link href="/" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: '#22c55e' }}>
              <span style={{ fontSize: '1.35rem', marginBottom: '4px' }}>📈</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>실거래가</span>
            </Link>
            <Link href="/stats" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '1.35rem', marginBottom: '4px' }}>📊</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>시장 통계</span>
            </Link>
            <Link href="/school" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '1.35rem', marginBottom: '4px' }}>🏫</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>학군 정보</span>
            </Link>
            <Link href="/tools" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '1.35rem', marginBottom: '4px' }}>🛠️</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>부동산 도구</span>
            </Link>
            <Link href="/community" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '1.35rem', marginBottom: '4px' }}>💬</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>커뮤니티</span>
            </Link>
          </div>

        </div>
      </div>

      {/* 아실 스타일 전면 지역 선택 모달 (실거래가/시장통계/학군정보 등에서 공유) */}
      <RegionSelectModal onKeywordMatch={handleKeywordMatch} onRegionFinalize={handleRegionFinalize} />
    </div>
  );
}
