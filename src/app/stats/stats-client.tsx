'use client';

import React, { useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import RegionSelectModal from '@/components/RegionSelectModal';
import { useRegion, RegionState } from '@/contexts/RegionContext';
import { resolveLawdCdByNames } from '@/lib/region-utils';
import { STATS_MENU } from './statsMenu';
import styles from './page.module.css';

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

export default function StatsPage() {
  const { region, setRegion, openRegionModal } = useRegion();

  return (
    <div className={styles.main}>
      <Suspense fallback={null}>
        <RegionUrlSync setRegion={setRegion} />
      </Suspense>
      <Header pageTitle="시장 통계·분석" />
      <div className="container">
        {/* 상단 지역 선택: 실거래가 탭과 동일한 전역 지역 선택 모달을 공유한다 */}
        <div className={styles.headerTop}>
          <button className={styles.regionTrigger} onClick={openRegionModal}>
            <span>📍 {region.displayRegionName}</span>
            <span className={styles.regionTriggerCaret}>▾</span>
          </button>
        </div>

        {/* 16개 핵심 통계/분석 메뉴 그리드 */}
        <div className={styles.menuGrid}>
          {STATS_MENU.map((item) => (
            <Link key={item.slug} href={`/stats/${item.slug}`} className={styles.menuCard}>
              {item.status === 'soon' && <span className={styles.menuSoonBadge}>준비중</span>}
              <span className={styles.menuIcon}>{item.icon}</span>
              <span className={styles.menuTitle}>{item.title}</span>
              <span className={styles.menuSubtitle}>{item.subtitle}</span>
            </Link>
          ))}
        </div>

        {/* 하단 탭바 개편으로 전용 탭이 사라진 학군정보/부동산 도구는 여기서 계속 진입 가능 */}
        <div className={styles.menuGrid}>
          <Link href="/school" className={styles.menuCard}>
            <span className={styles.menuIcon}>🏫</span>
            <span className={styles.menuTitle}>학군 정보</span>
            <span className={styles.menuSubtitle}>학교·학원가 정보</span>
          </Link>
          <Link href="/tools" className={styles.menuCard}>
            <span className={styles.menuIcon}>🛠️</span>
            <span className={styles.menuTitle}>부동산 도구</span>
            <span className={styles.menuSubtitle}>계산기·체크리스트</span>
          </Link>
        </div>
      </div>

      <RegionSelectModal />
    </div>
  );
}
