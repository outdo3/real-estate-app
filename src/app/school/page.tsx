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
  // REGIONAL_SEO_KEYWORD_LANDING_V1 §13 — 지역 없는 기본 제목에 "전국"을 쓰지 않는다.
  const regionLabel = isValidRegion ? `${sido} ${sigungu}` : '';
  const title = regionLabel ? `${regionLabel} 학군정보 - ${siteConfig.name}` : `학군정보 - ${siteConfig.name}`;
  const description = regionLabel
    ? `${regionLabel}의 초·중·고 학교 정보와 위치를 확인하세요.`
    : '초·중·고 학교 정보와 위치를 확인하세요.';
  return {
    title,
    description,
    // §13 — 지역 쿼리는 공유용 상태 복원이다. canonical은 /school 하나.
    alternates: { canonical: '/school' },
    openGraph: buildOpenGraph({ title, description, path: '/school' }),
  };
}

export default function SchoolInfoPage() {
  return <SchoolInfoPageClient />;
}
