import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, status, user } = await requireUser();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const { id } = await params;
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) return NextResponse.json({ success: false, error: '게시글을 찾을 수 없습니다.' }, { status: 404 });

    const body = await request.json();
    const content = (body.content || '').trim();
    if (!content) {
      return NextResponse.json({ success: false, error: '댓글 내용을 입력해주세요.' }, { status: 400 });
    }

    const comment = await prisma.comment.create({
      data: { content, postId: id, authorId: user!.id },
      include: { author: { select: { id: true, name: true, image: true, role: true } } },
    });

    return NextResponse.json({ success: true, data: comment });
  } catch (error) {
    console.error('Failed to create comment:', error);
    return NextResponse.json({ success: false, error: '댓글을 작성하지 못했습니다.' }, { status: 500 });
  }
}
