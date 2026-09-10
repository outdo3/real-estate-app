import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import RegionReportSheet from '@/components/report/RegionReportSheet';
import { readRegionReport } from '@/lib/report/region-read';
import { parsePeriodParam, resolvePeriod } from '@/lib/report/report-period';

// 리포트는 실거래 수집 상태에 따라 달라지므로 정적 캐시하지 않는다.
// (완전성/ dataAsOf를 화면에 그대로 노출하는 계약이라 오래된 캐시는 곧 거짓말이 된다.)
export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ period?: string | string[] }> };

export async function generateMetadata(): Promise<Metadata> {
  const title = `부산광역시 부동산 한장 브리핑 - ${siteConfig.name}`;
  const description = '부산광역시 아파트 실거래 거래량·중앙 거래가·구별 분포를 한 장으로 확인하세요.';
  return { title, description, openGraph: buildOpenGraph({ title, description }) };
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
  return <RegionReportSheet envelope={envelope} />;
}
