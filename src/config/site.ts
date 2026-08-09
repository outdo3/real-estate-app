import type { Metadata } from 'next';

export const siteConfig = {
  name: process.env.NEXT_PUBLIC_SITE_NAME || '아파트써처',
  url: (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  description: '전국 아파트 실거래가, 시세 변동 추이, 시장 분석, 학군 정보를 한눈에 확인하세요.',
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
