import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  MAX_IMAGES_PER_POST,
  MAX_SOURCE_BYTES,
  MAX_STORED_BYTES,
  STORED_MAX_EDGE,
  buildImagePath,
  checkSourceImage,
  checkStoredImage,
  fitWithin,
  isOwnedImagePath,
  parseImagePath,
  sniffImage,
} from './image-rules';
import { PrepareImageError, prepareImage, type DecodedImage, type ImageCodec } from './image-compress';
import {
  cleanupAfterFailedPostCreate,
  deletePostWithImages,
  handleImageSessionCleanup,
  handleImageUpload,
  resolvePostImages,
  type AuthResult,
  type ImageHandlerDeps,
} from './image-handlers';
import { createCommunityImageStorage, type CommunityImageStorage } from './image-storage-core';
import { deriveUploadTokenKey, signUploadReceipt, verifyUploadReceipt, type UploadReceipt } from './image-upload-token';

/**
 * COMMUNITY_IMAGE_UPLOAD_V1 — 게시글 사진 업로드/표시/삭제 계약.
 * 브라우저·Storage·DB는 fake로 주입하고, 라우트 배선은 소스 검사로 고정한다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 실제 형식 헤더 빌더 ────────────────────────────────────────────────────────

function jpeg(width: number, height: number, opts: { exif?: boolean; pad?: number } = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  parts.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);
  if (opts.exif) parts.push(0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08);
  parts.push(0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);
  const out = new Uint8Array(parts.length + (opts.pad ?? 0) + 2);
  out.set(parts);
  out.set([0xff, 0xd9], out.length - 2);
  return out;
}

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  b.set([8, 6, 0, 0, 0], 24);
  return b;
}

function riff(chunks: Uint8Array): Uint8Array {
  const b = new Uint8Array(12 + chunks.length);
  b.set([0x52, 0x49, 0x46, 0x46]);
  new DataView(b.buffer).setUint32(4, 4 + chunks.length, true);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set(chunks, 12);
  return b;
}

function webpLossy(width: number, height: number): Uint8Array {
  const c = new Uint8Array(8 + 10 + 12);
  c.set([0x56, 0x50, 0x38, 0x20]);
  new DataView(c.buffer).setUint32(4, 22, true);
  c.set([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a], 8);
  new DataView(c.buffer).setUint16(14, width, true);
  new DataView(c.buffer).setUint16(16, height, true);
  return riff(c);
}

function webpExtended(width: number, height: number, exif: boolean): Uint8Array {
  const vp8x = new Uint8Array(18);
  vp8x.set([0x56, 0x50, 0x38, 0x58]);
  new DataView(vp8x.buffer).setUint32(4, 10, true);
  vp8x[8] = exif ? 0x08 : 0;
  const w = width - 1;
  const h = height - 1;
  vp8x.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 12);
  const body = webpLossy(width, height).subarray(12);
  const exifChunk = exif ? new Uint8Array([0x45, 0x58, 0x49, 0x46, 4, 0, 0, 0, 1, 2, 3, 4]) : new Uint8Array(0);
  const all = new Uint8Array(vp8x.length + body.length + exifChunk.length);
  all.set(vp8x);
  all.set(body, vp8x.length);
  all.set(exifChunk, vp8x.length + body.length);
  return riff(all);
}

const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');

// ── fakes ─────────────────────────────────────────────────────────────────────

const USER = 'cmuser0001';
const OTHER = 'cmuser0002';
const SESSION = '3f1c2b7a-9d4e-4c1a-8b2f-0a1b2c3d4e5f';
const authOk = (id = USER): AuthResult => ({ error: null, status: 200, user: { id } });
const KEY = deriveUploadTokenKey('test-secret');
const NOW = 1_800_000_000_000;

function fakeStorage(opts: { failRemove?: number; existing?: string[]; missing?: string[] } = {}) {
  const objects = new Set<string>(opts.existing ?? []);
  const calls = { upload: [] as string[], remove: [] as string[][] };
  let removeFailures = opts.failRemove ?? 0;
  const storage: CommunityImageStorage = {
    async upload(path) {
      calls.upload.push(path);
      objects.add(path);
    },
    async exists(path) {
      return objects.has(path) && !(opts.missing ?? []).includes(path);
    },
    async list(prefix) {
      return [...objects].filter((p) => p.startsWith(prefix));
    },
    async remove(paths) {
      calls.remove.push(paths);
      if (removeFailures > 0) {
        removeFailures--;
        throw new Error('boom');
      }
      paths.forEach((p) => objects.delete(p));
    },
    publicUrl: (path) => `https://proj.supabase.co/storage/v1/object/public/community-images/${path}`,
  };
  return { storage, calls, objects };
}

function deps(storage: CommunityImageStorage | null, extra: Partial<ImageHandlerDeps> = {}) {
  const logs: { message: string; meta?: Record<string, unknown> }[] = [];
  let n = 0;
  const d: ImageHandlerDeps = {
    storage,
    sign: (r) => signUploadReceipt(r, KEY),
    verify: (t) => verifyUploadReceipt(t, KEY, NOW),
    newUuid: () => `aaaaaaaa-bbbb-4ccc-8ddd-${String(++n).padStart(12, '0')}`,
    now: () => NOW,
    referencedPaths: async () => new Set(),
    log: (message, meta) => logs.push({ message, meta }),
    ...extra,
  };
  return { d, logs };
}

async function upload(d: ImageHandlerDeps, bytes: Uint8Array, auth = authOk()) {
  return handleImageUpload({ auth, sessionId: SESSION, contentLength: bytes.length, readBytes: async () => bytes }, d);
}

function fakeCodec(opts: { width: number; height: number; encodedSizes?: number[]; webpSupported?: boolean; decodeFails?: boolean }) {
  const encodes: { width: number; height: number; mimeType: string; quality: number }[] = [];
  let closed = 0;
  const sizes = [...(opts.encodedSizes ?? [300 * 1024])];
  const codec: ImageCodec = {
    async decode() {
      if (opts.decodeFails) throw new Error('decode');
      return { width: opts.width, height: opts.height, close: () => closed++ } as DecodedImage;
    },
    async encode(_img, width, height, mimeType, quality) {
      encodes.push({ width, height, mimeType, quality });
      const size = sizes.length > 1 ? sizes.shift()! : sizes[0];
      const type = mimeType === 'image/webp' && opts.webpSupported === false ? 'image/png' : mimeType;
      return new Blob([new Uint8Array(size)], { type });
    },
  };
  return { codec, encodes, closed: () => closed };
}

const file = (bytes: Uint8Array, type = 'image/jpeg') => new Blob([bytes as unknown as ArrayBuffer], { type });

// ── 1. 사진 없는 글 ────────────────────────────────────────────────────────────

test('1. 사진 없는 글: images가 없으면 검증·Storage를 전혀 거치지 않고 기존 생성 그대로', async () => {
  const r = await resolvePostImages({ userId: USER, images: undefined }, deps(null).d);
  assert.deepEqual(r, { ok: true, rows: [] });
  const route = codeOf(read('src/app/api/community/posts/route.ts'));
  assert.ok(/const imageDeps = body\.images == null \? null : buildImageHandlerDeps\(\)/.test(route));
  assert.ok(/\.\.\.\(imageRows\.length > 0 && \{ images: \{ create: imageRows \} \}\)/.test(route));
});

// ── 2/3/13. 1장·5장·로그인 업로드 ──────────────────────────────────────────────

test('2·13. 로그인 사용자 1장 업로드 → 서버가 경로를 정하고 서명 영수증을 돌려준다', async () => {
  const { storage, calls } = fakeStorage();
  const { d } = deps(storage);
  const res = await upload(d, webpLossy(1600, 1200));
  assert.equal(res.status, 200);
  assert.ok(res.body.success);
  const data = (res.body as { data: { path: string; url: string; width: number; height: number; mimeType: string; token: string } }).data;
  assert.equal(calls.upload.length, 1);
  assert.deepEqual([data.width, data.height, data.mimeType], [1600, 1200, 'image/webp']);
  assert.ok(data.url.includes('/object/public/community-images/posts/'));
  const rows = await resolvePostImages({ userId: USER, images: [{ token: data.token }] }, d);
  assert.ok(rows.ok);
  assert.equal(rows.rows.length, 1);
});

test('3·20. 5장 → 5행, sortOrder는 보낸 순서 그대로 0..4', async () => {
  const { storage } = fakeStorage();
  const { d } = deps(storage);
  const tokens: { token: string; path: string }[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await upload(d, jpeg(1000 + i, 800));
    const data = (res.body as { data: { token: string; path: string } }).data;
    tokens.push({ token: data.token, path: data.path });
  }
  const shuffled = [tokens[3], tokens[0], tokens[4], tokens[1], tokens[2]];
  const r = await resolvePostImages({ userId: USER, images: shuffled.map(({ token }) => ({ token })) }, d);
  assert.ok(r.ok);
  assert.deepEqual(r.rows.map((x) => x.path), shuffled.map((t) => t.path));
  assert.deepEqual(r.rows.map((x) => x.sortOrder), [0, 1, 2, 3, 4]);
  assert.deepEqual(r.rows.map((x) => x.width), [1003, 1000, 1004, 1001, 1002]);
});

// ── 4. 6번째 ───────────────────────────────────────────────────────────────────

test('4. 6번째 사진은 거부: 게시글 API(6개 토큰)와 업로드 API(세션에 이미 5장) 모두', async () => {
  assert.equal(MAX_IMAGES_PER_POST, 5);
  const { storage } = fakeStorage({ existing: Array.from({ length: 5 }, (_, i) => `posts/${USER}/${SESSION}/aaaaaaaa-bbbb-4ccc-8ddd-00000000009${i}.webp`) });
  const { d } = deps(storage);
  const six = await resolvePostImages({ userId: USER, images: Array.from({ length: 6 }, () => ({ token: 'x' })) }, d);
  assert.deepEqual(six, { ok: false, status: 400, error: '사진은 최대 5장까지 올릴 수 있어요.' });
  const res = await upload(d, jpeg(100, 100));
  assert.equal(res.status, 409);
});

// ── 5. 10MB ───────────────────────────────────────────────────────────────────

test('5. 원본 10MB 초과는 디코드 전에 거부, 서버는 1.5MB 초과 본문을 읽기 전에 거부', async () => {
  const { codec, encodes } = fakeCodec({ width: 100, height: 100 });
  const big = new Blob([new Uint8Array(MAX_SOURCE_BYTES + 1)], { type: 'image/jpeg' });
  await assert.rejects(prepareImage(big, codec), (e: unknown) => e instanceof PrepareImageError && e.code === 'TOO_LARGE');
  assert.equal(encodes.length, 0);

  const { storage, calls } = fakeStorage();
  let read = false;
  const res = await handleImageUpload({ auth: authOk(), sessionId: SESSION, contentLength: MAX_STORED_BYTES + 1, readBytes: async () => ((read = true), new Uint8Array(0)) }, deps(storage).d);
  assert.equal(res.status, 413);
  assert.equal(read, false);
  assert.equal(calls.upload.length, 0);
});

// ── 6/7/8. 형식 ────────────────────────────────────────────────────────────────

test('6. MIME을 믿지 않는다 — image/jpeg라고 선언한 임의 바이너리는 클라이언트·서버 모두 거부', async () => {
  const junk = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]);
  const { codec } = fakeCodec({ width: 10, height: 10 });
  await assert.rejects(prepareImage(file(junk, 'image/jpeg'), codec), (e: unknown) => e instanceof PrepareImageError && e.code === 'UNSUPPORTED');
  const { storage, calls } = fakeStorage();
  assert.equal((await upload(deps(storage).d, junk)).status, 415);
  assert.equal(calls.upload.length, 0);
  // 저장 형식에 PNG는 없다(클라이언트가 재인코딩) — 서버는 PNG 바이트를 받지 않는다.
  assert.equal((await upload(deps(storage).d, png(100, 100))).status, 415);
});

test('7. SVG 거부(클라이언트 사전 검사·서버·bucket MIME 목록)', async () => {
  const { codec } = fakeCodec({ width: 10, height: 10 });
  await assert.rejects(prepareImage(file(SVG, 'image/svg+xml'), codec), (e: unknown) => e instanceof PrepareImageError && e.code === 'UNSUPPORTED');
  assert.equal(sniffImage(SVG), null);
  const { storage } = fakeStorage();
  assert.equal((await upload(deps(storage).d, SVG)).status, 415);
  const rules = read('src/lib/community/image-rules.ts');
  assert.ok(!/svg/i.test(rules.match(/STORED_IMAGE_MIME_TYPES = \[[^\]]*\]/)![0]));
});

test('8. 손상 이미지 거부: SOF 없는 JPEG, 잘린 WebP, 헤더는 맞지만 디코드 실패', async () => {
  const noSof = jpeg(100, 100).subarray(0, 20);
  assert.equal(sniffImage(noSof), null);
  const truncated = webpLossy(100, 100).subarray(0, 26);
  assert.equal(sniffImage(truncated), null);
  const { codec, closed } = fakeCodec({ width: 100, height: 100, decodeFails: true });
  await assert.rejects(prepareImage(file(jpeg(100, 100)), codec), (e: unknown) => e instanceof PrepareImageError && e.code === 'UNSUPPORTED');
  assert.equal(closed(), 0);
});

// ── 9. 크기 한도 ───────────────────────────────────────────────────────────────

test('9. 픽셀 한도: 긴 변 12,000 초과·50MP 초과 원본은 디코드 전 거부, 서버는 긴 변 1600 초과 저장본 거부', async () => {
  assert.deepEqual(checkSourceImage(1000, sniffImage(jpeg(12001, 100))), { ok: false, code: 'UNSUPPORTED' });
  assert.deepEqual(checkSourceImage(1000, sniffImage(png(8000, 7000))), { ok: false, code: 'UNSUPPORTED' }); // 56MP
  assert.deepEqual(checkSourceImage(1000, sniffImage(jpeg(8160, 6120))), { ok: true }); // 49.9MP
  const { codec, encodes } = fakeCodec({ width: 50000, height: 50000 });
  await assert.rejects(prepareImage(file(webpExtended(50000, 50000, false), 'image/webp'), codec), PrepareImageError);
  assert.equal(encodes.length, 0);
  assert.deepEqual(checkStoredImage(jpeg(STORED_MAX_EDGE + 1, 900)), { ok: false, reason: 'DIMENSIONS' });
  assert.ok(checkStoredImage(jpeg(STORED_MAX_EDGE, 900)).ok);
});

// ── 10/11. 압축 ────────────────────────────────────────────────────────────────

test('10. 압축: 긴 변 1600으로 축소, WebP q0.80 → 800KB 초과면 q0.70 재인코딩, WebP 불가 브라우저는 JPEG q0.82', async () => {
  const a = fakeCodec({ width: 4032, height: 3024, encodedSizes: [900 * 1024, 500 * 1024] });
  const out = await prepareImage(file(jpeg(4032, 3024)), a.codec);
  assert.deepEqual(a.encodes.map((e) => [e.width, e.height, e.mimeType, e.quality]), [
    [1600, 1200, 'image/webp', 0.8],
    [1600, 1200, 'image/webp', 0.7],
  ]);
  assert.deepEqual([out.width, out.height, out.mimeType, out.bytes], [1600, 1200, 'image/webp', 500 * 1024]);
  assert.equal(a.closed(), 1);

  const b = fakeCodec({ width: 3024, height: 4032, webpSupported: false });
  const out2 = await prepareImage(file(jpeg(3024, 4032)), b.codec);
  assert.deepEqual(b.encodes.map((e) => [e.mimeType, e.quality]), [
    ['image/webp', 0.8],
    ['image/jpeg', 0.82],
  ]);
  assert.equal(out2.mimeType, 'image/jpeg');
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 }); // 확대하지 않는다
});

test('11. 재인코딩 후에도 1.5MB를 넘으면 거부', async () => {
  const { codec, closed } = fakeCodec({ width: 1600, height: 1600, encodedSizes: [MAX_STORED_BYTES + 1] });
  await assert.rejects(prepareImage(file(jpeg(1600, 1600)), codec), (e: unknown) => e instanceof PrepareImageError && e.code === 'TOO_LARGE');
  assert.equal(closed(), 1);
  assert.deepEqual(checkStoredImage(jpeg(100, 100, { pad: MAX_STORED_BYTES })), { ok: false, reason: 'TOO_LARGE' });
});

// ── 11b. 방향 / EXIF ───────────────────────────────────────────────────────────

test('11b·28. 방향·EXIF 계약: 디코드는 imageOrientation from-image, 결과는 항상 인코더 산출물, EXIF가 남은 저장본은 서버가 거부', async () => {
  const src = read('src/lib/community/image-compress.ts');
  assert.ok(/createImageBitmap\(blob, \{ imageOrientation: 'from-image' \}\)/.test(src));
  // 세로 사진(방향 보정 후 3024×4032)은 세로로 축소된다.
  const portrait = fakeCodec({ width: 3024, height: 4032, encodedSizes: [100] });
  const out = await prepareImage(file(jpeg(4032, 3024, { exif: true })), portrait.codec);
  assert.deepEqual([out.width, out.height], [1200, 1600]);
  // 작은 원본(축소 불필요)도 원본 바이트를 그대로 쓰지 않는다.
  const small = fakeCodec({ width: 800, height: 600, encodedSizes: [1234] });
  const smallSrc = file(jpeg(800, 600, { exif: true }));
  const smallOut = await prepareImage(smallSrc, small.codec);
  assert.equal(small.encodes.length, 1);
  assert.notEqual(smallOut.blob, smallSrc);
  assert.equal(smallOut.bytes, 1234);

  assert.deepEqual(checkStoredImage(jpeg(1600, 1200, { exif: true })), { ok: false, reason: 'EXIF' });
  assert.deepEqual(checkStoredImage(webpExtended(1600, 1200, true)), { ok: false, reason: 'EXIF' });
  assert.ok(checkStoredImage(webpExtended(1600, 1200, false)).ok);
});

// ── 12. 파일명 ─────────────────────────────────────────────────────────────────

test('12. 저장 경로: posts/{userId}/{session}/{uuid}.ext — 원본 파일명·이메일 없음, 매번 다른 UUID', async () => {
  const { storage, calls } = fakeStorage();
  const { d } = deps(storage);
  await upload(d, jpeg(10, 10));
  await upload(d, jpeg(10, 10));
  assert.equal(calls.upload.length, 2);
  assert.notEqual(calls.upload[0], calls.upload[1]);
  for (const p of calls.upload) {
    const parsed = parseImagePath(p);
    assert.ok(parsed, p);
    assert.equal(parsed.userId, USER);
    assert.equal(parsed.uploadSession, SESSION);
    assert.equal(parsed.ext, 'jpg');
  }
  assert.throws(() => buildImagePath('me@example.com', SESSION, SESSION, 'jpg'));
  assert.throws(() => buildImagePath(USER, 'photo.jpg', SESSION, 'jpg'));
  const deps2 = read('src/lib/supabase/community-image-deps.ts');
  assert.ok(/newUuid: \(\) => randomUUID\(\)/.test(deps2));
  assert.ok(!/file\.name|\.name\b.*path/.test(codeOf(read('src/app/community/write/page.tsx'))));
});

// ── 14/15. 비로그인·차단 ────────────────────────────────────────────────────────

test('14·15. 비로그인(401)·차단 계정(403)은 업로드 불가, Storage 호출 0', async () => {
  const { storage, calls } = fakeStorage();
  const anon = await upload(deps(storage).d, jpeg(10, 10), { error: '로그인이 필요합니다.', status: 401, user: null });
  const banned = await upload(deps(storage).d, jpeg(10, 10), { error: '커뮤니티 이용이 제한된 계정입니다.', status: 403, user: null });
  assert.equal(anon.status, 401);
  assert.equal(banned.status, 403);
  assert.equal(calls.upload.length, 0);
  const route = codeOf(read('src/app/api/community/images/route.ts'));
  assert.ok(/export async function POST[\s\S]*const auth = await requireUser\(\)/.test(route), '업로드는 requireUser(차단 포함)를 거쳐야 한다');
});

// ── 16. 소유권 ────────────────────────────────────────────────────────────────

test('16. 게시글에는 본인 영수증만: 남의 영수증 403, 위조·만료·중복 400, 정리된 객체 400', async () => {
  const { storage } = fakeStorage();
  const { d } = deps(storage);
  const mine = (await upload(d, jpeg(10, 10))).body as { data: { token: string; path: string } };
  const theirs = (await upload(d, jpeg(10, 10), authOk(OTHER))).body as { data: { token: string } };

  assert.equal((await resolvePostImages({ userId: USER, images: [{ token: theirs.data.token }] }, d)).ok, false);
  const r403 = await resolvePostImages({ userId: USER, images: [{ token: theirs.data.token }] }, d);
  assert.equal(!r403.ok && r403.status, 403);

  const forgedReceipt: UploadReceipt = { userId: USER, path: `posts/${USER}/${SESSION}/${SESSION}.jpg`, width: 1, height: 1, bytes: 1, mimeType: 'image/jpeg', exp: NOW + 1000 };
  const forged = signUploadReceipt(forgedReceipt, deriveUploadTokenKey('attacker-secret'));
  const rForged = await resolvePostImages({ userId: USER, images: [{ token: forged }] }, d);
  assert.equal(!rForged.ok && rForged.status, 400);

  const [body, sig] = mine.data.token.split('.');
  const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), width: 9999 })).toString('base64url');
  assert.equal(verifyUploadReceipt(`${tampered}.${sig}`, KEY, NOW), null);
  assert.equal(verifyUploadReceipt(mine.data.token, KEY, NOW + 7 * 60 * 60 * 1000), null);

  const dup = await resolvePostImages({ userId: USER, images: [{ token: mine.data.token }, { token: mine.data.token }] }, d);
  assert.equal(!dup.ok && dup.status, 400);

  const gone = fakeStorage({ missing: [mine.data.path] });
  await gone.storage.upload(mine.data.path, new Uint8Array(1), 'image/jpeg');
  const rGone = await resolvePostImages({ userId: USER, images: [{ token: mine.data.token }] }, deps(gone.storage).d);
  assert.equal(!rGone.ok && rGone.status, 400);

  assert.equal(isOwnedImagePath(mine.data.path, OTHER), false);
  assert.equal(isOwnedImagePath(`posts/${USER}/../${OTHER}/${SESSION}/${SESSION}.jpg`, USER), false);
});

// ── 17/19. 트랜잭션·생성 실패 정리 ─────────────────────────────────────────────

test('17·19. 글+사진 행은 nested create 한 번(단일 트랜잭션), 생성 실패 시 올린 사진을 지운다', async () => {
  const route = codeOf(read('src/app/api/community/posts/route.ts'));
  assert.equal((route.match(/prisma\.post\.create\(/g) || []).length, 1, 'post.create는 한 번이어야 한다');
  assert.ok(!/prisma\.postImage\.create/.test(route), '사진 행을 별도 쿼리로 만들면 원자성이 깨진다');
  assert.ok(/catch \(createError\)[\s\S]*cleanupAfterFailedPostCreate\(imageRows, imageDeps\)/.test(route));

  const { storage, calls, objects } = fakeStorage();
  const rows = [
    { path: `posts/${USER}/${SESSION}/aaaaaaaa-bbbb-4ccc-8ddd-000000000001.webp`, sortOrder: 0, width: 1, height: 1, bytes: 1, mimeType: 'image/webp' as const },
  ];
  objects.add(rows[0].path);
  await cleanupAfterFailedPostCreate(rows, deps(storage).d);
  assert.deepEqual(calls.remove, [[rows[0].path]]);
  assert.equal(objects.size, 0);

  const failing = fakeStorage({ failRemove: 2 });
  const { d, logs } = deps(failing.storage);
  await cleanupAfterFailedPostCreate(rows, d);
  assert.equal(failing.calls.remove.length, 2, '1회 재시도');
  assert.ok(logs.some((l) => l.message.startsWith('[community-image-orphan]')));
});

// ── 18. 업로드 실패 정리 ───────────────────────────────────────────────────────

test('18. 업로드 실패 시 세션 정리: 본인 세션의 미연결 객체만 지우고, 이미 글에 붙은 경로는 보존', async () => {
  const attached = `posts/${USER}/${SESSION}/aaaaaaaa-bbbb-4ccc-8ddd-000000000001.webp`;
  const loose = `posts/${USER}/${SESSION}/aaaaaaaa-bbbb-4ccc-8ddd-000000000002.webp`;
  const othersSession = `posts/${OTHER}/${SESSION}/aaaaaaaa-bbbb-4ccc-8ddd-000000000003.webp`;
  const { storage, calls, objects } = fakeStorage({ existing: [attached, loose, othersSession] });
  const { d } = deps(storage, { referencedPaths: async (paths) => new Set(paths.filter((p) => p === attached)) });
  const res = await handleImageSessionCleanup({ auth: authOk(), sessionId: SESSION }, d);
  assert.equal(res.status, 200);
  assert.deepEqual(calls.remove, [[loose]]);
  assert.ok(objects.has(attached) && objects.has(othersSession));
  assert.equal((await handleImageSessionCleanup({ auth: { error: 'x', status: 401, user: null }, sessionId: SESSION }, d)).status, 401);
  assert.equal((await handleImageSessionCleanup({ auth: authOk(), sessionId: '../../etc' }, d)).status, 400);

  // COMMUNITY_EDITOR_V2 — 저장 흐름은 글쓰기·수정 공용 모듈로 옮겨졌다(계약 동일).
  const submit = codeOf(read('src/lib/community/submit-block-post.ts'));
  assert.ok((submit.match(/await cleanupUploadSession\(sessionId, fetchImpl\)/g) || []).length >= 3, '업로드 실패·글 생성 실패·예외 모두 정리');
});

// ── 21. 공개 읽기 ──────────────────────────────────────────────────────────────

test('21. 공개 읽기: 상세 API는 공개 URL·가로·세로·순서만 내보내고 sortOrder 오름차순', () => {
  const storage = createCommunityImageStorage({ url: 'https://proj.supabase.co/', serviceRoleKey: 'k' }, async () => new Response(null));
  assert.equal(storage.publicUrl(`posts/${USER}/${SESSION}/${SESSION}.webp`), `https://proj.supabase.co/storage/v1/object/public/community-images/posts/${USER}/${SESSION}/${SESSION}.webp`);
  const route = codeOf(read('src/app/api/community/posts/[id]/route.ts'));
  assert.ok(/images: \{ orderBy: \{ sortOrder: 'asc' \}, select: \{ id: true, path: true, width: true, height: true, sortOrder: true \} \}/.test(route));
  assert.ok(/url: storage \? storage\.publicUrl\(img\.path\) : null, width: img\.width, height: img\.height, sortOrder: img\.sortOrder/.test(route));
  assert.ok(!/bytes: true|mimeType: true/.test(route));
});

// ── 22–26. 삭제 ────────────────────────────────────────────────────────────────

function deleteDeps(post: { id: string; authorId: string; imagePaths: string[] } | null, storage: CommunityImageStorage | null) {
  const deleted: string[] = [];
  const logs: string[] = [];
  return {
    deleted,
    logs,
    d: {
      findPost: async () => post,
      deletePost: async (id: string) => void deleted.push(id),
      isAdmin: (u: { role?: string | null }) => u.role === 'ADMIN',
      storage,
      log: (m: string) => void logs.push(m),
    },
  };
}

const P1 = `posts/${USER}/${SESSION}/aaaaaaaa-bbbb-4ccc-8ddd-000000000001.webp`;
const P2 = `posts/${USER}/${SESSION}/aaaaaaaa-bbbb-4ccc-8ddd-000000000002.jpg`;

test('22·23. 작성자 삭제: DB 경로로 글 삭제(PostImage cascade) 후 Storage 삭제', async () => {
  const { storage, calls } = fakeStorage({ existing: [P1, P2] });
  const x = deleteDeps({ id: 'p1', authorId: USER, imagePaths: [P1, P2] }, storage);
  const res = await deletePostWithImages({ user: { id: USER }, postId: 'p1' }, x.d);
  assert.equal(res.status, 200);
  assert.deepEqual(x.deleted, ['p1']);
  assert.deepEqual(calls.remove, [[P1, P2]]);
  const schema = read('prisma/schema.prisma');
  assert.ok(/post\s+Post\s+@relation\(fields: \[postId\], references: \[id\], onDelete: Cascade\)/.test(schema));
  const mig = read('prisma/migrations/20260914100000_community_post_images_v1/migration.sql');
  assert.ok(/ON DELETE CASCADE/.test(mig));
});

test('23b. Storage 삭제 실패: 1회 재시도 후 orphan 로그, 글 삭제 자체는 성공(imageCleanup pending)', async () => {
  const { storage, calls } = fakeStorage({ failRemove: 5 });
  const x = deleteDeps({ id: 'p1', authorId: USER, imagePaths: [P1] }, storage);
  const res = await deletePostWithImages({ user: { id: USER }, postId: 'p1' }, x.d);
  assert.equal(res.status, 200);
  assert.deepEqual((res.body as { data: unknown }).data, { imageCleanup: 'pending' });
  assert.equal(calls.remove.length, 2);
  assert.ok(x.logs.some((m) => m.startsWith('[community-image-orphan]')));
});

test('24. 작성자 아닌 사용자는 삭제 불가 — DB·Storage 모두 손대지 않는다', async () => {
  const { storage, calls } = fakeStorage();
  const x = deleteDeps({ id: 'p1', authorId: USER, imagePaths: [P1] }, storage);
  const res = await deletePostWithImages({ user: { id: OTHER }, postId: 'p1' }, x.d);
  assert.equal(res.status, 403);
  assert.deepEqual(x.deleted, []);
  assert.equal(calls.remove.length, 0);
  assert.equal((await deletePostWithImages({ user: null, postId: 'p1' }, x.d)).status, 401);
});

test('25. 관리자 삭제 가능', async () => {
  const { storage, calls } = fakeStorage();
  const x = deleteDeps({ id: 'p1', authorId: USER, imagePaths: [P1] }, storage);
  const res = await deletePostWithImages({ user: { id: 'admin1', role: 'ADMIN' }, postId: 'p1' }, x.d);
  assert.equal(res.status, 200);
  assert.deepEqual(calls.remove, [[P1]]);
});

test('26. 사진 없는 기존 글 삭제: Storage 호출 0, 기존과 같은 응답', async () => {
  const { storage, calls } = fakeStorage();
  const x = deleteDeps({ id: 'p0', authorId: USER, imagePaths: [] }, storage);
  const res = await deletePostWithImages({ user: { id: USER }, postId: 'p0' }, x.d);
  assert.equal(res.status, 200);
  assert.equal(calls.remove.length, 0);
  const route = codeOf(read('src/app/api/community/posts/[id]/route.ts'));
  assert.ok(/if \(images\.length === 0\) return \[\]/.test(route));
  assert.ok(/if \(!result\.body\.success\) return NextResponse\.json\(result\.body, \{ status: result\.status \}\);\s*return NextResponse\.json\(\{ success: true \}\)/.test(route));
  assert.ok(/imagePaths: existing\.images\.map\(\(i\) => i\.path\)/.test(route), '삭제 경로는 DB에서만 읽는다');
});

// ── 27. 상세 렌더 ──────────────────────────────────────────────────────────────

test('27. 상세 렌더: lazy·async decode, 저장된 width/height, "게시글 이미지 N", 원본 비율(자르지 않음)', () => {
  // COMMUNITY_EDITOR_V2 — 상세 사진 렌더는 공용 렌더러로 옮겨졌다(계약 동일).
  const page = read('src/components/community/CommunityPostContent.tsx');
  assert.ok(/loading="lazy"/.test(page));
  assert.ok(/decoding="async"/.test(page));
  assert.ok(/alt=\{`게시글 이미지 \$\{imageNumbers\.get\(index\)\}`\}/.test(page));
  assert.ok(/width=\{block\.width\}/.test(page) && /height=\{block\.height\}/.test(page));
  const css = read('src/components/community/CommunityPostContent.module.css');
  const block = css.slice(css.indexOf('.image {'));
  assert.ok(/width: 100%;/.test(block) && /height: auto;/.test(block));
  assert.ok(!/object-fit/.test(block.slice(0, block.indexOf('}'))));
});

// ── 29. service role 서버 전용 ─────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    // 테스트 파일은 검사 대상 문자열을 정규식으로 담고 있어 제외한다.
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

test('29. service role 키는 서버 전용: server-only 모듈만 env를 읽고, 클라이언트 코드는 import하지 않으며 NEXT_PUBLIC·옛 이름 폴백 없음', () => {
  const server = read('src/lib/supabase/server-storage.ts');
  assert.ok(/^import 'server-only';/m.test(server));
  assert.ok(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(server));
  const files = walk(resolve(ROOT, 'src'));
  const readers: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const code = codeOf(src);
    assert.ok(!/NEXT_PUBLIC_SUPABASE/.test(code), `${f}: NEXT_PUBLIC_SUPABASE 사용`);
    assert.ok(!/process\.env\.SUPABASE_KEY\b/.test(code), `${f}: 옛 SUPABASE_KEY 사용`);
    if (/process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(code)) readers.push(f.replace(/\\/g, '/'));
    if (/^['"]use client['"]/.test(src.trimStart())) {
      assert.ok(!/supabase\/(server-storage|community-image-deps)/.test(code), `${f}: 클라이언트가 서버 Storage 모듈 import`);
    }
  }
  assert.deepEqual(readers.map((f) => f.slice(f.indexOf('src/'))), ['src/lib/supabase/server-storage.ts']);
  assert.ok(/^import 'server-only';/m.test(read('src/lib/supabase/community-image-deps.ts')));
});

test('29b. Storage 오류 메시지·로그에 키/Authorization이 실리지 않는다', async () => {
  const storage = createCommunityImageStorage({ url: 'https://proj.supabase.co', serviceRoleKey: 'super-secret-key' }, async () => new Response('denied', { status: 403 }));
  await assert.rejects(storage.upload('posts/a/b/c.jpg', new Uint8Array(1), 'image/jpeg'), (e: unknown) => {
    const msg = String((e as Error).message) + JSON.stringify(e);
    assert.ok(!msg.includes('super-secret-key'));
    assert.ok(!/authorization|bearer/i.test(msg));
    return true;
  });
  let sent: RequestInit | undefined;
  const s2 = createCommunityImageStorage({ url: 'https://proj.supabase.co', serviceRoleKey: 'k' }, async (_u, init) => ((sent = init), new Response('{}', { status: 200 })));
  await s2.upload('posts/a/b/c.jpg', new Uint8Array(1), 'image/webp');
  assert.equal((sent!.headers as Record<string, string>)['x-upsert'], 'false');
  assert.equal((sent!.headers as Record<string, string>)['cache-control'], 'max-age=3600');
});

// ── 30. 목록 불변 ──────────────────────────────────────────────────────────────

test('30. 커뮤니티 목록 API는 사진을 조회하지 않는다(썸네일은 P2)', () => {
  const route = codeOf(read('src/app/api/community/posts/route.ts'));
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  assert.ok(!/images/.test(get));
  assert.ok(/include: \{\s*author: \{ select: \{ name: true, image: true, role: true \} \},\s*_count: \{ select: \{ comments: true \} \},\s*\}/.test(get));
});

// ── least privilege migration ─────────────────────────────────────────────────

test('migration: 새 테이블만 만들고 API 역할 grant 회수 + RLS, 기존 테이블 변경 없음', () => {
  const mig = read('prisma/migrations/20260914100000_community_post_images_v1/migration.sql');
  const sql = mig.replace(/^--.*$/gm, '');
  assert.ok(/CREATE TABLE "post_images"/.test(sql));
  assert.ok(/REVOKE ALL ON TABLE "post_images" FROM %I/.test(sql));
  assert.ok(/ARRAY\['anon', 'authenticated', 'service_role'\]/.test(sql));
  assert.ok(/ALTER TABLE "post_images" ENABLE ROW LEVEL SECURITY/.test(sql));
  assert.ok(!/\bDROP\b|\bDELETE\b|\bUPDATE "|\bGRANT\b/i.test(sql.replace(/ON UPDATE CASCADE/g, '').replace(/ON DELETE CASCADE/g, '')));
  const alters = sql.match(/ALTER TABLE "([a-z_]+)"/g) || [];
  assert.ok(alters.every((a) => a.includes('"post_images"')));
});
