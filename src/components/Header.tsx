'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import HeaderAuthButton from './HeaderAuthButton';
import { siteConfig } from '@/config/site';
import { BOTTOM_NAV_ITEMS } from '@/lib/bottom-nav-items';
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

// 하단탭바 항목을 <a href>가 아니라 클릭 핸들러로 이동시킨다 — 실제 href가 있는 앵커는
// 마우스 호버/포커스만 해도 브라우저가 화면 좌하단에 원본 URL을 상태표시줄로 띄우는데,
// 하단탭바 자리가 그 위치와 겹쳐 "탭바 위에 주소가 뜬다"는 문제로 이어졌다(브라우저
// 자체 기능이라 CSS/z-index로는 못 지움 — href 자체를 없애는 것만이 실질적인 방법).
function NavButton({
  href,
  active,
  Icon,
  label,
}: {
  href: string;
  active: boolean;
  Icon: LucideIcon;
  label: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className={active ? styles.active : ''}
      style={{ color: 'inherit', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
    >
      <Icon className={styles.icon} strokeWidth={2} />
      <span>{label}</span>
    </button>
  );
}

const Header = ({ searchSlot, pageTitle, hideMobileNav, hideLogo, pageTitleLarge, pageTitleAlign = 'right' }: HeaderProps) => {
  const pathname = usePathname();
  const router = useRouter();
  // [MAIN UI-B2] 홈은 최상위 화면이라 뒤로가기보다 브랜드 identity가 자연스럽다. 다른
  // 모든 페이지의 뒤로가기 버튼 동작은 그대로 유지한다(홈 경로일 때만 숨김).
  const isHome = pathname === '/';

  return (
    <header className={styles.header}>
      <div className={`container ${styles.nav}`}>
        <div className={styles.leftCluster}>
          {!isHome && (
            <button
              onClick={() => router.back()}
              className={styles.backBtn}
              aria-label="이전 화면으로 돌아가기"
            >
              ←
            </button>
          )}

          {!hideLogo && (
            <Link href="/" className={styles.logo} aria-label={`${siteConfig.name} 홈으로 이동`}>
              <img src="/brand/logo/ejip-logo-horizontal.webp" alt={siteConfig.name} className={styles.logoImg} />
            </Link>
          )}
        </div>

        {searchSlot && <div className={styles.searchSlot}>{searchSlot}</div>}
        {!searchSlot && pageTitle && (
          <h1 className={`${styles.pageTitle} ${pageTitleLarge ? styles.pageTitleLarge : ''} ${pageTitleAlign === 'left' ? styles.pageTitleLeft : ''}`}>{pageTitle}</h1>
        )}

        <ul className={`${styles.menuList} ${hideMobileNav ? styles.menuListHideMobile : ''}`}>
          {BOTTOM_NAV_ITEMS.map((item) => (
            <li key={item.href} className={styles.menuItem}>
              <NavButton href={item.href} active={item.isActive(pathname)} Icon={item.Icon} label={item.label} />
            </li>
          ))}
        </ul>

        <HeaderAuthButton />
      </div>
    </header>
  );
};

export default Header;
