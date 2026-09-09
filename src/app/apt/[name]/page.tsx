import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import KakaoPreconnect from '@/components/KakaoPreconnect';
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
  return (
    <>
      {/* PERCEIVED_PERFORMANCE_V2 §4 — 주거환경/교통 카드가 Kakao SDK와 Local API를
          쓰므로 연결을 미리 열어둔다. 지도 타일(mts.daumcdn.net)은 지도 모달을 열기
          전까지 필요 없어 여기서는 열지 않는다. */}
      <KakaoPreconnect />
      <ApartmentDetailClient />
    </>
  );
}
