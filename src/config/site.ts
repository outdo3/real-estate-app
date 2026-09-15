import type { Metadata } from 'next';
import { CANONICAL_ORIGIN } from './canonical-host';
import { BRAND_NAME, MAIN_DESCRIPTION } from '../lib/seo/site-seo';

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
  name: BRAND_NAME,
  url: getBaseUrl().replace(/\/$/, ''),
  // REGIONAL_SEO_KEYWORD_LANDING_V1 §3 — 메인 description(사용자 확정값)과 같은 출처.
  description: MAIN_DESCRIPTION,
};

export function absoluteUrl(path: string): string {
  return `${siteConfig.url}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildOpenGraph(og: {
  title: string;
  description: string;
  type?: 'website' | 'article';
  /**
   * REGIONAL_SEO_KEYWORD_LANDING_V1 §13 — 이 페이지의 canonical 경로. 주면 og:url이 그 페이지를
   * 가리킨다. 주지 않으면 예전처럼 사이트 루트다(아직 경로를 넘기지 않는 화면의 동작은 그대로).
   */
  path?: string | null;
}): NonNullable<Metadata['openGraph']> {
  return {
    title: og.title,
    description: og.description,
    url: og.path ? absoluteUrl(og.path) : siteConfig.url,
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

/**
 * REGIONAL_SEO_KEYWORD_LANDING_V1 — 페이지 전용 twitter 카드.
 * 루트 layout의 twitter는 중첩 필드라 페이지가 선언하면 통째로 덮인다. 그래서 페이지 제목을
 * 싣고 싶은 화면은 card/이미지까지 함께 넣은 이 값을 쓴다.
 */
export function buildTwitter(tw: { title: string; description: string }): NonNullable<Metadata['twitter']> {
  return {
    card: 'summary_large_image',
    title: tw.title,
    description: tw.description,
    images: [absoluteUrl('/brand/og/ejip-og-main-1200x630.jpg')],
  };
}
