import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';
import SchoolInfoPageClient from './school-client';

type Props = {
  searchParams: Promise<{ sido?: string; sigungu?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { sido, sigungu } = await searchParams;
  const regionLabel = sido && sigungu ? `${sido} ${sigungu}` : '전국';
  const title = `${regionLabel} 학군정보 - ${siteConfig.name}`;
  const description = `${regionLabel}의 초·중·고 학교 정보, 특목고 진학률, 학원가 위치를 확인하세요.`;
  return {
    title,
    description,
    openGraph: { title, description },
  };
}

export default function SchoolInfoPage() {
  return <SchoolInfoPageClient />;
}
