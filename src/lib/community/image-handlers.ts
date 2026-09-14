// COMMUNITY_IMAGE_UPLOAD_V1 — 업로드/정리/게시글 연결/삭제의 서버 판정 로직(의존성 주입).
//
// 라우트는 세션·Prisma·Storage·서명키를 주입만 하고, 판정은 전부 여기서 한다 — 그래서 권한·경로
// 소유권·개수·실패 정리를 Next 런타임이나 실제 DB 없이 테스트할 수 있다.
import {
  IMAGE_ERROR_MESSAGES,
  MAX_IMAGES_PER_POST,
  MAX_STORED_BYTES,
  buildImagePath,
  checkStoredImage,
  isOwnedImagePath,
  isSafeUserId,
  isUuid,
  parseImagePath,
  sessionPrefix,
  type StoredImageMimeType,
} from './image-rules';
import { removeWithRetry, type CommunityImageStorage } from './image-storage-core';
import { UPLOAD_TOKEN_TTL_MS, type UploadReceipt } from './image-upload-token';

export interface SessionUser {
  id: string;
  role?: string | null;
  email?: string | null;
}

/** requireUser()/getCurrentUser() 결과를 그대로 받는다. */
export interface AuthResult {
  error: string | null;
  status: number;
  user: SessionUser | null;
}

export interface HandlerResult<T = unknown> {
  status: number;
  body: { success: true; data?: T } | { success: false; error: string };
}

const fail = (status: number, error: string): HandlerResult<never> => ({ status, body: { success: false, error } });

export interface ImageHandlerDeps {
  storage: CommunityImageStorage | null;
  sign: (receipt: UploadReceipt) => string;
  verify: (token: unknown) => UploadReceipt | null;
  newUuid: () => string;
  now: () => number;
  /** DB(PostImage)에 이미 연결된 경로 집합. */
  referencedPaths: (paths: string[]) => Promise<Set<string>>;
  log: (message: string, meta?: Record<string, unknown>) => void;
}

export interface UploadedImageDto {
  path: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: StoredImageMimeType;
  token: string;
}

// ── 업로드 ───────────────────────────────────────────────────────────────────

export async function handleImageUpload(
  input: { auth: AuthResult; sessionId: unknown; contentLength: number | null; readBytes: () => Promise<Uint8Array> },
  deps: ImageHandlerDeps
): Promise<HandlerResult<UploadedImageDto>> {
  const { auth } = input;
  if (auth.error || !auth.user) return fail(auth.status || 401, auth.error || '로그인이 필요합니다.');
  const user = auth.user;
  if (!isSafeUserId(user.id)) return fail(400, IMAGE_ERROR_MESSAGES.UPLOAD_FAILED);
  if (!isUuid(input.sessionId)) return fail(400, IMAGE_ERROR_MESSAGES.UPLOAD_FAILED);
  if (!deps.storage) {
    deps.log('[community-images] storage not configured');
    return fail(503, IMAGE_ERROR_MESSAGES.UPLOAD_FAILED);
  }
  // 본문을 읽기 전에 선언 길이로 먼저 막는다.
  if (input.contentLength != null && input.contentLength > MAX_STORED_BYTES) return fail(413, IMAGE_ERROR_MESSAGES.TOO_LARGE);

  const bytes = await input.readBytes();
  const checked = checkStoredImage(bytes);
  if (!checked.ok) {
    return checked.reason === 'TOO_LARGE' ? fail(413, IMAGE_ERROR_MESSAGES.TOO_LARGE) : fail(415, IMAGE_ERROR_MESSAGES.UNSUPPORTED);
  }

  try {
    const existing = await deps.storage.list(sessionPrefix(user.id, input.sessionId));
    if (existing.length >= MAX_IMAGES_PER_POST) return fail(409, IMAGE_ERROR_MESSAGES.TOO_MANY);

    const path = buildImagePath(user.id, input.sessionId, deps.newUuid(), checked.ext);
    await deps.storage.upload(path, bytes, checked.mimeType);
    deps.log('[community-images] uploaded', { bytes: bytes.length, mimeType: checked.mimeType });

    const receipt: UploadReceipt = {
      userId: user.id,
      path,
      width: checked.width,
      height: checked.height,
      bytes: bytes.length,
      mimeType: checked.mimeType,
      exp: deps.now() + UPLOAD_TOKEN_TTL_MS,
    };
    return {
      status: 200,
      body: {
        success: true,
        data: { path, url: deps.storage.publicUrl(path), width: checked.width, height: checked.height, bytes: bytes.length, mimeType: checked.mimeType, token: deps.sign(receipt) },
      },
    };
  } catch (error) {
    deps.log('[community-images] upload failed', { status: (error as { status?: number }).status ?? null });
    return fail(502, IMAGE_ERROR_MESSAGES.UPLOAD_FAILED);
  }
}

// ── 실패한 시도 정리 ───────────────────────────────────────────────────────────

/** 본인 세션 prefix 아래에서, 아직 어떤 게시글에도 연결되지 않은 객체만 지운다. */
export async function handleImageSessionCleanup(input: { auth: AuthResult; sessionId: unknown }, deps: ImageHandlerDeps): Promise<HandlerResult<{ removed: number }>> {
  const { auth } = input;
  if (!auth.user) return fail(auth.status || 401, auth.error || '로그인이 필요합니다.');
  if (!isSafeUserId(auth.user.id) || !isUuid(input.sessionId)) return fail(400, IMAGE_ERROR_MESSAGES.UPLOAD_FAILED);
  if (!deps.storage) return fail(503, IMAGE_ERROR_MESSAGES.UPLOAD_FAILED);
  try {
    const listed = await deps.storage.list(sessionPrefix(auth.user.id, input.sessionId));
    const owned = listed.filter((p) => isOwnedImagePath(p, auth.user!.id));
    const referenced = await deps.referencedPaths(owned);
    const orphans = owned.filter((p) => !referenced.has(p));
    const ok = await removeWithRetry(deps.storage, orphans);
    if (!ok) {
      deps.log('[community-image-orphan] session cleanup failed', { sessionId: input.sessionId, paths: orphans });
      return fail(502, IMAGE_ERROR_MESSAGES.UPLOAD_FAILED);
    }
    return { status: 200, body: { success: true, data: { removed: orphans.length } } };
  } catch (error) {
    deps.log('[community-image-orphan] session cleanup error', { sessionId: input.sessionId, status: (error as { status?: number }).status ?? null });
    return fail(502, IMAGE_ERROR_MESSAGES.UPLOAD_FAILED);
  }
}

// ── 게시글에 연결 ─────────────────────────────────────────────────────────────

export interface PostImageRow {
  path: string;
  sortOrder: number;
  width: number;
  height: number;
  bytes: number;
  mimeType: StoredImageMimeType;
}

/**
 * 게시글 생성 요청의 images(=업로드 영수증 토큰 배열)를 검증해 DB에 넣을 행으로 바꾼다.
 * 클라이언트가 보낸 경로·크기 값은 쓰지 않는다 — 서명된 영수증의 값만 쓴다.
 */
export async function resolvePostImages(
  input: { userId: string; images: unknown },
  deps: Pick<ImageHandlerDeps, 'verify' | 'storage'>
): Promise<{ ok: true; rows: PostImageRow[] } | { ok: false; status: number; error: string }> {
  if (input.images == null) return { ok: true, rows: [] };
  if (!Array.isArray(input.images)) return { ok: false, status: 400, error: IMAGE_ERROR_MESSAGES.UPLOAD_FAILED };
  if (input.images.length === 0) return { ok: true, rows: [] };
  if (input.images.length > MAX_IMAGES_PER_POST) return { ok: false, status: 400, error: IMAGE_ERROR_MESSAGES.TOO_MANY };
  const verified = await verifyUploadReceipts({ userId: input.userId, tokens: input.images.map((item) => (item as { token?: unknown } | null)?.token) }, deps);
  if (!verified.ok) return verified;
  return { ok: true, rows: verified.images.map((img, i) => ({ ...img, sortOrder: i })) };
}

export type VerifiedUpload = Omit<PostImageRow, 'sortOrder'>;

/**
 * 업로드 영수증 토큰들을 검증한다(V1 게시글 생성과 COMMUNITY_EDITOR_V2 블록 생성·수정 공용).
 * 서명·만료 → 현재 사용자 본인 영수증·본인 경로 → 경로 중복 없음 → Storage에 실제 존재. 클라이언트 경로·크기는 쓰지 않는다.
 */
export async function verifyUploadReceipts(
  input: { userId: string; tokens: unknown[] },
  deps: Pick<ImageHandlerDeps, 'verify' | 'storage'>
): Promise<{ ok: true; images: VerifiedUpload[] } | { ok: false; status: number; error: string }> {
  if (input.tokens.length === 0) return { ok: true, images: [] };
  if (!deps.storage) return { ok: false, status: 503, error: IMAGE_ERROR_MESSAGES.UPLOAD_FAILED };

  const images: VerifiedUpload[] = [];
  const seen = new Set<string>();
  for (const token of input.tokens) {
    const receipt = deps.verify(token);
    if (!receipt) return { ok: false, status: 400, error: IMAGE_ERROR_MESSAGES.UPLOAD_FAILED };
    if (receipt.userId !== input.userId || !isOwnedImagePath(receipt.path, input.userId)) {
      return { ok: false, status: 403, error: IMAGE_ERROR_MESSAGES.UPLOAD_FAILED };
    }
    if (seen.has(receipt.path)) return { ok: false, status: 400, error: IMAGE_ERROR_MESSAGES.UPLOAD_FAILED };
    seen.add(receipt.path);
    images.push({ path: receipt.path, width: receipt.width, height: receipt.height, bytes: receipt.bytes, mimeType: receipt.mimeType });
  }
  // 정리(cleanup)로 이미 지워진 객체를 게시글에 붙이지 않는다.
  for (const img of images) {
    let present = false;
    try {
      present = await deps.storage.exists(img.path);
    } catch {
      return { ok: false, status: 502, error: IMAGE_ERROR_MESSAGES.UPLOAD_FAILED };
    }
    if (!present) return { ok: false, status: 400, error: IMAGE_ERROR_MESSAGES.UPLOAD_FAILED };
  }
  return { ok: true, images };
}

/** 게시글 생성이 실패했을 때 이미 올라간 이 요청의 이미지를 지운다. */
export async function cleanupAfterFailedPostCreate(rows: PostImageRow[], deps: Pick<ImageHandlerDeps, 'storage' | 'log'>): Promise<void> {
  if (!deps.storage || rows.length === 0) return;
  const paths = rows.map((r) => r.path).filter((p) => parseImagePath(p));
  const ok = await removeWithRetry(deps.storage, paths);
  if (!ok) deps.log('[community-image-orphan] post create failed and cleanup failed', { paths });
}

// ── 게시글 삭제 ──────────────────────────────────────────────────────────────

export interface DeletePostDeps {
  findPost: (id: string) => Promise<{ id: string; authorId: string; imagePaths: string[] } | null>;
  deletePost: (id: string) => Promise<void>;
  isAdmin: (user: SessionUser) => boolean;
  storage: CommunityImageStorage | null;
  log: ImageHandlerDeps['log'];
}

/** 권한 → DB에서 경로 확보 → 게시글 삭제(PostImage cascade) → Storage 삭제(1회 재시도) → 실패 시 orphan 로그. */
export async function deletePostWithImages(input: { user: SessionUser | null; postId: string }, deps: DeletePostDeps): Promise<HandlerResult<{ imageCleanup: 'none' | 'done' | 'pending' }>> {
  if (!input.user) return fail(401, '로그인이 필요합니다.');
  const post = await deps.findPost(input.postId);
  if (!post) return fail(404, '게시글을 찾을 수 없습니다.');
  const isOwner = post.authorId === input.user.id;
  if (!isOwner && !deps.isAdmin(input.user)) return fail(403, '삭제 권한이 없습니다.');

  const paths = post.imagePaths.filter((p) => parseImagePath(p));
  await deps.deletePost(post.id);
  if (paths.length === 0) return { status: 200, body: { success: true, data: { imageCleanup: 'none' } } };

  if (!deps.storage) {
    deps.log('[community-image-orphan] storage not configured at post delete', { postId: post.id, paths });
    return { status: 200, body: { success: true, data: { imageCleanup: 'pending' } } };
  }
  const ok = await removeWithRetry(deps.storage, paths);
  if (!ok) {
    deps.log('[community-image-orphan] post deleted but storage delete failed', { postId: post.id, paths });
    return { status: 200, body: { success: true, data: { imageCleanup: 'pending' } } };
  }
  return { status: 200, body: { success: true, data: { imageCleanup: 'done' } } };
}
