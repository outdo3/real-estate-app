import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph, buildTwitter } from '@/config/site';
import RegionReportSheet from '@/components/report/RegionReportSheet';
import InvalidScope from '@/components/report/InvalidScope';
import JsonLd from '@/components/seo/JsonLd';
import { readRegionReport } from '@/lib/report/region-read';
import { isBusanCurrentLawdCd, normalizeDong } from '@/lib/report/region-scope';
import { parsePeriodParam, resolvePeriod } from '@/lib/report/report-period';
import { dongReportSeo } from '@/lib/seo/report-region-seo';
import { readDongTrailingYearTrades } from '@/lib/seo/region-seo-read';
import { buildBreadcrumbJsonLd } from '@/lib/seo/site-seo';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ lawdCd: string; dong: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
};

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

// REGIONAL_SEO_KEYWORD_LANDING_V1 §8 — 동 이름은 최근 1년 실거래에서 확인될 때만 제목에 쓰고,
// 표본(10건 이상)이 있을 때만 색인한다. 확인 못 한 동은 일반 제목 + noindex.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lawdCd, dong } = await params;
  const dongName = normalizeDong(safeDecode(dong));
  const trades = isBusanCurrentLawdCd(lawdCd) && dongName ? await readDongTrailingYearTrades(lawdCd, dongName) : null;
  const seo = dongReportSeo(lawdCd, dongName ?? '', trades);
  return {
    title: seo.title,
    description: seo.description,
    ...(seo.canonicalPath ? { alternates: { canonical: seo.canonicalPath } } : {}),
    robots: seo.robots,
    openGraph: buildOpenGraph({ title: seo.title, description: seo.description, path: seo.canonicalPath }),
    twitter: buildTwitter({ title: seo.title, description: seo.description }),
  };
}

export default async function DongReportPage({ params, searchParams }: Props) {
  const { lawdCd, dong } = await params;
  if (!isBusanCurrentLawdCd(lawdCd)) {
    return <InvalidScope reason={`요청하신 지역코드 ${lawdCd} 는 부산광역시 자치구·군이 아닙니다.`} />;
  }
  const dongName = normalizeDong(decodeURIComponent(dong));
  if (!dongName) {
    return <InvalidScope reason="동 이름이 비어 있어 리포트를 만들 수 없습니다." />;
  }
  const sp = await searchParams;
  const period = resolvePeriod(parsePeriodParam(sp?.period));
  const [envelope, trades] = await Promise.all([
    readRegionReport({
      level: 'DONG',
      lawdCd,
      dong: dongName,
      start: period.start,
      end: period.end,
      periodLabel: period.label,
    }),
    readDongTrailingYearTrades(lawdCd, dongName),
  ]);
  const seo = dongReportSeo(lawdCd, dongName, trades);
  return (
    <>
      <JsonLd data={buildBreadcrumbJsonLd(siteConfig.url, seo.breadcrumbs)} />
      {/* 확인되지 않은 동이면 heading/breadcrumbs가 비어 시트는 기존 제목을 그대로 쓴다. */}
      <RegionReportSheet envelope={envelope} heading={seo.heading} breadcrumbs={seo.breadcrumbs} />
    </>
  );
}
