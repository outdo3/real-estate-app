import type { LucideIcon } from 'lucide-react';
import { Home, Map, BarChart3, Building2, User } from 'lucide-react';

// [MAIN UI-B2] Header.tsx의 모바일 하단탭바와 src/app/map/page.tsx의 MapBottomNav는
// 동일한 5개 메뉴를 각자 렌더링한다(지도 페이지는 전체화면 커스텀 UI라 Header 자체를
// 렌더링하지 않기 때문 — Header.tsx 10번 줄 주석 참고). 두 곳이 서로 다른 아이콘/active
// 판정으로 갈라지지 않도록 이 설정 하나를 공유한다.
export interface BottomNavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  isActive: (pathname: string) => boolean;
}

export const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
  { href: '/', label: '홈', Icon: Home, isActive: (p) => p === '/' },
  { href: '/map', label: '지도', Icon: Map, isActive: (p) => p === '/map' },
  { href: '/stats', label: '통계', Icon: BarChart3, isActive: (p) => p.startsWith('/stats') },
  {
    href: '/redevelopment',
    label: '재개발·분양',
    Icon: Building2,
    // 분양 전체보기(/presales, /presales/[id])는 redevelopment-client.tsx의 "분양" 탭에서
    // 이어지는 같은 기능 영역이라 이 탭도 함께 active 처리한다.
    isActive: (p) => p.startsWith('/redevelopment') || p.startsWith('/presales'),
  },
  { href: '/my', label: 'MY', Icon: User, isActive: (p) => p.startsWith('/my') },
];
