import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import { REGION_DATA } from '@/lib/regions';
import StatsPageClient from './stats-client';

type Props = {
  searchParams: Promise<{ sido?: string; sigungu?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { sido, sigungu } = await searchParams;
  const isValidRegion =
    !!sido && !!sigungu && Object.prototype.hasOwnProperty.call(REGION_DATA, sido) && REGION_DATA[sido].includes(sigungu);
  // REGIONAL_SEO_KEYWORD_LANDING_V1 §13 — 지역 없는 기본 제목에 "전국"을 쓰지 않는다(데이터는 부산 우선).
  const regionLabel = isValidRegion ? `${sido} ${sigungu} ` : '';
  const title = `${regionLabel}아파트 시장 통계·분석 - ${siteConfig.name}`;
  const description = `${regionLabel}아파트 거래량, 갭투자, 단지 랭킹, 입주물량·전세가율 등 시장 통계를 확인하세요.`;
  return {
    title,
    description,
    // §13 — ?sido=&sigungu=는 공유 링크의 지역 복원용 상태다. 서버 HTML은 쿼리와 무관하게 같으므로
    // canonical은 깨끗한 /stats 하나다(지역 검색 랜딩은 /report/district/*가 맡는다).
    alternates: { canonical: '/stats' },
    openGraph: buildOpenGraph({ title, description, path: '/stats' }),
  };
}

export default function StatsPage() {
  return <StatsPageClient />;
}
