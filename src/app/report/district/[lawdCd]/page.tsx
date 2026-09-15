import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph, buildTwitter } from '@/config/site';
import RegionReportSheet from '@/components/report/RegionReportSheet';
import InvalidScope from '@/components/report/InvalidScope';
import JsonLd from '@/components/seo/JsonLd';
import { readRegionReport } from '@/lib/report/region-read';
import { isBusanCurrentLawdCd } from '@/lib/report/region-scope';
import { parsePeriodParam, resolvePeriod } from '@/lib/report/report-period';
import { districtReportSeo, dongNavLinks } from '@/lib/seo/report-region-seo';
import { readBusanDongTradeCounts } from '@/lib/seo/region-seo-read';
import { buildBreadcrumbJsonLd } from '@/lib/seo/site-seo';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ lawdCd: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
};

// REGIONAL_SEO_KEYWORD_LANDING_V1 §6/§13/§14 — 검증된 16개 lawdCd만 지역 제목·색인을 받는다.
// 모르는 코드는 일반 제목 + noindex(지역 이름을 지어내지 않는다).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lawdCd } = await params;
  const seo = districtReportSeo(lawdCd);
  return {
    title: seo.title,
    description: seo.description,
    ...(seo.canonicalPath ? { alternates: { canonical: seo.canonicalPath } } : {}),
    robots: seo.robots,
    openGraph: buildOpenGraph({ title: seo.title, description: seo.description, path: seo.canonicalPath }),
    twitter: buildTwitter({ title: seo.title, description: seo.description }),
  };
}

export default async function DistrictReportPage({ params, searchParams }: Props) {
  const { lawdCd } = await params;
  // §1 — 스코프 검증은 REPORT-1 helper로만 한다(여기서 규칙을 다시 만들지 않는다).
  if (!isBusanCurrentLawdCd(lawdCd)) {
    return <InvalidScope reason={`요청하신 지역코드 ${lawdCd} 는 부산광역시 자치구·군이 아닙니다.`} />;
  }
  const sp = await searchParams;
  const period = resolvePeriod(parsePeriodParam(sp?.period));
  const [envelope, dongCounts] = await Promise.all([
    readRegionReport({
      level: 'DISTRICT',
      lawdCd,
      start: period.start,
      end: period.end,
      periodLabel: period.label,
    }),
    // 동 링크 목록은 보조 내비게이션이다 — 조회가 실패하면 목록만 빠진다(리포트는 그대로).
    readBusanDongTradeCounts(),
  ]);
  const seo = districtReportSeo(lawdCd);
  const links = dongCounts ? dongNavLinks(lawdCd, dongCounts) : [];
  return (
    <>
      <JsonLd data={buildBreadcrumbJsonLd(siteConfig.url, seo.breadcrumbs)} />
      <RegionReportSheet
        envelope={envelope}
        heading={seo.heading}
        breadcrumbs={seo.breadcrumbs}
        subRegionNav={links.length > 0 ? { title: '동별 아파트 시세·실거래가', links } : null}
      />
    </>
  );
}
