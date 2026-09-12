'use client';

import React, { useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MapPin, ChevronDown, School, Wrench, FileText } from 'lucide-react';
import Header from '@/components/Header';
import RegionSelectModal from '@/components/RegionSelectModal';
import SectionHeader from '@/components/ui/SectionHeader';
import { useRegion, RegionState } from '@/contexts/RegionContext';
import { resolveLawdCdByNames } from '@/lib/region-utils';
import { STATS_MENU, STATS_CATEGORIES, type StatsColorToken } from './statsMenu';
import styles from './page.module.css';
import { buildRegionDisplayName } from '@/lib/region-display-name';
import { resolveStatsReportEntry } from '@/lib/report/stats-report-entry';

// [STATISTICS_COLOR_SYSTEM_V1] colorToken -> CSS 모듈 클래스 매핑. 지정되지
// 않은 항목(이번 STEP 적용 대상 밖)은 기존과 동일한 브랜드 그린 기본값을 쓴다.
const MENU_ICON_CLASS: Record<StatsColorToken, string> = {
  up: 'menuIconUp',
  down: 'menuIconDown',
  warn: 'menuIconWarn',
  brand: 'menuIconBrand',
  popular: 'menuIconPopular',
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

export default function StatsPage() {
  const { region, setRegion, openRegionModal } = useRegion();
  // STATS_REPORT_ENTRY_V1 — 지금 선택된 지역의 한장 브리핑. 경로 판정은 통계 상세와
  // 같은 함수를 쓴다(부산 전체→city, 구/군→district, 동→dong). 리포트가 없는 지역이면
  // null이고, 그때는 링크를 만들지 않는다 — 다른 지역 리포트로 보내지 않는다.
  const reportEntry = resolveStatsReportEntry(region);

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
            <MapPin size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: '0.3rem' }} />
            <span className={styles.regionTriggerLabel}>{region.displayRegionName}</span>
            <ChevronDown size={14} aria-hidden="true" className={styles.regionTriggerCaret} />
          </button>
          {/* 보조 액션 수준의 진입점 — 지역명은 왼쪽 트리거에 이미 보이므로 짧은 문구를
              쓴다. 통계 상세의 공유 버튼과 같은 자리·같은 축소 규칙이라(.headerTop >
              *:not(.regionTrigger)) 지역명이 길어도 이 버튼이 깎이지 않는다. */}
          {reportEntry && (
            <Link href={reportEntry.href} className={styles.reportCtaInline} aria-label={reportEntry.label}>
              <FileText size={14} strokeWidth={2.2} aria-hidden="true" />
              {reportEntry.shortLabel}
            </Link>
          )}
        </div>

        {/* [STATISTICS V2 §35] 16개 메뉴를 5개 카테고리로 grouping — emoji
            대신 Lucide, 카드 배경색 남발 없이 브랜드 그린 하나로 통일. */}
        {STATS_CATEGORIES.map((category) => (
          <div key={category} className={styles.categorySection}>
            <h2 className={styles.categoryTitle}>{category}</h2>
            <div className={styles.menuGrid}>
              {STATS_MENU.filter((item) => item.category === category).map((item) => (
                <Link key={item.slug} href={`/stats/${item.slug}`} className={styles.menuCard}>
                  {item.status === 'soon' && <span className={styles.menuSoonBadge}>준비중</span>}
                  <span className={[styles.menuIcon, styles[MENU_ICON_CLASS[item.colorToken || 'brand']]].join(' ')}>
                    <item.Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <span className={styles.menuTitle}>{item.title}</span>
                  <span className={styles.menuSubtitle}>{item.subtitle}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* 하단 탭바 개편으로 전용 탭이 사라진 학군정보/부동산 도구는 여기서 계속 진입 가능 */}
        <div className={styles.categorySection}>
          <h2 className={styles.categoryTitle}>기타</h2>
          <div className={styles.menuGrid}>
            <Link href="/school" className={styles.menuCard}>
              <span className={styles.menuIcon}><School size={26} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className={styles.menuTitle}>학군 정보</span>
              <span className={styles.menuSubtitle}>학교·학원가 정보</span>
            </Link>
            <Link href="/tools" className={styles.menuCard}>
              <span className={styles.menuIcon}><Wrench size={26} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className={styles.menuTitle}>부동산 도구</span>
              <span className={styles.menuSubtitle}>계산기·체크리스트</span>
            </Link>
          </div>
        </div>
      </div>

      <RegionSelectModal />
    </div>
  );
}
