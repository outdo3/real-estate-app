import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import DailyReportSheet from '@/components/report/DailyReportSheet';
import InvalidScope from '@/components/report/InvalidScope';
import { readDailyReport, DailyReportInvalidDate } from '@/lib/report/daily-read';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ date: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  const d = decodeURIComponent(date);
  // 제목에서도 "새로 확인된"을 유지한다 — 공유 카드가 "N건 계약"으로 읽히면 안 된다(§19).
  const title = `${d} 새로 확인된 부산 실거래 - ${siteConfig.name}`;
  const description = '이집이 해당 날짜에 새로 확인한 부산 아파트 실거래입니다. 실제 계약일은 각 거래에 따로 표시됩니다.';
  return { title, description, openGraph: buildOpenGraph({ title, description }) };
}

export default async function DailyReportPage({ params }: Props) {
  const { date } = await params;
  const d = decodeURIComponent(date).trim();

  // JSX를 try/catch 안에서 만들지 않는다.
  let result: Awaited<ReturnType<typeof readDailyReport>> | null = null;
  let invalid = false;
  try {
    result = await readDailyReport(d);
  } catch (e) {
    if (e instanceof DailyReportInvalidDate) invalid = true;
    else throw e;
  }

  if (invalid || !result) {
    return <InvalidScope reason={`날짜 형식이 올바르지 않습니다(${d}). YYYY-MM-DD 형식이 필요합니다.`} />;
  }
  return <DailyReportSheet envelope={result.envelope} />;
}
