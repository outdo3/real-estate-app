// REALTOR_PRO_MVP_V1 — 얇은 라우트: 스위치·로그인(서버 세션)·서비스 호출만. 로직은 src/lib/pro/*.
// 요청 본문의 id·realtorId는 쓰지 않는다 — 소유자는 항상 서버 세션의 사용자다.
import { jsonResult, readJsonBody, sameOriginOrReject, withPro } from '@/lib/pro/runtime';
import { createBriefing, listBriefings } from '@/lib/pro/briefing-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  return withPro(async (deps, actor) => jsonResult(await listBriefings(deps, actor)));
}

// 응답의 token은 공유 링크 원문 — 이 응답에서 한 번만 보인다(DB에는 해시만).
export async function POST(request: Request) {
  const blocked = sameOriginOrReject(request);
  if (blocked) return blocked;
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  return withPro(async (deps, actor) => jsonResult(await createBriefing(deps, actor, parsed.body), 201));
}
