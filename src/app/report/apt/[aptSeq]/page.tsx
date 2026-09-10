import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import ApartmentReportSheet from '@/components/report/ApartmentReportSheet';
import InvalidScope from '@/components/report/InvalidScope';
import { readApartmentReport, AptReportNotFound } from '@/lib/report/apt-read';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ aptSeq: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { aptSeq } = await params;
  // 제목에 쓸 이름만 가볍게 조회한다. 없으면 이름을 지어내지 않는다.
  const m = await prisma.apartmentMaster
    .findUnique({ where: { aptSeq: decodeURIComponent(aptSeq) }, select: { name: true } })
    .catch(() => null);
  const title = m?.name ? `${m.name} 단지 리포트 - ${siteConfig.name}` : `단지 리포트 - ${siteConfig.name}`;
  const description = m?.name
    ? `${m.name}의 최근 실거래, 12개월 거래량, 이집 점수를 한 장으로 확인하세요.`
    : '이집 단지 리포트';
  return { title, description, openGraph: buildOpenGraph({ title, description }) };
}

export default async function ApartmentReportPage({ params }: Props) {
  const { aptSeq } = await params;
  const id = decodeURIComponent(aptSeq).trim();
  if (!id) {
    return <InvalidScope reason="단지 식별자(aptSeq)가 비어 있어 리포트를 만들 수 없습니다." />;
  }

  // JSX를 try/catch 안에서 만들지 않는다(react-hooks/error-boundaries).
  // 비동기 결과만 먼저 확정하고, 렌더는 바깥에서 한 번만 한다.
  let envelope: Awaited<ReturnType<typeof readApartmentReport>> | null = null;
  let notFound = false;
  try {
    envelope = await readApartmentReport(id);
  } catch (e) {
    // §1 — 다른 단지로 폴백하지 않는다. 없는 단지는 없다고 말한다.
    if (e instanceof AptReportNotFound) notFound = true;
    else throw e;
  }

  if (notFound || !envelope) {
    return (
      <InvalidScope
        reason={`요청하신 단지(${id})를 찾을 수 없습니다. 다른 단지의 정보를 대신 보여드리지 않습니다.`}
      />
    );
  }

  // 강점/확인할 점은 Score briefing이 이미 만든 것을 envelope.data로 그대로 받는다
  // (여기서 새 문장을 만들지 않는다 — §10).
  return (
    <ApartmentReportSheet
      envelope={envelope}
      strengths={envelope.data?.strengths ?? []}
      cautions={envelope.data?.cautions ?? []}
    />
  );
}
