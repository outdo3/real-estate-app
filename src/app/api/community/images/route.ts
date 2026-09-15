import { NextResponse } from 'next/server';
import { getCurrentUser, requireUser } from '@/lib/auth-helpers';
import { handleImageSessionCleanup, handleImageUpload } from '@/lib/community/image-handlers';
import { buildImageHandlerDeps } from '@/lib/supabase/community-image-deps';

// COMMUNITY_IMAGE_UPLOAD_V1 — 게시글 사진 업로드(POST) / 실패한 시도 정리(DELETE).
// 브라우저는 압축이 끝난 WebP/JPEG 바이트를 본문 그대로 보낸다(?session=<uuid>). 경로·파일명은 서버가 정한다.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireUser();
  const url = new URL(request.url);
  const lengthHeader = request.headers.get('content-length');
  const result = await handleImageUpload(
    {
      auth,
      sessionId: url.searchParams.get('session'),
      contentLength: lengthHeader != null && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null,
      readBytes: async () => new Uint8Array(await request.arrayBuffer()),
    },
    buildImageHandlerDeps()
  );
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}

export async function DELETE(request: Request) {
  // 차단된 계정도 자기 실패 업로드는 지울 수 있어야 하므로 getCurrentUser를 쓴다(쓰기 권한과 무관).
  const user = await getCurrentUser();
  const url = new URL(request.url);
  const result = await handleImageSessionCleanup(
    { auth: user ? { error: null, status: 200, user } : { error: '로그인이 필요합니다.', status: 401, user: null }, sessionId: url.searchParams.get('session') },
    buildImageHandlerDeps()
  );
  return NextResponse.json(result.body, { status: result.status });
}
