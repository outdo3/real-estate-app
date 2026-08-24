import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';

// 로그인 사용자의 최근 본 단지 목록 반환.
// viewedAt DESC, 서버 보존 최대 20건.
export async function GET() {
  const { error, status, user } = await requireUser();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const recent = await prisma.recentView.findMany({
      where: { userId: user!.id },
      orderBy: { viewedAt: 'desc' },
      take: 20,
    });
    return NextResponse.json({ success: true, data: recent });
  } catch (err) {
    console.error('Failed to list recent views:', err);
    return NextResponse.json(
      { success: false, error: '최근 본 단지 목록을 불러오지 못했습니다.' },
      { status: 500 }
    );
  }
}
