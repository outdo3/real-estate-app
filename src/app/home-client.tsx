'use client';

import React, { useState } from 'react';
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
        <div className={styles.logo}>이집</div>
        <h1 className={styles.headline}>니가 원하는게 뭐야?</h1>

        <form
          className={styles.searchBar}
          onSubmit={(e) => {
            e.preventDefault();
            goSearch(query);
          }}
        >
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="예: 부산 서구 5억 이하 신축 아파트"
          />
          <button type="submit" className={styles.searchBtn}>
            🪄 AI 검색
          </button>
        </form>

        <div className={styles.suggestions}>
          <span className={styles.suggestLabel}>💡 이렇게 물어보세요:</span>
          <div className={styles.chipRow}>
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
      </main>
    </div>
  );
}
