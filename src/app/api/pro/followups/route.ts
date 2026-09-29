// REALTOR_PRO_MVP_V1 — 얇은 라우트: 스위치·로그인(서버 세션)·서비스 호출만. 로직은 src/lib/pro/*.
// 요청 본문의 id·realtorId는 쓰지 않는다 — 소유자는 항상 서버 세션의 사용자다.
import { jsonResult, readJsonBody, sameOriginOrReject, withPro } from '@/lib/pro/runtime';
import { createFollowup, listFollowups } from '@/lib/pro/followup-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const s = url.searchParams.get('status');
  const status = s === 'OPEN' || s === 'DONE' || s === 'CANCELED' ? s : undefined;
  return withPro(async (deps, actor) => jsonResult(await listFollowups(deps, actor, { status, customerId: url.searchParams.get('customerId') ?? undefined })));
}

export async function POST(request: Request) {
  const blocked = sameOriginOrReject(request);
  if (blocked) return blocked;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  return withPro(async (deps, actor) => jsonResult(await createFollowup(deps, actor, parsed.body), 201));
}
