import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { prismaAdminFeedbackRepo } from '@/lib/feedback/feedback-repo-prisma';
import { ADMIN_PAGE_SIZE, parseAdminListFilters, toAdminFeedbackItem } from '@/lib/feedback/feedback-service';

// USER_FEEDBACK_V1 — 관리자 전용 의견 목록(최신순, 상태·유형 필터). 기존 requireAdmin() 재사용.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const filters = parseAdminListFilters(new URL(request.url).searchParams);
    const { rows, total } = await prismaAdminFeedbackRepo.list(filters, ADMIN_PAGE_SIZE, (filters.page - 1) * ADMIN_PAGE_SIZE);
    return NextResponse.json({
      success: true,
      data: { items: rows.map(toAdminFeedbackItem), total, page: filters.page, pageSize: ADMIN_PAGE_SIZE, filters },
    });
  } catch (e) {
    console.error('[ADMIN_FEEDBACK_LIST_FAILED]', (e as Error)?.message?.slice(0, 200));
    return NextResponse.json({ success: false, error: '의견 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
