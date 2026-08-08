import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-helpers';

// 관리자 전용: 전체 유저 목록 (강퇴/권한 관리용)
export async function GET(request: Request) {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = 50;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, email: true, name: true, image: true, role: true, banned: true, createdAt: true },
      }),
      prisma.user.count(),
    ]);

    return NextResponse.json({ success: true, data: { users, total, page, pageSize } });
  } catch (error) {
    console.error('Failed to list users:', error);
    return NextResponse.json({ success: false, error: '유저 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
