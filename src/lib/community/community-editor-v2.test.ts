import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  BLOCK_ERROR_MESSAGES,
  MAX_CONTENT_BLOCKS,
  MAX_TEXT_BLOCK_CHARS,
  MAX_TEXT_TOTAL_CHARS,
  buildPostDescription,
  deriveContentText,
  normalizeBlocks,
  toContentBlockViews,
  type StoredBlockRef,
  type StoredImageRef,
} from './content-blocks';
import {
  buildBlocksPayload,
  editorBlocksFromViews,
  editorSnapshot,
  insertImagePlaceholders,
  insertTextBlock,
  moveBlock,
  precheckBlocks,
  removeBlock,
  resolveImageBlock,
  updateTextBlock,
  type EditorBlock,
} from './block-editor-state';
import { EDIT_ERROR_MESSAGES, StaleEditError, handleCreateBlockPost, handleEditBlockPost, type EditablePost, type WritePlan } from './post-write-handlers';
import { isAdminSessionUser } from '../admin-access';
import type { CommunityImageStorage } from './image-storage-core';
import { deriveUploadTokenKey, signUploadReceipt, verifyUploadReceipt, type UploadReceipt } from './image-upload-token';
import type { AuthResult, SessionUser } from './image-handlers';

/**
 * COMMUNITY_EDITOR_V2 — 텍스트/사진 블록 게시글 생성·수정·렌더 계약.
 * Storage·DB 트랜잭션은 fake로 주입하고, 라우트·화면 배선은 소스 검사로 고정한다.
 * DB 제약(FK·unique·CHECK·cascade)의 실제 동작은 scripts/community/verify-content-block-constraints.ts(롤백 트랜잭션)로 확인한다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const OWNER = 'owner0001';
const OTHER = 'other0002';
const ADMIN = 'admin0003';
const SESSION = '3f1c2b7a-9d4e-4c1a-8b2f-0a1b2c3d4e5f';
const KEY = deriveUploadTokenKey('test-secret');
const NOW = 1_800_000_000_000;

let uuidSeq = 0;
const uuid = () => `aaaaaaaa-bbbb-4ccc-8ddd-${String(++uuidSeq).padStart(12, '0')}`;

function receipt(userId: string, extra: Partial<UploadReceipt> = {}): { token: string; path: string } {
  const path = `posts/${userId}/${SESSION}/${uuid()}.webp`;
  const r: UploadReceipt = { userId, path, width: 1200, height: 1600, bytes: 150_000, mimeType: 'image/webp', exp: NOW + 60_000, ...extra };
  return { token: signUploadReceipt(r, KEY), path };
}

function fakeStorage(opts: { failRemove?: number } = {}) {
  const objects = new Set<string>();
  const calls: string[] = [];
  const removed: string[][] = [];
  let failures = opts.failRemove ?? 0;
  const storage: CommunityImageStorage = {
    upload: async (p) => void objects.add(p),
    exists: async (p) => objects.has(p),
    list: async (prefix) => [...objects].filter((o) => o.startsWith(prefix)),
    remove: async (paths) => {
      calls.push('storage.remove');
      removed.push(paths);
      if (failures > 0) {
        failures--;
        throw new Error('boom');
      }
      paths.forEach((p) => objects.delete(p));
    },
    publicUrl: (p) => `https://proj.supabase.co/storage/v1/object/public/community-images/${p}`,
  };
  return { storage, objects, calls, removed };
}

const verify = (t: unknown) => verifyUploadReceipt(t, KEY, NOW);
const authOf = (id: string, extra: Partial<SessionUser> = {}): AuthResult => ({ error: null, status: 200, user: { id, ...extra } });

// ── 1–7, 35. 블록 조합 ─────────────────────────────────────────────────────────

async function createWith(blocks: unknown[], fs = fakeStorage()) {
  let plan: WritePlan | null = null;
  const logs: string[] = [];
  const res = await handleCreateBlockPost(
    { user: { id: OWNER }, title: '광복 롯데 애슐리', blocks },
    { verify, storage: fs.storage, log: (m) => void logs.push(m), persistCreate: async (p) => ((plan = p), { id: 'post1' }) }
  );
  return { res, plan: plan as WritePlan | null, fs, logs };
}

function uploaded(fs: ReturnType<typeof fakeStorage>, userId = OWNER) {
  const r = receipt(userId);
  fs.objects.add(r.path);
  return r;
}

test('1·7. text only (첫 블록 텍스트) — 줄바꿈 보존, 파생 평문 = 텍스트', async () => {
  const { res, plan } = await createWith([{ type: 'text', text: '광복 롯데백화점 애슐리에서 저녁 먹고 왔어요.\n생각보다 사람이 많지 않았어요.' }]);
  assert.equal(res.status, 200);
  assert.deepEqual(plan!.blocks, [{ sortOrder: 0, type: 'TEXT', text: '광복 롯데백화점 애슐리에서 저녁 먹고 왔어요.\n생각보다 사람이 많지 않았어요.' }]);
  assert.equal(plan!.content, '광복 롯데백화점 애슐리에서 저녁 먹고 왔어요.\n생각보다 사람이 많지 않았어요.');
  assert.equal(plan!.newImages.length, 0);
});

test('2·6·35. image only (첫 블록 사진) — 파생 평문은 빈 문자열, SEO는 제목으로 대체', async () => {
  const fs = fakeStorage();
  const a = uploaded(fs);
  const { res, plan } = await createWith([{ type: 'image', uploadToken: a.token }], fs);
  assert.equal(res.status, 200);
  assert.deepEqual(plan!.blocks, [{ sortOrder: 0, type: 'IMAGE', image: { kind: 'new', path: a.path } }]);
  assert.equal(plan!.content, '');
  assert.equal(buildPostDescription(plan!.content, '입구 사진'), '입구 사진');
});

test('3. text-image-text-image — 블록 순서·사진 순번(sortOrder)이 등장 순서 그대로', async () => {
  const fs = fakeStorage();
  const a = uploaded(fs);
  const b = uploaded(fs);
  const { plan } = await createWith(
    [
      { type: 'text', text: '생각보다 사람이 많지 않았어요.' },
      { type: 'image', uploadToken: a.token },
      { type: 'text', text: '내부는 이런 분위기였고 좌석도 넓었습니다.' },
      { type: 'image', uploadToken: b.token },
    ],
    fs
  );
  assert.deepEqual(plan!.blocks.map((x) => x.type), ['TEXT', 'IMAGE', 'TEXT', 'IMAGE']);
  assert.deepEqual(plan!.blocks.map((x) => x.sortOrder), [0, 1, 2, 3]);
  assert.deepEqual(plan!.newImages.map((x) => [x.path, x.sortOrder]), [
    [a.path, 0],
    [b.path, 1],
  ]);
  assert.equal(plan!.content, '생각보다 사람이 많지 않았어요.\n\n내부는 이런 분위기였고 좌석도 넓었습니다.');
});

test('4·5. image-text-image, image-image-text 모두 허용', async () => {
  for (const shape of [
    ['image', 'text', 'image'],
    ['image', 'image', 'text'],
    ['text', 'text', 'image'],
  ]) {
    const fs = fakeStorage();
    const blocks = shape.map((t) => (t === 'text' ? { type: 'text', text: '여기는 입구예요.' } : { type: 'image', uploadToken: uploaded(fs).token }));
    const { res, plan } = await createWith(blocks, fs);
    assert.equal(res.status, 200, shape.join('-'));
    assert.deepEqual(plan!.blocks.map((b) => b.type.toLowerCase()), shape);
  }
});

// ── 8–13. 한도 ────────────────────────────────────────────────────────────────

test('8·9·28. 사진 최대 5장, 6번째 거부(생성·수정·편집기 모두)', async () => {
  const fs = fakeStorage();
  const five = Array.from({ length: 5 }, () => ({ type: 'image', uploadToken: uploaded(fs).token }));
  assert.equal((await createWith(five, fs)).res.status, 200);
  const six = [...five, { type: 'image', uploadToken: uploaded(fs).token }];
  const r6 = await createWith(six, fs);
  assert.equal(r6.res.status, 400);
  assert.deepEqual(r6.res.body, { success: false, error: BLOCK_ERROR_MESSAGES.TOO_MANY_IMAGES });

  let editor: EditorBlock[] = [];
  const ins = insertImagePlaceholders(editor, 0, ['k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
  assert.deepEqual([ins.accepted.length, ins.rejected], [5, 1]);
  editor = ins.blocks;
  assert.equal(insertImagePlaceholders(editor, 0, ['k7']).accepted.length, 0);
});

test('10. 블록 25개 초과 거부', () => {
  const ok = normalizeBlocks(Array.from({ length: MAX_CONTENT_BLOCKS }, (_, i) => ({ type: 'text', text: `문단 ${i}` })));
  assert.ok(ok.ok);
  const over = normalizeBlocks(Array.from({ length: MAX_CONTENT_BLOCKS + 1 }, (_, i) => ({ type: 'text', text: `문단 ${i}` })));
  assert.deepEqual(over, { ok: false, status: 400, error: BLOCK_ERROR_MESSAGES.TOO_MANY_BLOCKS });
});

test('11·12. 블록당 10,000자, 합계 20,000자 초과 거부', () => {
  assert.ok(normalizeBlocks([{ type: 'text', text: 'a'.repeat(MAX_TEXT_BLOCK_CHARS) }]).ok);
  assert.deepEqual(normalizeBlocks([{ type: 'text', text: 'a'.repeat(MAX_TEXT_BLOCK_CHARS + 1) }]), { ok: false, status: 400, error: BLOCK_ERROR_MESSAGES.TEXT_BLOCK_TOO_LONG });
  assert.ok(normalizeBlocks([{ type: 'text', text: 'a'.repeat(10_000) }, { type: 'text', text: 'b'.repeat(10_000) }]).ok);
  assert.deepEqual(
    normalizeBlocks([{ type: 'text', text: 'a'.repeat(10_000) }, { type: 'text', text: 'b'.repeat(10_000) }, { type: 'text', text: 'c' }]),
    { ok: false, status: 400, error: BLOCK_ERROR_MESSAGES.TEXT_TOTAL_TOO_LONG }
  );
  assert.equal(MAX_TEXT_TOTAL_CHARS, 20_000);
});

test('13. 빈 텍스트 블록은 저장 시 제거, 전부 비면 거부(공백·줄바꿈·전각 공백 포함)', () => {
  const r = normalizeBlocks([{ type: 'text', text: '  \n\t ' }, { type: 'text', text: '　' }, { type: 'text', text: '\n진짜 내용\n' }, { type: 'text', text: '' }]);
  assert.ok(r.ok);
  assert.deepEqual(r.blocks, [{ type: 'text', text: '진짜 내용' }]);
  assert.deepEqual(normalizeBlocks([{ type: 'text', text: ' \n ' }]), { ok: false, status: 400, error: BLOCK_ERROR_MESSAGES.EMPTY });
  assert.deepEqual(normalizeBlocks([]), { ok: false, status: 400, error: BLOCK_ERROR_MESSAGES.EMPTY });
  const editor: EditorBlock[] = [
    { key: 'a', kind: 'text', text: '   ' },
    { key: 'b', kind: 'text', text: '내용' },
  ];
  assert.deepEqual(buildBlocksPayload(editor, new Map()), [{ type: 'text', text: '내용' }]);
  assert.ok(!precheckBlocks([{ key: 'a', kind: 'text', text: '' }]).ok);
});

// ── 14–16. 편집기 조작 ─────────────────────────────────────────────────────────

test('14·15·16. 블록 이동(텍스트·사진 동일), 텍스트 삭제, 사진 삭제 — 로컬 상태만', () => {
  let b: EditorBlock[] = [];
  b = insertTextBlock(b, 0, 't1');
  b = updateTextBlock(b, 't1', '첫 글');
  b = insertImagePlaceholders(b, 1, ['i1']).blocks;
  b = insertTextBlock(b, 2, 't2');
  assert.deepEqual(b.map((x) => x.key), ['t1', 'i1', 't2']);

  b = moveBlock(b, 'i1', -1);
  assert.deepEqual(b.map((x) => x.key), ['i1', 't1', 't2']);
  assert.equal(moveBlock(b, 'i1', -1), b, '맨 위에서 위로는 그대로');
  b = moveBlock(b, 't1', 1);
  assert.deepEqual(b.map((x) => x.key), ['i1', 't2', 't1']);

  b = removeBlock(b, 't2');
  assert.deepEqual(b.map((x) => x.key), ['i1', 't1']);
  b = removeBlock(b, 'i1');
  assert.deepEqual(b.map((x) => x.key), ['t1']);

  // 사진 여러 장을 선택하면 선택 순서대로 그 위치에 들어간다.
  const many = insertImagePlaceholders([{ key: 't', kind: 'text', text: 'x' }], 1, ['p1', 'p2', 'p3']).blocks;
  assert.deepEqual(many.map((x) => x.key), ['t', 'p1', 'p2', 'p3']);
  const resolved = resolveImageBlock(many, 'p2', { status: 'ready', source: 'existing', imageId: 'img', url: 'u', width: 1, height: 1 });
  assert.equal((resolved[2] as Extract<EditorBlock, { kind: 'image' }>).image.status, 'ready');

  // COMMUNITY_EDITOR_V2.1 — 편집 화면은 단순 인라인 작성기로 바뀌었다(같은 상태 함수 사용).
  const editorSrc = codeOf(read('src/components/community/SimpleInlineComposer.tsx'));
  assert.ok(!/fetch\(/.test(editorSrc), '편집기 조작 중 서버 요청이 있으면 안 된다');
});

// ── 17–18. legacy ──────────────────────────────────────────────────────────────

const LEGACY_IMAGES: StoredImageRef[] = [
  { id: 'img2', path: 'posts/u/s/2.webp', width: 1200, height: 1600, sortOrder: 1 },
  { id: 'img1', path: 'posts/u/s/1.webp', width: 1200, height: 1600, sortOrder: 0 },
];
const pub = (p: string) => `https://cdn/${p}`;

test('17. legacy V1 글(블록 0개) → [TEXT(content), 사진 sortOrder 순] 같은 렌더러 입력', () => {
  const views = toContentBlockViews({ content: '광복 롯데 애슐리 다녀왔어요', images: LEGACY_IMAGES, blocks: [] }, pub);
  assert.deepEqual(views, [
    { type: 'text', text: '광복 롯데 애슐리 다녀왔어요' },
    { type: 'image', imageId: 'img1', url: 'https://cdn/posts/u/s/1.webp', width: 1200, height: 1600 },
    { type: 'image', imageId: 'img2', url: 'https://cdn/posts/u/s/2.webp', width: 1200, height: 1600 },
  ]);
  assert.deepEqual(toContentBlockViews({ content: '   ', images: LEGACY_IMAGES.slice(0, 1), blocks: [] }, pub).map((v) => v.type), ['image']);
  // V2 글은 저장된 블록 순서(사진 먼저)
  const v2: StoredBlockRef[] = [
    { type: 'TEXT', text: '내부 분위기', postImageId: null, sortOrder: 1 },
    { type: 'IMAGE', text: null, postImageId: 'img2', sortOrder: 0 },
  ];
  assert.deepEqual(toContentBlockViews({ content: '내부 분위기', images: LEGACY_IMAGES, blocks: v2 }, pub).map((v) => (v.type === 'text' ? v.text : v.imageId)), ['img2', '내부 분위기']);
});

test('18. legacy 글 수정: adapter 순서로 불러와 그대로 저장하면 결정적 블록([TEXT, 사진1, 사진2])이 된다', async () => {
  const views = toContentBlockViews({ content: '기존 글', images: LEGACY_IMAGES, blocks: [] }, pub);
  let k = 0;
  const editor = editorBlocksFromViews(views, () => `k${++k}`);
  const payload = buildBlocksPayload(editor, new Map());
  assert.deepEqual(payload, [
    { type: 'text', text: '기존 글' },
    { type: 'image', existingImageId: 'img1' },
    { type: 'image', existingImageId: 'img2' },
  ]);
  const { res, plan } = await editWith({ blocks: payload, post: legacyPost() });
  assert.equal(res.status, 200);
  assert.deepEqual(plan!.blocks, [
    { sortOrder: 0, type: 'TEXT', text: '기존 글' },
    { sortOrder: 1, type: 'IMAGE', image: { kind: 'existing', id: 'img1' } },
    { sortOrder: 2, type: 'IMAGE', image: { kind: 'existing', id: 'img2' } },
  ]);
  assert.deepEqual(plan!.retainedImages, [
    { id: 'img1', sortOrder: 0 },
    { id: 'img2', sortOrder: 1 },
  ]);
  assert.deepEqual(plan!.removedImages, []);
});

// ── 수정 헬퍼 ──────────────────────────────────────────────────────────────────

const UPDATED_AT = new Date('2026-09-14T06:35:06.802Z');

function legacyPost(): EditablePost {
  return {
    id: 'post1',
    authorId: OWNER,
    updatedAt: new Date(UPDATED_AT),
    images: [
      { id: 'img1', path: `posts/${OWNER}/${SESSION}/aaaaaaaa-bbbb-4ccc-8ddd-900000000001.webp` },
      { id: 'img2', path: `posts/${OWNER}/${SESSION}/aaaaaaaa-bbbb-4ccc-8ddd-900000000002.webp` },
    ],
  };
}

async function editWith(opts: {
  blocks: unknown;
  post?: EditablePost | null;
  auth?: AuthResult;
  expected?: unknown;
  fs?: ReturnType<typeof fakeStorage>;
  persist?: (id: string, expected: Date, plan: WritePlan) => Promise<void>;
  isAdmin?: (u: SessionUser) => boolean;
}) {
  const fs = opts.fs ?? fakeStorage();
  let plan: WritePlan | null = null;
  const logs: string[] = [];
  const res = await handleEditBlockPost(
    { auth: opts.auth ?? authOf(OWNER), post: opts.post === undefined ? legacyPost() : opts.post, title: '수정한 제목', blocks: opts.blocks, expectedUpdatedAt: opts.expected ?? UPDATED_AT.toISOString() },
    {
      verify,
      storage: fs.storage,
      log: (m) => void logs.push(m),
      isAdmin: opts.isAdmin ?? ((u) => u.id === ADMIN),
      persistEdit: async (id, expected, p) => {
        plan = p;
        fs.calls.push('db.commit');
        if (opts.persist) await opts.persist(id, expected, p);
      },
    }
  );
  return { res, plan: plan as WritePlan | null, fs, logs };
}

// ── 19–24. 권한 ────────────────────────────────────────────────────────────────

test('19·20. 작성자 수정 가능, 다른 사용자 403(DB·Storage 손대지 않음)', async () => {
  const blocks = [{ type: 'text', text: '수정' }];
  assert.equal((await editWith({ blocks })).res.status, 200);
  const other = await editWith({ blocks, auth: authOf(OTHER) });
  assert.equal(other.res.status, 403);
  assert.equal(other.plan, null);
  assert.deepEqual(other.fs.calls, []);
  assert.equal((await editWith({ blocks, auth: { error: '로그인이 필요합니다.', status: 401, user: null } })).res.status, 401);
  assert.equal((await editWith({ blocks, post: null })).res.status, 404);
});

test('21·22. 관리자 수정: role ADMIN과 ADMIN_EMAIL 둘 다 서버 규칙(isAdminSessionUser)으로 허용', async () => {
  const blocks = [{ type: 'text', text: '관리자 수정' }];
  const prev = process.env.ADMIN_EMAIL;
  process.env.ADMIN_EMAIL = 'ops@example.com';
  try {
    const byRole = await editWith({ blocks, auth: authOf('someAdmin', { role: 'ADMIN' }), isAdmin: (u) => isAdminSessionUser(u) });
    assert.equal(byRole.res.status, 200);
    const byEmail = await editWith({ blocks, auth: authOf('emailAdmin', { role: 'USER', email: 'OPS@example.com' }), isAdmin: (u) => isAdminSessionUser(u) });
    assert.equal(byEmail.res.status, 200);
    const notAdmin = await editWith({ blocks, auth: authOf('user9', { role: 'USER', email: 'x@example.com' }), isAdmin: (u) => isAdminSessionUser(u) });
    assert.equal(notAdmin.res.status, 403);
  } finally {
    if (prev === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = prev;
  }
  const route = codeOf(read('src/app/api/community/posts/[id]/route.ts'));
  assert.ok(/isAdmin: \(u\) => isAdminSessionUser\(u as \{ role\?: string \| null; email\?: string \| null \}\)/.test(route));
});

test('23. UI 관리자 판정 = 서버 규칙: 세션 isAdmin(isAdminSessionUser로 계산)만 사용, role 직접 비교 없음', () => {
  const detail = codeOf(read('src/app/community/[id]/post-client.tsx'));
  assert.ok(/const isAdmin = session\?\.user\?\.isAdmin === true;/.test(detail));
  assert.ok(!/session\?\.user\?\.role === 'ADMIN'/.test(detail));
  assert.ok(/\(isOwner \|\| isAdmin\) && \(\s*<Link href=\{`\/community\/\$\{postId\}\/edit`\}/.test(detail), '수정 버튼');
  const edit = codeOf(read('src/app/community/[id]/edit/page.tsx'));
  assert.ok(/session\?\.user\?\.id === post\.authorId \|\| session\?\.user\?\.isAdmin === true/.test(edit));
  const auth = read('src/lib/auth.ts');
  assert.ok(/\.isAdmin = isAdminSessionUser\(/.test(auth), '세션 isAdmin이 서버 규칙으로 계산되지 않는다');
});

test('24. 차단 계정: 수정 요청은 requireUser(403)를 거친다 — 핸들러도 auth 오류를 그대로 반환', async () => {
  const banned = await editWith({ blocks: [{ type: 'text', text: 'x' }], auth: { error: '커뮤니티 이용이 제한된 계정입니다.', status: 403, user: null } });
  assert.equal(banned.res.status, 403);
  const route = codeOf(read('src/app/api/community/posts/[id]/route.ts'));
  const patch = route.slice(route.indexOf('export async function PATCH'), route.indexOf('export async function DELETE'));
  assert.ok(/await requireUser\(\)/.test(patch));
  assert.ok(patch.indexOf('requireUser') < patch.indexOf('handleEditBlockPost'));
});

// ── 25–29. 사진 수명주기 ────────────────────────────────────────────────────────

test('25·26·27. 유지·새 사진·제거 분류와 순번 — 제거 사진은 DB 커밋 후에만 Storage 삭제', async () => {
  const fs = fakeStorage();
  const fresh = uploaded(fs);
  const post = legacyPost();
  const { res, plan } = await editWith({
    fs,
    post,
    blocks: [
      { type: 'image', uploadToken: fresh.token },
      { type: 'text', text: '여기는 입구예요.' },
      { type: 'image', existingImageId: 'img2' },
      { type: 'text', text: '내부는 이런 분위기입니다.' },
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(plan!.retainedImages, [{ id: 'img2', sortOrder: 1 }]);
  assert.deepEqual(plan!.newImages.map((n) => [n.path, n.sortOrder]), [[fresh.path, 0]]);
  assert.deepEqual(plan!.removedImages, [{ id: 'img1', path: post.images[0].path }]);
  assert.deepEqual(fs.calls, ['db.commit', 'storage.remove']);
  assert.deepEqual(fs.removed, [[post.images[0].path]]);
  assert.deepEqual((res.body as { data: unknown }).data, { id: 'post1', imageCleanup: 'done' });
});

test('28·29. 다른 글/다른 사용자 사진 거부, 같은 사진 중복 거부, 남의 영수증 거부', async () => {
  const foreign = await editWith({ blocks: [{ type: 'image', existingImageId: 'imgFromAnotherPost' }] });
  assert.equal(foreign.res.status, 400);
  assert.equal(foreign.plan, null);
  const dup = await editWith({ blocks: [{ type: 'image', existingImageId: 'img1' }, { type: 'image', existingImageId: 'img1' }] });
  assert.equal(dup.res.status, 400);
  const fs = fakeStorage();
  const theirs = uploaded(fs, OTHER);
  const stolen = await editWith({ fs, blocks: [{ type: 'image', uploadToken: theirs.token }] });
  assert.equal(stolen.res.status, 403);
  const created = await createWith([{ type: 'image', existingImageId: 'img1' }]);
  assert.equal(created.res.status, 400, '새 글에 기존 사진 id를 끼워 넣을 수 없다');
  assert.deepEqual(normalizeBlocks([{ type: 'image', existingImageId: 'x', uploadToken: 'y' }]).ok, false);
  assert.deepEqual(normalizeBlocks([{ type: 'image', existingImageId: '../posts/a' }]).ok, false);
  assert.deepEqual(normalizeBlocks([{ type: 'image', path: 'posts/u/s/x.webp' }]).ok, false, '임의 경로 필드는 받지 않는다');
});

// ── 30–33. 동시 수정·실패 ──────────────────────────────────────────────────────

test('30. 동시 수정: 시작 버전이 다르면 409, 트랜잭션 안의 조건부 갱신이 0행이어도 409', async () => {
  const early = await editWith({ blocks: [{ type: 'text', text: 'x' }], expected: '2026-09-14T06:00:00.000Z' });
  assert.equal(early.res.status, 409);
  assert.deepEqual(early.res.body, { success: false, error: EDIT_ERROR_MESSAGES.STALE });
  assert.equal(early.plan, null);

  const fs = fakeStorage();
  const fresh = uploaded(fs);
  const race = await editWith({ fs, blocks: [{ type: 'image', uploadToken: fresh.token }], persist: async () => { throw new StaleEditError(); } });
  assert.equal(race.res.status, 409);
  assert.deepEqual(fs.removed, [[fresh.path]], '경합으로 실패하면 새 업로드만 정리');

  assert.equal((await editWith({ blocks: [{ type: 'text', text: 'x' }], expected: 'not-a-date' })).res.status, 400);
  const db = codeOf(read('src/lib/community/post-write-db.ts'));
  assert.ok(/tx\.post\.updateMany\(\{ where: \{ id: postId, updatedAt: expectedUpdatedAt \}/.test(db));
  assert.ok(/if \(updated\.count !== 1\) throw new StaleEditError\(\)/.test(db));
});

test('31·32. DB 갱신 실패: 기존 글·기존 사진 Storage는 그대로, 이번에 올린 새 사진만 정리', async () => {
  const fs = fakeStorage();
  const post = legacyPost();
  post.images.forEach((img) => fs.objects.add(img.path));
  const fresh = uploaded(fs);
  const snapshot = JSON.stringify(post);
  const { res, logs } = await editWith({
    fs,
    post,
    blocks: [{ type: 'image', uploadToken: fresh.token }],
    persist: async () => {
      throw new Error('db down');
    },
  });
  assert.equal(res.status, 500);
  assert.equal(JSON.stringify(post), snapshot);
  assert.deepEqual(fs.removed, [[fresh.path]]);
  assert.ok(post.images.every((img) => fs.objects.has(img.path)), '기존 사진 객체가 지워졌다');
  assert.ok(logs.some((m) => m.includes('edit transaction failed')));
});

test('33. 제거 사진 Storage 삭제 실패: 1회 재시도 후 orphan 로그, 수정 자체는 성공(pending)', async () => {
  const fs = fakeStorage({ failRemove: 5 });
  const { res, logs } = await editWith({ fs, blocks: [{ type: 'text', text: '사진 전부 뺌' }] });
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { data: unknown }).data, { id: 'post1', imageCleanup: 'pending' });
  assert.equal(fs.removed.length, 2);
  assert.ok(logs.some((m) => m.startsWith('[community-image-orphan]')));
  const db = codeOf(read('src/lib/community/post-write-db.ts'));
  assert.ok(!/storage|Storage/.test(db.replace(/Storage는 여기서 만지지 않는다/, '')), '트랜잭션 모듈이 Storage를 만지면 안 된다');
  const editFn = db.slice(db.indexOf('export async function persistEditBlockPost'));
  const order = ['postContentBlock.deleteMany', 'postImage.deleteMany', 'postImage.create', 'postContentBlock.createMany'].map((s) => editFn.indexOf(s));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), '블록 삭제 → 사진 삭제 → 새 사진 → 블록 생성 순서');
});

// ── 34·36·37·38. 읽기·파생·XSS ─────────────────────────────────────────────────

test('34. 익명 상세 읽기: GET은 세션 없이 blocks(렌더 뷰)를 내보내고 사진은 url/width/height만', () => {
  const route = codeOf(read('src/app/api/community/posts/[id]/route.ts'));
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function PATCH'));
  assert.ok(!/requireUser|getCurrentUser/.test(get));
  assert.ok(/blocks: \{ orderBy: \{ sortOrder: 'asc' \}, select: \{ type: true, text: true, postImageId: true, sortOrder: true \} \}/.test(get));
  assert.ok(/blocks: toContentBlockViews\(/.test(get));
  assert.ok(!/bytes: true|mimeType: true/.test(get));
});

test('36·37. 파생 평문과 SEO description: 텍스트 블록만 빈 줄로 연결, 사진만 있으면 제목', () => {
  assert.equal(deriveContentText([{ type: 'image' }, { type: 'text', text: 'A' }, { type: 'image' }, { type: 'text', text: 'B' }]), 'A\n\nB');
  assert.equal(buildPostDescription('A\n\nB', '제목'), 'A B');
  assert.equal(buildPostDescription('', '사진만 있는 글'), '사진만 있는 글');
  assert.equal(buildPostDescription('x'.repeat(300), 't').length, 120);
  const page = codeOf(read('src/app/community/[id]/page.tsx'));
  assert.ok(/const description = buildPostDescription\(post\.content, post\.title\)/.test(page));
  assert.ok(!/\.blocks\b|blocks:|select: \{[^}]*blocks/.test(page), '메타데이터에 블록 구조를 노출하지 않는다');
  assert.ok(/select: \{ title: true, content: true \}/.test(page));
});

test('38. HTML/스크립트 문자열은 텍스트로만 저장·렌더(해석·주입 경로 없음)', () => {
  const xss = '<img src=x onerror=alert(1)><script>alert(1)</script>';
  const r = normalizeBlocks([{ type: 'text', text: xss }]);
  assert.ok(r.ok);
  assert.deepEqual(r.blocks, [{ type: 'text', text: xss }]);
  const renderer = codeOf(read('src/components/community/CommunityPostContent.tsx'));
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(renderer));
  assert.ok(/\{block\.text\}/.test(renderer));
  for (const f of ['src/components/community/SimpleInlineComposer.tsx', 'src/app/community/[id]/post-client.tsx', 'src/app/community/[id]/edit/page.tsx']) {
    assert.ok(!/dangerouslySetInnerHTML/.test(read(f)), f);
  }
});

// ── 39. 목록 ───────────────────────────────────────────────────────────────────

test('39. 목록 API는 블록·사진을 조회하지 않는다(UI·payload 불변)', () => {
  const route = codeOf(read('src/app/api/community/posts/route.ts'));
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  assert.ok(!/blocks|images/.test(get));
});

// ── 40–42. migration ───────────────────────────────────────────────────────────

test('40. migration: 새 테이블만 API 역할 grant 회수 + RLS, policy·GRANT 없음, 기존 테이블 권한 불변', () => {
  const sql = read('prisma/migrations/20260914120000_community_content_blocks_v2/migration.sql').replace(/^--.*$/gm, '');
  assert.ok(/CREATE TABLE "post_content_blocks"/.test(sql));
  assert.ok(/REVOKE ALL ON TABLE "post_content_blocks" FROM %I/.test(sql));
  assert.ok(/ARRAY\['anon', 'authenticated', 'service_role'\]/.test(sql));
  assert.ok(/ALTER TABLE "post_content_blocks" ENABLE ROW LEVEL SECURITY/.test(sql));
  assert.ok(!/\bGRANT\b|CREATE POLICY|\bDROP\b|\bDELETE FROM\b|\bUPDATE "/i.test(sql));
  const alters = sql.match(/ALTER TABLE "([a-z_]+)"/g) || [];
  assert.ok(alters.every((a) => a.includes('"post_content_blocks"')), '다른 테이블을 ALTER하지 않는다');
  assert.ok(/CREATE UNIQUE INDEX "post_images_id_post_id_key" ON "post_images"\("id", "post_id"\)/.test(sql), 'post_images에는 인덱스만 추가');
  const fix = read('prisma/migrations/20260914130000_community_content_blocks_v2_text_check/migration.sql').replace(/^--.*$/gm, '');
  assert.ok(/"text" ~ '\[\^\[:space:\]\]'/.test(fix), 'TEXT 공백만 금지 CHECK 보정');
  assert.ok(!/\bGRANT\b|DISABLE ROW LEVEL SECURITY/i.test(fix));
});

test('41·42. cascade·같은 글 FK: 복합 FK(NO ACTION) + 글 cascade, schema relation 일치', () => {
  const sql = read('prisma/migrations/20260914120000_community_content_blocks_v2/migration.sql');
  assert.ok(/FOREIGN KEY \("post_image_id", "post_id"\) REFERENCES "post_images"\("id", "post_id"\) ON DELETE NO ACTION/.test(sql));
  assert.ok(/FOREIGN KEY \("post_id"\) REFERENCES "posts"\("id"\) ON DELETE CASCADE/.test(sql));
  assert.ok(/CREATE UNIQUE INDEX "post_content_blocks_post_image_id_post_id_key"/.test(sql));
  assert.ok(/CREATE UNIQUE INDEX "post_content_blocks_post_id_sort_order_key"/.test(sql));
  const schema = read('prisma/schema.prisma');
  assert.ok(/image PostImage\? @relation\(fields: \[postImageId, postId\], references: \[id, postId\], onDelete: NoAction\)/.test(schema));
  const verifyScript = read('scripts/community/verify-content-block-constraints.ts');
  for (const name of ['another post image rejected', 'same image in two blocks rejected', 'post delete cascades images + blocks', 'deleting an image still used by a block rejected']) {
    assert.ok(verifyScript.includes(name), `DB 실동작 검증 케이스 누락: ${name}`);
  }
});

// ── 추가: 모바일·이탈 경고·배선 ────────────────────────────────────────────────

test('모바일 CSS 계약: 입력 16px·폭 100%·넘침 방지, 조작 버튼 44px, 미리보기 원본 비율', () => {
  const css = read('src/components/community/SimpleInlineComposer.module.css');
  const rule = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
  assert.ok(/font-size: 16px/.test(rule('.textarea')) && /width: 100%/.test(rule('.textarea')) && /box-sizing: border-box/.test(rule('.textarea')));
  assert.ok(/width: 44px/.test(rule('.control')) && /height: 44px/.test(rule('.control')));
  assert.ok(/min-height: 44px/.test(rule('.photoButton')));
  assert.ok(/object-fit: contain/.test(rule('.image')) && /height: auto/.test(rule('.image')));
  assert.ok(/min-width: 0/.test(rule('.body')) && /min-width: 0/.test(rule('.imageCard')));
});

test('이탈 경고: beforeunload·링크 클릭·뒤로 가기(popstate) + 저장 성공 시 해제 후 replace', () => {
  const guard = codeOf(read('src/lib/community/use-leave-guard.ts'));
  assert.ok(/addEventListener\('beforeunload'/.test(guard));
  assert.ok(/document\.addEventListener\('click', onClick, true\)/.test(guard));
  assert.ok(/addEventListener\('popstate'/.test(guard));
  assert.ok(/\.\.\.\(window\.history\.state \?\? \{\}\)/.test(guard), 'Next 내부 history state 보존');
  for (const f of ['src/app/community/write/page.tsx', 'src/app/community/[id]/edit/page.tsx']) {
    const src = codeOf(read(f));
    assert.ok(/useLeaveGuard\(dirty \|\| submitting\)/.test(src), f);
    assert.ok(/release\(\);[\s\S]{0,400}router\.replace\(/.test(src), f);
    assert.ok(/requestLeave\(\(\) => router\.back\(\)\)/.test(src), f);
  }
});

test('수정 저장 후 상세 캐시 갱신: 이동 전에 SWR 캐시를 다시 받아 수정 전 내용이 보이지 않는다(Production QA 회귀)', () => {
  const edit = codeOf(read('src/app/community/[id]/edit/page.tsx'));
  assert.ok(/const \{ mutate \} = useSWRConfig\(\);/.test(edit));
  const save = edit.slice(edit.indexOf('if (result.ok) {'));
  // 데이터 없이 mutate(key)만 부르면 언마운트된 상세 캐시는 갱신되지 않는다(SWR 2.5 internalMutate: args.length < 3 → 마운트된 훅만).
  // 반드시 새로 받은 글을 데이터로 넣어야 한다.
  assert.ok(/const detailKey = `\/api\/community\/posts\/\$\{post\.id\}`;/.test(save));
  assert.ok(/await mutate\(\s*detailKey,\s*fetch\(detailKey, \{ cache: 'no-store' \}\)\.then\(\(res\) => res\.json\(\)\),\s*\{ revalidate: false \}\s*\)/.test(save), '캐시에 최신 데이터를 직접 넣어야 한다');
  const m = save.indexOf('await mutate(');
  const r = save.indexOf('router.replace(`/community/${post.id}`)');
  assert.ok(m > 0 && r > m, '캐시 갱신이 이동보다 먼저여야 한다');
  const detail = codeOf(read('src/app/community/[id]/post-client.tsx'));
  assert.ok(/useSWR\(`\/api\/community\/posts\/\$\{postId\}`, fetcher\)/.test(detail), '상세 SWR 키가 바뀌면 캐시 갱신 키도 같이 바꿔야 한다');
});

test('편집 스냅샷: 내용이 같으면 dirty 아님, 순서만 바꿔도 dirty', () => {
  const a: EditorBlock[] = [
    { key: '1', kind: 'text', text: 'A' },
    { key: '2', kind: 'image', image: { status: 'ready', source: 'existing', imageId: 'img', url: 'u', width: 1, height: 1 } },
  ];
  assert.equal(editorSnapshot('t', a), editorSnapshot('t', a.map((b) => ({ ...b }))));
  assert.notEqual(editorSnapshot('t', a), editorSnapshot('t', [a[1], a[0]]));
});

test('관련 단지는 수정 API에서 읽지 않는다(정책 유지), 수정 화면은 표시만', () => {
  const route = codeOf(read('src/app/api/community/posts/[id]/route.ts'));
  const patch = route.slice(route.indexOf('export async function PATCH'), route.indexOf('export async function DELETE'));
  assert.ok(!/aptName/.test(patch));
  const edit = codeOf(read('src/app/community/[id]/edit/page.tsx'));
  assert.ok(!/ApartmentAutocomplete|setAptName/.test(edit));
  const submit = codeOf(read('src/lib/community/submit-block-post.ts'));
  const editBody = submit.slice(submit.indexOf("method: 'PATCH'"), submit.indexOf(": await fetchImpl('/api/community/posts'"));
  assert.ok(!/aptName/.test(editBody));
});
