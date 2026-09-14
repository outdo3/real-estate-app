// COMMUNITY_DELETE_NAVIGATION_CLEANUP_V1 — 삭제됐거나 없는 게시글의 화면 정책(순수 함수 + 탭 단위 기억).
//
// 제품 원칙: 삭제된 글에 대한 사용자 화면은 **커뮤니티 목록 하나**다.
// "삭제된 게시글입니다", "게시글을 찾을 수 없습니다", "다시 시도" 같은 중간 화면을 두지 않는다.
//
//  - 삭제 성공 / API 404 → 이 탭에서 그 글 id를 기억한다.
//  - 상세·수정 화면은 기억한 id면 요청도 하지 않고 바로 목록으로 replace한다(뒤로·앞으로 가기에서 중간 화면이 번쩍이지 않게).
//  - 404가 아닌 실패(통신 끊김·500)는 "없는 글"이 아니다 — 기존 오류·다시 시도 화면을 유지한다(AGENTS.md 데이터 진실성).
//
// SWR 키는 실제 화면이 쓰는 값 그대로다(추측 키 금지).
//  - 상세: src/app/community/[id]/post-client.tsx `useSWR(`/api/community/posts/${postId}`)`, 수정 저장 후 캐시 기록도 같은 키
//  - 목록: src/app/community/page.tsx `/api/community/posts?page=${page}${aptName ? `&aptName=...` : ''}`
//  - 수정 화면은 SWR을 쓰지 않는다(fetch no-store) — 지울 캐시가 없다.

export const COMMUNITY_LIST_PATH = '/community';

export const communityPostDetailKey = (postId: string) => `/api/community/posts/${postId}`;

/** 목록 SWR 키인가(모든 페이지·단지 필터). 상세 키(`/api/community/posts/{id}`)와 겹치지 않는다. */
export const isCommunityListKey = (key: unknown): key is string => typeof key === 'string' && key.startsWith('/api/community/posts?');

interface ListPayload {
  success: boolean;
  data?: { posts?: { id: string }[]; total?: number } & Record<string, unknown>;
}

/** 목록 캐시에서 삭제한 글을 뺀다(목록으로 돌아왔을 때 재검증 전에도 지운 글이 보이지 않게). 모양이 다르면 그대로 둔다. */
export function removePostFromListData<T>(current: T, postId: string): T {
  const payload = current as unknown as ListPayload | undefined;
  if (!payload?.success || !payload.data || !Array.isArray(payload.data.posts)) return current;
  const posts = payload.data.posts.filter((p) => p?.id !== postId);
  if (posts.length === payload.data.posts.length) return current;
  const removed = payload.data.posts.length - posts.length;
  const total = typeof payload.data.total === 'number' ? Math.max(0, payload.data.total - removed) : payload.data.total;
  return { ...payload, data: { ...payload.data, posts, total } } as unknown as T;
}

/** 상세 API 응답이 "없는 글"인가. HTTP 404만 해당한다(통신 실패·500은 아님). */
export const isMissingPostStatus = (status: number | undefined) => status === 404;

// ── 탭 단위 기억 ───────────────────────────────────────────────────────────────
// 모듈 Set(같은 문서의 앞/뒤 이동) + sessionStorage(같은 탭에서 문서가 다시 열린 경우). 저장소가 막혀도 동작한다.

const STORAGE_KEY = 'ejip:community:deleted-posts';
const MAX_REMEMBERED = 50;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const remembered = new Set<string>();

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function readStored(storage: StorageLike | null): string[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function markPostDeleted(postId: string, storage: StorageLike | null = defaultStorage()): void {
  if (!postId) return;
  remembered.add(postId);
  if (!storage) return;
  try {
    const next = [...readStored(storage).filter((id) => id !== postId), postId].slice(-MAX_REMEMBERED);
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 저장소가 가득 찼거나 막힘 — 모듈 기억만으로 동작한다.
  }
}

export function isPostDeleted(postId: string, storage: StorageLike | null = defaultStorage()): boolean {
  if (!postId) return false;
  return remembered.has(postId) || readStored(storage).includes(postId);
}

/** 테스트 전용: 모듈 기억 초기화. */
export function __resetDeletedPostsForTest() {
  remembered.clear();
}
