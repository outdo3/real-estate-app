'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Header.module.css';

interface HeaderProps {
  searchSlot?: React.ReactNode;
}

const Header = ({ searchSlot }: HeaderProps) => {
  const pathname = usePathname();

  return (
    <header className={styles.header}>
      <div className={`container ${styles.nav}`}>
        <Link href="/" className={styles.logo}>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--primary-color)' }}>아파트써처</span>
        </Link>

        {searchSlot && <div className={styles.searchSlot}>{searchSlot}</div>}

        <ul className={styles.menuList}>
          <li className={styles.menuItem}>
            <Link href="/" className={pathname === '/' ? styles.active : ''} style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className={styles.icon}>🏢</span>
              <span>실거래가</span>
            </Link>
          </li>
          <li className={styles.menuItem}>
            <Link href="/stats" className={pathname === '/stats' ? styles.active : ''} style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className={styles.icon}>📊</span>
              <span>시장 통계</span>
            </Link>
          </li>
          <li className={styles.menuItem}>
            <Link href="/school" className={pathname === '/school' ? styles.active : ''} style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className={styles.icon}>🏫</span>
              <span>학군 정보</span>
            </Link>
          </li>
          <li className={styles.menuItem}>
            <Link href="/tools" className={pathname === '/tools' ? styles.active : ''} style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className={styles.icon}>🛠️</span>
              <span>부동산 도구</span>
            </Link>
          </li>
        </ul>
        
      </div>
    </header>
  );
};

export default Header;
