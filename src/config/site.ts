import type { Metadata } from 'next';

// 프로덕션(main) 배포의 고정 도메인. VERCEL_URL은 배포마다 바뀌는 임시 호스트명이라
// og:image 등 절대경로 메타태그에 쓰면 카카오톡 공유 등에서 매번 다른(혹은 아직 크롤러가
// 접근 이력이 없는) 도메인으로 나갈 수 있어, 프로덕션에서는 이 고정 도메인을 우선한다.
const CANONICAL_PRODUCTION_URL = 'https://real-estate-app-park11.vercel.app';

const getBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_ENV === 'production') return CANONICAL_PRODUCTION_URL;
  if (process.env.NEXT_PUBLIC_VERCEL_URL) return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
};

export const siteConfig = {
  name: '이집 - 부산 실거래가 지도',
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
        url: absoluteUrl('/og-image.png'),
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  };
}
