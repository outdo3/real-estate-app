// REALTOR_PRO_MVP_V1 — 얇은 라우트: 스위치·로그인(서버 세션)·서비스 호출만. 로직은 src/lib/pro/*.
// 요청 본문의 id·realtorId는 쓰지 않는다 — 소유자는 항상 서버 세션의 사용자다.
import { jsonResult, withPro } from '@/lib/pro/runtime';
import { listShortlist } from '@/lib/pro/match-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  return withPro(async (deps, actor) => jsonResult(await listShortlist(deps, actor)));
}
