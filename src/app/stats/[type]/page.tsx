import type { Metadata } from 'next';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { siteConfig, buildOpenGraph } from '@/config/site';
import { getStatsMenuItem } from '../statsMenu';
import StatsTypeClient from './type-client';

type Props = {
  params: Promise<{ type: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { type } = await params;
  const item = getStatsMenuItem(type);
  const title = item ? `${item.icon} ${item.title} - ${siteConfig.name}` : `시장 통계 - ${siteConfig.name}`;
  const description = item ? item.subtitle : '시장 통계·분석';
  // REGIONAL_SEO_KEYWORD_LANDING_V1 §13 — 지역 쿼리(공유 복원용)를 뺀 깨끗한 경로가 canonical이다.
  const path = item ? `/stats/${encodeURIComponent(type)}` : null;
  return {
    title,
    description,
    ...(path ? { alternates: { canonical: path } } : {}),
    // §14 — 준비 중 메뉴는 데이터 없이 안내만 있다. 색인하지 않는다.
    ...(item?.status === 'soon' ? { robots: { index: false, follow: true } } : {}),
    openGraph: buildOpenGraph({ title, description, path }),
  };
}

export default async function StatsTypePage({ params }: Props) {
  const { type } = await params;
  const item = getStatsMenuItem(type);
  if (!item) notFound();
  // GLOBAL SHARE SYSTEM V1 — 공유 링크로 들어온 지역 쿼리스트링(?sido=&sigungu=...)을
  // type-client.tsx가 useSearchParams()로 읽어 복원한다. Next.js는 useSearchParams()를
  // 쓰는 컴포넌트를 Suspense 경계 없이 정적 렌더하면 페이지 전체가 CSR로 강제 전환되니,
  // ai-search 페이지와 동일한 패턴으로 여기서 감싼다(§6/§27).
  return (
    <Suspense fallback={null}>
      <StatsTypeClient slug={type} />
    </Suspense>
  );
}
