'use client';

import React, { useEffect, useState } from 'react';
import { Map, CustomOverlayMap } from 'react-kakao-maps-sdk';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function FullscreenMapPage() {
  const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  const router = useRouter();

  const [markers, setMarkers] = useState<any[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isMapReady, setIsMapReady] = useState(false);
  const [center, setCenter] = useState({ lat: 37.498095, lng: 127.027610 });
  const [keyword, setKeyword] = useState('');

  useEffect(() => {
    if (!apiKey) return;
    
    const scriptId = 'kakao-map-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement;
    
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${apiKey}&libraries=services,clusterer&autoload=false`;
      script.async = true;
      document.head.appendChild(script);
    }
    
    const checkKakao = setInterval(() => {
      if (window.kakao && window.kakao.maps) {
        clearInterval(checkKakao);
        window.kakao.maps.load(() => {
          setIsMapReady(true);
        });
      }
    }, 200);
    
    return () => clearInterval(checkKakao);
  }, [apiKey]);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/transactions');
        const data = await res.json();
        
        const fetchedMarkers = data
          .filter((item: any) => item.lat && item.lng)
          .map((item: any) => ({
            id: item.id,
            name: item.name,
            price: item.price,
            type: item.changeType,
            lat: item.lat,
            lng: item.lng,
          }));
        
        setMarkers(fetchedMarkers);
      } catch (error) {
        console.error('Failed to fetch map data:', error);
      } finally {
        setIsLoadingData(false);
      }
    }
    
    fetchData();
  }, []);

  // 컴포넌트 첫 마운트 시, 사용자 위치 가져오기
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCenter({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.log('위치 정보를 가져오지 못했습니다. 기본 위치를 사용합니다.', error);
          if (markers.length > 0) {
            setCenter({ lat: markers[0].lat, lng: markers[0].lng });
          }
        }
      );
    } else if (markers.length > 0) {
      setCenter({ lat: markers[0].lat, lng: markers[0].lng });
    }
  }, [markers]);

  // 장소 검색 함수
  const searchPlaces = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;

    if (!window.kakao || !window.kakao.maps || !window.kakao.maps.services) {
      alert("지도 서비스가 아직 로드되지 않았습니다.");
      return;
    }

    const ps = new window.kakao.maps.services.Places();
    ps.keywordSearch(keyword, (data: any, status: any) => {
      if (status === window.kakao.maps.services.Status.OK) {
        setCenter({
          lat: parseFloat(data[0].y),
          lng: parseFloat(data[0].x),
        });
      } else if (status === window.kakao.maps.services.Status.ZERO_RESULT) {
        alert("검색 결과가 존재하지 않습니다.");
      } else {
        alert("검색 중 오류가 발생했습니다.");
      }
    });
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

        <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.95)', padding: '0.5rem', borderRadius: '99px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
          <form onSubmit={searchPlaces} style={{ display: 'flex', gap: '0.5rem' }}>
            <input 
              type="text" 
              placeholder="지역 검색 (예: 판교역)" 
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              style={{ padding: '0.6rem 1rem', border: '1px solid var(--border-color)', borderRadius: '99px', outline: 'none', width: '250px', fontSize: '1rem' }}
            />
            <button type="submit" style={{ padding: '0.6rem 1.2rem', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '99px', cursor: 'pointer', fontWeight: 600 }}>검색</button>
          </form>
          <button 
            onClick={() => {
              if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition((pos) => setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }));
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

      <Map
        center={center}
        style={{ width: '100%', height: '100%' }}
        level={6}
      >
        {markers.map((marker) => (
          <CustomOverlayMap
            key={marker.id}
            position={{ lat: marker.lat, lng: marker.lng }}
            yAnchor={1} // 오버레이의 기준점 (1이면 마커 하단이 뾰족한 부분이 됨)
          >
            <div 
              onClick={() => router.push(`/apt/${marker.name}`)}
              style={{
                background: 'white',
                border: `2px solid ${marker.type === 'new' ? '#EF4444' : 'var(--primary-color)'}`,
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
                borderTop: `8px solid ${marker.type === 'new' ? '#EF4444' : 'var(--primary-color)'}`
              }} />
              
              <span style={{ fontSize: '0.75rem', color: '#666', fontWeight: 600 }}>{marker.name}</span>
              <span style={{ fontSize: '1.1rem', fontWeight: 800, color: marker.type === 'new' ? '#EF4444' : 'var(--text-primary)' }}>
                {marker.price}
              </span>
            </div>
          </CustomOverlayMap>
        ))}
      </Map>
    </div>
  );
}
