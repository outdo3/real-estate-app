import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph, buildTwitter } from '@/config/site';
import JsonLd from '@/components/seo/JsonLd';
import { MAIN_DESCRIPTION, MAIN_TITLE, buildOrganizationJsonLd, buildWebSiteJsonLd } from '@/lib/seo/site-seo';
import HomeClient from './home-client';

// REGIONAL_SEO_KEYWORD_LANDING_V1 §3 — 메인 title/description은 사용자 확정값(site-seo 단일 출처).
export const metadata: Metadata = {
  title: MAIN_TITLE,
  description: MAIN_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: buildOpenGraph({ title: MAIN_TITLE, description: MAIN_DESCRIPTION, path: '/' }),
  // buildTwitter는 card/images까지 함께 싣는다(중첩 필드는 통째로 덮이므로).
  twitter: buildTwitter({ title: MAIN_TITLE, description: MAIN_DESCRIPTION }),
};

export default function Home() {
  return (
    <>
      {/* §2/§16 — 사이트 이름 신호. WebSite/Organization은 홈에만 싣는다. */}
      <JsonLd data={buildWebSiteJsonLd(siteConfig.url)} />
      <JsonLd data={buildOrganizationJsonLd(siteConfig.url)} />
      <HomeClient />
    </>
  );
}
