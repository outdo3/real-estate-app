// REALTOR_PRO_MVP_V1 — 매물 등록용 단지 prefill(aptSeq로만 조회, 공개 게이트 적용). 로직은 src/lib/pro/*.
import { jsonResult, withPro } from '@/lib/pro/runtime';
import { getApartmentPrefill } from '@/lib/pro/listing-service';

export const dynamic = 'force-dynamic';

// 잘못된 % 시퀀스는 500이 아니라 형식 오류(서비스가 400)로
function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return '';
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ aptSeq: string }> }) {
  const { aptSeq } = await params;
  return withPro(async (deps, actor) => jsonResult(await getApartmentPrefill(deps, actor, safeDecode(aptSeq))));
}
