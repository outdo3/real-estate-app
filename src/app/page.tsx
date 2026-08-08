'use client';

import React, { useEffect, useState } from 'react';
import { Map, CustomOverlayMap } from 'react-kakao-maps-sdk';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import RankCard from '@/components/RankCard';
import styles from './page.module.css';

// 배포 환경에 따라 변수명이 다르게 설정된 경우까지 대비한 방어적 조회
const apiKey =
  process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY ||
  process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

export default function Home() {
  const router = useRouter();

  const [markers, setMarkers] = useState<any[]>([]);
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapLoadFailed, setMapLoadFailed] = useState(false);
  const [mapLoadAttempt, setMapLoadAttempt] = useState(0);
  const [center, setCenter] = useState({ lat: 35.0979, lng: 129.0244 }); // 기본: 부산광역시 서구
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');

  const [dynamicData, setDynamicData] = useState<any[]>([]); // 탭 변경 시 데이터
  const [userLawdCd, setUserLawdCd] = useState<string>('26140');
  const [userDong, setUserDong] = useState<string>('all');
  const [displayRegionName, setDisplayRegionName] = useState<string>('부산광역시 서구 동 전체');

  // 아실 스타일 검색 모달 상태
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [modalStep, setModalStep] = useState<'sido' | 'sigungu' | 'dong'>('sido');
  const [modalKeyword, setModalKeyword] = useState('');
  type RegionOption = { code: string; name: string };
  const [modalSidos, setModalSidos] = useState<RegionOption[]>([]);
  const [modalSigungus, setModalSigungus] = useState<RegionOption[]>([]);
  const [modalDongs, setModalDongs] = useState<RegionOption[]>([]);
  const [selectedSido, setSelectedSido] = useState<RegionOption | null>(null);
  const [selectedSigungu, setSelectedSigungu] = useState<RegionOption | null>(null);
  const [regionLoading, setRegionLoading] = useState(false);

  const openSearchModal = () => {
    setShowSearchModal(true);
    setModalStep('sido');
    setSelectedSido(null);
    setSelectedSigungu(null);
    setModalKeyword('');
    if (modalSidos.length === 0) {
      setRegionLoading(true);
      fetch('https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?regcode_pattern=*00000000')
        .then(res => res.json())
        .then(data => setModalSidos(data.regcodes || []))
        .catch(err => console.error('시도 목록 조회 실패', err))
        .finally(() => setRegionLoading(false));
    }
  };

  const selectSido = (sido: RegionOption) => {
    setSelectedSido(sido);
    setSelectedSigungu(null);
    setModalDongs([]);
    setRegionLoading(true);
    const sidoCode = sido.code.substring(0, 2);
    fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?regcode_pattern=${sidoCode}*00000&is_ignore_zero=true`)
      .then(res => res.json())
      .then(data => {
        const list = (data.regcodes || []).filter((item: RegionOption) => item.code.substring(0, 5) !== `${sidoCode}000`);
        setModalSigungus(list);
        setModalStep('sigungu');
      })
      .catch(err => console.error('시군구 목록 조회 실패', err))
      .finally(() => setRegionLoading(false));
  };

  const selectSigungu = (sigungu: RegionOption) => {
    setSelectedSigungu(sigungu);
    setRegionLoading(true);
    const sigunguCode = sigungu.code.substring(0, 5);
    fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?regcode_pattern=${sigunguCode}*&is_ignore_zero=true`)
      .then(res => res.json())
      .then(data => {
        const list = (data.regcodes || []).filter((item: RegionOption) => item.code !== `${sigunguCode}00000`);
        setModalDongs(list);
        setModalStep('dong');
      })
      .catch(err => console.error('읍면동 목록 조회 실패', err))
      .finally(() => setRegionLoading(false));
  };

  // 지역 선택 확정: lawdCd/동 상태 갱신 + 카카오 지오코딩으로 지도 중심 이동 + 모달 닫기
  const finalizeRegion = (lawdCd: string, regionName: string, dongName: string) => {
    setUserLawdCd(lawdCd);
    setUserDong(dongName);
    setDisplayRegionName(regionName);
    setShowSearchModal(false);

    if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
      const geocoder = new window.kakao.maps.services.Geocoder();
      geocoder.addressSearch(regionName, (result: any, status: any) => {
        if (status === window.kakao.maps.services.Status.OK && result[0]) {
          setCenter({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) });
        }
      });
    }
  };

  const selectDong = (dong: RegionOption | null) => {
    if (!selectedSido || !selectedSigungu) return;
    const sigunguCode = selectedSigungu.code.substring(0, 5);
    const sigunguShortName = selectedSigungu.name.split(' ').slice(1).join(' ');
    if (!dong) {
      finalizeRegion(sigunguCode, `${selectedSido.name} ${sigunguShortName}`, 'all');
      return;
    }
    const dongShortName = dong.name.split(' ').pop() || 'all';
    finalizeRegion(sigunguCode, dong.name, dongShortName);
  };

  const handleModalKeywordSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalKeyword.trim()) return;
    if (!window.kakao || !window.kakao.maps || !window.kakao.maps.services) return;

    const ps = new window.kakao.maps.services.Places();
    ps.keywordSearch(modalKeyword, (data: any, status: any) => {
      if (status === window.kakao.maps.services.Status.OK && data[0]) {
        setCenter({ lat: parseFloat(data[0].y), lng: parseFloat(data[0].x) });
        setShowSearchModal(false);
      }
    });
  };

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

  // 실거래가 데이터 로드
  useEffect(() => {
    async function fetchData() {
      try {
        const dongParam = userDong && userDong !== 'all' ? `&dong=${encodeURIComponent(userDong)}` : '';
        const res = await fetch(`/api/transactions?type=apt&lawdCd=${userLawdCd}${dongParam}`);
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
  }, [userLawdCd, userDong]);

  // 컴팩트 시장 동향 바용 요약: 동별 거래량 집계 (실데이터 기반, 더미 수치 없음)
  const dongCounts: Record<string, number> = {};
  dynamicData.forEach((item: any) => {
    const d = item.dong || '기타';
    dongCounts[d] = (dongCounts[d] || 0) + 1;
  });
  const topDongs = Object.entries(dongCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);

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
        searchSlot={
          <div
            onClick={openSearchModal}
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
                    onClick={() => router.push(`/apt/${encodeURIComponent(marker.name)}?lawdCd=${userLawdCd}`)}
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

        {/* 슬림 리스트 레이어: 지도 대신 부산 서구 아파트 단지 카드 목록을 같은 자리에 표시 */}
        {viewMode === 'list' && (
          <div className={styles.listWrapper}>
            <div className={styles.listGrid}>
              {dynamicData.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
                  표시할 단지 정보가 없습니다.
                </div>
              ) : (
                dynamicData.map((item: any) => (
                  <RankCard key={item.id} data={item} regionName={displayRegionName} />
                ))
              )}
            </div>
          </div>
        )}

        {/* 상단 떠있는 UI 레이어 */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10, pointerEvents: 'none', display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>

            {/* 현재 위치: 클릭 시 검색 모달 오픈 (검색창은 상단 헤더로 이동) */}
            <div
              onClick={openSearchModal}
              style={{ pointerEvents: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255, 255, 255, 0.95)', padding: '10px 16px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', cursor: 'pointer' }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                현재 위치: {displayRegionName} <span style={{ color: '#22c55e' }}>📍</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); window.location.reload(); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--text-secondary)' }}
              >
                🔄
              </button>
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
                style={{ padding: '8px 14px', background: viewMode === 'map' ? 'var(--primary-color)' : 'white', border: 'none', fontWeight: 700, color: viewMode === 'map' ? 'white' : 'var(--text-secondary)', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                🗺️ 지도
              </button>
              <button
                onClick={() => setViewMode('list')}
                style={{ padding: '8px 14px', background: viewMode === 'list' ? 'var(--primary-color)' : 'white', border: 'none', fontWeight: 700, color: viewMode === 'list' ? 'white' : 'var(--text-secondary)', fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                📋 리스트
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

          {/* 하단 네비게이션 바: 실거래가(/) / 시장 통계(/stats) / 학군 정보(/school) / 부동산 도구(/tools) */}
          <div style={{ pointerEvents: 'auto', background: 'white', display: 'flex', justifyContent: 'space-around', padding: '12px 0', borderTop: '1px solid var(--border-color)', paddingBottom: 'calc(12px + env(safe-area-inset-bottom))' }}>
            <Link href="/" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: '#22c55e' }}>
              <span style={{ fontSize: '1.5rem', marginBottom: '4px' }}>📈</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>실거래가</span>
            </Link>
            <Link href="/stats" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '1.5rem', marginBottom: '4px' }}>📊</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>시장 통계</span>
            </Link>
            <Link href="/school" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🏫</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>학군 정보</span>
            </Link>
            <Link href="/tools" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '1.5rem', marginBottom: '4px' }}>🛠️</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>부동산 도구</span>
            </Link>
          </div>

        </div>
      </div>

      {/* 아실 스타일 전면 검색 모달 */}
      {showSearchModal && (
        <div className={styles.searchModalOverlay} onClick={() => setShowSearchModal(false)}>
          <div className={styles.searchModalContent} onClick={(e) => e.stopPropagation()}>
            {/* 상단: 아파트명 검색 입력 + 닫기 */}
            <div className={styles.searchModalHeader}>
              <form onSubmit={handleModalKeywordSearch} style={{ flex: 1, display: 'flex' }}>
                <input
                  autoFocus
                  type="text"
                  placeholder="아파트명을 입력해주세요."
                  value={modalKeyword}
                  onChange={(e) => setModalKeyword(e.target.value)}
                  className={styles.searchModalInput}
                />
              </form>
              <button
                className={styles.searchModalCloseBtn}
                onClick={() => setShowSearchModal(false)}
                aria-label="검색 닫기"
              >
                ×
              </button>
            </div>

            {/* 중단: 단계별 탭 */}
            <div className={styles.searchModalTabs}>
              <button
                className={`${styles.searchModalTab} ${modalStep === 'sido' ? styles.searchModalTabActive : ''}`}
                onClick={() => setModalStep('sido')}
              >
                {selectedSido ? selectedSido.name : '시도 선택'}
              </button>
              <span className={styles.searchModalTabArrow}>›</span>
              <button
                className={`${styles.searchModalTab} ${modalStep === 'sigungu' ? styles.searchModalTabActive : ''}`}
                disabled={!selectedSido}
                onClick={() => selectedSido && setModalStep('sigungu')}
              >
                {selectedSigungu ? selectedSigungu.name.split(' ').slice(1).join(' ') : '시군구 선택'}
              </button>
              <span className={styles.searchModalTabArrow}>›</span>
              <button
                className={`${styles.searchModalTab} ${modalStep === 'dong' ? styles.searchModalTabActive : ''}`}
                disabled={!selectedSigungu}
                onClick={() => selectedSigungu && setModalStep('dong')}
              >
                읍면동 선택
              </button>
            </div>

            {/* 하단: 지역 그리드 패널 */}
            <div className={styles.searchModalGridWrapper}>
              {regionLoading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                  불러오는 중...
                </div>
              ) : (
                <div className={styles.searchModalGrid}>
                  {modalStep === 'sido' &&
                    modalSidos.map((sido) => (
                      <button key={sido.code} className={styles.searchModalGridBtn} onClick={() => selectSido(sido)}>
                        {sido.name}
                      </button>
                    ))}

                  {modalStep === 'sigungu' &&
                    modalSigungus.map((sigungu) => (
                      <button key={sigungu.code} className={styles.searchModalGridBtn} onClick={() => selectSigungu(sigungu)}>
                        {sigungu.name.split(' ').slice(1).join(' ')}
                      </button>
                    ))}

                  {modalStep === 'dong' && (
                    <>
                      <button className={styles.searchModalGridBtn} onClick={() => selectDong(null)}>
                        {(selectedSigungu?.name.split(' ').slice(1).join(' ')) || ''} 전체
                      </button>
                      {modalDongs.map((dong) => (
                        <button key={dong.code} className={styles.searchModalGridBtn} onClick={() => selectDong(dong)}>
                          {dong.name.split(' ').pop()}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
