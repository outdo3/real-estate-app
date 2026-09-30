import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { COMMUNITY_LIST_PATH } from '@/lib/community/deleted-post-navigation';

/**
 * COMMUNITY_DELETE_NAVIGATION_CLEANUP_V1 — 게시글 상세·수정(/community/[id], /community/[id]/edit) 공통 서버 확인.
 *
 * 삭제됐거나 없는 글의 주소로 **직접 들어오면**(새로고침·주소 입력·공유 링크) 화면을 그리기 전에 목록으로 보낸다.
 * "게시글을 찾을 수 없습니다" 같은 중간 화면을 두지 않는다는 제품 결정이다.
 *
 *  - 조회가 성공했고 글이 없을 때만 redirect한다. DB 오류는 "없는 글"이 아니므로 그대로 렌더하고,
 *    화면의 기존 오류·다시 시도 경로가 처리한다(AGENTS.md 데이터 진실성).
 *  - 같은 탭 안의 뒤로·앞으로 가기는 클라이언트 라우터 캐시를 쓰므로 이 레이아웃이 다시 실행되지 않는다.
 *    그 경우는 상세·수정 화면의 클라이언트 확인(src/lib/community/deleted-post-navigation.ts)이 맡는다.
 *  - 권한 판정은 하지 않는다(읽기는 공개, 수정·삭제 권한은 각 API가 판정).
 */
export default async function CommunityPostLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  let missing = false;
  try {
    const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
    missing = post === null;
  } catch (e) {
    console.error('[community/[id]] layout 게시글 확인 실패', e);
  }
  // redirect()는 예외로 동작하므로 try 밖에서 호출한다.
  if (missing) redirect(COMMUNITY_LIST_PATH);
  return children;
}
