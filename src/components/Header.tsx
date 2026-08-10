'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import HeaderAuthButton from './HeaderAuthButton';
import { siteConfig } from '@/config/site';
import styles from './Header.module.css';

interface HeaderProps {
  searchSlot?: React.ReactNode;
  /** 현재 페이지를 나타내는 타이틀(예: "시장 통계·분석"). searchSlot이 없을 때
   *  로고 우측 중앙 영역에 균형감 있게 표시된다. */
  pageTitle?: string;
  /** 페이지가 자체적인 모바일 하단 탭바를 이미 그리는 경우(예: 홈 화면), Header의 기본
   *  모바일 하단 탭바와 중복 표시되는 것을 막기 위해 true로 전달한다. */
  hideMobileNav?: boolean;
  /** 브랜드 로고 텍스트를 숨긴다. 단지 상세페이지처럼 현재 조회 중인 대상(아파트명)을
   *  pageTitle 자리에 대신 크게 보여주고 싶을 때 pageTitleLarge와 함께 사용한다. */
  hideLogo?: boolean;
  /** pageTitle을 더 크고 진하게(단지명처럼 화면의 주인공이 되는 타이틀) 표시한다. */
  pageTitleLarge?: boolean;
  /** pageTitle 정렬. 기본은 'right'(우측 끝 근처). 로고가 있던 좌측 영역에 타이틀을
   *  두고 싶을 때(예: 단지 상세페이지) 'left'로 전달한다. */
  pageTitleAlign?: 'left' | 'right';
}

const Header = ({ searchSlot, pageTitle, hideMobileNav, hideLogo, pageTitleLarge, pageTitleAlign = 'right' }: HeaderProps) => {
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

          {!hideLogo && (
            <Link href="/" className={styles.logo}>
              <span className={styles.logoText}>{siteConfig.name}</span>
            </Link>
          )}
        </div>

        {searchSlot && <div className={styles.searchSlot}>{searchSlot}</div>}
        {!searchSlot && pageTitle && (
          <h1 className={`${styles.pageTitle} ${pageTitleLarge ? styles.pageTitleLarge : ''} ${pageTitleAlign === 'left' ? styles.pageTitleLeft : ''}`}>{pageTitle}</h1>
        )}

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
          <li className={styles.menuItem}>
            <Link href="/community" className={pathname.startsWith('/community') ? styles.active : ''} style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className={styles.icon}>💬</span>
              <span>커뮤니티</span>
            </Link>
          </li>
        </ul>

        <HeaderAuthButton />
      </div>
    </header>
  );
};

export default Header;
