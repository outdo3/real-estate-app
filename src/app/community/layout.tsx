import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';

// REGIONAL_SEO_KEYWORD_LANDING_V1 §17 — 목록 페이지가 'use client'라 자기 제목이 없어 홈과 같은
// 제목이 나갔다. 목록 전용 제목과 self canonical을 싣는다.
// 하위 화면은 자기 값을 쓴다: 글 상세는 generateMetadata가 title/canonical을 덮고,
// 글쓰기·수정은 각 레이아웃이 noindex + canonical 제거로 덮는다.
const title = `커뮤니티 - ${siteConfig.name}`;
const description = '이집 커뮤니티에서 우리 동네와 아파트 단지 이야기를 나눠보세요.';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/community' },
  openGraph: buildOpenGraph({ title, description, path: '/community' }),
};

export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
