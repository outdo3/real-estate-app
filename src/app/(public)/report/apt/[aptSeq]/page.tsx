import type { Metadata } from 'next';
import { siteConfig, buildOpenGraph } from '@/config/site';
import { aptReportHref } from '@/lib/report/report-links';
import ApartmentReportSheet from '@/components/report/ApartmentReportSheet';
import InvalidScope from '@/components/report/InvalidScope';
import { readApartmentReport, AptReportNotFound } from '@/lib/report/apt-read';
import { prisma } from '@/lib/prisma';
import { isPublicRegionAllowed } from '@/lib/region/enablement';
import { decidePublicSeo, lawdCdFromAptSeq, SEOUL_NOINDEX_ROBOTS } from '@/lib/seo/seoul-blocked-seo';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ aptSeq: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { aptSeq } = await params;
  // SEOUL_BETA_PRELAUNCH_SEO_SAFETY_FIX_V1 — 본문 게이트(아래 isPublicRegionAllowed(…, 'report'))와 같은 축으로
  // 메타데이터도 닫는다. 서울 리포트는 beta에서도 전부 막히므로 단지명 조회 자체를 하지 않는다.
  if (decidePublicSeo([lawdCdFromAptSeq(decodeURIComponent(aptSeq))], 'report') !== 'NONE') {
    const title = `단지 리포트 - ${siteConfig.name}`;
    const description = '이 지역의 단지 리포트는 아직 준비 중입니다.';
    return { title, description, robots: SEOUL_NOINDEX_ROBOTS, openGraph: buildOpenGraph({ title, description }) };
  }
  // 제목에 쓸 이름만 가볍게 조회한다. 없으면 이름을 지어내지 않는다.
  const m = await prisma.apartmentMaster
    .findUnique({ where: { aptSeq: decodeURIComponent(aptSeq) }, select: { name: true } })
    .catch(() => null);
  const title = m?.name ? `${m.name} 단지 리포트 - ${siteConfig.name}` : `단지 리포트 - ${siteConfig.name}`;
  const description = m?.name
    ? `${m.name}의 최근 실거래, 12개월 거래량, 이집 점수를 한 장으로 확인하세요.`
    : '이집 단지 리포트';
  // REGIONAL_SEO_KEYWORD_LANDING_V1 §13/§14 — 단지 마스터에서 확인된 aptSeq만 self canonical + 색인.
  // 확인되지 않은 식별자는 이름을 지어내지 않는 일반 제목이고, 색인하지 않는다.
  const path = m?.name ? aptReportHref(decodeURIComponent(aptSeq)) : null;
  return {
    title,
    description,
    ...(path ? { alternates: { canonical: path } } : { robots: { index: false, follow: true } }),
    openGraph: buildOpenGraph({ title, description, path }),
  };
}

export default async function ApartmentReportPage({ params }: Props) {
  const { aptSeq } = await params;
  const id = decodeURIComponent(aptSeq).trim();
  if (!id) {
    return <InvalidScope reason="단지 식별자(aptSeq)가 비어 있어 리포트를 만들 수 없습니다." />;
  }

  // SEOUL_BETA_EXPOSURE_LEAK_CLOSE_V1 — 서울 단지 리포트는 **전부** 막는다.
  //
  // 지금까지 이 경로에는 지역 게이트가 없어서 서울 master 6,843개 전부가 열려 있었다.
  // 게이트 기준은 `report` 축이고 서울은 beta에서도 그 축을 열지 않는다 — 즉 승인된 8구까지
  // 포함해 전부 닫힌다. 리포트/SEO 범위(BUSAN_DISTRICTS)·제목·breadcrumb가 아직 부산 전용이라
  // 상세(`app` 축)보다 **더 엄격해야** 하기 때문이다.
  // 지역은 aptSeq의 앞 5자리(canonical 구 코드)로만 판정한다 — 이름으로 추측하지 않는다.
  // GYEONGGI_PUBLIC_EXPOSURE_GUARD_V1 — 서울 deny-list에서 공개 allowlist(`report` 축)로 바꿨다. 경기·전국도 막힌다.
  // aptSeq 형태가 아니면(앞자리 판정 불가) 아래 조회가 '없는 단지'로 답한다(기존 동작).
  const reportLawdCd = lawdCdFromAptSeq(id);
  if (reportLawdCd && !isPublicRegionAllowed(reportLawdCd, 'report')) {
    return (
      <InvalidScope reason={`요청하신 단지(${id})가 속한 지역의 리포트는 아직 준비 중입니다.`} />
    );
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
