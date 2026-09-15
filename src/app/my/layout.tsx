import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';

// REGIONAL_SEO_KEYWORD_LANDING_V1 §14 — MY는 사용자별 화면이다. 색인하지 않는다.
// (robots.txt도 /my를 막고 있다. 페이지가 'use client'라 메타데이터는 이 레이아웃이 싣는다.)
export const metadata: Metadata = {
  title: `MY - ${siteConfig.name}`,
  robots: { index: false, follow: false },
};

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
