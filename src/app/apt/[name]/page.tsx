import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import ApartmentDetailClient from './apt-client';

type Props = {
  params: Promise<{ name: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  const aptName = decodeURIComponent(name);
  const title = `${aptName} 실거래가·시세 - ${siteConfig.name}`;
  const description = `${aptName}의 실거래가, 시세 변동 추이, 평형별 거래 내역을 확인하세요.`;

  return {
    title,
    description,
    openGraph: buildOpenGraph({ title, description }),
  };
}

export default function ApartmentDetail() {
  return <ApartmentDetailClient />;
}
