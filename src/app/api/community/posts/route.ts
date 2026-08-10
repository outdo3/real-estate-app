import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';

const PAGE_SIZE = 20;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const aptName = searchParams.get('aptName')?.trim() || undefined;
    const where = aptName ? { aptName } : undefined;

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          author: { select: { id: true, name: true, image: true, role: true } },
          _count: { select: { comments: true } },
        },
      }),
      prisma.post.count({ where }),
    ]);

    return NextResponse.json({ success: true, data: { posts, total, page, pageSize: PAGE_SIZE } });
  } catch (error) {
    console.error('Failed to list posts:', error);
    return NextResponse.json({ success: false, error: '게시글 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error, status, user } = await requireUser();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const body = await request.json();
    const title = (body.title || '').trim();
    const content = (body.content || '').trim();
    const aptName = (body.aptName || '').trim() || null;

    if (!title || !content) {
      return NextResponse.json({ success: false, error: '제목과 내용을 모두 입력해주세요.' }, { status: 400 });
    }
    if (title.length > 200) {
      return NextResponse.json({ success: false, error: '제목은 200자 이내로 입력해주세요.' }, { status: 400 });
    }
    if (aptName && aptName.length > 100) {
      return NextResponse.json({ success: false, error: '단지명은 100자 이내로 입력해주세요.' }, { status: 400 });
    }

    const post = await prisma.post.create({
      data: { title, content, aptName, authorId: user!.id },
      include: { author: { select: { id: true, name: true, image: true, role: true } } },
    });

    return NextResponse.json({ success: true, data: post });
  } catch (error) {
    console.error('Failed to create post:', error);
    return NextResponse.json({ success: false, error: '게시글을 작성하지 못했습니다.' }, { status: 500 });
  }
}
