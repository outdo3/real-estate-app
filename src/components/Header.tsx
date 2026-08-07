'use client';

import React from 'react';
import Link from 'next/link';
import styles from './Header.module.css';

const Header = () => {
  return (
    <header className={styles.header}>
      <div className={`container ${styles.nav}`}>
        <Link href="/" className={styles.logo}>
          <span style={{ fontSize: '1.75rem', fontWeight: 900, marginRight: '4px', letterSpacing: '-1px' }}>N</span>
          <span>부동산</span>
        </Link>
        
        <ul className={styles.menuList}>
          <li className={styles.menuItem}>
            <Link href="/" style={{ color: 'inherit', textDecoration: 'none' }}>실거래가</Link>
          </li>
          <li className={styles.menuItem}>
            <Link href="/stats" style={{ color: 'inherit', textDecoration: 'none' }}>시장 통계·분석</Link>
          </li>
          <li className={styles.menuItem}>
            <Link href="/school" style={{ color: 'inherit', textDecoration: 'none' }}>학군 정보</Link>
          </li>
          <li className={styles.menuItem}>
            <Link href="#" style={{ color: 'inherit', textDecoration: 'none' }}>부동산 도구</Link>
          </li>
        </ul>
        
      </div>
    </header>
  );
};

export default Header;
