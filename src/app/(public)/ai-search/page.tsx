import type { Metadata } from 'next';
import { Suspense } from 'react';
import { siteConfig, buildOpenGraph } from '@/config/site';
import AiSearchClient from './ai-search-client';

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  const title = q ? `"${q}" AI 검색 결과 - ${siteConfig.name}` : `AI 검색 - ${siteConfig.name}`;
  const description = q ? `${q} - AI가 실거래 데이터를 분석해 답합니다.` : siteConfig.description;
  return {
    title,
    description,
    // REGIONAL_SEO_KEYWORD_LANDING_V1 §14 — 진입점이 닫힌 기능이고 ?q=마다 생기는 검색 결과 화면이다. 색인하지 않는다.
    robots: { index: false, follow: true },
    openGraph: buildOpenGraph({ title, description }),
  };
}

export default function AiSearchPage() {
  return (
    <Suspense fallback={null}>
      <AiSearchClient />
    </Suspense>
  );
}
