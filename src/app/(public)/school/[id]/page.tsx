import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import { prisma } from '@/lib/prisma';
import SchoolDetailClient from './school-detail-client';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ name?: string }>;
};

// SCHOOLINFO / SCHOOL V2.1 — canonical 링크(/school/{neisSchoolCode})는 더 이상 name을
// 쿼리로 넘기지 않으므로, 메타데이터용 학교명은 School 테이블에서 먼저 조회하고
// (없으면) 기존 Kakao 링크의 name 쿼리로 폴백한다.
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const { name: queryName } = await searchParams;

  let name = queryName || '';
  try {
    const school = await prisma.school.findUnique({ where: { neisSchoolCode: id }, select: { schoolName: true } });
    if (school?.schoolName) name = school.schoolName;
  } catch {
    // DB 조회 실패는 메타데이터 폴백으로 충분 — 페이지 렌더 자체를 막지 않는다.
  }

  const title = `${name || '학교 정보'} - ${siteConfig.name}`;
  const description = name ? `${name}와 관련된 아파트, 거리, 가격 비교를 확인하세요.` : '학교 정보를 확인하세요.';
  return {
    title,
    description,
    openGraph: buildOpenGraph({ title, description }),
  };
}

export default function SchoolDetailPage() {
  return <SchoolDetailClient />;
}
