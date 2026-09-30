import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import PresalesClient from './presales-client';

export const metadata: Metadata = {
  title: `분양정보 - ${siteConfig.name}`,
  description: '전국 아파트 분양 청약 정보를 지역·상태·분양가로 찾아보세요. 최근 3년 분양가 아카이브를 확인할 수 있습니다.',
  openGraph: buildOpenGraph({
    title: `분양정보 - ${siteConfig.name}`,
    description: '전국 아파트 분양 청약 정보를 지역·상태·분양가로 찾아보세요. 최근 3년 분양가 아카이브를 확인할 수 있습니다.',
  }),
};

export default function PresalesPage() {
  return <PresalesClient />;
}
