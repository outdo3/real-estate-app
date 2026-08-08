import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth-helpers';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true, image: true, role: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, name: true, image: true, role: true } } },
        },
      },
    });

    if (!post) {
      return NextResponse.json({ success: false, error: '게시글을 찾을 수 없습니다.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: post });
  } catch (error) {
    console.error('Failed to load post:', error);
    return NextResponse.json({ success: false, error: '게시글을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const { id } = await params;
    const existing = await prisma.post.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ success: false, error: '게시글을 찾을 수 없습니다.' }, { status: 404 });

    const isOwner = existing.authorId === user.id;
    const isAdmin = user.role === 'ADMIN';
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ success: false, error: '수정 권한이 없습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const title = body.title != null ? String(body.title).trim() : undefined;
    const content = body.content != null ? String(body.content).trim() : undefined;
    if (title === '' || content === '') {
      return NextResponse.json({ success: false, error: '제목과 내용은 비워둘 수 없습니다.' }, { status: 400 });
    }

    const post = await prisma.post.update({
      where: { id },
      data: { ...(title !== undefined && { title }), ...(content !== undefined && { content }) },
    });

    return NextResponse.json({ success: true, data: post });
  } catch (error) {
    console.error('Failed to update post:', error);
    return NextResponse.json({ success: false, error: '게시글을 수정하지 못했습니다.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const { id } = await params;
    const existing = await prisma.post.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ success: false, error: '게시글을 찾을 수 없습니다.' }, { status: 404 });

    const isOwner = existing.authorId === user.id;
    const isAdmin = user.role === 'ADMIN';
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ success: false, error: '삭제 권한이 없습니다.' }, { status: 403 });
    }

    await prisma.post.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete post:', error);
    return NextResponse.json({ success: false, error: '게시글을 삭제하지 못했습니다.' }, { status: 500 });
  }
}
