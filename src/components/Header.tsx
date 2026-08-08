'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import styles from './Header.module.css';

interface HeaderProps {
  searchSlot?: React.ReactNode;
  /** 현재 페이지를 나타내는 타이틀(예: "시장 통계·분석"). searchSlot이 없을 때
   *  로고 우측 중앙 영역에 균형감 있게 표시된다. */
  pageTitle?: string;
  /** 페이지가 자체적인 모바일 하단 탭바를 이미 그리는 경우(예: 홈 화면), Header의 기본
   *  모바일 하단 탭바와 중복 표시되는 것을 막기 위해 true로 전달한다. */
  hideMobileNav?: boolean;
}

const Header = ({ searchSlot, pageTitle, hideMobileNav }: HeaderProps) => {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className={styles.header}>
      <div className={`container ${styles.nav}`}>
        <div className={styles.leftCluster}>
          <button
            onClick={() => router.back()}
            className={styles.backBtn}
            aria-label="이전 화면으로 돌아가기"
          >
            ←
          </button>

          <Link href="/" className={styles.logo}>
            <span className={styles.logoText}>아파트써처</span>
          </Link>
        </div>

        {searchSlot && <div className={styles.searchSlot}>{searchSlot}</div>}
        {!searchSlot && pageTitle && <h1 className={styles.pageTitle}>{pageTitle}</h1>}

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
