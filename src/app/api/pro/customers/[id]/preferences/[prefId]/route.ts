// REALTOR_PRO_MVP_V1 — 얇은 라우트: 스위치·로그인(서버 세션)·서비스 호출만. 로직은 src/lib/pro/*.
// 요청 본문의 id·realtorId는 쓰지 않는다 — 소유자는 항상 서버 세션의 사용자다.
import { jsonResult, readJsonBody, sameOriginOrReject, withPro } from '@/lib/pro/runtime';
import { savePreference } from '@/lib/pro/customer-service';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; prefId: string }> }) {
  const { id, prefId } = await params;
  const blocked = sameOriginOrReject(request);
  if (blocked) return blocked;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  return withPro(async (deps, actor) => jsonResult(await savePreference(deps, actor, id, prefId, parsed.body), 200));
}
