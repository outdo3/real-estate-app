import React from 'react';
import Link from 'next/link';
import styles from '@/app/apt/[name]/detail.module.css';

interface StickyPriceBarProps {
  aptName: string;
  latestPrice: string;
  // PRODUCTION QA P0-D — latestPrice is Hero's own heroTrade.priceStr: already
  // scoped to selectedTradeArea correctly (no state-split regression there), but
  // it also follows the top 매매/전월세 toggle and is NOT restricted to pure-jeonse
  // — so in 전월세 mode it can show a 반전세/월세-mixed deposit that looks like it
  // contradicts the chart section's always-pure-jeonse "최근 전세" a few scrolls
  // away. Both numbers are honest, real data; only the unlabeled "최근 실거래가"
  // text left which lens it was made ambiguous. Labeling it by the active type
  // removes that ambiguity without changing any filtering logic.
  tradeTypeFilter: '매매' | '전월세';
}

// 모바일 스크롤 중에도 노출되는 하단 고정 바. detail.module.css의 .stickyBar가
// 데스크톱에서는 숨기고 768px 이하에서만 fixed로 보이도록 미디어쿼리를 갖고 있다.
export default function StickyPriceBar({ aptName, latestPrice, tradeTypeFilter }: StickyPriceBarProps) {
  const label = tradeTypeFilter === '전월세' ? '최근 전월세' : '최근 매매가';
  return (
    <div className={styles.stickyBar}>
      <div className={styles.stickyBarPrice}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--primary-color)' }}>{latestPrice}</span>
      </div>
    </div>
  );
}
