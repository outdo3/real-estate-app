'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Map as KakaoMap, CustomOverlayMap } from 'react-kakao-maps-sdk';
import { useRouter } from 'next/navigation';
import ApartmentAutocomplete, { ApartmentSearchResult } from '@/components/ApartmentAutocomplete';

const apiKey =
  process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY ||
  process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

interface AptMarker {
  id: string;
  name: string;
  dong: string;
  price: string;
  hasRecentPrice: boolean; // 최근 거래(가격) 유무 — 없으면 "시세 정보 없음"으로 폴백 표시
  lat: number;
  lng: number;
}

interface AptCluster {
  id: string;
  lat: number;
  lng: number;
  markers: AptMarker[];
}

// 화면 픽셀 기준 이 거리 안에 있는 칩들은 한 그룹으로 묶는다. 서구 원도심처럼 오래된
// 소규모 단지가 밀집한 지역에서는 칩이 서로 완전히 겹쳐 뒤에 깔린 단지가 실제로는
// 존재해도 "마커가 안 보인다"는 문제로 이어졌었다 — 데이터가 없어서가 아니라 화면에서
// 물리적으로 가려진 것. 숫자 배지로 뭉치는 대신, 그룹 안 칩들을 정사각형에 가까운
// 격자로 살짝 벌려서 각자 정보가 그대로 보이게 한다(뱃지 방식은 정보가 안 보인다는
// 피드백을 받아 교체함). 확대 단계별로 칩 크기 자체가 다르므로(아래 CHIP_LAYOUT),
// 클러스터링 반경/격자 간격도 현재 확대 단계에 맞는 값을 써야 실제 렌더 크기와
// 어긋나지 않는다.
const DETAIL_ZOOM_LEVEL = 4; // 카카오맵 레벨(숫자가 작을수록 확대) 기준: 이 값 이하로 확대해야 단지명+실거래가 상세 카드로 전환됨
const CHIP_LAYOUT = {
  compact: { width: 60, height: 26, gap: 4, clusterRadius: 38 },
  detailed: { width: 92, height: 42, gap: 6, clusterRadius: 52 },
};

interface SchoolMarker {
  id: string;
  name: string;
  level: '초' | '중' | '고';
  lat: number;
  lng: number;
}

type LayerKey = 'apt' | 'school' | 'redevelopment' | 'auction';

const LEVEL_COLOR: Record<SchoolMarker['level'], string> = {
  초: '#3b82f6',
  중: '#10b981',
  고: '#f59e0b',
};

const classifySchoolLevel = (name: string): SchoolMarker['level'] | null => {
  if (name.includes('초등학교')) return '초';
  if (name.includes('고등학교')) return '고'; // '중'보다 먼저 검사(고등학교엔 '중'이 안 들어가므로 순서 무관하지만 명확성 위해 고→중→초 순으로 방어적으로 배치)
  if (name.includes('중학교')) return '중';
  return null;
};

export default function FullscreenMapPage() {
  const router = useRouter();

  const [aptMarkers, setAptMarkers] = useState<AptMarker[]>([]);
  const [aptClusters, setAptClusters] = useState<AptCluster[]>([]);
  const [schoolMarkers, setSchoolMarkers] = useState<SchoolMarker[]>([]);
  const [zoomLevel, setZoomLevel] = useState(6);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  // 현재 화면의 마커들을 조회할 때 실제로 사용한 lawdCd. 마커 클릭 시 상세페이지로 이 값을
  // 함께 넘겨야 한다 — 안 넘기면 상세페이지가 자기 자신의 하드코딩된 기본 지역(서울 강남구)으로
  // 실거래가를 조회해 엉뚱한 지역/빈 데이터가 뜨는 버그로 이어진다.
  const [currentLawdCd, setCurrentLawdCd] = useState('26140');
  const isDetailed = zoomLevel <= DETAIL_ZOOM_LEVEL;
  const chipLayout = isDetailed ? CHIP_LAYOUT.detailed : CHIP_LAYOUT.compact;
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapInstanceReady, setMapInstanceReady] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);
  const [center, setCenter] = useState({ lat: 35.0979, lng: 129.0244 }); // 기본: 부산광역시 서구
  const [showSearchHereBtn, setShowSearchHereBtn] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    apt: true,
    school: false,
    redevelopment: false,
    auction: false,
  });
  const mapRef = useRef<any>(null);
  const pendingCenterRef = useRef(center);

  useEffect(() => {
    if (!apiKey) return;

    const scriptId = 'kakao-map-script-main';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer&autoload=false`;
      script.async = true;
      document.head.appendChild(script);
    }

    // 광고차단 확장 프로그램이나 특정 통신사/사내망이 dapi.kakao.com 스크립트 자체를
    // 막는 경우가 실제로 있다 — 이전에는 그러면 아래 폴링이 영원히 실패 상태로 남아
    // 사용자에게 아무 신호 없이 "지도 데이터를 불러오는 중입니다..."에서 페이지가
    // 멈춘 것처럼 보였다. 스크립트 자체의 로드 실패를 즉시 감지하고, 혹시 그 신호를
    // 놓치는 경우를 대비해 폴링에도 타임아웃을 둬서 반드시 사용자에게 원인을 알린다.
    const handleScriptError = () => {
      setMapLoadError('카카오맵 스크립트를 불러오지 못했습니다. 광고 차단 확장 프로그램이나 네트워크(사내망/통신사) 설정이 dapi.kakao.com 접속을 막고 있을 수 있습니다.');
    };
    script.addEventListener('error', handleScriptError);

    const checkKakao = setInterval(() => {
      if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
        clearInterval(checkKakao);
        setIsMapReady(true);
      } else if (window.kakao && window.kakao.maps) {
        // In case load wasn't called by page.tsx
        clearInterval(checkKakao);
        window.kakao.maps.load(() => {
          setIsMapReady(true);
        });
      }
    }, 200);

    const timeout = setTimeout(() => {
      clearInterval(checkKakao);
      setIsMapReady((ready) => {
        if (!ready) {
          setMapLoadError('지도를 불러오는 데 시간이 너무 오래 걸립니다. 네트워크 상태를 확인하거나 광고 차단 확장 프로그램을 꺼보세요.');
        }
        return ready;
      });
    }, 10000);

    return () => {
      clearInterval(checkKakao);
      clearTimeout(timeout);
      script?.removeEventListener('error', handleScriptError);
    };
  }, [apiKey]);

  // 단지(아파트) 마커: 좌표만으로는 어느 시군구(lawdCd) 실거래 데이터를 조회해야 할지 알 수
  // 없으므로, 우선 좌표를 lawdCd로 역지오코딩한 다음 그 지역의 실거래를 넓은 기간(12개월)으로
  // 조회한다. 이전에는 이 페이지가 /api/transactions를 파라미터 없이 호출해서(= lawdCd 없음)
  // 서버가 항상 빈 배열을 반환했다 — 그래서 지도에 마커가 하나도 안 뜨던 게 근본 원인이었다.
  // "최근 3개월 내 거래 없는 단지는 마커가 아예 안 뜨는" 문제도 여기서 같이 해결된다: 최근
  // 3개월치만 보던 홈 화면과 달리 지도 마커는 12개월 윈도우 안에서 가장 최근 거래를 찾아
  // "기존 가격"으로라도 보여준다. 다만 12개월 안에도 거래가 전혀 없는 단지는 이 데이터
  // 소스(MOLIT 실거래) 자체에 존재 근거가 없어 마커를 만들 수 없다 — 그 경우까지 100%
  // 커버하려면 별도의 "단지 마스터 목록" 데이터가 필요한데 이 앱엔 아직 없다.
  const fetchAptMarkers = async (lat: number, lng: number) => {
    if (!window.kakao?.maps?.services) {
      setIsLoadingData(false);
      return;
    }
    const geocoder = new window.kakao.maps.services.Geocoder();

    geocoder.coord2RegionCode(lng, lat, async (result: any, status: any) => {
      // 사용자의 실제 GPS 좌표가 국내 행정구역으로 역지오코딩되지 않는 경우(해외, 또는
      // 카카오가 지원하지 않는 좌표)가 실제로 있다 — 이때 그냥 return해버리면
      // isLoadingData가 영원히 true로 남아 페이지 전체가 "지도 데이터를 불러오는
      // 중입니다..."에 멈춘 것처럼 보이는 심각한 버그였다(발견: 실사용자 리포트로 좌표
      // 실패 케이스를 재현). 역지오코딩이 실패하면 이 서비스의 기본 대상 지역(부산 서구)
      // 데이터로 폴백해서 최소한 화면에 뭔가는 뜨게 한다.
      const DEFAULT_FALLBACK_LAWD_CD = '26140'; // 부산광역시 서구
      const region = status === window.kakao.maps.services.Status.OK
        ? result.find((r: any) => r.region_type === 'B')
        : null;
      const lawdCd = region ? region.code.substring(0, 5) : DEFAULT_FALLBACK_LAWD_CD;
      setCurrentLawdCd(lawdCd);

      try {
        const res = await fetch(`/api/transactions?type=apt&lawdCd=${lawdCd}&months=12`);
        const data = await res.json();
        if (!Array.isArray(data)) return;

        // 단지별(name+dong) 최신 거래 1건만 남긴다 — 같은 단지의 여러 거래가 마커로
        // 중복 표시되는 것을 막는다. data는 이미 route.ts에서 계약일 최신순 정렬됨.
        const byComplex = new Map<string, any>();
        for (const item of data) {
          if (!item.lat || !item.lng) continue;
          const key = `${item.dong}|${item.name}`;
          if (!byComplex.has(key)) byComplex.set(key, item);
        }

        const markers: AptMarker[] = Array.from(byComplex.values()).map((item) => ({
          id: `${item.dong}-${item.name}`,
          name: item.name,
          dong: item.dong || '',
          price: item.price || '시세 정보 없음',
          hasRecentPrice: !!item.price,
          lat: item.lat,
          lng: item.lng,
        }));

        setAptMarkers(markers);
      } catch (error) {
        console.error('Failed to fetch apt markers:', error);
      } finally {
        setIsLoadingData(false);
      }
    });
  };

  // 학교 레이어: 나이스(NEIS) 학년별 통계는 이 앱에 실제 데이터가 없어(코드 확인 결과 해시
  // 기반 시뮬레이션) 새로 노출하지 않는다. 대신 카카오 실제 장소검색(SC4=학교 카테고리)
  // 결과를 그대로 쓰고, 실제 학교명 문자열에서 "초등학교/중학교/고등학교"를 그대로 읽어
  // 초/중/고 배지로 분류한다 — 지어낸 값이 아니라 실제 이름을 파싱만 한 것이다.
  const fetchSchoolMarkers = (lat: number, lng: number) => {
    if (!window.kakao?.maps?.services) return;
    const ps = new window.kakao.maps.services.Places();
    const coords = new window.kakao.maps.LatLng(lat, lng);

    ps.categorySearch(
      'SC4',
      (result: any, status: any) => {
        if (status !== window.kakao.maps.services.Status.OK) return;
        const markers: SchoolMarker[] = result
          .map((p: any) => {
            const level = classifySchoolLevel(p.place_name);
            if (!level) return null;
            return {
              id: p.id,
              name: p.place_name,
              level,
              lat: parseFloat(p.y),
              lng: parseFloat(p.x),
            } as SchoolMarker;
          })
          .filter(Boolean);
        setSchoolMarkers(markers);
      },
      { location: coords, radius: 3000, sort: window.kakao.maps.services.SortBy.DISTANCE }
    );
  };

  const refreshActiveLayers = (lat: number, lng: number) => {
    if (layers.apt) fetchAptMarkers(lat, lng);
    if (layers.school) fetchSchoolMarkers(lat, lng);
  };

  // aptMarkers를 현재 지도 줌/중심 기준 화면 픽셀 좌표로 투영해서 서로 가까운 칩끼리
  // 묶는다. 실제 kakao.maps.Map 인스턴스의 projection API가 필요해서(react-kakao-maps-sdk
  // 프롭이 아니라 원본 SDK 기능) mapRef를 직접 사용한다.
  const recomputeClusters = () => {
    const map = mapRef.current;
    if (!map || !window.kakao?.maps || aptMarkers.length === 0) {
      setAptClusters([]);
      return;
    }
    const projection = map.getProjection();
    if (!projection) return;

    const points = aptMarkers.map((m) => {
      const p = projection.containerPointFromCoords(new window.kakao.maps.LatLng(m.lat, m.lng));
      return { marker: m, x: p.x, y: p.y };
    });

    const used = new Array(points.length).fill(false);
    const result: AptCluster[] = [];

    points.forEach((p, i) => {
      if (used[i]) return;
      const group = [p];
      used[i] = true;
      points.forEach((q, j) => {
        if (used[j] || i === j) return;
        if (Math.hypot(p.x - q.x, p.y - q.y) <= chipLayout.clusterRadius) {
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

    setAptClusters(result);
  };

  // 최초 지도 준비 완료 + center 확정 시 최초 1회 로드
  useEffect(() => {
    if (!isMapReady) return;
    setIsLoadingData(true);
    refreshActiveLayers(center.lat, center.lng);
  }, [isMapReady]);

  // react-kakao-maps-sdk의 <Map ref={mapRef}>는 실제 kakao.maps.Map 인스턴스를 자기 내부
  // useEffect에서 비동기로 생성한 뒤에야 ref에 채워준다 — 그래서 "로딩 게이트를 지난 그
  // 커밋"에서 곧바로 mapRef.current를 참조하는 effect는 항상 null을 보고 조기 종료됐다
  // (ref 자체는 리액트 렌더 트리거가 아니라 effect 재실행도 안 됨 → 클러스터가 영원히
  // 빈 배열로 남아 마커가 하나도 안 그려지는 회귀로 이어졌다). SDK 로드 감지와 같은 이
  // 파일의 기존 관례(위 checkKakao setInterval)를 그대로 따라 짧은 폴링으로 실제 인스턴스
  // 생성을 기다린다.
  useEffect(() => {
    if (isLoadingData || !isMapReady) return;
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
  }, [isLoadingData, isMapReady]);

  // 지도 인스턴스가 실제로 준비된 뒤 줌/드래그가 끝날 때마다(native 'idle' 이벤트) 클러스터를
  // 다시 계산한다. 데이터가 새로 들어와도(aptMarkers 변경) 같은 화면 상태 기준으로 즉시 한
  // 번 재계산한다. zoomLevel이 바뀌면(확대/축소로 칩 크기·클러스터 반경이 달라짐) 리스너를
  // 새 chipLayout을 참조하는 클로저로 다시 등록하고, 그 자리에서 즉시 한 번 재계산해
  // 'idle' 이벤트를 기다리지 않고도 칩 배치가 바로 갱신되게 한다.
  useEffect(() => {
    if (!mapInstanceReady || !mapRef.current || !window.kakao?.maps?.event) return;
    const map = mapRef.current;
    const handleIdle = () => recomputeClusters();
    window.kakao.maps.event.addListener(map, 'idle', handleIdle);
    recomputeClusters();
    return () => {
      window.kakao.maps.event.removeListener(map, 'idle', handleIdle);
    };
  }, [mapInstanceReady, aptMarkers, zoomLevel]);

  // 개별 마커 칩 하나를 그린다. 단독 마커든, 겹친 그룹을 격자로 벌린 것 중 하나든 이
  // 함수 하나로 렌더링해서 두 경우의 모양이 항상 같게 유지한다.
  // - isDetailed(확대 상태)가 아니면 단지명 없이 가격만 파스텔톤 알약 칩으로 간결하게 보여
  //   화면 점유율을 낮춘다. 확대해야만 단지명이 함께 보이는 상세 카드로 전환된다.
  // - 선택(터치/호버)된 마커는 강조 링 + 확대 transform으로 다른 마커보다 항상 눈에 띄게
  //   하고, 실제 겹침 순서는 호출부에서 CustomOverlayMap의 zIndex prop으로 9999를 줘서
  //   보장한다(CSS z-index만으로는 카카오 SDK가 각 오버레이를 별도 컨테이너로 그려서
  //   먹히지 않는다).
  const renderMarkerChip = (marker: AptMarker, selected: boolean) => {
    const accent = marker.hasRecentPrice ? 'var(--primary-color)' : '#94a3b8';
    const highlightRing = selected
      ? '0 0 0 3px rgba(37, 99, 235, 0.35), 0 6px 14px rgba(0,0,0,0.22)'
      : '0 2px 5px rgba(0,0,0,0.12)';
    const handleSelect = () => setSelectedMarkerId(marker.id);
    const handleDeselect = () => setSelectedMarkerId((cur) => (cur === marker.id ? null : cur));
    const handleClick = () => {
      setSelectedMarkerId(marker.id);
      router.push(`/apt/${encodeURIComponent(marker.name)}?lawdCd=${currentLawdCd}&dong=${encodeURIComponent(marker.dong)}`);
    };

    if (!isDetailed) {
      return (
        <div
          onClick={handleClick}
          onMouseEnter={handleSelect}
          onMouseLeave={handleDeselect}
          style={{
            background: marker.hasRecentPrice ? '#ecfdf5' : '#f1f5f9',
            border: `1.5px solid ${accent}`,
            borderRadius: '999px',
            padding: '3px 9px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: highlightRing,
            cursor: 'pointer',
            transform: selected ? 'scale(1.12)' : 'scale(1)',
            transition: 'transform 0.12s ease, box-shadow 0.12s ease',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: marker.hasRecentPrice ? '0.72rem' : '0.66rem', fontWeight: 800, color: marker.hasRecentPrice ? 'var(--primary-hover)' : '#64748b' }}>
            {marker.price}
          </span>
        </div>
      );
    }

    return (
      <div
        onClick={handleClick}
        onMouseEnter={handleSelect}
        onMouseLeave={handleDeselect}
        style={{
          background: 'white',
          border: `1.5px solid ${accent}`,
          borderRadius: '6px',
          padding: '4px 8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          boxShadow: highlightRing,
          cursor: 'pointer',
          position: 'relative',
          transform: selected ? 'scale(1.08)' : 'scale(1)',
          transition: 'transform 0.12s ease, box-shadow 0.12s ease',
        }}
      >
        {/* 작은 말풍선 꼬리 */}
        <div style={{
          position: 'absolute',
          bottom: '-6px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '0',
          height: '0',
          borderLeft: '5px solid transparent',
          borderRight: '5px solid transparent',
          borderTop: `6px solid ${accent}`
        }} />

        <span style={{ fontSize: '0.66rem', color: '#666', fontWeight: 600, whiteSpace: 'nowrap' }}>{marker.name}</span>
        <span style={{ fontSize: marker.hasRecentPrice ? '0.9rem' : '0.7rem', fontWeight: marker.hasRecentPrice ? 800 : 600, color: marker.hasRecentPrice ? 'var(--text-primary)' : '#94a3b8', whiteSpace: 'nowrap' }}>
          {marker.price}
        </span>
      </div>
    );
  };

  // 컴포넌트 첫 마운트 시, 사용자 위치 가져오기
  useEffect(() => {
    const fallbackToIp = async () => {
      try {
        const res = await fetch('https://ipinfo.io/json');
        const data = await res.json();
        if (data.loc) {
          const parts = data.loc.split(',');
          setCenter({ lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) });
        }
      } catch (e) {}
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCenter({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.log('위치 정보를 가져오지 못했습니다. IP 기반 위치를 시도합니다.', error);
          fallbackToIp();
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    } else {
      fallbackToIp();
    }
  }, []);

  // 사용자가 지도를 드래그하면 "이 지역에서 재검색" 버튼만 노출하고, 실제 재조회는 그
  // 버튼을 눌렀을 때만 수행한다(드래그할 때마다 자동 재조회하면 API 호출이 과도해짐 —
  // 네이버지도/카카오맵 등 실제 지도 서비스도 같은 패턴을 쓴다).
  const handleDragEnd = () => {
    if (!mapRef.current) return;
    const c = mapRef.current.getCenter();
    pendingCenterRef.current = { lat: c.getLat(), lng: c.getLng() };
    setShowSearchHereBtn(true);
  };

  const handleSearchHere = () => {
    const { lat, lng } = pendingCenterRef.current;
    setCenter({ lat, lng });
    setShowSearchHereBtn(false);
    setIsLoadingData(true);
    refreshActiveLayers(lat, lng);
  };

  const toggleLayer = (key: LayerKey) => {
    setLayers((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      // 이번에 새로 켠 레이어라면 현재 중심 기준으로 즉시 데이터를 채운다.
      if (!prev[key]) {
        if (key === 'apt') fetchAptMarkers(center.lat, center.lng);
        if (key === 'school') fetchSchoolMarkers(center.lat, center.lng);
      }
      return next;
    });
  };

  // 아파트 자동완성에서 단지를 선택하면 실제 kakao.maps.Map 인스턴스의 panTo로 부드럽게
  // 이동시킨다(마커 재조회 등으로 인한 리렌더가 center state를 되돌리지 못하도록 state도
  // 함께 갱신한다 — panTo만 호출하면 다음 setCenter 호출 없는 리렌더에서는 문제 없지만,
  // 이후 다른 흐름이 center state를 참조할 때 최신 위치와 어긋나는 것을 방지). 선택한 단지가
  // 있는 지역의 마커도 함께 새로 불러온다.
  const handleApartmentSelect = (result: ApartmentSearchResult) => {
    const latLng = { lat: result.lat, lng: result.lng };
    setCenter(latLng);
    setShowSearchHereBtn(false);
    if (mapRef.current && window.kakao?.maps) {
      const anchor = new window.kakao.maps.LatLng(latLng.lat, latLng.lng);
      mapRef.current.panTo(anchor);
      // 기존 지도 줌(레벨 6, 넓은 개요 화면)에서는 목적지가 이미 화면 안에 있는 경우가
      // 많아서(특히 도심 밀집지역) panTo만으로는 사용자 눈에 "아무것도 안 바뀐 것"처럼
      // 보였다 — 검색해서 고른 그 단지가 클러스터 배지 뒤에 묻혀 있지 않고 개별 칩으로
      // 확실히 보이도록 레벨 3까지 함께 확대한다.
      if (mapRef.current.getLevel() > 3) {
        mapRef.current.setLevel(3, { anchor });
      }
    }
    refreshActiveLayers(latLng.lat, latLng.lng);
  };

  if (!apiKey) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#FEE2E2', color: '#EF4444' }}>
        <h2>지도를 불러오는 데 실패했습니다.</h2>
        <p>카카오맵 API 키를 확인해주세요. (현재 키가 비어있습니다)</p>
        <button onClick={() => router.push('/')} style={{ marginTop: '2rem', padding: '1rem 2rem', background: 'white', border: '1px solid #EF4444', borderRadius: '8px', cursor: 'pointer' }}>돌아가기</button>
      </div>
    );
  }

  if (mapLoadError) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: '2rem', textAlign: 'center', backgroundColor: '#FEE2E2', color: '#EF4444' }}>
        <h2>지도를 불러오지 못했습니다.</h2>
        <p style={{ maxWidth: '480px', marginTop: '0.75rem' }}>{mapLoadError}</p>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem' }}>
          <button onClick={() => window.location.reload()} style={{ padding: '1rem 2rem', background: '#EF4444', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>다시 시도</button>
          <button onClick={() => router.push('/')} style={{ padding: '1rem 2rem', background: 'white', border: '1px solid #EF4444', borderRadius: '8px', cursor: 'pointer' }}>돌아가기</button>
        </div>
      </div>
    );
  }

  if (isLoadingData || !isMapReady) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '1.5rem', color: 'var(--primary-color)' }}>지도 데이터를 불러오는 중입니다...</div>;
  }

  const LAYER_LABEL: Record<LayerKey, string> = { apt: '단지', school: '학교', redevelopment: '재개발', auction: '경매' };
  const showComingSoonNotice = layers.redevelopment || layers.auction;

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {/* 상단 컨트롤 UI (뒤로가기, 검색창, 내 위치) */}
      <div style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10, display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => router.push('/')}
          style={{
            background: 'white', padding: '12px 24px', borderRadius: '99px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem',
            border: 'none', cursor: 'pointer'
          }}
        >
          ⬅ 메인으로
        </button>

        <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.95)', padding: '0.5rem', borderRadius: '99px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', alignItems: 'center' }}>
          <div style={{ width: '260px' }}>
            <ApartmentAutocomplete onSelect={handleApartmentSelect} placeholder="아파트 단지명 검색" />
          </div>
          <button
            onClick={async () => {
              if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    const latLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    setCenter(latLng);
                    refreshActiveLayers(latLng.lat, latLng.lng);
                  },
                  async (err) => {
                    try {
                      const res = await fetch('https://ipinfo.io/json');
                      const data = await res.json();
                      if (data.loc) {
                        const parts = data.loc.split(',');
                        const latLng = { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
                        setCenter(latLng);
                        refreshActiveLayers(latLng.lat, latLng.lng);
                      }
                    } catch (e) {}
                  },
                  { enableHighAccuracy: false, timeout: 5000, maximumAge: 0 }
                );
              }
            }}
            style={{ padding: '0.6rem 1.2rem', background: 'white', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '99px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, transition: 'background 0.2s' }}
            onMouseOver={(e) => e.currentTarget.style.background = '#f5f5f5'}
            onMouseOut={(e) => e.currentTarget.style.background = 'white'}
          >
            📍 내 위치
          </button>
        </div>
      </div>

      {/* 레이어 토글 컨트롤 */}
      <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 10, display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.95)', padding: '0.5rem', borderRadius: '99px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
        {(Object.keys(LAYER_LABEL) as LayerKey[]).map((key) => (
          <button
            key={key}
            onClick={() => toggleLayer(key)}
            style={{
              padding: '0.5rem 0.9rem',
              borderRadius: '99px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.85rem',
              background: layers[key] ? 'var(--primary-color)' : 'transparent',
              color: layers[key] ? 'white' : 'var(--text-secondary)',
              whiteSpace: 'nowrap',
            }}
          >
            {LAYER_LABEL[key]}
          </button>
        ))}
      </div>

      {/* 이 지역에서 재검색 */}
      {showSearchHereBtn && (
        <button
          onClick={handleSearchHere}
          style={{
            position: 'absolute', top: '80px', left: '50%', transform: 'translateX(-50%)', zIndex: 10,
            padding: '0.65rem 1.3rem', background: 'white', border: 'none', borderRadius: '99px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)', fontWeight: 700, cursor: 'pointer', color: 'var(--primary-color)',
          }}
        >
          🔄 이 지역에서 재검색
        </button>
      )}

      {/* 재개발/경매 레이어: 실제 데이터 소스가 아직 없어 정직하게 준비중 안내만 표시 */}
      {showComingSoonNotice && (
        <div
          style={{
            position: 'absolute', bottom: '90px', left: '50%', transform: 'translateX(-50%)', zIndex: 10,
            padding: '0.75rem 1.25rem', background: 'rgba(30,41,59,0.92)', color: 'white', borderRadius: '12px',
            fontSize: '0.85rem', fontWeight: 600, textAlign: 'center', boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          {layers.redevelopment && '재개발/재건축 구역 데이터는 아직 연동 준비 중입니다. '}
          {layers.auction && '경매/공매 매물 데이터는 아직 연동 준비 중입니다.'}
        </div>
      )}

      <KakaoMap
        ref={mapRef}
        center={center}
        style={{ width: '100%', height: '100%' }}
        level={6}
        onDragEnd={handleDragEnd}
        onZoomChanged={(map) => setZoomLevel(map.getLevel())}
        onClick={() => setSelectedMarkerId(null)}
      >
        {layers.apt && aptClusters.map((cluster) => {
          if (cluster.markers.length > 1) {
            // 겹치는 칩들을 정사각형에 가까운 격자로 살짝 벌려서 그린다 — 숫자 배지
            // 하나로 뭉치면 이름/가격이 안 보인다는 피드백을 반영. 그룹 안에 선택된
            // 마커가 있으면 이 그룹 오버레이 전체를 다른 클러스터들보다 위로 올리고
            // (CustomOverlayMap의 zIndex), 그룹 내부에서도 선택된 칩 하나만 형제 칩들
            // 위로 올려(일반 CSS z-index — 같은 컨테이너 안이라 여기선 먹힌다) 완전히
            // 겹친 경우에도 항상 맨 위에서 보이게 한다.
            const cols = Math.ceil(Math.sqrt(cluster.markers.length));
            const rows = Math.ceil(cluster.markers.length / cols);
            const clusterSelected = cluster.markers.some((m) => m.id === selectedMarkerId);
            return (
              <CustomOverlayMap
                key={cluster.id}
                position={{ lat: cluster.lat, lng: cluster.lng }}
                yAnchor={0.5}
                zIndex={clusterSelected ? 9999 : 1}
              >
                <div style={{ position: 'relative' }}>
                  {cluster.markers.map((marker, i) => {
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    const offsetX = (col - (cols - 1) / 2) * (chipLayout.width + chipLayout.gap);
                    const offsetY = (row - (rows - 1) / 2) * (chipLayout.height + chipLayout.gap);
                    const selected = marker.id === selectedMarkerId;
                    return (
                      <div
                        key={marker.id}
                        style={{
                          position: 'absolute',
                          left: offsetX,
                          top: offsetY,
                          transform: 'translate(-50%, -50%)',
                          zIndex: selected ? 9999 : i,
                        }}
                      >
                        {renderMarkerChip(marker, selected)}
                      </div>
                    );
                  })}
                </div>
              </CustomOverlayMap>
            );
          }

          const marker = cluster.markers[0];
          const selected = marker.id === selectedMarkerId;
          return (
            <CustomOverlayMap
              key={marker.id}
              position={{ lat: marker.lat, lng: marker.lng }}
              yAnchor={1} // 오버레이의 기준점 (1이면 마커 하단이 뾰족한 부분이 됨)
              zIndex={selected ? 9999 : 1}
            >
              <div style={{ transform: 'translateY(-10px)' }}>
                {renderMarkerChip(marker, selected)}
              </div>
            </CustomOverlayMap>
          );
        })}

        {layers.school && schoolMarkers.map((school) => (
          <CustomOverlayMap key={school.id} position={{ lat: school.lat, lng: school.lng }} yAnchor={1}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'white',
                border: `2px solid ${LEVEL_COLOR[school.level]}`,
                borderRadius: '999px',
                padding: '3px 8px 3px 4px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                whiteSpace: 'nowrap',
              }}
              title={school.name}
            >
              <span style={{ background: LEVEL_COLOR[school.level], color: 'white', borderRadius: '999px', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800 }}>
                {school.level}
              </span>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)' }}>{school.name}</span>
            </div>
          </CustomOverlayMap>
        ))}
      </KakaoMap>
    </div>
  );
}
