import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { siteConfig, buildOpenGraph } from '@/config/site';
import PresaleDetailClient from './presale-detail-client';

type Props = {
  params: Promise<{ id: string }>;
};

function formatManwon(v: number): string {
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  if (eok === 0) return `${man.toLocaleString()}만원`;
  if (man === 0) return `${eok}억`;
  return `${eok}억 ${man.toLocaleString()}만원`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const presaleId = Number(id);

  let presale: {
    houseName: string;
    subscriptionAreaName: string | null;
    minPrice: number | null;
    maxPrice: number | null;
    receiptStartDate: Date | null;
    receiptEndDate: Date | null;
  } | null = null;

  if (Number.isInteger(presaleId)) {
    try {
      presale = await prisma.presale.findUnique({
        where: { id: presaleId },
        select: {
          houseName: true,
          subscriptionAreaName: true,
          minPrice: true,
          maxPrice: true,
          receiptStartDate: true,
          receiptEndDate: true,
        },
      });
    } catch (e) {
      console.error('[presales/[id]] generateMetadata Prisma 조회 실패', e);
    }
  }

  if (!presale) {
    return {
      title: `분양정보를 찾을 수 없습니다 - ${siteConfig.name}`,
      description: '요청하신 분양정보를 찾을 수 없습니다.',
    };
  }

  const priceText =
    presale.minPrice != null && presale.maxPrice != null
      ? presale.minPrice === presale.maxPrice
        ? formatManwon(presale.minPrice)
        : `${formatManwon(presale.minPrice)} ~ ${formatManwon(presale.maxPrice)}`
      : '가격 미공개';

  const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
  const scheduleText =
    presale.receiptStartDate && presale.receiptEndDate
      ? `청약 접수 ${fmtDate(presale.receiptStartDate)}~${fmtDate(presale.receiptEndDate)}.`
      : '';

  const title = `${presale.houseName} 분양가·청약일정·주택형 | ${siteConfig.name}`;
  const description =
    `${presale.houseName}(${presale.subscriptionAreaName || '지역 정보 없음'}) 분양가 ${priceText}. ${scheduleText} 주택형별 상세 정보를 확인하세요.`.trim();

  return {
    title,
    description,
    openGraph: buildOpenGraph({ title, description }),
  };
}

export default function PresaleDetailPage() {
  return <PresaleDetailClient />;
}
