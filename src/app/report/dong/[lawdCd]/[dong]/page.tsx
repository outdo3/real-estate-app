import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import RegionReportSheet from '@/components/report/RegionReportSheet';
import InvalidScope from '@/components/report/InvalidScope';
import { readRegionReport } from '@/lib/report/region-read';
import { districtName, isBusanCurrentLawdCd, normalizeDong } from '@/lib/report/region-scope';
import { parsePeriodParam, resolvePeriod } from '@/lib/report/report-period';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ lawdCd: string; dong: string }>;
  searchParams: Promise<{ period?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lawdCd, dong } = await params;
  const name = districtName(lawdCd);
  const dongName = decodeURIComponent(dong);
  const title = name
    ? `부산 ${name} ${dongName} 부동산 한장 브리핑 - ${siteConfig.name}`
    : `지역 리포트 - ${siteConfig.name}`;
  const description = name
    ? `부산 ${name} ${dongName} 아파트 실거래 거래량·중앙 거래가를 한 장으로 확인하세요.`
    : '이집 지역 리포트';
  return { title, description, openGraph: buildOpenGraph({ title, description }) };
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
  const envelope = await readRegionReport({
    level: 'DONG',
    lawdCd,
    dong: dongName,
    start: period.start,
    end: period.end,
    periodLabel: period.label,
  });
  return <RegionReportSheet envelope={envelope} />;
}
