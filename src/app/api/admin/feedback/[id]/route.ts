import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { prismaAdminFeedbackRepo } from '@/lib/feedback/feedback-repo-prisma';
import { updateFeedbackStatus } from '@/lib/feedback/feedback-service';

// USER_FEEDBACK_V1 — 관리자 전용 상태 변경(NEW/REVIEWING/DONE, 선택 adminNote). resolvedAt 규칙은 feedback-rules.nextStatusFields.
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  const { id } = await params;
  if (!id || id.length > 64) return NextResponse.json({ success: false, error: '의견을 찾을 수 없습니다.' }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  try {
    const result = await updateFeedbackStatus(id, body, prismaAdminFeedbackRepo, new Date());
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    console.error('[ADMIN_FEEDBACK_UPDATE_FAILED]', (e as Error)?.message?.slice(0, 200));
    return NextResponse.json({ success: false, error: '상태를 변경하지 못했습니다.' }, { status: 500 });
  }
}
