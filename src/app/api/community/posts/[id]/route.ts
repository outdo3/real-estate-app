import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser, isAdminSessionUser, requireUser } from '@/lib/auth-helpers';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: { select: { name: true, image: true, role: true } },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { name: true, image: true, role: true } } },
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
  // COMMUNITY_LAUNCH_READINESS_V1 — 수정은 requireUser로 막는다.
  //
  // 예전에는 getCurrentUser만 썼다. 그러면 커뮤니티 이용이 제한된(banned) 계정도
  // 이미 쓴 글의 **내용을 바꿔** 스팸으로 만들 수 있다 — 글쓰기는 막아두고 수정은
  // 열어두면 차단이 무의미해진다. 삭제(DELETE)는 그대로 둔다: 차단된 사용자가 자기
  // 글을 지우는 것은 막을 이유가 없다.
  const { error: authError, status: authStatus, user } = await requireUser();
  if (authError) return NextResponse.json({ success: false, error: authError }, { status: authStatus });

  try {
    const { id } = await params;
    const existing = await prisma.post.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ success: false, error: '게시글을 찾을 수 없습니다.' }, { status: 404 });

    const isOwner = existing.authorId === user!.id;
    // 관리자 판정은 프로젝트 단일 기준(role === 'ADMIN' 또는 ADMIN_EMAIL)을 쓴다.
    // 예전에는 여기만 role만 봐서, 같은 관리자가 고정(pin)은 되는데 수정/삭제는 안 되는
    // 불일치가 있었다(pin 라우트는 requireAdmin을 쓴다).
    const isAdmin = isAdminSessionUser(user as { role?: string | null; email?: string | null });
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
    const isAdmin = isAdminSessionUser(user as { role?: string | null; email?: string | null });
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
