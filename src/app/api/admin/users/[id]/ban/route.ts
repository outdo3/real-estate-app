import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-helpers';

// 관리자 전용: 유저 강퇴(커뮤니티 글/댓글 작성 제한) 토글
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, status, user: admin } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const { id } = await params;
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return NextResponse.json({ success: false, error: '대상 유저를 찾을 수 없습니다.' }, { status: 404 });

    if (target.id === admin!.id) {
      return NextResponse.json({ success: false, error: '본인 계정은 강퇴할 수 없습니다.' }, { status: 400 });
    }
    if (target.role === 'ADMIN') {
      return NextResponse.json({ success: false, error: '다른 관리자는 강퇴할 수 없습니다.' }, { status: 400 });
    }

    const updated = await prisma.user.update({ where: { id }, data: { banned: !target.banned } });
    return NextResponse.json({ success: true, data: { id: updated.id, banned: updated.banned } });
  } catch (error) {
    console.error('Failed to toggle ban:', error);
    return NextResponse.json({ success: false, error: '강퇴 상태를 변경하지 못했습니다.' }, { status: 500 });
  }
}
