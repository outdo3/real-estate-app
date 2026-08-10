import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import HomeClient from './home-client';

export const metadata: Metadata = {
  title: `${siteConfig.name} - AI 부동산 검색`,
  description: siteConfig.description,
  openGraph: buildOpenGraph({
    title: `${siteConfig.name} - AI 부동산 검색`,
    description: siteConfig.description,
  }),
};

export default function Home() {
  return <HomeClient />;
}
