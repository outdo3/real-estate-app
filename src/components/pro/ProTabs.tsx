'use client';

// REALTOR_PRO_MVP_V1 — Pro 상단 탭(가로 스크롤). 현재 경로로 활성 탭 표시.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, LayoutDashboard, ListChecks, Building2, Settings, Users } from 'lucide-react';
import styles from './ProShell.module.css';

const TABS = [
  { href: '/pro/dashboard', label: '대시보드', Icon: LayoutDashboard },
  { href: '/pro/listings', label: '매물', Icon: Building2 },
  { href: '/pro/customers', label: '고객', Icon: Users },
  { href: '/pro/matches', label: '매칭', Icon: ListChecks },
  { href: '/pro/briefings', label: '브리핑', Icon: FileText },
  { href: '/pro/settings', label: '설정', Icon: Settings },
] as const;

export default function ProTabs() {
  const pathname = usePathname() ?? '';
  return (
    <nav className={styles.tabs} aria-label="중개사 Pro 메뉴">
      <ul className={styles.tabList}>
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link href={href} className={`${styles.tab} ${active ? styles.tabActive : ''}`} aria-current={active ? 'page' : undefined}>
                <Icon size={16} aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
