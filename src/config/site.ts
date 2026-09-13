import type { Metadata } from 'next';
import { CANONICAL_ORIGIN } from './canonical-host';

// 프로덕션(main) 배포의 고정 도메인. VERCEL_URL은 배포마다 바뀌는 임시 호스트명이라
// og:image 등 절대경로 메타태그에 쓰면 카카오톡 공유 등에서 매번 다른(혹은 아직 크롤러가
// 접근 이력이 없는) 도메인으로 나갈 수 있어, 프로덕션에서는 이 고정 도메인을 우선한다.
// E-JIP CANONICAL HOST REDIRECT V1 — 예전 폴백은 기본 Vercel 호스트였다. NEXT_PUBLIC_SITE_URL이
// 없던 기간에 공유 링크/OG/sitemap이 그 호스트를 퍼뜨렸고, 그 링크로 들어온 사용자는 로그인이
// 첫 시도에서 실패했다. 환경변수가 빠져도 다시 퍼지지 않게 정규 오리진으로 둔다.
const CANONICAL_PRODUCTION_URL = CANONICAL_ORIGIN;

const getBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_ENV === 'production') return CANONICAL_PRODUCTION_URL;
  if (process.env.NEXT_PUBLIC_VERCEL_URL) return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
};

export const siteConfig = {
  name: '이집',
  url: getBaseUrl().replace(/\/$/, ''),
  description: '언제 어디서나 쉽게 부산 아파트 실거래가와 현장 팁을 확인하세요.',
};

export function absoluteUrl(path: string): string {
  return `${siteConfig.url}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildOpenGraph(og: {
  title: string;
  description: string;
  type?: 'website' | 'article';
}): NonNullable<Metadata['openGraph']> {
  return {
    title: og.title,
    description: og.description,
    url: siteConfig.url,
    siteName: siteConfig.name,
    locale: 'ko_KR',
    type: og.type || 'website',
    images: [
      {
        url: absoluteUrl('/brand/og/ejip-og-main-1200x630.jpg'),
        width: 1200,
        height: 630,
        alt: `${siteConfig.name} - 복잡한 부동산, 이집으로 쉽게`,
      },
    ],
  };
}
