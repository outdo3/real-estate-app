'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import RegionSelectModal from '@/components/RegionSelectModal';
import { useRegion, RegionState } from '@/contexts/RegionContext';
import { resolveLawdCdByNames } from '@/lib/region-utils';
import styles from './school.module.css';
import { buildRegionDisplayName } from '@/lib/region-display-name';

const TABS = ['전체', '초등', '중등', '고등', '학원가'];

interface SchoolStats {
  totalSchools: number;
  elemCount: number;
  midCount: number;
  highCount: number;
  /** COUNT_CONTRACT_FIX_V1 §6 — 초/중/고 밖 학교급(특수·외국인·각종학교 등). total = 초+중+고+기타. */
  otherCount: number;
  specRate: string | null;
  academyLocation: string;
  academyCount: number;
}

// 지역이 바뀌는 순간 되돌아갈 자리. 이전 지역 숫자가 새 제목 아래 남지 않게 한다.
const EMPTY_STATS: SchoolStats = {
  totalSchools: 0, elemCount: 0, midCount: 0, highCount: 0, otherCount: 0,
  specRate: null, academyLocation: '-', academyCount: 0,
};

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
        sidoCode: lawdCd.substring(0, 2),
        dong: 'all',
        sido,
        sigungu,
        displayRegionName: buildRegionDisplayName({ sido, sigungu, dong: 'all' }),
      });
    });
  }, [searchParams, setRegion]);

  return null;
}

export default function SchoolInfoPage() {
  const router = useRouter();
  const { region, setRegion, openRegionModal } = useRegion();
  const [activeTab, setActiveTab] = useState(TABS[0]);

  // 학교 검색 API는 동(洞) 단위가 아닌 시/군/구 단위로 동작하므로, 선택된 동 이름은
  // 제외하고 "시도 시군구" 형태로만 구성한다.
  const regionName = `${region.sido} ${region.sigungu}`;
  // SCHOOL_DISTRICT_IDENTITY_BUG_FIX_V1 — 시/군/구를 고르지 않았으면(= "부산광역시 전체")
  // 학교 목록은 지역을 특정할 수 없다. 예전에는 그 상태가 시/도 전체 학교를 쏟아냈고,
  // 이제는 0건이다. 0건을 "불러오지 못했습니다"(실패)로 보여주면 안 되므로 상태를 구분한다.
  const hasDistrict = !!region.sigungu && region.sigungu.trim().length > 0;
  const regionLabel = regionName.trim();

  // 통계 상태 관리
  const [stats, setStats] = useState<SchoolStats>(EMPTY_STATS);

  const [schools, setSchools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 선택 지역에 맞는 학교 목록 불러오기 (탭 변경 시 리스트만 업데이트)
  // SCHOOL_REGION_TRANSITION_COUNT_CONTRACT_FIX_V1 §1~§3
  //  - 지역/탭이 바뀌면 **즉시 이전 목록을 버린다.** 예전에는 성공 응답이 올 때만 교체해서,
  //    제목은 새 지역인데 목록은 이전 지역인 상태가 응답 도착까지 유지됐다.
  //  - 늦게 도착한 이전 요청이 현재 지역을 덮어쓰지 못하게 abort + cancelled 가드를 둔다.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setSchools([]);
    setLoading(true);

    (async () => {
      try {
        const res = await fetch(
          `/api/school?region=${encodeURIComponent(regionName)}&type=${encodeURIComponent(activeTab)}`,
          { signal: controller.signal }
        );
        const json = await res.json();
        if (cancelled) return;
        if (json.success) setSchools(json.data);
      } catch (error) {
        if (!cancelled && (error as Error)?.name !== 'AbortError') {
          console.error('Data load error:', error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [regionName, activeTab]);

  // 지역 전체 통계 불러오기 (지역 변경 시에만 업데이트하여 숫자 널뛰기 방지)
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setStats(EMPTY_STATS);

    (async () => {
      try {
        const statsRes = await fetch(`/api/school/stats?region=${encodeURIComponent(regionName)}`, {
          signal: controller.signal,
        });
        const statsJson = await statsRes.json();
        if (cancelled) return;
        if (statsJson.success) setStats(statsJson.data);
      } catch (error) {
        if (!cancelled && (error as Error)?.name !== 'AbortError') {
          console.error('Stats load error:', error);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [regionName]);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
  };

  // 학교 상세페이지(/school/[id])는 아파트 상세페이지의 [학군] 탭에서 진입하는 경로와
  // 동일한 단일 라우트다 — 여기서도 같은 경로로 이동시켜(예전에는 이 페이지 안에서
  // 자체 모달을 띄웠다) 두 진입 경로의 화면을 하나로 합친다.
  const goToSchoolDetail = (item: any) => {
    const params = new URLSearchParams({ name: item.name });
    if (item.lat) params.set('lat', String(item.lat));
    if (item.lng) params.set('lng', String(item.lng));
    if (region.lawdCd) params.set('lawdCd', region.lawdCd);
    router.push(`/school/${encodeURIComponent(item.id)}?${params.toString()}`);
  };

  // 학생수/학급당인원/학업성취도/특목고 진학률/통학시간 등은 NEIS API에 없는 값이라
  // 과거에는 학교명 해시로 지어낸 가짜 수치를 보여줬다(STEP 1 감사에서 발견, STEP 1.5-A에서
  // 제거). 실제 근거가 있는 값(학교명, 고교 유형)만 표시하고 나머지는 "데이터 준비 중"으로
  // 표시한다 — 0%나 임의 숫자로 채우지 않는다.
  const renderSchoolItem = (item: any) => {
    if (activeTab === '중등') {
      return (
        <div className={styles.schoolInfo}>
          <h4>{item.name}</h4>
          <div className={styles.schoolStats}>
            <span>학업성취도·특목고 진학률: <span className={styles.dataPending}>데이터 준비 중</span></span>
          </div>
        </div>
      );
    } else if (activeTab === '초등') {
      return (
        <div className={styles.schoolInfo}>
          <h4>{item.name}</h4>
          <div className={styles.schoolStats}>
            <span>학급당 인원·통학 정보: <span className={styles.dataPending}>데이터 준비 중</span></span>
          </div>
        </div>
      );
    } else {
      return (
        <div className={styles.schoolInfo}>
          <h4>{item.name}</h4>
          <div className={styles.schoolStats}>
            <span>유형: {item.schoolType || '정보 없음'}</span>
            <span>4년제 진학률: <span className={styles.dataPending}>데이터 준비 중</span></span>
          </div>
        </div>
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
              <span>📍 {regionLabel}</span>
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
                <h3>{regionLabel} {activeTab === '전체' || activeTab === '학원가' ? '학교' : activeTab + '학교'} 수</h3>
                <p>
                  {activeTab === '전체' || activeTab === '학원가'
                    ? `총 ${stats.totalSchools}개교 (초${stats.elemCount}/중${stats.midCount}/고${stats.highCount}/기타${stats.otherCount})`
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
                <p>
                  {stats.specRate
                    ? stats.specRate
                    : <span className={styles.dataPending} style={{ fontSize: '1rem' }}>데이터 준비 중</span>}
                </p>
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
            <h2 className={styles.panelTitle}>🏫 {regionLabel} {activeTab} 학교 목록</h2>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              가나다순
            </span>
          </div>

          {/* §3 — 불러오는 동안에는 목록 자리를 비워 둔다. 예전에는 로딩 여부와 무관하게
              `schools`를 그렸기 때문에 이전 지역 목록이 새 제목 아래 남아 있었다. */}
          {loading && (
            <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>
              불러오는 중입니다...
            </div>
          )}

          {!loading && schools.length === 0 && (
            <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>
              {hasDistrict
                ? `${regionLabel}에서 조회된 학교가 없습니다.`
                : '구·군을 선택하면 그 지역 학교 목록을 볼 수 있어요.'}
            </div>
          )}

          <ul className={styles.schoolList}>
            {!loading && schools.map((item) => (
              <li
                key={item.id}
                className={styles.schoolItem}
                onClick={() => goToSchoolDetail(item)}
              >
                <div className={styles.rankBadge}>{item.rank}</div>
                {renderSchoolItem(item)}
              </li>
            ))}
          </ul>
        </div>

      </div>

      <RegionSelectModal />
    </div>
  );
}
