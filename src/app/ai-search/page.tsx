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
