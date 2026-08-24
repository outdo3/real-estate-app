import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import { REGION_DATA } from '@/lib/regions';
import SchoolInfoPageClient from './school-client';

type Props = {
  searchParams: Promise<{ sido?: string; sigungu?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { sido, sigungu } = await searchParams;
  const isValidRegion =
    !!sido && !!sigungu && Object.prototype.hasOwnProperty.call(REGION_DATA, sido) && REGION_DATA[sido].includes(sigungu);
  const regionLabel = isValidRegion ? `${sido} ${sigungu}` : '전국';
  const title = `${regionLabel} 학군정보 - ${siteConfig.name}`;
  const description = `${regionLabel}의 초·중·고 학교 정보와 위치를 확인하세요.`;
  return {
    title,
    description,
    openGraph: buildOpenGraph({ title, description }),
  };
}

export default function SchoolInfoPage() {
  return <SchoolInfoPageClient />;
}
