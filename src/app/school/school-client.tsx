'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import RegionSelectModal from '@/components/RegionSelectModal';
import { useRegion, RegionState } from '@/contexts/RegionContext';
import { resolveLawdCdByNames } from '@/lib/region-utils';
import styles from './school.module.css';

const TABS = ['전체', '초등', '중등', '고등', '학원가'];

// ?sido=...&sigungu=...로 진입한 경우(사이트맵/공유 링크) 최초 1회만 URL의 지역으로
// RegionContext를 초기화한다. useSearchParams()는 정적 렌더링 페이지에서 Suspense 경계
// 안에 있어야 하므로 별도 컴포넌트로 분리했다.
function RegionUrlSync({ setRegion }: { setRegion: (region: RegionState) => void }) {
  const searchParams = useSearchParams();
  const hydratedFromUrl = useRef(false);

  useEffect(() => {
    if (hydratedFromUrl.current) return;
    hydratedFromUrl.current = true;
    const sido = searchParams.get('sido');
    const sigungu = searchParams.get('sigungu');
    if (!sido || !sigungu) return;
    resolveLawdCdByNames(sido, sigungu).then((lawdCd) => {
      if (!lawdCd) return;
      setRegion({
        lawdCd,
        dong: 'all',
        sido,
        sigungu,
        displayRegionName: `${sido} ${sigungu} 동 전체`,
      });
    });
  }, [searchParams, setRegion]);

  return null;
}

export default function SchoolInfoPage() {
  const { region, setRegion, openRegionModal } = useRegion();
  const [activeTab, setActiveTab] = useState(TABS[0]);
  const [selectedSchool, setSelectedSchool] = useState<any>(null);

  // 학교 검색 API는 동(洞) 단위가 아닌 시/군/구 단위로 동작하므로, 선택된 동 이름은
  // 제외하고 "시도 시군구" 형태로만 구성한다.
  const regionName = `${region.sido} ${region.sigungu}`;

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

  // 선택 지역에 맞는 학교 목록 불러오기 (탭 변경 시 리스트만 업데이트)
  useEffect(() => {
    const fetchSchools = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/school?region=${encodeURIComponent(regionName)}&type=${encodeURIComponent(activeTab)}`);
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
  }, [regionName, activeTab]);

  // 지역 전체 통계 불러오기 (지역 변경 시에만 업데이트하여 숫자 널뛰기 방지)
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const statsRes = await fetch(`/api/school/stats?region=${encodeURIComponent(regionName)}`);
        const statsJson = await statsRes.json();
        if (statsJson.success) {
          setStats(statsJson.data);
        }
      } catch (error) {
        console.error('Stats load error:', error);
      }
    };

    fetchStats();
  }, [regionName]);

  // 배정 단지 불러오기 (GIS 연산 API 연동)
  useEffect(() => {
    if (selectedSchool && selectedSchool.name) {
      const fetchApts = async () => {
        try {
          const res = await fetch(`/api/school/apartments?schoolName=${encodeURIComponent(selectedSchool.name)}&lat=${selectedSchool.lat || ''}&lng=${selectedSchool.lng || ''}&lawdCd=${encodeURIComponent(region.lawdCd)}`);
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
  }, [selectedSchool, region.lawdCd]);

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
      <Suspense fallback={null}>
        <RegionUrlSync setRegion={setRegion} />
      </Suspense>
      <Header pageTitle="학군 정보" />
      <div className="container">
        
        {/* 1단계: 상단 '학군 탐색 필터' 및 '지역 대시보드' */}
        <div className={styles.header}>
          <div className={styles.headerTop}>
            <button className={styles.regionTrigger} onClick={openRegionModal}>
              <span>📍 {regionName}</span>
              <span className={styles.regionTriggerCaret}>▾</span>
            </button>
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
                <h3>{regionName} {activeTab === '전체' || activeTab === '학원가' ? '학교' : activeTab + '학교'} 수</h3>
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
                <p>
                  {stats.academyCount === -1 
                    ? <span style={{fontSize: '1rem', color: 'var(--text-muted)'}}>데이터 수집 중...</span>
                    : `${stats.academyLocation} (학원 ${stats.academyCount}개)`
                  }
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 2단계 및 3단계 레이아웃 */}
        {/* 학교 랭킹 리스트 (전체 너비 사용) */}
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>🏆 {regionName} {activeTab} 랭킹</h2>
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

      </div>

      {/* 학교 상세 전면 모달 (Modal) */}
      {selectedSchool && (
        <div className={styles.modalOverlay} onClick={() => setSelectedSchool(null)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h2 className={styles.modalTitle}>{selectedSchool.name}</h2>
                <span style={{color: 'var(--text-secondary)', fontSize: '0.9rem'}}>{regionName} 전체 {selectedSchool.rank}위</span>
              </div>
              <button className={styles.modalCloseBtn} onClick={() => setSelectedSchool(null)}>×</button>
            </div>
            
            <div className={styles.modalBody}>
              {/* 상단: 학교 기본 정보 및 지표 */}
              <h3 style={{marginTop: 0, marginBottom: '1rem', color: 'var(--text-primary)'}}>📊 세부 지표</h3>
              <div className={styles.schoolDetailGrid}>
                <div className={styles.detailBox}>
                  <div className={styles.detailLabel}>총 학생수</div>
                  <div className={styles.detailValue}>{selectedSchool.students}명</div>
                </div>
                {selectedSchool.classStudents && (
                  <div className={styles.detailBox}>
                    <div className={styles.detailLabel}>학급당 인원</div>
                    <div className={styles.detailValue}>{selectedSchool.classStudents}명</div>
                  </div>
                )}
                {selectedSchool.graduates && (
                  <div className={styles.detailBox}>
                    <div className={styles.detailLabel}>졸업생 수</div>
                    <div className={styles.detailValue}>{selectedSchool.graduates}명</div>
                  </div>
                )}
                
                {activeTab === '중등' && (
                  <>
                    <div className={styles.detailBox}>
                      <div className={styles.detailLabel}>과학고 진학</div>
                      <div className={styles.detailValue} style={{color: '#3b82f6'}}>{selectedSchool.sciHigh}명</div>
                    </div>
                    <div className={styles.detailBox}>
                      <div className={styles.detailLabel}>외고·국제고 진학</div>
                      <div className={styles.detailValue} style={{color: '#8b5cf6'}}>{selectedSchool.foreignHigh}명</div>
                    </div>
                    <div className={styles.detailBox}>
                      <div className={styles.detailLabel}>특목고 진학률</div>
                      <div className={styles.detailValue} style={{color: 'var(--primary-color)'}}>{selectedSchool.specialRatio}%</div>
                    </div>
                  </>
                )}

                {activeTab === '고등' && (
                  <>
                    <div className={styles.detailBox}>
                      <div className={styles.detailLabel}>4년제 진학률</div>
                      <div className={styles.detailValue} style={{color: '#3b82f6'}}>{selectedSchool.univRate}%</div>
                    </div>
                    <div className={styles.detailBox}>
                      <div className={styles.detailLabel}>의약계열/주요대</div>
                      <div className={styles.detailValue} style={{color: '#8b5cf6'}}>{selectedSchool.medSeoulRate}%</div>
                    </div>
                  </>
                )}
              </div>

              {/* 하단: 배정 단지 리스트 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem' }}>
                <div>
                  <h3 style={{margin: 0, color: 'var(--text-primary)'}}>📌 배정 가능 단지 (직선거리)</h3>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
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
                      <Link href={`/apt/${encodeURIComponent(apt.name)}?lawdCd=${region.lawdCd}&type=apt`} className={styles.linkBtn}>시세 보기 &gt;</Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <RegionSelectModal />
    </div>
  );
}
