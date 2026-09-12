'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Map as MapIcon, Sparkles, BarChart3, Building2, TrendingDown, Award, TrendingUp, Activity, Scale, Coins, Rows3, ChevronDown, ChevronUp } from 'lucide-react';
import Header from '@/components/Header';
import AdContainer from '@/components/AdContainer';
import HomeApartmentSearch from '@/components/HomeApartmentSearch';
import Button from '@/components/ui/Button';
import { useRecentApartments } from '@/hooks/useRecentApartments';
import {
  RECENT_ROWS_COLLAPSED,
  canCollapseRecent,
  canExpandRecent,
  visibleRecentItems,
} from '@/lib/my/recent-rows';
import styles from './home-client.module.css';

const QUICK_MENU = [
  // STATISTICS V2 — REGIONAL TRANSACTION FEED §42/§43: 신규 핵심 기능이라
  // quick menu 맨 앞에 추가한다(Home 대개편 아님, 기존 항목/순서는 그대로 유지).
  { Icon: Rows3, label: '실거래', href: '/stats/feed' },
  { Icon: TrendingDown, label: '하락', href: '/stats/decline' },
  { Icon: Award, label: '2년최고가', href: '/stats/record-high' },
  { Icon: TrendingUp, label: '상승', href: '/stats/rising' },
  { Icon: Activity, label: '거래량', href: '/stats/volume' },
  { Icon: Scale, label: '단지비교', href: '/stats/compare' },
  { Icon: Coins, label: '갭투자', href: '/stats/gap-invest' },
];

export default function Home() {
  // RECENT_VIEWED_AUTH_PARITY_V1 §4 — 출처를 세션에 따라 가른다.
  //
  // 예전에는 세션과 무관하게 localStorage만 읽었다. 그래서 로그인해도 홈은 계정
  // 기록이 아니라 로컬 기록을 보여줬고, 로그아웃한 뒤에도 그대로 남았다.
  const { items: recentAll, loading: recentLoading, error: recentError } = useRecentApartments();

  // §9 — 기본 5개, 초과분은 요청할 때 펼친다. 개수 규칙은 MY의 최근 목록과 같은
  // 모듈을 쓴다(기본 5 + 전부 펼치기) — 두 화면이 같은 의미를 갖도록.
  const [recentExpanded, setRecentExpanded] = useState(false);
  const recent = visibleRecentItems(recentAll, recentExpanded);

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <section className={styles.heroSection}>
          <img src="/brand/mascot/ejipy-default.webp" alt="" className={styles.heroMascot} />
          <p className={styles.tagline}>복잡한 부동산, 이집으로 쉽게</p>

          <HomeApartmentSearch />

          <div className={styles.quickActionsRow}>
            <Button href="/map" variant="secondary" className={styles.quickActionBtn} icon={<MapIcon width={18} height={18} strokeWidth={2} />}>
              지도에서 찾기
            </Button>
            <Button href="/ai-search" variant="secondary" className={styles.quickActionBtn} icon={<Sparkles width={18} height={18} strokeWidth={2} />}>
              조건으로 집 찾기
            </Button>
          </div>
        </section>

        <section className={styles.recentSection}>
          <div className={styles.recentHeading}>최근 본 단지</div>
          {/* §4 — 세션 확인 전에는 잘못된 목록을 먼저 보여주지 않는다. */}
          {recentLoading ? (
            <div className={styles.recentEmpty} role="status">
              <span>최근 본 단지를 불러오는 중입니다...</span>
            </div>
          ) : recentError ? (
            /* §11 — 계정 목록을 못 불러왔을 때 로컬 기록으로 대체하지 않는다.
               남의 목록을 내 기록인 척 보여주는 것보다 비어 있는 편이 낫다. */
            <div className={styles.recentEmpty} role="alert">
              <span>최근 본 단지를 불러오지 못했어요.</span>
            </div>
          ) : recent.length > 0 ? (
            <>
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
              {/* §9 — 5개를 넘을 때만 펼칠 수 있다. 로그인/비로그인 동일 UX. */}
              {(canExpandRecent(recentAll.length) || canCollapseRecent(recentAll.length, recentExpanded)) && (
                <button
                  type="button"
                  className={styles.recentToggle}
                  onClick={() => setRecentExpanded((v) => !v)}
                  aria-expanded={recentExpanded}
                  aria-label={recentExpanded ? '최근 본 단지 접기' : '최근 본 단지 더보기'}
                >
                  {recentExpanded ? (
                    <>
                      접기
                      <ChevronUp size={14} aria-hidden="true" />
                    </>
                  ) : (
                    <>
                      더보기 ({recentAll.length - RECENT_ROWS_COLLAPSED})
                      <ChevronDown size={14} aria-hidden="true" />
                    </>
                  )}
                </button>
              )}
            </>
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
              <span className={styles.bigCardSubtitle}>2년최고가·거래량·갭투자</span>
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
