// COMMUNITY_EDITOR_V2 — 블록 게시글 생성·수정의 서버 판정 로직(의존성 주입).
//
// 라우트는 세션·Prisma 트랜잭션·Storage·서명 검증을 주입하고, 판정·사진 분류·정리 순서는 전부 여기서 한다.
// 핵심 불변식:
//  - 기존 사진 참조는 **이 글의 사진만**(다른 글·다른 사용자 사진 거부), 새 사진은 **현재 편집자 본인** 영수증만.
//  - DB 커밋 전에는 기존 Storage 객체를 절대 지우지 않는다. 제거된 사진은 커밋 성공 후에만 삭제한다.
//  - 저장이 실패하면 기존 글·사진은 그대로이고, 이번 요청에서 새로 올린 사진만 정리한다.
import { BLOCK_ERROR_MESSAGES, deriveContentText, normalizeBlocks, type NormalizedBlock } from './content-blocks';
import { verifyUploadReceipts, type AuthResult, type HandlerResult, type ImageHandlerDeps, type SessionUser, type VerifiedUpload } from './image-handlers';
import { removeWithRetry } from './image-storage-core';

export const POST_TITLE_MAX = 200;

export const EDIT_ERROR_MESSAGES = {
  TITLE_REQUIRED: '제목을 입력해주세요.',
  TITLE_TOO_LONG: '제목은 200자 이내로 입력해주세요.',
  STALE: '다른 곳에서 이 글이 먼저 수정됐어요. 새로고침한 뒤 다시 수정해주세요.',
  FORBIDDEN: '수정 권한이 없습니다.',
  NOT_FOUND: '게시글을 찾을 수 없습니다.',
  SAVE_FAILED: '게시글을 저장하지 못했습니다. 다시 시도해주세요.',
} as const;

export type PlannedBlock =
  | { sortOrder: number; type: 'TEXT'; text: string }
  | { sortOrder: number; type: 'IMAGE'; image: { kind: 'existing'; id: string } | { kind: 'new'; path: string } };

export interface NewImagePlan extends VerifiedUpload {
  sortOrder: number;
}

export interface WritePlan {
  title: string;
  content: string;
  blocks: PlannedBlock[];
  newImages: NewImagePlan[];
  /** 수정에서만: 유지되는 기존 사진과 새 순번. */
  retainedImages: { id: string; sortOrder: number }[];
  /** 수정에서만: 제거되는 기존 사진(커밋 후 Storage 삭제 대상). */
  removedImages: { id: string; path: string }[];
}

export type WriteDeps = Pick<ImageHandlerDeps, 'verify' | 'storage' | 'log'>;

export function validateTitle(raw: unknown): { ok: true; title: string } | { ok: false; error: string } {
  const title = typeof raw === 'string' ? raw.trim() : '';
  if (!title) return { ok: false, error: EDIT_ERROR_MESSAGES.TITLE_REQUIRED };
  if (title.length > POST_TITLE_MAX) return { ok: false, error: EDIT_ERROR_MESSAGES.TITLE_TOO_LONG };
  return { ok: true, title };
}

/** 정규화된 블록 + 검증된 새 사진 + (수정 시) 기존 사진 → DB 계획. 사진 순번은 블록 안 등장 순서. */
function buildPlan(
  title: string,
  blocks: NormalizedBlock[],
  newUploads: Map<string, VerifiedUpload>,
  existing: { id: string; path: string }[]
): WritePlan {
  const planned: PlannedBlock[] = [];
  const newImages: NewImagePlan[] = [];
  const retainedImages: { id: string; sortOrder: number }[] = [];
  const keep = new Set<string>();
  let imageOrder = 0;

  blocks.forEach((b, i) => {
    if (b.type === 'text') {
      planned.push({ sortOrder: i, type: 'TEXT', text: b.text });
    } else if ('existingImageId' in b) {
      keep.add(b.existingImageId);
      retainedImages.push({ id: b.existingImageId, sortOrder: imageOrder++ });
      planned.push({ sortOrder: i, type: 'IMAGE', image: { kind: 'existing', id: b.existingImageId } });
    } else {
      const upload = newUploads.get(b.uploadToken)!;
      newImages.push({ ...upload, sortOrder: imageOrder++ });
      planned.push({ sortOrder: i, type: 'IMAGE', image: { kind: 'new', path: upload.path } });
    }
  });

  return {
    title,
    content: deriveContentText(blocks.map((b) => (b.type === 'text' ? b : { type: 'image' }))),
    blocks: planned,
    newImages,
    retainedImages,
    removedImages: existing.filter((img) => !keep.has(img.id)).map((img) => ({ id: img.id, path: img.path })),
  };
}

async function verifyNewTokens(userId: string, blocks: NormalizedBlock[], deps: WriteDeps) {
  const tokens = blocks.flatMap((b) => (b.type === 'image' && 'uploadToken' in b ? [b.uploadToken] : []));
  const verified = await verifyUploadReceipts({ userId, tokens }, deps);
  if (!verified.ok) return verified;
  return { ok: true as const, byToken: new Map(tokens.map((t, i) => [t, verified.images[i]])) };
}

async function cleanupNewUploads(plan: Pick<WritePlan, 'newImages'>, deps: WriteDeps, context: Record<string, unknown>) {
  if (!deps.storage || plan.newImages.length === 0) return;
  const paths = plan.newImages.map((img) => img.path);
  const ok = await removeWithRetry(deps.storage, paths);
  if (!ok) deps.log('[community-image-orphan] write failed and new-upload cleanup failed', { ...context, paths });
}

// ── 생성 ─────────────────────────────────────────────────────────────────────

export interface CreateDeps extends WriteDeps {
  persistCreate: (plan: WritePlan) => Promise<{ id: string }>;
}

export async function handleCreateBlockPost(
  input: { user: SessionUser; title: unknown; blocks: unknown },
  deps: CreateDeps
): Promise<HandlerResult<{ id: string }>> {
  const title = validateTitle(input.title);
  if (!title.ok) return { status: 400, body: { success: false, error: title.error } };
  const normalized = normalizeBlocks(input.blocks);
  if (!normalized.ok) return { status: normalized.status, body: { success: false, error: normalized.error } };
  // 새 글에는 "기존 사진"이 있을 수 없다 — 다른 글의 사진 id를 끼워 넣는 시도를 거부한다.
  if (normalized.blocks.some((b) => b.type === 'image' && 'existingImageId' in b)) {
    return { status: 400, body: { success: false, error: BLOCK_ERROR_MESSAGES.INVALID } };
  }
  const verified = await verifyNewTokens(input.user.id, normalized.blocks, deps);
  if (!verified.ok) return { status: verified.status, body: { success: false, error: verified.error } };

  const plan = buildPlan(title.title, normalized.blocks, verified.byToken, []);
  try {
    const created = await deps.persistCreate(plan);
    if (plan.newImages.length > 0) {
      deps.log('[community-images] post created', { count: plan.newImages.length, bytes: plan.newImages.reduce((s, r) => s + r.bytes, 0) });
    }
    return { status: 200, body: { success: true, data: { id: created.id } } };
  } catch (error) {
    await cleanupNewUploads(plan, deps, { phase: 'create' });
    throw error;
  }
}

// ── 수정 ─────────────────────────────────────────────────────────────────────

export interface EditablePost {
  id: string;
  authorId: string;
  updatedAt: Date;
  images: { id: string; path: string }[];
}

export class StaleEditError extends Error {
  constructor() {
    super('stale edit');
    this.name = 'StaleEditError';
  }
}

export interface EditDeps extends WriteDeps {
  isAdmin: (user: SessionUser) => boolean;
  /** 트랜잭션. 조건부 갱신(updatedAt 일치)이 0행이면 StaleEditError를 던진다. */
  persistEdit: (postId: string, expectedUpdatedAt: Date, plan: WritePlan) => Promise<void>;
}

export async function handleEditBlockPost(
  input: { auth: AuthResult; post: EditablePost | null; title: unknown; blocks: unknown; expectedUpdatedAt: unknown },
  deps: EditDeps
): Promise<HandlerResult<{ id: string; imageCleanup: 'none' | 'done' | 'pending' }>> {
  const fail = (status: number, error: string) => ({ status, body: { success: false as const, error } });
  const { auth, post } = input;
  if (auth.error || !auth.user) return fail(auth.status || 401, auth.error || '로그인이 필요합니다.');
  if (!post) return fail(404, EDIT_ERROR_MESSAGES.NOT_FOUND);
  const user = auth.user;
  if (post.authorId !== user.id && !deps.isAdmin(user)) return fail(403, EDIT_ERROR_MESSAGES.FORBIDDEN);

  // 동시 수정 보호: 편집을 시작할 때 본 버전과 지금 버전이 다르면 덮어쓰지 않는다.
  const expected = typeof input.expectedUpdatedAt === 'string' ? new Date(input.expectedUpdatedAt) : null;
  if (!expected || Number.isNaN(expected.getTime())) return fail(400, BLOCK_ERROR_MESSAGES.INVALID);
  if (expected.getTime() !== post.updatedAt.getTime()) return fail(409, EDIT_ERROR_MESSAGES.STALE);

  const title = validateTitle(input.title);
  if (!title.ok) return fail(400, title.error);
  const normalized = normalizeBlocks(input.blocks);
  if (!normalized.ok) return fail(normalized.status, normalized.error);

  // 기존 사진은 반드시 이 글의 사진이어야 한다(다른 글·다른 사용자 사진 id 거부).
  const ownImageIds = new Set(post.images.map((img) => img.id));
  for (const b of normalized.blocks) {
    if (b.type === 'image' && 'existingImageId' in b && !ownImageIds.has(b.existingImageId)) {
      return fail(400, BLOCK_ERROR_MESSAGES.INVALID);
    }
  }
  const verified = await verifyNewTokens(user.id, normalized.blocks, deps);
  if (!verified.ok) return fail(verified.status, verified.error);

  const plan = buildPlan(title.title, normalized.blocks, verified.byToken, post.images);
  try {
    await deps.persistEdit(post.id, expected, plan);
  } catch (error) {
    await cleanupNewUploads(plan, deps, { phase: 'edit', postId: post.id });
    if (error instanceof StaleEditError) return fail(409, EDIT_ERROR_MESSAGES.STALE);
    deps.log('[community-posts] edit transaction failed', { postId: post.id });
    return fail(500, EDIT_ERROR_MESSAGES.SAVE_FAILED);
  }

  // 커밋 이후에만 제거된 사진의 Storage 객체를 지운다.
  if (plan.removedImages.length === 0) return { status: 200, body: { success: true, data: { id: post.id, imageCleanup: 'none' } } };
  const paths = plan.removedImages.map((img) => img.path);
  const ok = deps.storage ? await removeWithRetry(deps.storage, paths) : false;
  if (!ok) {
    deps.log('[community-image-orphan] post edited but removed-image storage delete failed', { postId: post.id, paths });
    return { status: 200, body: { success: true, data: { id: post.id, imageCleanup: 'pending' } } };
  }
  return { status: 200, body: { success: true, data: { id: post.id, imageCleanup: 'done' } } };
}
