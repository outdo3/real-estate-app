'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import SearchFilterBar from '@/components/SearchFilterBar';
import MarketInsights from '@/components/MarketInsights';
import CardList from '@/components/CardList';
import TableList from '@/components/TableList';
import MapViewer from '@/components/MapViewer';
import { RankData } from '@/components/RankCard';
import styles from './page.module.css';

// 탭 맵핑
const TAB_MAP: Record<string, string> = {
  '아파트': 'apt',
  '전월세': 'rent',
  '분양권': 'silv',
  '오피스텔': 'officetel',
  '빌라': 'villa',
};

const SORT_OPTIONS = [
  { value: 'latest', label: '최신순' },
  { value: 'price_desc', label: '최고가순' },
  { value: 'price_asc', label: '최저가순' },
];

const AREA_OPTIONS = [
  { value: 'all', label: '면적 전체' },
  { value: 'small', label: '20평 미만' },
  { value: 'medium', label: '20~30평대' },
  { value: 'large', label: '40평 이상' },
];

export default function Home() {
  const apiKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY;

  const [activeTab, setActiveTab] = useState('아파트');
  const [showMap, setShowMap] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
  
  // 데이터 상태
  const [reboundData, setReboundData] = useState<RankData[]>([]);
  const [newHighData, setNewHighData] = useState<RankData[]>([]);
  const [dynamicData, setDynamicData] = useState<RankData[]>([]); // 탭 변경 시 데이터
  
  const [mapMarkers, setMapMarkers] = useState<any[]>([]);
  
  // 로딩 및 위치 상태
  const [isLoading, setIsLoading] = useState(true);
  const [isDynamicLoading, setIsDynamicLoading] = useState(false);
  const [userLawdCd, setUserLawdCd] = useState<string>(''); 
  const [userRegionName, setUserRegionName] = useState<string>('지역 탐색 중...');
  const [userDong, setUserDong] = useState<string>('all');
  
  // 더보기 상태
  const [loadMoreCount, setLoadMoreCount] = useState(0);
  const [visibleLimit, setVisibleLimit] = useState(20);

  // 검색/필터 상태
  const [keyword, setKeyword] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<string>('latest');
  const [areaFilter, setAreaFilter] = useState<string>('all');

  // 1. 카카오맵 스크립트 로드 및 사용자 위치(LAWD_CD) 획득
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
      if (window.kakao && window.kakao.maps) {
        clearInterval(checkKakao);
        window.kakao.maps.load(() => {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                const geocoder = new window.kakao.maps.services.Geocoder();
                geocoder.coord2RegionCode(lng, lat, (result: any, status: any) => {
                  if (status === window.kakao.maps.services.Status.OK) {
                    for (let i = 0; i < result.length; i++) {
                      if (result[i].region_type === 'B') {
                        const lawdCd = result[i].code.substring(0, 5);
                        setUserLawdCd(lawdCd);
                        setUserRegionName(result[i].address_name);
                        break;
                      }
                    }
                  }
                });
              },
              (error) => {
                setUserLawdCd('11680');
                setUserRegionName('서울 강남구');
              }
            );
          } else {
            setUserLawdCd('11680');
            setUserRegionName('서울 강남구');
          }
        });
      }
    }, 200);
    
    return () => clearInterval(checkKakao);
  }, [apiKey]);

  // 2. 초기 데이터 (아파트 TOP 5) 로드
  useEffect(() => {
    async function fetchInitialData() {
      try {
        const res = await fetch('/api/transactions');
        const data = await res.json();
        
        const rebound = data.filter((item: any) => item.changeType === 'up');
        const newHigh = data.filter((item: any) => item.changeType === 'new');
        
        setReboundData(rebound);
        setNewHighData(newHigh);

        const markers = data
          .filter((item: any) => item.lat && item.lng)
          .map((item: any) => ({
            id: item.id,
            title: `${item.name} (${item.price})`,
            lat: item.lat,
            lng: item.lng,
          }));
        
        setMapMarkers(markers);
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchInitialData();
  }, []);

  // 3. 탭 변경 또는 위치 획득 시 동적 데이터 로드
  useEffect(() => {
    if (!userLawdCd) return;

    const fetchDynamicData = async () => {
      setIsDynamicLoading(true);
      if (loadMoreCount === 0) setVisibleLimit(20); // 초기화 시에만 20으로 리셋
      try {
        const type = TAB_MAP[activeTab];
        let url = `/api/transactions?type=${type}&lawdCd=${userLawdCd}&loadMore=${loadMoreCount}`;
        if (userDong && userDong !== 'all') {
          url += `&dong=${encodeURIComponent(userDong)}`;
        }
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          setDynamicData(data);
        }
      } catch (error) {
        console.error('Failed to fetch dynamic data:', error);
        setDynamicData([]);
      } finally {
        setIsDynamicLoading(false);
      }
    }

    fetchDynamicData();
  }, [activeTab, userLawdCd, userDong, loadMoreCount]);

  const handleRegionChange = (lawdCd: string, regionName: string, dongName?: string) => {
    setUserLawdCd(lawdCd);
    setUserRegionName(regionName);
    setUserDong(dongName || 'all');
    setLoadMoreCount(0);
  };

  // 필터 및 정렬 적용
  const getFilteredData = () => {
    let data = [...dynamicData];
    if (keyword) {
      data = data.filter(item => item.name.includes(keyword) || item.dong?.includes(keyword));
    }
    if (areaFilter !== 'all') {
      data = data.filter(item => {
        const match = item.info.match(/([\d.]+)m²/);
        if (match) {
          const m2 = parseFloat(match[1]);
          if (areaFilter === 'small') return m2 < 60;
          if (areaFilter === 'medium') return m2 >= 60 && m2 < 85;
          if (areaFilter === 'large') return m2 >= 85;
        }
        return true;
      });
    }
    if (sortOrder === 'price_high') data.sort((a, b) => parseInt(b.price.replace(/[^\d]/g, '')) - parseInt(a.price.replace(/[^\d]/g, '')));
    if (sortOrder === 'price_low') data.sort((a, b) => parseInt(a.price.replace(/[^\d]/g, '')) - parseInt(b.price.replace(/[^\d]/g, '')));
    return data;
  };

  const handleLoadMore = () => {
    const filteredData = getFilteredData();
    if (visibleLimit >= filteredData.length) {
      // 렌더링된 데이터가 모두 표시되었을 경우 서버에 추가 데이터 요청
      setLoadMoreCount(c => c + 1);
      setVisibleLimit(v => v + 20);
    } else {
      // 서버에서 가져온 데이터가 아직 남아있을 경우 UI 표시 갯수만 증가
      setVisibleLimit(v => v + 20);
    }
  };

  const filteredDynamicData = getFilteredData();
  const visibleDynamicData = filteredDynamicData.slice(0, visibleLimit);
  const displayRegionName = userDong !== 'all' ? `${userRegionName} ${userDong}` : userRegionName;

  if (isLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '1.5rem', color: 'var(--primary-color)' }}>데이터를 불러오는 중입니다...</div>;
  }

  return (
    <main className={styles.main}>
      <Header />
      
      <SearchFilterBar 
        initialLawdCd={userLawdCd}
        onRegionChange={handleRegionChange}
        onSearch={setKeyword}
      />
      <div className={`container hide-scrollbar`} style={{ 
        marginTop: '1.5rem', 
        display: 'flex', 
        gap: '0.5rem', 
        marginBottom: '2rem',
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        padding: '0 16px',
        WebkitOverflowScrolling: 'touch'
      }}>
        {Object.keys(TAB_MAP).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '20px',
              border: activeTab === tab ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
              fontWeight: 700,
              fontSize: '0.95rem',
              cursor: 'pointer',
              background: activeTab === tab ? '#e6f9ed' : 'white',
              color: activeTab === tab ? 'var(--primary-color)' : 'var(--text-secondary)',
              transition: 'all 0.2s ease',
              flexShrink: 0
            }}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="container">
        <MarketInsights data={dynamicData} regionName={displayRegionName} />
      </div>
      <div className="container" style={{ marginTop: '2rem' }}>
        {/* 리스트 헤더 및 지도 토글 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', padding: '0 0.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              단지 실거래가 리스트
            </h2>
            <select 
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              style={{ padding: '0.4rem 0.8rem', borderRadius: '4px', border: '1px solid var(--border-color)', outline: 'none' }}
            >
              {AREA_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <select 
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              style={{ padding: '0.4rem 0.8rem', borderRadius: '4px', border: '1px solid var(--border-color)', outline: 'none' }}
            >
              {SORT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
          <div className={styles.floatingViewToggle}>
            <div className={styles.floatingViewToggleInner}>
              <Link href="/map" style={{ textDecoration: 'none' }}>
                <button style={{
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  padding: '0.6rem 1rem',
                  borderRadius: '999px',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: 'var(--shadow-sm)',
                  whiteSpace: 'nowrap'
                }}>
                  📍 지도
                </button>
              </Link>
              <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '999px', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
                <button 
                  onClick={() => setViewMode('table')}
                  style={{
                    background: viewMode === 'table' ? 'var(--primary-color)' : 'transparent',
                    color: viewMode === 'table' ? 'white' : '#475569',
                    border: 'none',
                    padding: '0.6rem 1.25rem',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap'
                  }}
                >
                  📋 목록
                </button>
                <button 
                  onClick={() => setViewMode('card')}
                  style={{
                    background: viewMode === 'card' ? 'var(--primary-color)' : 'transparent',
                    color: viewMode === 'card' ? 'white' : '#475569',
                    border: 'none',
                    padding: '0.6rem 1.25rem',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap'
                  }}
                >
                  🗂️ 카드
                </button>
              </div>
              <button 
                onClick={() => setShowMap(!showMap)}
                style={{
                  background: showMap ? 'var(--primary-color)' : '#f1f5f9',
                  color: showMap ? '#ffffff' : '#475569',
                  border: 'none',
                  padding: '0.6rem 1rem',
                  borderRadius: '999px',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: 'var(--shadow-sm)',
                  whiteSpace: 'nowrap'
                }}
              >
                {showMap ? '🗺️ 닫기' : '🗺️ 뷰어'}
              </button>
            </div>
          </div>
        </div>

        {/* 지도 영역 (토글) */}
        {showMap && (
          <div style={{ marginBottom: '3rem' }}>
            <MapViewer markers={mapMarkers} />
          </div>
        )}

        {/* 데이터 리스트 영역 */}
        <div style={{ minHeight: '500px' }}>
          {isDynamicLoading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              {displayRegionName}의 최신 실거래 데이터를 불러오는 중입니다...
            </div>
          ) : dynamicData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              {displayRegionName}에 거래 데이터가 없습니다.
            </div>
          ) : getFilteredData().length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 1rem', backgroundColor: '#f8fafc', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--border-color)', margin: '2rem 0' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏢</div>
              <h3 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                최근 3개월 내 <b>"{keyword}"</b>의 실거래 내역이 없습니다.
              </h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>
                원하시는 단지가 맞다면, 상세 페이지에서 과거 실거래 내역과 단지 정보를 확인해 보세요.
              </p>
              <Link href={`/apt/${encodeURIComponent(keyword)}?type=${TAB_MAP[activeTab]}&lawdCd=${userLawdCd}`} passHref legacyBehavior>
                <button style={{
                  padding: '1rem 2.5rem',
                  backgroundColor: 'var(--primary-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: 'var(--shadow-md)',
                  transition: 'all 0.2s'
                }}>
                  {keyword} 상세정보 바로가기 &gt;
                </button>
              </Link>
            </div>
          ) : (
            <>
              {viewMode === 'table' ? (
                <TableList 
                  title={keyword ? `${keyword} ${activeTab} 실거래` : `${displayRegionName} ${activeTab} 실거래`}
                  titleHighlight="최신"
                  highlightColor="var(--primary-color)"
                  date="06-08월"
                  data={visibleDynamicData}
                />
              ) : (
                <CardList 
                  title={keyword ? `${keyword} ${activeTab} 실거래` : `${displayRegionName} ${activeTab} 실거래`}
                  titleHighlight="최신"
                  highlightColor="var(--primary-color)"
                  date="06-08월"
                  data={visibleDynamicData}
                />
              )}
              {visibleDynamicData.length > 0 && (
                <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                  <button 
                    onClick={handleLoadMore}
                    style={{
                      padding: '0.75rem 2rem',
                      background: 'white',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-full)',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  >
                    더보기 {loadMoreCount > 0 ? `(${loadMoreCount})` : ''} 🔽
                  </button>
                </div>
              )}
            </>
          )}

          {/* 아파트 탭일 경우 기존 TOP5 데이터도 하단에 표시 */}
          {activeTab === '아파트' && (
            <div style={{ marginTop: '4rem' }}>
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: 'var(--text-secondary)', paddingLeft: '0.5rem' }}>🔥 전국 핫이슈 단지</h2>
              <CardList 
                title="전국 반등 실거래"
                titleHighlight="TOP5"
                highlightColor="var(--primary-color)"
                date="08.05"
                data={reboundData}
                isHorizontal={true}
              />
              <CardList 
                title="전국 아파트 신고가"
                titleHighlight="TOP5"
                highlightColor="var(--up-color)"
                date="08.05"
                data={newHighData}
                isHorizontal={true}
              />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
