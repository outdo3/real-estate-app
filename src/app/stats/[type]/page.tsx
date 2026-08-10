import type { Metadata } from 'next';
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
  return { title, description, openGraph: buildOpenGraph({ title, description }) };
}

export default async function StatsTypePage({ params }: Props) {
  const { type } = await params;
  const item = getStatsMenuItem(type);
  if (!item) notFound();
  return <StatsTypeClient slug={type} />;
}
