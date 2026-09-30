import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';

// REGIONAL_SEO_KEYWORD_LANDING_V1 §14 — 관리자 화면은 색인하지 않는다(robots.txt도 /admin을 막는다).
// 접근 제어는 각 화면의 AuthGate/API가 그대로 맡는다 — 이 레이아웃은 메타데이터만 싣는다.
export const metadata: Metadata = {
  title: `관리자 - ${siteConfig.name}`,
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
