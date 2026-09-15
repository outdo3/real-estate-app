import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph, buildTwitter } from '@/config/site';
import RegionReportSheet from '@/components/report/RegionReportSheet';
import JsonLd from '@/components/seo/JsonLd';
import { readRegionReport } from '@/lib/report/region-read';
import { parsePeriodParam, resolvePeriod } from '@/lib/report/report-period';
import { cityReportSeo, districtNavLinks } from '@/lib/seo/report-region-seo';
import { buildBreadcrumbJsonLd } from '@/lib/seo/site-seo';

// 리포트는 실거래 수집 상태에 따라 달라지므로 정적 캐시하지 않는다.
// (완전성/ dataAsOf를 화면에 그대로 노출하는 계약이라 오래된 캐시는 곧 거짓말이 된다.)
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ period?: string | string[] }> };

// REGIONAL_SEO_KEYWORD_LANDING_V1 §6/§13 — 제목·설명·canonical은 지역 SEO 템플릿 한 곳에서 나온다.
// canonical은 ?period= 없는 깨끗한 경로다(기간 전환은 공유용 쿼리이지 별도 랜딩이 아니다).
export async function generateMetadata(): Promise<Metadata> {
  const seo = cityReportSeo();
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: seo.canonicalPath },
    robots: seo.robots,
    openGraph: buildOpenGraph({ title: seo.title, description: seo.description, path: seo.canonicalPath }),
    twitter: buildTwitter({ title: seo.title, description: seo.description }),
  };
}

export default async function CityReportPage({ searchParams }: Props) {
  const sp = await searchParams;
  const period = resolvePeriod(parsePeriodParam(sp?.period));
  const envelope = await readRegionReport({
    level: 'CITY',
    start: period.start,
    end: period.end,
    periodLabel: period.label,
  });
  const seo = cityReportSeo();
  return (
    <>
      <JsonLd data={buildBreadcrumbJsonLd(siteConfig.url, seo.breadcrumbs)} />
      <RegionReportSheet
        envelope={envelope}
        heading={seo.heading}
        breadcrumbs={seo.breadcrumbs}
        subRegionNav={{ title: '구·군별 아파트 시세·실거래가', links: districtNavLinks() }}
      />
    </>
  );
}
