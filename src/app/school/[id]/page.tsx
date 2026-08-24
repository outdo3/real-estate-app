import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import SchoolDetailClient from './school-detail-client';

type Props = {
  searchParams: Promise<{ name?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { name } = await searchParams;
  const title = `${name || '학교 정보'} - ${siteConfig.name}`;
  const description = name ? `${name}의 학군 정보를 확인하세요.` : '학교 학군 정보를 확인하세요.';
  return {
    title,
    description,
    openGraph: buildOpenGraph({ title, description }),
  };
}

export default function SchoolDetailPage() {
  return <SchoolDetailClient />;
}
