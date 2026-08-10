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
  price: string;
  hasRecentPrice: boolean; // 최근 거래(가격) 유무 — 없으면 "시세 정보 없음"으로 폴백 표시
  lat: number;
  lng: number;
}

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
  const [schoolMarkers, setSchoolMarkers] = useState<SchoolMarker[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isMapReady, setIsMapReady] = useState(false);
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
    let script = document.getElementById(scriptId) as HTMLScriptElement;

    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer&autoload=false`;
      script.async = true;
      document.head.appendChild(script);
    }

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

    return () => clearInterval(checkKakao);
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
    if (!window.kakao?.maps?.services) return;
    const geocoder = new window.kakao.maps.services.Geocoder();

    geocoder.coord2RegionCode(lng, lat, async (result: any, status: any) => {
      if (status !== window.kakao.maps.services.Status.OK) return;
      const region = result.find((r: any) => r.region_type === 'B');
      if (!region) return;
      const lawdCd = region.code.substring(0, 5);

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

  // 최초 지도 준비 완료 + center 확정 시 최초 1회 로드
  useEffect(() => {
    if (!isMapReady) return;
    setIsLoadingData(true);
    refreshActiveLayers(center.lat, center.lng);
  }, [isMapReady]);

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
      mapRef.current.panTo(new window.kakao.maps.LatLng(latLng.lat, latLng.lng));
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
      >
        {layers.apt && aptMarkers.map((marker) => (
          <CustomOverlayMap
            key={marker.id}
            position={{ lat: marker.lat, lng: marker.lng }}
            yAnchor={1} // 오버레이의 기준점 (1이면 마커 하단이 뾰족한 부분이 됨)
          >
            <div
              onClick={() => router.push(`/apt/${marker.name}`)}
              style={{
                background: 'white',
                border: `2px solid ${marker.hasRecentPrice ? 'var(--primary-color)' : '#94a3b8'}`,
                borderRadius: '8px',
                padding: '6px 12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                cursor: 'pointer',
                transform: 'translateY(-10px)',
                transition: 'transform 0.2s, boxShadow 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-15px) scale(1.05)';
                e.currentTarget.style.boxShadow = '0 8px 12px rgba(0,0,0,0.2)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(-10px) scale(1)';
                e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
              }}
            >
              {/* 작은 말풍선 꼬리 */}
              <div style={{
                position: 'absolute',
                bottom: '-8px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '0',
                height: '0',
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                borderTop: `8px solid ${marker.hasRecentPrice ? 'var(--primary-color)' : '#94a3b8'}`
              }} />

              <span style={{ fontSize: '0.75rem', color: '#666', fontWeight: 600 }}>{marker.name}</span>
              <span style={{ fontSize: marker.hasRecentPrice ? '1.1rem' : '0.8rem', fontWeight: marker.hasRecentPrice ? 800 : 600, color: marker.hasRecentPrice ? 'var(--text-primary)' : '#94a3b8' }}>
                {marker.price}
              </span>
            </div>
          </CustomOverlayMap>
        ))}

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
