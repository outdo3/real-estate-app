import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import RedevelopmentClient from './redevelopment-client';

export const metadata: Metadata = {
  title: `재개발·분양 - ${siteConfig.name}`,
  description: '분양·청약 정보와 재개발·재건축 구역 정보를 확인하세요.',
  openGraph: buildOpenGraph({
    title: `재개발·분양 - ${siteConfig.name}`,
    description: '분양·청약 정보와 재개발·재건축 구역 정보를 확인하세요.',
  }),
};

export default function RedevelopmentPage() {
  return <RedevelopmentClient />;
}
