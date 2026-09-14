import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser, isAdminSessionUser, requireUser } from '@/lib/auth-helpers';
import { deletePostWithImages } from '@/lib/community/image-handlers';
import { getCommunityImageStorage } from '@/lib/supabase/server-storage';
import { buildImageHandlerDeps } from '@/lib/supabase/community-image-deps';
import { toContentBlockViews } from '@/lib/community/content-blocks';
import { handleEditBlockPost } from '@/lib/community/post-write-handlers';
import { persistEditBlockPost } from '@/lib/community/post-write-db';

function toPublicImages(images: { path: string; width: number; height: number; sortOrder: number }[]) {
  if (images.length === 0) return [];
  const storage = getCommunityImageStorage();
  return images.map((img) => ({ url: storage ? storage.publicUrl(img.path) : null, width: img.width, height: img.height, sortOrder: img.sortOrder }));
}

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
        // COMMUNITY_IMAGE_UPLOAD_V1 — 표시에 필요한 값만(바이트 수·MIME 등 저장 메타데이터는 내보내지 않는다).
        images: { orderBy: { sortOrder: 'asc' }, select: { id: true, path: true, width: true, height: true, sortOrder: true } },
        // COMMUNITY_EDITOR_V2 — 순서 있는 본문 블록. 0개면 V1 글(아래 adapter가 content + images로 만든다).
        blocks: { orderBy: { sortOrder: 'asc' }, select: { type: true, text: true, postImageId: true, sortOrder: true } },
      },
    });

    if (!post) {
      return NextResponse.json({ success: false, error: '게시글을 찾을 수 없습니다.' }, { status: 404 });
    }

    const { images, blocks, ...rest } = post;
    const storage = getCommunityImageStorage();
    return NextResponse.json({
      success: true,
      data: {
        ...rest,
        images: toPublicImages(images),
        blocks: toContentBlockViews({ content: post.content, images, blocks }, (path) => (storage ? storage.publicUrl(path) : null)),
      },
    });
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
    const existing = await prisma.post.findUnique({
      where: { id },
      select: { id: true, authorId: true, updatedAt: true, images: { select: { id: true, path: true } }, _count: { select: { blocks: true } } },
    });
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

    // COMMUNITY_EDITOR_V2 — 블록 편집기 저장. 권한은 위에서 확인했고 핸들러가 한 번 더 확인한다.
    // 관련 단지(aptName)는 이 요청으로 바꿀 수 없다(정책 유지 — 필드를 읽지 않는다).
    if (body.blocks !== undefined) {
      const deps = buildImageHandlerDeps();
      const result = await handleEditBlockPost(
        { auth: { error: null, status: 200, user: user! }, post: existing, title: body.title, blocks: body.blocks, expectedUpdatedAt: body.expectedUpdatedAt },
        {
          ...deps,
          storage: deps.storage ?? getCommunityImageStorage(),
          isAdmin: (u) => isAdminSessionUser(u as { role?: string | null; email?: string | null }),
          persistEdit: persistEditBlockPost,
        }
      );
      return NextResponse.json(result.body, { status: result.status });
    }

    // 이하 V1 요청 형태(title/content). 블록으로 저장된 글의 본문을 content로만 바꾸면 블록과 어긋나므로 거부한다.
    const title = body.title != null ? String(body.title).trim() : undefined;
    const content = body.content != null ? String(body.content).trim() : undefined;
    if (content !== undefined && existing._count.blocks > 0) {
      return NextResponse.json({ success: false, error: '이 글은 편집 화면에서 수정해주세요.' }, { status: 409 });
    }
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
    const existing = await prisma.post.findUnique({ where: { id }, select: { id: true, authorId: true, images: { select: { path: true } } } });
    if (!existing) return NextResponse.json({ success: false, error: '게시글을 찾을 수 없습니다.' }, { status: 404 });

    const isOwner = existing.authorId === user.id;
    const isAdmin = isAdminSessionUser(user as { role?: string | null; email?: string | null });
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ success: false, error: '삭제 권한이 없습니다.' }, { status: 403 });
    }

    // COMMUNITY_IMAGE_UPLOAD_V1 — 권한 → DB에서 사진 경로 확보 → 글 삭제(PostImage cascade) → Storage 삭제.
    // 지울 경로는 항상 DB에서 읽는다(클라이언트가 보낸 경로로는 절대 지우지 않는다). 핸들러도 권한을 다시 확인한다.
    const result = await deletePostWithImages(
      { user, postId: id },
      {
        findPost: async () => ({ id: existing.id, authorId: existing.authorId, imagePaths: existing.images.map((i) => i.path) }),
        deletePost: async (postId) => {
          await prisma.post.delete({ where: { id: postId } });
        },
        isAdmin: (u) => isAdminSessionUser(u as { role?: string | null; email?: string | null }),
        storage: getCommunityImageStorage(),
        log: (message, meta) => console.error(message, meta ?? ''),
      }
    );
    if (!result.body.success) return NextResponse.json(result.body, { status: result.status });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete post:', error);
    return NextResponse.json({ success: false, error: '게시글을 삭제하지 못했습니다.' }, { status: 500 });
  }
}
