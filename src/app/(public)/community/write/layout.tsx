import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';

// REGIONAL_SEO_KEYWORD_LANDING_V1 §14 — 글쓰기는 색인하지 않는다(robots.txt도 막는다).
// 부모(/community) canonical을 물려받지 않게 비운다.
export const metadata: Metadata = {
  title: `글쓰기 - ${siteConfig.name} 커뮤니티`,
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function CommunityWriteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
