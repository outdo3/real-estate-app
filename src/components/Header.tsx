'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Header.module.css';

const Header = () => {
  const pathname = usePathname();

  return (
    <header className={styles.header}>
      <div className={`container ${styles.nav}`}>
        <Link href="/" className={styles.logo}>
          <span style={{ fontSize: '1.75rem', fontWeight: 900, marginRight: '4px', letterSpacing: '-1px' }}>N</span>
          <span>부동산</span>
        </Link>
        
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
        </ul>
        
      </div>
    </header>
  );
};

export default Header;
