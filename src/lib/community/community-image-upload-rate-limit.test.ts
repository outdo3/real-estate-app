import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { IMAGE_ERROR_MESSAGES, MAX_IMAGES_PER_POST, MAX_STORED_BYTES, parseImagePath } from './image-rules';
import { handleImageSessionCleanup, handleImageUpload, type AuthResult, type ImageHandlerDeps } from './image-handlers';
import type { CommunityImageStorage } from './image-storage-core';
import { deriveUploadTokenKey, signUploadReceipt, verifyUploadReceipt } from './image-upload-token';
import {
  IMAGE_UPLOAD_RATE_LIMIT_MESSAGE,
  STORED_IMAGE_LIMITS,
  UPLOAD_REQUEST_LIMIT,
  checkImageUploadRateLimit,
  createInMemoryRequestLimiter,
  decideStoredUploadLimit,
  imageUploadRateLimitKey,
  type StoredUploadUsage,
} from './image-upload-rate-limit';

/**
 * COMMUNITY_IMAGE_UPLOAD_RATE_LIMIT_V1 — 업로드 한도 계약.
 * storage.objects 조회는 fake(storedUsage)로, 메모리 한도는 실제 구현으로 검사한다. 라우트 배선은 소스 검사.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const USER_A = 'cmusera0001';
const USER_B = 'cmuserb0002';
const SESSION = '3f1c2b7a-9d4e-4c1a-8b2f-0a1b2c3d4e5f';
const KEY = deriveUploadTokenKey('test-secret');
const NOW = 1_800_000_000_000;
const MIN = 60_000;
const authOk = (id = USER_A, role: string | null = null): AuthResult => ({ error: null, status: 200, user: { id, role } });

/** 헤더가 유효한 최소 JPEG(SOF0, EXIF 없음). */
function jpeg(width = 64, height = 48): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xd9,
  ]);
}

/** storage.objects를 흉내 낸다: 업로드하면 사용자 경로 아래 행이 생기고, 지우면 사라진다. */
function world() {
  const objects = new Map<string, number>(); // path -> createdAt
  let clock = NOW;
  const calls = { upload: 0, usage: [] as string[] };
  const storage: CommunityImageStorage = {
    async upload(path) {
      calls.upload++;
      objects.set(path, clock);
    },
    async exists(path) {
      return objects.has(path);
    },
    async list(prefix) {
      return [...objects.keys()].filter((p) => p.startsWith(prefix));
    },
    async remove(paths) {
      paths.forEach((p) => objects.delete(p));
    },
    publicUrl: (p) => `https://x/${p}`,
  };
  const storedUsage = async (userId: string): Promise<StoredUploadUsage> => {
    calls.usage.push(userId);
    const mine = [...objects].filter(([p]) => p.startsWith(`posts/${userId}/`)).map(([, t]) => t);
    const short = mine.filter((t) => t > clock - STORED_IMAGE_LIMITS.shortWindowMs);
    const day = mine.filter((t) => t > clock - STORED_IMAGE_LIMITS.dayWindowMs);
    return {
      shortCount: short.length,
      dayCount: day.length,
      shortOldestExpiresInSec: short.length ? (Math.min(...short) + STORED_IMAGE_LIMITS.shortWindowMs - clock) / 1000 : null,
      dayOldestExpiresInSec: day.length ? (Math.min(...day) + STORED_IMAGE_LIMITS.dayWindowMs - clock) / 1000 : null,
    };
  };
  const requests = createInMemoryRequestLimiter();
  const logs: string[] = [];
  let n = 0;
  const deps: ImageHandlerDeps = {
    storage,
    sign: (r) => signUploadReceipt(r, KEY),
    verify: (t) => verifyUploadReceipt(t, KEY, clock),
    newUuid: () => `aaaaaaaa-bbbb-4ccc-8ddd-${String(++n).padStart(12, '0')}`,
    now: () => clock,
    referencedPaths: async () => new Set(),
    rateLimit: (userId) => checkImageUploadRateLimit(userId, { requests, storedUsage, now: () => clock, log: (m) => logs.push(m) }),
    log: (m) => logs.push(m),
  };
  const advance = (ms: number) => (clock += ms);
  return { deps, objects, calls, logs, advance, requests };
}

const upload = (deps: ImageHandlerDeps, opts: { auth?: AuthResult; session?: string; bytes?: Uint8Array; contentLength?: number | null } = {}) => {
  const bytes = opts.bytes ?? jpeg();
  return handleImageUpload({ auth: opts.auth ?? authOk(), sessionId: opts.session ?? SESSION, contentLength: opts.contentLength === undefined ? bytes.length : opts.contentLength, readBytes: async () => bytes }, deps);
};

const session = (i: number) => `3f1c2b7a-9d4e-4c1a-8b2f-${String(i).padStart(12, '0')}`;

/** 5장짜리 제출 k번(세션마다 5장). */
async function submitPosts(deps: ImageHandlerDeps, k: number, auth = authOk()) {
  const statuses: number[] = [];
  for (let s = 0; s < k; s++) for (let i = 0; i < MAX_IMAGES_PER_POST; i++) statuses.push((await upload(deps, { auth, session: session(s) })).status);
  return statuses;
}

// ── 1~5 ──────────────────────────────────────────────────────────────────────

test('1. 비로그인·차단 계정은 기존대로 401/403 — 한도 조회도 하지 않는다', async () => {
  const w = world();
  const anon = await upload(w.deps, { auth: { error: '로그인이 필요합니다.', status: 401, user: null } });
  const banned = await upload(w.deps, { auth: { error: '커뮤니티 이용이 제한된 계정입니다.', status: 403, user: null } });
  assert.equal(anon.status, 401);
  assert.equal(banned.status, 403);
  assert.equal(w.calls.usage.length, 0);
  assert.equal(w.requests.size(), 0);
  assert.equal(w.calls.upload, 0);
});

test('2. 정상 업로드는 성공(영수증·경로 계약 그대로)', async () => {
  const w = world();
  const res = await upload(w.deps);
  assert.equal(res.status, 200);
  assert.ok(res.body.success && res.body.data);
  const data = (res.body as { data: { path: string; token: string } }).data;
  assert.ok(parseImagePath(data.path)?.userId === USER_A);
  const receipt = verifyUploadReceipt(data.token, KEY, NOW);
  assert.ok(receipt && receipt.path === data.path && receipt.userId === USER_A);
  assert.equal(res.headers, undefined);
});

test('3. 한도 아래(5장짜리 글 4개 = 20장)는 전부 성공', async () => {
  const w = world();
  const statuses = await submitPosts(w.deps, 4);
  assert.equal(statuses.length, STORED_IMAGE_LIMITS.shortMax);
  assert.ok(statuses.every((s) => s === 200));
});

test('4. 경계: 저장 20장째 성공, 21장째 실패 / 요청 40번째 허용, 41번째 거절', async () => {
  assert.deepEqual(decideStoredUploadLimit({ shortCount: 19, dayCount: 19, shortOldestExpiresInSec: 10, dayOldestExpiresInSec: 10 }), { allowed: true });
  const at = decideStoredUploadLimit({ shortCount: 20, dayCount: 20, shortOldestExpiresInSec: 10, dayOldestExpiresInSec: 10 });
  assert.equal(at.allowed, false);
  assert.ok(!at.allowed && at.reason === 'STORED_SHORT');
  assert.ok(!decideStoredUploadLimit({ shortCount: 0, dayCount: 100, shortOldestExpiresInSec: null, dayOldestExpiresInSec: 50 }).allowed);
  assert.ok(decideStoredUploadLimit({ shortCount: 0, dayCount: 99, shortOldestExpiresInSec: null, dayOldestExpiresInSec: 50 }).allowed);

  const lim = createInMemoryRequestLimiter();
  const key = imageUploadRateLimitKey(USER_A);
  for (let i = 1; i <= UPLOAD_REQUEST_LIMIT.max; i++) assert.ok(lim.hit(key, NOW + i).allowed, `request ${i}`);
  assert.equal(lim.hit(key, NOW + 41).allowed, false);
  // 가장 오래된 요청이 창을 벗어나면 다시 허용(거절된 요청은 기록되지 않음)
  assert.ok(lim.hit(key, NOW + 1 + UPLOAD_REQUEST_LIMIT.windowMs).allowed);
});

test('5·6. 초과 시 HTTP 429 + 간단한 메시지 + Retry-After(초), 본문 읽기·Storage 업로드 없음', async () => {
  const w = world();
  await submitPosts(w.deps, 4);
  w.advance(3 * MIN);
  let read = false;
  const res = await handleImageUpload({ auth: authOk(), sessionId: session(9), contentLength: 100, readBytes: async () => ((read = true), jpeg()) }, w.deps);
  assert.equal(res.status, 429);
  assert.deepEqual(res.body, { success: false, error: IMAGE_UPLOAD_RATE_LIMIT_MESSAGE });
  assert.equal(IMAGE_UPLOAD_RATE_LIMIT_MESSAGE, '사진 업로드 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
  assert.equal(read, false);
  assert.equal(w.calls.upload, 20);
  // 첫 업로드가 10분 창을 벗어날 때까지 7분 = 420초
  assert.equal(res.headers?.['Retry-After'], '420');
  assert.ok(!/storage|objects|STORED|count/i.test(JSON.stringify(res.body)), '내부 정보 노출 없음');
  assert.ok(w.logs.includes('[community-images] rate limited'));

  w.advance(7 * MIN + 1);
  assert.equal((await upload(w.deps, { session: session(9) })).status, 200, '창이 지나면 다시 가능');
});

test('5b. 하루 한도(100장): 10분 창이 풀려도 24시간 안 누적 100장이면 429, Retry-After는 가장 오래된 것 기준', async () => {
  const w = world();
  for (let round = 0; round < 5; round++) {
    const statuses = [] as number[];
    for (let s = 0; s < 4; s++) for (let i = 0; i < 5; i++) statuses.push((await upload(w.deps, { session: session(round * 10 + s) })).status);
    assert.ok(statuses.every((st) => st === 200), `round ${round}`);
    w.advance(11 * MIN);
  }
  const res = await upload(w.deps, { session: session(99) });
  assert.equal(res.status, 429);
  const retry = Number(res.headers?.['Retry-After']);
  assert.equal(retry, 24 * 3600 - 55 * 60);
});

// ── 7·8·13 ───────────────────────────────────────────────────────────────────

test('7. 사용자 A의 한도는 사용자 B에 영향 없음(요청·저장 모두)', async () => {
  const w = world();
  await submitPosts(w.deps, 4, authOk(USER_A));
  assert.equal((await upload(w.deps, { auth: authOk(USER_A), session: session(8) })).status, 429);
  assert.equal((await upload(w.deps, { auth: authOk(USER_B), session: session(8) })).status, 200);

  const lim = createInMemoryRequestLimiter();
  for (let i = 0; i < UPLOAD_REQUEST_LIMIT.max; i++) lim.hit(imageUploadRateLimitKey(USER_A), NOW);
  assert.equal(lim.hit(imageUploadRateLimitKey(USER_A), NOW).allowed, false);
  assert.equal(lim.hit(imageUploadRateLimitKey(USER_B), NOW).allowed, true);
});

test('8. 클라이언트가 보낸 user id로 우회 불가: 한도 키·경로는 세션 사용자 id뿐, 라우트는 요청의 userId를 읽지 않음', async () => {
  const w = world();
  await submitPosts(w.deps, 4, authOk(USER_A));
  const seen: string[] = [];
  const res = await handleImageUpload(
    { auth: authOk(USER_A), sessionId: session(7), contentLength: null, readBytes: async () => jpeg() },
    { ...w.deps, rateLimit: (id) => (seen.push(id), w.deps.rateLimit(id)) }
  );
  assert.equal(res.status, 429);
  assert.deepEqual(seen, [USER_A]);
  assert.ok(w.calls.usage.every((id) => id === USER_A));

  const route = read('src/app/api/community/images/route.ts');
  assert.ok(!/searchParams\.get\(['"]user/i.test(route) && !/headers\.get\(['"]x-user/i.test(route));
  const handlers = read('src/lib/community/image-handlers.ts');
  assert.match(handlers, /await deps\.rateLimit\(user\.id\)/);
  assert.equal(imageUploadRateLimitKey(USER_A), `community-image-upload:${USER_A}`);
});

test('13. 관리자도 예외 없음(같은 한도)', async () => {
  const w = world();
  const admin = authOk('cmadmin0001', 'ADMIN');
  const statuses = await submitPosts(w.deps, 4, admin);
  assert.ok(statuses.every((s) => s === 200));
  assert.equal((await upload(w.deps, { auth: admin, session: session(9) })).status, 429);
  const code = read('src/lib/community/image-upload-rate-limit.ts') + read('src/lib/community/image-handlers.ts');
  assert.ok(!/isAdmin|ADMIN|role/.test(code.slice(code.indexOf('// 본문을 읽고'), code.indexOf('const bytes = await input.readBytes()'))));
});

// ── 9~12: 기존 계약 유지 ──────────────────────────────────────────────────────

test('9. 글당 5장 규칙 그대로(한도 안에서도 같은 세션 6장째 409)', async () => {
  const w = world();
  for (let i = 0; i < MAX_IMAGES_PER_POST; i++) assert.equal((await upload(w.deps)).status, 200);
  const sixth = await upload(w.deps);
  assert.equal(sixth.status, 409);
  assert.deepEqual(sixth.body, { success: false, error: IMAGE_ERROR_MESSAGES.TOO_MANY });
});

test('10. 업로드 영수증 형식·만료 그대로(한도 추가 전후 동일 필드)', async () => {
  const w = world();
  const res = await upload(w.deps);
  const data = (res.body as unknown as { data: Record<string, unknown> }).data;
  assert.deepEqual(Object.keys(data).sort(), ['bytes', 'height', 'mimeType', 'path', 'token', 'url', 'width']);
  const receipt = verifyUploadReceipt(data.token, KEY, NOW);
  assert.ok(receipt);
  assert.equal(receipt.exp, NOW + 6 * 60 * 60 * 1000);
});

test('11. 한도 때문에 중간에 막힌 부분 업로드는 기존 세션 정리로 지워지고, 지우면 다시 올릴 수 있다', async () => {
  const w = world();
  await submitPosts(w.deps, 3); // 15장
  // 네 번째 글: 5장 중 5장 성공 → 다섯 번째 글 첫 장 429(부분 업로드 0장) / 네 번째 글이 실패했다고 가정하고 정리
  for (let i = 0; i < 5; i++) assert.equal((await upload(w.deps, { session: session(3) })).status, 200);
  assert.equal((await upload(w.deps, { session: session(4) })).status, 429);
  const cleanup = await handleImageSessionCleanup({ auth: authOk(), sessionId: session(3) }, w.deps);
  assert.equal(cleanup.status, 200);
  assert.deepEqual(cleanup.body, { success: true, data: { removed: 5 } });
  assert.equal([...w.objects.keys()].filter((p) => p.includes(session(3))).length, 0);
  assert.equal((await upload(w.deps, { session: session(4) })).status, 200, '정리 후 재시도 가능');
  // 정리(DELETE)는 한도의 영향을 받지 않는다
  assert.ok(!/rateLimit/.test(read('src/lib/community/image-handlers.ts').split('export async function handleImageSessionCleanup')[1].split('// ── 게시글에 연결')[0]));
  // 브라우저는 업로드 실패 시 서버 메시지를 그대로 보여주고 세션 정리를 호출한다(기존 흐름)
  const submit = read('src/lib/community/submit-block-post.ts');
  assert.match(submit, /if \(!json\?\.success\) \{\s*await cleanupUploadSession\(sessionId, fetchImpl\);\s*return \{ ok: false, error: json\?\.error/);
});

test('12. 크기·형식 검증 그대로(413 선언 길이, 415 형식) — 413은 한도 조회 전', async () => {
  const w = world();
  const big = await upload(w.deps, { contentLength: MAX_STORED_BYTES + 1 });
  assert.equal(big.status, 413);
  assert.equal(w.calls.usage.length, 0);
  const junk = await upload(w.deps, { bytes: new Uint8Array(64).fill(7) });
  assert.equal(junk.status, 415);
  assert.equal(w.calls.upload, 0);
});

// ── 사용량 조회 실패·메모리 ────────────────────────────────────────────────────

test('14a. 사용량 조회 실패는 fail-open(업로드 허용) + 사용자 id·원문 없는 로그, 요청 한도는 계속 적용', async () => {
  const logs: { m: string; meta?: Record<string, unknown> }[] = [];
  const requests = createInMemoryRequestLimiter();
  const deps = { requests, storedUsage: async () => Promise.reject(new Error(`db down for ${USER_A}`)), now: () => NOW, log: (m: string, meta?: Record<string, unknown>) => logs.push({ m, meta }) };
  assert.deepEqual(await checkImageUploadRateLimit(USER_A, deps), { allowed: true });
  assert.equal(logs[0].m, '[community-images] rate limit usage unavailable');
  assert.ok(!JSON.stringify(logs).includes(USER_A));
  for (let i = 1; i < UPLOAD_REQUEST_LIMIT.max; i++) await checkImageUploadRateLimit(USER_A, deps);
  const blocked = await checkImageUploadRateLimit(USER_A, deps);
  assert.ok(!blocked.allowed && blocked.reason === 'REQUESTS' && blocked.retryAfterSec === 600);
});

test('14b. 메모리 한도는 키 수 상한을 지킨다(오래된 키부터 제거)', () => {
  const lim = createInMemoryRequestLimiter({ windowMs: 10 * MIN, max: 3, maxKeys: 100 });
  for (let i = 0; i < 250; i++) lim.hit(`k${i}`, NOW + i);
  assert.ok(lim.size() <= 100);
  const expired = createInMemoryRequestLimiter({ windowMs: MIN, max: 3, maxKeys: 10 });
  for (let i = 0; i < 10; i++) expired.hit(`old${i}`, NOW);
  expired.hit('fresh', NOW + 2 * MIN);
  assert.equal(expired.size(), 1, '만료된 키가 먼저 정리됨');
});

test('14c. 배선: 요청 한도는 모듈 단위(인스턴스당 1개), 사용량은 storage.objects 읽기 쿼리 — 한계는 문서화', () => {
  const deps = read('src/lib/supabase/community-image-deps.ts');
  assert.match(deps, /^import 'server-only';/m);
  assert.match(deps, /^const uploadRequestLimiter = createInMemoryRequestLimiter\(\);$/m);
  assert.match(deps, /storedUsage: queryStoredUploadUsage/);
  const db = read('src/lib/community/image-upload-usage-db.ts');
  assert.match(db, /^import 'server-only';/m);
  assert.match(db, /FROM storage\.objects/);
  assert.ok(!/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/.test(db.replace(/\/\/.*$/gm, '')), '읽기 전용');
  assert.ok(!/\$queryRawUnsafe|\$executeRaw/.test(db), '파라미터 바인딩만');
  const route = read('src/app/api/community/images/route.ts');
  assert.match(route, /headers: result\.headers/);
  const doc = read('docs/development/COMMUNITY_IMAGE_UPLOAD_RATE_LIMIT_V1.md');
  assert.match(doc, /인스턴스/);
  assert.match(doc, /storage\.objects/);
});

test('14d. 경로 구간은 사용자 prefix만 포함(다른 사용자·접두 겹침 제외)', () => {
  // image-upload-usage-db.ts의 userPathRange와 같은 규칙: [posts/{id}/, posts/{id}0) — C collation 문자 순서
  const from = `posts/${USER_A}/`;
  const to = `posts/${USER_A}0`;
  const inRange = (name: string) => name >= from && name < to;
  assert.ok(inRange(`posts/${USER_A}/${SESSION}/x.webp`));
  assert.ok(!inRange(`posts/${USER_A}1/${SESSION}/x.webp`), '다른 사용자(접두 겹침)');
  assert.ok(!inRange(`posts/${USER_A}-x/${SESSION}/x.webp`), '하이픈 접미 사용자');
  assert.ok(!inRange(`posts/${USER_A}_/${SESSION}/x.webp`));
  assert.ok(!inRange(`posts/${USER_B}/${SESSION}/x.webp`));
  assert.match(read('src/lib/community/image-upload-usage-db.ts'), /from: `posts\/\$\{userId\}\/`, to: `posts\/\$\{userId\}0`/);
});

// ── 보안 ─────────────────────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

test('15. 보안: 한도 모듈은 env를 읽지 않고 클라이언트가 서버 모듈을 import하지 않음, Data API 호출 없음', () => {
  assert.ok(!/process\.env/.test(read('src/lib/community/image-upload-rate-limit.ts')));
  assert.ok(!/process\.env/.test(read('src/lib/community/image-upload-usage-db.ts')));
  for (const f of walk(join(ROOT, 'src'))) {
    const src = readFileSync(f, 'utf8');
    if (/^['"]use client['"]/.test(src.trimStart())) {
      assert.ok(!/image-upload-usage-db|supabase\/community-image-deps/.test(src), `${f}: 클라이언트가 서버 모듈 import`);
    }
    if (!f.endsWith('.test.ts')) assert.ok(!/\/rest\/v1/.test(src), `${f}: Data API`);
  }
});
