import React from 'react';
import Link from 'next/link';
import styles from '@/app/apt/[name]/detail.module.css';

interface StickyPriceBarProps {
  aptName: string;
  latestPrice: string;
}

// 모바일 스크롤 중에도 노출되는 하단 고정 바. detail.module.css의 .stickyBar가
// 데스크톱에서는 숨기고 768px 이하에서만 fixed로 보이도록 미디어쿼리를 갖고 있다.
export default function StickyPriceBar({ aptName, latestPrice }: StickyPriceBarProps) {
  return (
    <div className={styles.stickyBar}>
      <div className={styles.stickyBarPrice}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>최근 실거래가</span>
        <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--primary-color)' }}>{latestPrice}</span>
      </div>
      <Link href={`/community/write?aptName=${encodeURIComponent(aptName)}`} className={styles.stickyBarWriteBtn}>
        ✏️ 글쓰기
      </Link>
    </div>
  );
}
