import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import { REGION_DATA } from '@/lib/regions';
import StatsPageClient from './stats-client';

type Props = {
  searchParams: Promise<{ sido?: string; sigungu?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { sido, sigungu } = await searchParams;
  const isValidRegion = !!sido && !!sigungu && REGION_DATA[sido]?.includes(sigungu);
  const regionLabel = isValidRegion ? `${sido} ${sigungu}` : '전국';
  const title = `${regionLabel} 시장 통계·분석 - ${siteConfig.name}`;
  const description = `${regionLabel} 아파트 거래량, 갭투자, 단지 랭킹, 입주물량·전세가율 등 시장 통계를 확인하세요.`;
  return {
    title,
    description,
    openGraph: buildOpenGraph({ title, description }),
  };
}

export default function StatsPage() {
  return <StatsPageClient />;
}
