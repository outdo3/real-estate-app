'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Header.module.css';

interface HeaderProps {
  searchSlot?: React.ReactNode;
  /** 페이지가 자체적인 모바일 하단 탭바를 이미 그리는 경우(예: 홈 화면), Header의 기본
   *  모바일 하단 탭바와 중복 표시되는 것을 막기 위해 true로 전달한다. */
  hideMobileNav?: boolean;
}

const Header = ({ searchSlot, hideMobileNav }: HeaderProps) => {
  const pathname = usePathname();

  return (
    <header className={styles.header}>
      <div className={`container ${styles.nav}`}>
        <Link href="/" className={styles.logo}>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.5px', color: 'var(--primary-color)' }}>아파트써처</span>
        </Link>

        {searchSlot && <div className={styles.searchSlot}>{searchSlot}</div>}

        <ul className={`${styles.menuList} ${hideMobileNav ? styles.menuListHideMobile : ''}`}>
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
