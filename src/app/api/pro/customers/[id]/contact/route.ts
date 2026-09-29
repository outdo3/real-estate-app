// REALTOR_PRO_MVP_V1 — 얇은 라우트: 스위치·로그인(서버 세션)·서비스 호출만. 로직은 src/lib/pro/*.
// 요청 본문의 id·realtorId는 쓰지 않는다 — 소유자는 항상 서버 세션의 사용자다.
import { contactRevealAllowed, jsonResult, sameOriginOrReject, withPro } from '@/lib/pro/runtime';
import { revealCustomerContact } from '@/lib/pro/customer-service';

export const dynamic = 'force-dynamic';

// 복호화는 POST만(프리페치·링크 미리보기 방지).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const blocked = sameOriginOrReject(request);
  if (blocked) return blocked;
  return withPro(async (deps, actor) => contactRevealAllowed(actor) ?? jsonResult(await revealCustomerContact(deps, actor, id), 200));
}
