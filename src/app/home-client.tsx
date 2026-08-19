'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Map as MapIcon, Sparkles, BarChart3, Building2, TrendingDown, Award, TrendingUp, Activity, Scale, Coins } from 'lucide-react';
import Header from '@/components/Header';
import AdContainer from '@/components/AdContainer';
import HomeApartmentSearch from '@/components/HomeApartmentSearch';
import { getRecentApartments, RecentApartment } from '@/lib/recent-apartments';
import styles from './home-client.module.css';

const QUICK_MENU = [
  { Icon: TrendingDown, label: '최근하락', href: '/stats/decline' },
  { Icon: Award, label: '최고가', href: '/stats/record-high' },
  { Icon: TrendingUp, label: '최고상승', href: '/stats/rising' },
  { Icon: Activity, label: '거래량', href: '/stats/volume' },
  { Icon: Scale, label: '단지비교', href: '/stats/compare' },
  { Icon: Coins, label: '갭투자', href: '/stats/gap-invest' },
];

// 홈에서는 상세페이지(최대 8개 보관)와 달리 첫 화면 공간을 고려해 최근 5개만 노출한다.
const HOME_RECENT_LIMIT = 5;

export default function Home() {
  const [recent, setRecent] = useState<RecentApartment[]>([]);

  // localStorage는 클라이언트에서만 읽는다(SSR 중 접근 없음 — 하이드레이션 불일치 없음).
  useEffect(() => {
    setRecent(getRecentApartments().slice(0, HOME_RECENT_LIMIT));
  }, []);

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <section className={styles.heroSection}>
          <img src="/brand/mascot/ejipy-default.webp" alt="" className={styles.heroMascot} />
          <p className={styles.tagline}>복잡한 부동산, 이집으로 쉽게</p>

          <HomeApartmentSearch />

          <div className={styles.quickActionsRow}>
            <Link href="/map" className={styles.quickActionBtn}>
              <MapIcon width={18} height={18} strokeWidth={2} />
              지도에서 찾기
            </Link>
            <Link href="/ai-search" className={styles.quickActionBtn}>
              <Sparkles width={18} height={18} strokeWidth={2} />
              조건으로 집 찾기
            </Link>
          </div>
        </section>

        <section className={styles.recentSection}>
          <div className={styles.recentHeading}>최근 본 단지</div>
          {recent.length > 0 ? (
            <div className={styles.recentScroll}>
              {recent.map((r) => (
                <Link
                  key={`${r.name}|${r.dong}`}
                  href={`/apt/${encodeURIComponent(r.name)}?lawdCd=${encodeURIComponent(r.lawdCd)}&dong=${encodeURIComponent(r.dong)}`}
                  className={styles.recentCard}
                >
                  <span className={styles.recentCardName}>{r.name}</span>
                  {r.address && <span className={styles.recentCardAddress}>{r.address}</span>}
                </Link>
              ))}
            </div>
          ) : (
            <div className={styles.recentEmpty}>
              <img src="/brand/mascot/ejipy-empty.webp" alt="" className={styles.recentEmptyMascot} />
              <span>아직 본 이집이 없어요. 관심 가는 단지를 둘러보세요.</span>
            </div>
          )}
        </section>

        <AdContainer variant="banner" slot="home-search-bottom" />

        <section className={styles.quickSection}>
          <div className={styles.quickHeading}>시장 둘러보기</div>

          <div className={styles.bigCards}>
            <Link href="/stats" className={styles.bigCard}>
              <BarChart3 className={styles.bigCardIcon} strokeWidth={1.8} />
              <span className={styles.bigCardTitle}>시장통계 (인기)</span>
              <span className={styles.bigCardSubtitle}>최고가·거래량·갭투자</span>
            </Link>
            <Link href="/redevelopment" className={styles.bigCard}>
              <Building2 className={styles.bigCardIcon} strokeWidth={1.8} />
              <span className={styles.bigCardTitle}>재개발·분양</span>
              <span className={styles.bigCardSubtitle}>청약·재건축 정보</span>
            </Link>
          </div>

          <div className={styles.iconGrid}>
            {QUICK_MENU.map((item) => (
              <Link key={item.href} href={item.href} className={styles.iconCell}>
                <item.Icon className={styles.iconCellIcon} strokeWidth={1.8} />
                <span className={styles.iconCellLabel}>{item.label}</span>
              </Link>
            ))}
          </div>
        </section>

        <AdContainer variant="banner" slot="home-quick-menu-bottom" />
      </main>
    </div>
  );
}
