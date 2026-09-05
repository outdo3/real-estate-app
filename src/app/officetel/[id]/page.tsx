// OFFICETEL_V1 STEP 4B §6 — 오피스텔 상세 라우트.
//
// 아파트 상세(`/apt/[name]`)에 얹지 않고 별도 라우트를 쓴다. 아파트 경로의 식별자는
// **이름**이라 오피스텔을 거기 태우면 곧바로 identity 모호성이 생긴다(같은 이름의 다른
// 건물 4.47% 실측). 오피스텔은 master id로만 도달한다.
//
// 초기 데이터는 STEP 4A의 read 계층(`getOfficetelDetail`)을 서버에서 그대로 호출한다 —
// API 라우트와 **같은 함수**이므로 계약이 갈라지지 않으면서 HTTP 왕복 한 번을 아낀다.
// 거래 목록/면적 전환은 클라이언트에서 STEP 4A API(`/api/officetel/[id]/transactions`)를
// 그대로 호출한다.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { parseOfficetelIdRef, officetelFallbackDisplayName } from '@/lib/officetel/detail-contract';
import { getOfficetelDetail } from '@/lib/officetel/detail-read';
import OfficetelDetailClient from '@/components/officetel/OfficetelDetailClient';

export const dynamic = 'force-dynamic';

async function load(idParam: string) {
  const ref = parseOfficetelIdRef(decodeURIComponent(idParam));
  if (ref.kind === 'invalid') return null;
  return getOfficetelDetail(ref);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await load(id);
  if (!data) return { title: '오피스텔 정보 없음 | 이집' };
  const name = officetelFallbackDisplayName({
    officetelName: data.master.name,
    umdNm: data.master.address.umdNm,
    jibun: data.master.address.jibun,
  });
  return {
    title: `${name} 오피스텔 실거래 | 이집`,
    description: `${data.master.address.umdNm} ${data.master.address.jibun} ${name}의 매매·전세·월세 실거래 정보`,
  };
}

export default async function OfficetelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await load(id);
  // §6 — 잘못된/없는 id는 명확한 NOT FOUND. 다른 오피스텔로 대체하지 않는다.
  if (!data) notFound();
  return <OfficetelDetailClient detail={data} />;
}
