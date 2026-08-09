import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';
import HomeClient from './home-client';

export const metadata: Metadata = {
  title: `${siteConfig.name} - 실거래가 지도`,
  description: siteConfig.description,
  openGraph: {
    title: `${siteConfig.name} - 실거래가 지도`,
    description: siteConfig.description,
  },
};

export default function Home() {
  return <HomeClient />;
}
