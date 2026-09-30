import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { siteConfig, buildOpenGraph } from '@/config/site';
import { STAGE_LABELS, BUSINESS_TYPE_LABELS, sidoShortLabel } from '@/lib/redevelopment/labels';
import RedevelopmentDetailClient from './redevelopment-detail-client';

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const projectId = Number(id);

  let project: {
    canonicalName: string;
    sido: string;
    sigungu: string;
    businessType: string;
    stage: string;
    householdCount: number | null;
  } | null = null;

  if (Number.isInteger(projectId)) {
    try {
      project = await prisma.redevelopmentProject.findUnique({
        where: { id: projectId },
        select: { canonicalName: true, sido: true, sigungu: true, businessType: true, stage: true, householdCount: true },
      });
    } catch (e) {
      console.error('[redevelopment/[id]] generateMetadata Prisma 조회 실패', e);
    }
  }

  if (!project) {
    return {
      title: `재개발 정보를 찾을 수 없습니다 - ${siteConfig.name}`,
      description: '요청하신 재개발·재건축 사업 정보를 찾을 수 없습니다.',
    };
  }

  const stageLabel = STAGE_LABELS[project.stage as keyof typeof STAGE_LABELS] ?? project.stage;
  const typeLabel = BUSINESS_TYPE_LABELS[project.businessType as keyof typeof BUSINESS_TYPE_LABELS] ?? project.businessType;
  const householdText = project.householdCount != null ? `${project.householdCount.toLocaleString()}세대` : '세대수 확인 중';

  const title = `${project.canonicalName} ${typeLabel} 진행단계·세대수 | ${siteConfig.name}`;
  const description = `${sidoShortLabel(project.sido)} ${project.sigungu} ${project.canonicalName}(${typeLabel}) 진행단계 ${stageLabel}, ${householdText}. 국토교통부·지자체 데이터를 확인하세요.`;

  return {
    title,
    description,
    openGraph: buildOpenGraph({ title, description }),
  };
}

export default function RedevelopmentDetailPage() {
  return <RedevelopmentDetailClient />;
}
