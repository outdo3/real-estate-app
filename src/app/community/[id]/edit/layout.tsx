import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';

// REGIONAL_SEO_KEYWORD_LANDING_V1 §14 — 글 수정 화면은 색인하지 않는다.
// 부모(/community) canonical을 물려받지 않게 비운다.
export const metadata: Metadata = {
  title: `글 수정 - ${siteConfig.name} 커뮤니티`,
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function CommunityEditLayout({ children }: { children: React.ReactNode }) {
  return children;
}
