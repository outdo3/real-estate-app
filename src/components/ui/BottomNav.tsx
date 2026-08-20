'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { BOTTOM_NAV_ITEMS } from '@/lib/bottom-nav-items';
import styles from './BottomNav.module.css';

// [DESIGN SYSTEM 3 §9] map/page.tsx가 인라인 스타일로 직접 그리던
// MapBottomNav를 대체하는 공용 컴포넌트. Header.tsx의 모바일 하단탭바와
// 완전히 동일한 5개 메뉴(BOTTOM_NAV_ITEMS)/시각을 공유한다. <a href>가
// 아니라 버튼+router.push를 쓰는 이유는 Header.tsx의 기존 주석과 동일
// (호버만 해도 브라우저가 상태표시줄에 URL을 띄워 탭바와 겹치는 문제).
export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className={styles.nav} aria-label="주요 메뉴">
      {BOTTOM_NAV_ITEMS.map((item) => {
        const active = item.isActive(pathname);
        const Icon = item.Icon;
        return (
          <button
            key={item.href}
            type="button"
            className={[styles.item, active ? styles.active : ''].filter(Boolean).join(' ')}
            onClick={() => router.push(item.href)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className={styles.icon} strokeWidth={2} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
