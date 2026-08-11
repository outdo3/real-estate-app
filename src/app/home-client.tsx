'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { useRegion } from '@/contexts/RegionContext';
import styles from './home-client.module.css';

const SUGGESTIONS = [
  { icon: '✨', label: '부산 서구 5억 이하 주차 넉넉한 아파트' },
  { icon: '📊', label: '부산 서구 최근 거래량 보여줘' },
  { icon: '⚖️', label: '대신더샵과 대신롯데캐슬 비교해줘' },
  { icon: '💰', label: '부산 서구 갭투자 인기 단지' },
];

const QUICK_MENU = [
  { icon: '📉', label: '최근하락', href: '/stats/decline' },
  { icon: '🏆', label: '최고가', href: '/stats/record-high' },
  { icon: '📈', label: '최고상승', href: '/stats/rising' },
  { icon: '📊', label: '거래량', href: '/stats/volume' },
  { icon: '⚖️', label: '단지비교', href: '/stats/compare' },
  { icon: '💰', label: '갭투자', href: '/stats/gap-invest' },
];

export default function Home() {
  const router = useRouter();
  const { region } = useRegion();
  const [query, setQuery] = useState('');

  const goSearch = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    router.push(`/ai-search?q=${encodeURIComponent(trimmed)}&lawdCd=${region.lawdCd}`);
  };

  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <section className={styles.aiZone}>
          <h1 className={styles.headline}>니가 찾는 아파트가 뭐야?</h1>

          <form
            className={styles.searchBar}
            onSubmit={(e) => {
              e.preventDefault();
              goSearch(query);
            }}
          >
            <span className={styles.searchIcon}>🔍</span>
            <input
              className={styles.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 부산 서구 5억 이하 신축 아파트"
            />
            <button type="submit" className={styles.searchBtn}>
              ✨ AI 검색
            </button>
          </form>

          <div className={styles.suggestions}>
            <span className={styles.suggestLabel}>💡 추천 프롬프트</span>
            <div className={styles.chipScroll}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className={styles.chip}
                  onClick={() => {
                    setQuery(s.label);
                    goSearch(s.label);
                  }}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.quickSection}>
          <div className={styles.quickHeading}>핵심 Quick 메뉴</div>

          <div className={styles.bigCards}>
            <Link href="/map" className={styles.bigCard}>
              <span className={styles.bigCardIcon}>🗺️</span>
              <span className={styles.bigCardTitle}>지도 검색</span>
              <span className={styles.bigCardSubtitle}>지도에서 아파트 보기</span>
            </Link>
            <Link href="/stats" className={styles.bigCard}>
              <span className={styles.bigCardIcon}>📊</span>
              <span className={styles.bigCardTitle}>시장통계 (인기)</span>
              <span className={styles.bigCardSubtitle}>최고가·거래량·갭투자</span>
            </Link>
          </div>

          <div className={styles.iconGrid}>
            {QUICK_MENU.map((item) => (
              <Link key={item.href} href={item.href} className={styles.iconCell}>
                <span className={styles.iconCellIcon}>{item.icon}</span>
                <span className={styles.iconCellLabel}>{item.label}</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
