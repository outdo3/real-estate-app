// REALTOR_PRO_MVP_V1 — 매물 등록용 단지 prefill(aptSeq로만 조회, 공개 게이트 적용). 로직은 src/lib/pro/*.
import { jsonResult, withPro } from '@/lib/pro/runtime';
import { getApartmentPrefill } from '@/lib/pro/listing-service';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ aptSeq: string }> }) {
  const { aptSeq } = await params;
  return withPro(async (deps, actor) => jsonResult(await getApartmentPrefill(deps, actor, decodeURIComponent(aptSeq))));
}
