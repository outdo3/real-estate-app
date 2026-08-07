'use client';

import React, { useEffect, useState } from 'react';
import { Map, MapMarker } from 'react-kakao-maps-sdk';

interface MapViewerProps {
  markers?: {
    id: number;
    title: string;
    lat: number;
    lng: number;
  }[];
  userCenter?: { lat: number; lng: number } | null;
}

const MapViewer: React.FC<MapViewerProps> = ({ markers = [], userCenter = null }) => {
  const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  const [isMapReady, setIsMapReady] = useState(false);
  const [center, setCenter] = useState({ lat: 37.498095, lng: 127.027610 }); // 기본: 강남역
  const [keyword, setKeyword] = useState('');

  // 스크립트 로드 (page.tsx에서 로드한 것을 재사용)
  useEffect(() => {
    const checkKakao = setInterval(() => {
      // services 객체까지 로드되었는지 확인 (MapViewer에서는 services를 사용하므로)
      if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
        clearInterval(checkKakao);
        setIsMapReady(true);
      }
    }, 200);
    
    return () => clearInterval(checkKakao);
  }, []);

  // 컴포넌트 첫 마운트 시 또는 userCenter 변경 시 중심 위치 업데이트
  useEffect(() => {
    if (userCenter) {
      setCenter(userCenter);
    } else if (navigator.geolocation) {
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
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else if (markers.length > 0) {
      setCenter({ lat: markers[0].lat, lng: markers[0].lng });
    }
  }, [userCenter, markers]);

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
    return <div style={{ width: '100%', height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEE2E2', color: '#EF4444', borderRadius: 'var(--radius-lg)' }}>환경변수(API 키)를 불러오지 못했습니다. 서버를 재시작해야 할 수 있습니다.</div>;
  }

  if (!isMapReady) {
    return <div style={{ width: '100%', height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-color)', borderRadius: 'var(--radius-lg)' }}>지도 불러오는 중...</div>;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '500px', borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-color)' }}>
      {/* 지도 위 컨트롤 UI */}
      <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, display: 'flex', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.95)', padding: '0.5rem', borderRadius: '8px', boxShadow: '0 2px 6px rgba(0,0,0,0.15)', backdropFilter: 'blur(4px)' }}>
        <form onSubmit={searchPlaces} style={{ display: 'flex', gap: '0.5rem' }}>
          <input 
            type="text" 
            placeholder="지역 검색 (예: 판교역)" 
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '4px', outline: 'none', width: '200px', fontSize: '0.95rem' }}
          />
          <button type="submit" style={{ padding: '0.6rem 1rem', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}>이동</button>
        </form>
        <button 
          onClick={() => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(
                (pos) => setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                (err) => console.warn(err),
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
              );
            }
          }} 
          style={{ padding: '0.6rem 1rem', background: 'white', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, transition: 'background 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.background = '#f5f5f5'}
          onMouseOut={(e) => e.currentTarget.style.background = 'white'}
        >
          📍 내 위치
        </button>
      </div>

      <Map
        center={center}
        style={{ width: '100%', height: '100%' }}
        level={4} // 확대 수준
      >
        {markers.map((marker) => (
          <MapMarker
            key={marker.id}
            position={{ lat: marker.lat, lng: marker.lng }}
            title={marker.title}
          />
        ))}
      </Map>
    </div>
  );
};

export default MapViewer;
