'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Map, MapMarker } from 'react-kakao-maps-sdk';
import { REGION_DATA, SIDO_LIST } from '../../lib/regions';
import Header from '@/components/Header';
import styles from './school.module.css';

const TABS = ['전체', '초등', '중등', '고등', '학원가'];

export default function SchoolInfoPage() {
  const [sido, setSido] = useState('서울특별시');
  const [gungu, setGungu] = useState('강남구');
  const [activeTab, setActiveTab] = useState(TABS[0]);
  const [selectedSchool, setSelectedSchool] = useState<any>(null);
  
  const region = `${sido} ${gungu}`;
  
  // 통계 상태 관리
  const [stats, setStats] = useState({
    totalSchools: 0,
    elemCount: 0,
    midCount: 0,
    highCount: 0,
    specRate: '0.0%',
    academyLocation: '-',
    academyCount: 0
  });
  
  const [schools, setSchools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [aptList, setAptList] = useState<any[]>([]);
  const [aptSort, setAptSort] = useState<'distance' | 'newest'>('distance');
  const [lawdCd, setLawdCd] = useState('11680'); // 기본값: 강남구

  // 선택한 지역(sido, gungu)에 맞는 법정동코드(lawdCd) 조회
  useEffect(() => {
    const fetchLawdCd = async () => {
      try {
        const res = await fetch(`https://grpc-proxy-server-mkvo6j4wsq-du.a.run.app/v1/regcodes?regcode_pattern=*00000`);
        const json = await res.json();
        const targetName = `${sido} ${gungu}`;
        const found = json.regcodes.find((r: any) => r.name === targetName);
        if (found) {
          setLawdCd(found.code.substring(0, 5));
        }
      } catch (e) {
        console.error('Failed to fetch lawdCd', e);
      }
    };
    fetchLawdCd();
  }, [sido, gungu]);

  // 선택 지역에 맞는 학교 목록 불러오기 (탭 변경 시 리스트만 업데이트)
  useEffect(() => {
    const fetchSchools = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/school?region=${encodeURIComponent(region)}&type=${encodeURIComponent(activeTab)}`);
        const json = await res.json();
        if (json.success) {
          setSchools(json.data);
          setSelectedSchool(null);
        }
      } catch (error) {
        console.error('Data load error:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchSchools();
  }, [region, activeTab]);

  // 지역 전체 통계 불러오기 (지역 변경 시에만 업데이트하여 숫자 널뛰기 방지)
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const statsRes = await fetch(`/api/school/stats?region=${encodeURIComponent(region)}`);
        const statsJson = await statsRes.json();
        if (statsJson.success) {
          setStats(statsJson.data);
        }
      } catch (error) {
        console.error('Stats load error:', error);
      }
    };
    
    fetchStats();
  }, [region]);

  // 배정 단지 불러오기 (GIS 연산 API 연동)
  useEffect(() => {
    if (selectedSchool && selectedSchool.name) {
      const fetchApts = async () => {
        try {
          const res = await fetch(`/api/school/apartments?schoolName=${encodeURIComponent(selectedSchool.name)}&lat=${selectedSchool.lat || ''}&lng=${selectedSchool.lng || ''}`);
          const json = await res.json();
          if (json.success) {
            setAptList(json.data);
          }
        } catch (err) {
          console.error(err);
        }
      };
      fetchApts();
    } else {
      setAptList([]);
    }
  }, [selectedSchool]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSelectedSchool(null);
  };

  const renderSchoolItem = (item: any) => {
    if (activeTab === '중등') {
      return (
        <>
          <div className={styles.schoolInfo}>
            <h4>{item.name}</h4>
            <div className={styles.schoolStats}>
              <span>학업성취도: <strong>{item.achievement}%</strong></span>
              <span>특목·자사고: <span className={styles.statHighlight}>{item.specialHigh}명 ({item.specialRatio}%)</span></span>
              <span>학생수: {item.students}명</span>
            </div>
          </div>
        </>
      );
    } else if (activeTab === '초등') {
      return (
        <>
          <div className={styles.schoolInfo}>
            <h4>{item.name}</h4>
            <div className={styles.schoolStats}>
              <span>학급당 인원: <strong>{item.classStudents}명</strong></span>
              <span>통학: <span className={styles.statHighlight}>{item.walkTime}</span></span>
              <span>안전: {item.crossRoad}</span>
            </div>
          </div>
        </>
      );
    } else {
      return (
        <>
          <div className={styles.schoolInfo}>
            <h4>{item.name}</h4>
            <div className={styles.schoolStats}>
              <span>4년제 진학률: <strong>{item.univRate}%</strong></span>
              <span>주요대/의약계열: <span className={styles.statHighlight}>{item.medSeoulRate}%</span></span>
              <span>유형: {item.type}</span>
            </div>
          </div>
        </>
      );
    }
  };

  return (
    <div className={styles.main}>
      <Header />
      <div className="container">
        
        {/* 1단계: 상단 '학군 탐색 필터' 및 '지역 대시보드' */}
        <div className={styles.header}>
          <div className={styles.headerTop}>
            <div className={styles.regionSelectorGroup}>
              <select 
                className={styles.regionSelect} 
                value={sido}
                onChange={(e) => {
                  const newSido = e.target.value;
                  setSido(newSido);
                  setGungu(REGION_DATA[newSido][0]);
                }}
              >
                {SIDO_LIST.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select 
                className={styles.regionSelect} 
                value={gungu}
                onChange={(e) => setGungu(e.target.value)}
              >
                {REGION_DATA[sido].map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>  
            <div className={styles.tabs}>
              {TABS.map(tab => (
                <button 
                  key={tab} 
                  className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
                  onClick={() => handleTabChange(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.dashboardGrid}>
            <div className={styles.summaryCard}>
              <div className={styles.cardIcon}>🏫</div>
              <div className={styles.cardContent}>
                <h3>{region} {activeTab === '전체' || activeTab === '학원가' ? '학교' : activeTab + '학교'} 수</h3>
                <p>
                  {activeTab === '전체' || activeTab === '학원가'
                    ? `총 ${stats.totalSchools}개교 (초${stats.elemCount}/중${stats.midCount}/고${stats.highCount})`
                    : activeTab === '초등'
                    ? `총 ${stats.elemCount}개교`
                    : activeTab === '중등'
                    ? `총 ${stats.midCount}개교`
                    : activeTab === '고등'
                    ? `총 ${stats.highCount}개교`
                    : `총 ${stats.totalSchools}개교`
                  }
                </p>
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.cardIcon}>🎓</div>
              <div className={styles.cardContent}>
                <h3>평균 특목고 진학률</h3>
                <p>{stats.specRate} (시 평균 상회)</p>
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.cardIcon}>📚</div>
              <div className={styles.cardContent}>
                <h3>주요 학원가 밀집</h3>
                <p>{stats.academyLocation} (학원 {stats.academyCount}개)</p>
              </div>
            </div>
          </div>
        </div>

        {/* 2단계 및 3단계 레이아웃 */}
        <div className={styles.mainGrid}>
          
          {/* 좌측: 학교/비교 학군 리스트 */}
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>🏆 {region} {activeTab} 랭킹</h2>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {activeTab === '중등' ? '특목고 진학률 순' : (activeTab === '초등' ? '과밀학급/선호도 순' : '진학률 순')}
              </span>
            </div>
            
            <ul className={styles.schoolList}>
              {schools.map((item) => (
                <li 
                  key={item.id} 
                  className={`${styles.schoolItem} ${selectedSchool?.id === item.id ? styles.active : ''}`}
                  onClick={() => setSelectedSchool(item)}
                >
                  <div className={styles.rankBadge}>{item.rank}</div>
                  {renderSchoolItem(item)}
                </li>
              ))}
            </ul>
          </div>

          {/* 우측: 학교 배정 단지 및 맵 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            <div className={styles.panel}>
              <div className={styles.panelHeader} style={{ backgroundColor: '#eff6ff', borderBottom: '2px solid #bfdbfe', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
                <h2 className={styles.panelTitle} style={{ fontSize: '1.1rem', color: 'var(--primary-color)' }}>
                  📌 선택한 학교 배정 단지
                </h2>
                <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>
                  ※ 직선거리 기반 자동 매칭 단지로, 교육청의 공식 행정 배정 구역과는 미세한 차이가 있을 수 있습니다.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <button onClick={() => setAptSort('distance')} className={aptSort === 'distance' ? styles.activeSortBtn : styles.sortBtn}>거리순</button>
                  <button onClick={() => setAptSort('newest')} className={aptSort === 'newest' ? styles.activeSortBtn : styles.sortBtn}>신축순</button>
                </div>
              </div>
              <div className={styles.aptList}>
                {[...aptList].sort((a, b) => {
                  if (aptSort === 'newest') {
                    return (b.buildYear || 0) - (a.buildYear || 0);
                  } else {
                    return (a.distance || 0) - (b.distance || 0);
                  }
                }).map(apt => (
                  <div key={apt.id} className={styles.aptItem}>
                    <div>
                      <div className={styles.aptName}>{apt.name} <span style={{fontSize: '0.75rem', color: '#64748b', marginLeft: '4px'}}>{apt.buildYear ? `${apt.buildYear}년` : ''}</span></div>
                      <div className={styles.aptWalk}>{apt.walkTime}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className={styles.aptPrice}>{apt.price}</div>
                      <Link href={`/apt/${encodeURIComponent(apt.name)}?lawdCd=${lawdCd}&type=apt`} className={styles.linkBtn}>시세 보기 &gt;</Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle} style={{ fontSize: '1.1rem' }}>🎓 주변 학원가 분포</h2>
              </div>
              <div className={styles.mapContainer} style={{ padding: 0, overflow: 'hidden', height: '300px' }}>
                <Map 
                  center={{ lat: 35.115, lng: 129.018 }} 
                  style={{ width: '100%', height: '100%' }}
                  level={4}
                >
                  <MapMarker position={{ lat: 35.115, lng: 129.018 }}>
                    <div style={{ padding: '5px', color: '#000', fontSize: '12px' }}>{region} 학원가</div>
                  </MapMarker>
                </Map>
              </div>
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}
