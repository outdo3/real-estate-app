import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import CompareReportSheet from '@/components/report/CompareReportSheet';
import InvalidScope from '@/components/report/InvalidScope';
import { readApartmentCompareReport, CompareReportError } from '@/lib/report/compare-read';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ a?: string | string[]; b?: string | string[] }> };

export async function generateMetadata(): Promise<Metadata> {
  const title = `단지 비교 한장 리포트 - ${siteConfig.name}`;
  const description = '두 아파트 단지의 실거래가, 이집 점수, 교통·생활 조건을 한 장으로 비교하세요.';
  return { title, description, openGraph: buildOpenGraph({ title, description }) };
}

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

export default async function CompareReportPage({ searchParams }: Props) {
  const sp = await searchParams;
  const a = decodeURIComponent(first(sp?.a)).trim();
  const b = decodeURIComponent(first(sp?.b)).trim();

  // JSX를 try/catch 안에서 만들지 않는다 — 결과만 먼저 확정한다.
  let envelope: Awaited<ReturnType<typeof readApartmentCompareReport>> | null = null;
  let failure: string | null = null;
  try {
    envelope = await readApartmentCompareReport(a, b);
  } catch (e) {
    // §1 — 어떤 실패에서도 다른 단지로 대체하지 않는다. 무엇이 잘못됐는지 말한다.
    if (e instanceof CompareReportError) failure = e.message;
    else throw e;
  }

  if (failure || !envelope) {
    return <InvalidScope reason={failure ?? '비교 리포트를 만들 수 없습니다.'} />;
  }
  return <CompareReportSheet envelope={envelope} />;
}
