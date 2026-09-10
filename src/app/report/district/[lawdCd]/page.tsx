import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import RegionReportSheet from '@/components/report/RegionReportSheet';
import InvalidScope from '@/components/report/InvalidScope';
import { readRegionReport } from '@/lib/report/region-read';
import { districtName, isBusanCurrentLawdCd } from '@/lib/report/region-scope';
import { parsePeriodParam, resolvePeriod } from '@/lib/report/report-period';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ lawdCd: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lawdCd } = await params;
  const name = districtName(lawdCd);
  const title = name
    ? `부산 ${name} 부동산 한장 브리핑 - ${siteConfig.name}`
    : `지역 리포트 - ${siteConfig.name}`;
  const description = name
    ? `부산 ${name} 아파트 실거래 거래량·중앙 거래가·동별 분포를 한 장으로 확인하세요.`
    : '이집 지역 리포트';
  return { title, description, openGraph: buildOpenGraph({ title, description }) };
}

export default async function DistrictReportPage({ params, searchParams }: Props) {
  const { lawdCd } = await params;
  // §1 — 스코프 검증은 REPORT-1 helper로만 한다(여기서 규칙을 다시 만들지 않는다).
  if (!isBusanCurrentLawdCd(lawdCd)) {
    return <InvalidScope reason={`요청하신 지역코드 ${lawdCd} 는 부산광역시 자치구·군이 아닙니다.`} />;
  }
  const sp = await searchParams;
  const period = resolvePeriod(parsePeriodParam(sp?.period));
  const envelope = await readRegionReport({
    level: 'DISTRICT',
    lawdCd,
    start: period.start,
    end: period.end,
    periodLabel: period.label,
  });
  return <RegionReportSheet envelope={envelope} />;
}
