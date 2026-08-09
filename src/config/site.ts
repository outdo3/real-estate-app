import type { Metadata } from 'next';

const getBaseUrl = () => {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
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
    siteName: siteConfig.name,
    locale: 'ko_KR',
    type: og.type || 'website',
  };
}
