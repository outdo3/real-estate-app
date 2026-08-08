import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-helpers';

// 관리자 전용: 게시글을 목록 상단에 고정/해제
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const { id } = await params;
    const existing = await prisma.post.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ success: false, error: '게시글을 찾을 수 없습니다.' }, { status: 404 });

    const post = await prisma.post.update({ where: { id }, data: { pinned: !existing.pinned } });
    return NextResponse.json({ success: true, data: post });
  } catch (error) {
    console.error('Failed to toggle pin:', error);
    return NextResponse.json({ success: false, error: '고정 상태를 변경하지 못했습니다.' }, { status: 500 });
  }
}
