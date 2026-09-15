import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import { aptDetailHref } from '@/lib/report/report-links';
import KakaoPreconnect from '@/components/KakaoPreconnect';
import ApartmentDetailClient from './apt-client';

type Props = {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

const first = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { name } = await params;
  const sp = await searchParams;
  const aptName = decodeURIComponent(name);
  const title = `${aptName} 실거래가·시세 - ${siteConfig.name}`;
  const description = `${aptName}의 실거래가, 시세 변동 추이, 평형별 거래 내역을 확인하세요.`;

  // REGIONAL_SEO_KEYWORD_LANDING_V1 §13/§14 — canonical은 **식별이 완전한 주소**(lawdCd+dong+aptSeq)일 때만
  // 싣는다. 경로는 리포트·검색·지도와 같은 단일 정의(aptDetailHref)로 정규화한다 — 평형/탭 같은 부가
  // 쿼리는 빠진다. 이름만 있는 주소는 식별이 불완전하므로 canonical을 지어내지 않는다(기존 동작 그대로).
  const canonical = aptDetailHref({ name: aptName, aptSeq: first(sp.aptSeq), lawdCd: first(sp.lawdCd), dong: first(sp.dong) });

  return {
    title,
    description,
    ...(canonical ? { alternates: { canonical } } : {}),
    openGraph: buildOpenGraph({ title, description, path: canonical }),
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
