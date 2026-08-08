'use client';

import React, { useEffect, useState } from 'react';
import { Map, CustomOverlayMap } from 'react-kakao-maps-sdk';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import MarketInsights from '@/components/MarketInsights';
import styles from './page.module.css';

export default function Home() {
  const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;
  const router = useRouter();

  const [markers, setMarkers] = useState<any[]>([]);
  const [isMapReady, setIsMapReady] = useState(false);
  const [center, setCenter] = useState({ lat: 35.0979, lng: 129.0244 }); // 기본: 부산광역시 서구
  const [keyword, setKeyword] = useState('');
  
  const [dynamicData, setDynamicData] = useState<any[]>([]); // 탭 변경 시 데이터
  const [userLawdCd, setUserLawdCd] = useState<string>('26140');
  const [displayRegionName, setDisplayRegionName] = useState<string>('부산광역시 서구 동 전체');

  // 카카오맵 스크립트 로드
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
        clearInterval(checkKakao);
        window.kakao.maps.load(() => {
          setIsMapReady(true);
        });
      }
    }, 200);
    
    return () => clearInterval(checkKakao);
  }, [apiKey]);

  // 실거래가 데이터 로드
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/transactions?type=apt&lawdCd=${userLawdCd}`);
        const data = await res.json();
        setDynamicData(data);
        
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
      }
    }
    
    fetchData();
  }, [userLawdCd]);

  // 장소 검색 함수
  const searchPlaces = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;

    if (!window.kakao || !window.kakao.maps || !window.kakao.maps.services) return;

    const ps = new window.kakao.maps.services.Places();
    ps.keywordSearch(keyword, (data: any, status: any) => {
      if (status === window.kakao.maps.services.Status.OK) {
        setCenter({
          lat: parseFloat(data[0].y),
          lng: parseFloat(data[0].x),
        });
      }
    });
  };

  if (!apiKey) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>API 키를 확인해주세요.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Header />
      
      <div style={{ position: 'relative', flex: 1 }}>
        {/* 지도 레이어 */}
        {isMapReady && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}>
            <Map
              center={center}
              style={{ width: '100%', height: '100%' }}
              level={5}
            >
              {markers.map((marker) => (
                <CustomOverlayMap
                  key={marker.id}
                  position={{ lat: marker.lat, lng: marker.lng }}
                  yAnchor={1}
                >
                  <div 
                    onClick={() => router.push(`/apt/${marker.name}`)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      cursor: 'pointer',
                      transform: 'translateY(-5px)',
                    }}
                  >
                    <div style={{
                      background: 'white',
                      border: '1px solid #1d4ed8',
                      borderTopLeftRadius: '6px',
                      borderTopRightRadius: '6px',
                      padding: '4px 8px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      color: '#1e293b',
                      whiteSpace: 'nowrap'
                    }}>
                      {marker.name}
                    </div>
                    <div style={{
                      background: '#1d4ed8',
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
                        borderTop: '6px solid #1d4ed8'
                      }} />
                    </div>
                  </div>
                </CustomOverlayMap>
              ))}
            </Map>
          </div>
        )}

        {/* 상단 떠있는 UI 레이어 */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, pointerEvents: 'none', display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            
            {/* 검색창 */}
            <div style={{ pointerEvents: 'auto', background: 'white', borderRadius: '8px', padding: '6px', display: 'flex', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              <form onSubmit={searchPlaces} style={{ display: 'flex', width: '100%', gap: '6px' }}>
                <input 
                  type="text" 
                  placeholder="단지명, 동이름, 지역명을 입력하세요" 
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  style={{ flex: 1, padding: '0.6rem 1rem', border: '1px solid var(--border-color)', borderRadius: '4px', outline: 'none', fontSize: '1rem' }}
                />
                <button type="submit" style={{ padding: '0.6rem 1.2rem', background: '#22c55e', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  전국 검색
                </button>
              </form>
            </div>

            {/* 현재 위치 */}
            <div style={{ pointerEvents: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.95)', padding: '10px 16px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                현재 위치: {displayRegionName} <span style={{ color: '#22c55e' }}>📍</span>
              </div>
              <button 
                onClick={() => window.location.reload()}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--text-secondary)' }}
              >
                🔄
              </button>
            </div>

            {/* 대시보드 */}
            <div style={{ pointerEvents: 'auto', background: 'white', borderRadius: '12px', padding: '0', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
              <MarketInsights data={dynamicData} regionName="부산광역시 서구" />
            </div>

            {/* 모드 전환 토글 */}
            <div style={{ pointerEvents: 'auto', display: 'flex', background: 'white', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginTop: '4px' }}>
              <button style={{ flex: 1, padding: '12px 0', background: 'white', border: 'none', borderRight: '1px solid var(--border-color)', fontWeight: 700, fontSize: '1rem', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}>
                🗺️ 지도 모드
              </button>
              <button 
                onClick={() => router.push('/stats')} 
                style={{ flex: 1, padding: '12px 0', background: '#f8fafc', border: 'none', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '1rem', cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
              >
                📋 슬림 리스트
              </button>
            </div>

          </div>

          {/* 하단 여백 및 네비게이션을 위해 flex-1 */}
          <div style={{ flex: 1 }}></div>

          {/* 우측 하단 컨트롤 */}
          <div style={{ pointerEvents: 'auto', alignSelf: 'flex-end', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button style={{ width: '40px', height: '40px', background: 'white', border: '1px solid var(--border-color)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.1)', cursor: 'pointer' }}>
              🎯
            </button>
            <button style={{ width: '40px', height: '40px', background: 'white', border: '1px solid var(--border-color)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.1)', cursor: 'pointer' }}>
              📏
            </button>
          </div>

          {/* 하단 네비게이션 바 */}
          <div style={{ pointerEvents: 'auto', background: 'white', display: 'flex', justifyContent: 'space-around', padding: '12px 0', borderTop: '1px solid var(--border-color)', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
            <Link href="/" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: '#22c55e' }}>
              <span style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🗺️</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>지도</span>
            </Link>
            <Link href="/stats" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '1.5rem', marginBottom: '4px' }}>📈</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>실거래</span>
            </Link>
            <Link href="/stats" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '1.5rem', marginBottom: '4px' }}>📊</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>통계</span>
            </Link>
            <Link href="/school" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🏫</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>학군</span>
            </Link>
            <Link href="/tools" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🛠️</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>부동산도구</span>
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
