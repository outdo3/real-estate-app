import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  APPLY_MAX_DELETE_PER_RUN,
  APPLY_STOP_OBJECT_COUNT,
  ORPHAN_DEFAULT_MIN_AGE_HOURS,
  ORPHAN_MIN_AGE_HOURS_FLOOR,
  OrphanScanError,
  applyOrphanCleanup,
  classifyCommunityImageObjects,
  createReadOnlyImageStorageProbe,
  describeSupabaseKeyRole,
  findCommunityImageOrphans,
  parseOrphanCliArgs,
  planOrphanCleanup,
  redactImagePath,
  type ApplyDeps,
  type ClassifiedObject,
  type OrphanFindDeps,
  type StorageObjectEntry,
} from './image-orphan-audit';
import { UPLOAD_TOKEN_TTL_MS } from './image-upload-token';

const ROOT = resolve(__dirname, '../../..');
const HOUR = 3600_000;
const NOW = Date.parse('2026-09-15T00:00:00.000Z');
const USER = 'cmuser0000000000000000001';
const S1 = '11111111-1111-4111-8111-111111111111';
const uuid = (n: number) => `${String(n).padStart(8, '0')}-2222-4222-8222-222222222222`;
const imgPath = (n: number, ext: 'webp' | 'jpg' = 'webp', user = USER) => `posts/${user}/${S1}/${uuid(n)}.${ext}`;
const obj = (p: string, ageHours: number, over: Partial<StorageObjectEntry> = {}): StorageObjectEntry => ({
  path: p,
  createdAt: new Date(NOW - ageHours * HOUR).toISOString(),
  updatedAt: new Date(NOW - ageHours * HOUR).toISOString(),
  size: 1000,
  mimeType: p.endsWith('.jpg') ? 'image/jpeg' : 'image/webp',
  ...over,
});
const classify = (objects: StorageObjectEntry[], dbPaths: string[] = [], minAgeHours = 24) =>
  classifyCommunityImageObjects({ objects, dbPaths, knownUserIds: new Set([USER]), nowMs: NOW, minAgeHours });

// ── 분류 ─────────────────────────────────────────────────────────────────────

test('1. referenced object → REFERENCED (오래됐어도 후보 아님)', () => {
  const r = classify([obj(imgPath(1), 500)], [imgPath(1)]);
  assert.equal(r.counts.REFERENCED, 1);
  assert.equal(r.counts.SAFE_ORPHAN_CANDIDATE, 0);
});

test('2. recent unreferenced → RECENT_UNREFERENCED로 보호', () => {
  const r = classify([obj(imgPath(1), 1), obj(imgPath(2), 23.99)]);
  assert.equal(r.counts.RECENT_UNREFERENCED, 2);
  assert.equal(r.candidates.length, 0);
});

test('2b. 미래 created_at(시계 차이)은 최근으로 보호', () => {
  const r = classify([obj(imgPath(1), -3)]);
  assert.equal(r.counts.RECENT_UNREFERENCED, 1);
});

test('3. old unreferenced → SAFE_ORPHAN_CANDIDATE, bytes·나이 집계', () => {
  const r = classify([obj(imgPath(1), 30, { size: 700 }), obj(imgPath(2), 100, { size: 300 }), obj(imgPath(3), 5)]);
  assert.equal(r.counts.SAFE_ORPHAN_CANDIDATE, 2);
  assert.equal(r.candidateBytes, 1000);
  assert.equal(r.oldestCandidateAgeHours, 100);
  assert.equal(r.newestCandidateAgeHours, 30);
  assert.equal(r.candidates[0].path, imgPath(2), '오래된 순');
});

test('4. malformed path → REVIEW_REQUIRED(MALFORMED_PATH)', () => {
  const bad = [
    `posts/${USER}/${S1}/not-a-uuid.webp`,
    `posts/${USER}/${S1}/${uuid(1)}.png`,
    `posts/${USER}/${uuid(1)}.webp`,
    `posts/${USER}/${S1}/${uuid(1)}.webp/extra`,
    `posts/bad user/${S1}/${uuid(1)}.webp`,
  ];
  const r = classify(bad.map((p) => obj(p, 500)));
  assert.equal(r.counts.REVIEW_REQUIRED, bad.length);
  assert.ok(r.review.every((o) => o.reviewReason === 'MALFORMED_PATH'));
  assert.equal(r.candidates.length, 0);
});

test('5. wrong prefix → REVIEW_REQUIRED(WRONG_PREFIX), 삭제 후보 아님', () => {
  const r = classify([obj(`avatars/${USER}/${S1}/${uuid(1)}.webp`, 500), obj('.emptyFolderPlaceholder', 500), obj(`Posts/${USER}/${S1}/${uuid(1)}.webp`, 500)]);
  assert.equal(r.counts.REVIEW_REQUIRED, 3);
  assert.ok(r.review.every((o) => o.reviewReason === 'WRONG_PREFIX'));
});

test('5b. 메타데이터 부족·MIME 불일치·크기 초과·모르는 소유자 → REVIEW_REQUIRED', () => {
  const r = classifyCommunityImageObjects({
    objects: [
      obj(imgPath(1), 500, { createdAt: null }),
      obj(imgPath(2), 500, { createdAt: 'garbage' }),
      obj(imgPath(3), 500, { size: null }),
      obj(imgPath(4), 500, { mimeType: 'image/jpeg' }),
      obj(imgPath(5), 500, { size: 3 * 1024 * 1024 }),
      obj(imgPath(6, 'webp', 'qa-storage-verify'), 500),
    ],
    dbPaths: [],
    knownUserIds: new Set([USER]),
    nowMs: NOW,
    minAgeHours: 24,
  });
  assert.deepEqual(
    r.review.map((o) => o.reviewReason),
    ['MISSING_CREATED_AT', 'INVALID_CREATED_AT', 'MISSING_SIZE', 'MIME_EXT_MISMATCH', 'OVERSIZED', 'UNKNOWN_OWNER']
  );
  assert.equal(r.candidates.length, 0);
});

test('6. DB 참조는 있는데 Storage 객체 없음 → DB_MISSING_STORAGE(orphan 후보와 분리)', () => {
  const r = classify([obj(imgPath(1), 500)], [imgPath(1), imgPath(2), 'posts/qa/x.webp']);
  assert.deepEqual(r.dbMissingStorage.sort(), [imgPath(2), 'posts/qa/x.webp'].sort());
  assert.equal(r.counts.DB_INVALID_PATH, 1);
  assert.equal(r.candidates.length, 0);
});

function fakeFindDeps(over: Partial<OrphanFindDeps> = {}): OrphanFindDeps {
  return {
    listStorageObjects: async () => [obj(imgPath(1), 500), obj(imgPath(2), 500)],
    listReferencedPaths: async () => [imgPath(1), imgPath(9)],
    existingUserIds: async (ids) => new Set(ids),
    objectExists: async () => false,
    now: () => NOW,
    ...over,
  };
}

test('6b. DB_MISSING_STORAGE는 개별 존재 확인으로 재검증(스캔 이후 생성분 제외)', async () => {
  const res = await findCommunityImageOrphans({}, fakeFindDeps({ objectExists: async (p) => p === imgPath(9) }));
  assert.ok(res.ok);
  assert.equal(res.report.counts.DB_MISSING_STORAGE, 0);
  const res2 = await findCommunityImageOrphans({}, fakeFindDeps());
  assert.ok(res2.ok);
  assert.deepEqual(res2.report.dbMissingStorage, [imgPath(9)]);
  assert.equal(res2.report.counts.SAFE_ORPHAN_CANDIDATE, 1);
});

test('7. storage error → 후보 없음, DB 조회도 하지 않음', async () => {
  let dbCalled = false;
  const res = await findCommunityImageOrphans(
    {},
    fakeFindDeps({
      listStorageObjects: async () => {
        throw new OrphanScanError('HTTP', 500);
      },
      listReferencedPaths: async () => {
        dbCalled = true;
        return [];
      },
    })
  );
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.stage, 'STORAGE');
  assert.equal(dbCalled, false);
  assert.ok(!('report' in res));
});

test('8. DB error → 후보 없음(DB 참조 없이 판정하지 않는다)', async () => {
  const res = await findCommunityImageOrphans({}, fakeFindDeps({ listReferencedPaths: async () => Promise.reject(new Error('db down')) }));
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.stage, 'DB');
  const res2 = await findCommunityImageOrphans({}, fakeFindDeps({ existingUserIds: async () => Promise.reject(new Error('db down')) }));
  assert.equal(!res2.ok && res2.stage, 'DB');
  const res3 = await findCommunityImageOrphans({}, fakeFindDeps({ objectExists: async () => Promise.reject(new Error('x')) }));
  assert.equal(!res3.ok && res3.stage, 'CONFIRM');
});

test('8b. 오류 문자열에 키·메시지 원문을 싣지 않는다', async () => {
  const res = await findCommunityImageOrphans({}, fakeFindDeps({ listReferencedPaths: async () => Promise.reject(new Error('postgres://user:secret@host')) }));
  assert.ok(!res.ok && !res.error.includes('secret'));
});

test('9. 정확한 나이 경계: 24h ± 1ms', () => {
  const at = obj(imgPath(1), 24);
  const just = obj(imgPath(2), 24 - 1 / HOUR);
  const r = classify([at, just]);
  assert.deepEqual(r.candidates.map((c) => c.path), [imgPath(1)]);
  assert.deepEqual(r.recentUnreferenced.map((c) => c.path), [imgPath(2)]);
});

test('9b. 안전 창 하한 = 영수증 TTL + 6h, 기본 24h', () => {
  assert.equal(ORPHAN_MIN_AGE_HOURS_FLOOR, UPLOAD_TOKEN_TTL_MS / HOUR + 6);
  assert.equal(ORPHAN_DEFAULT_MIN_AGE_HOURS, 24);
  assert.throws(() => classify([], [], ORPHAN_MIN_AGE_HOURS_FLOOR - 0.1));
  assert.throws(() => classify([], [], Number.NaN));
  assert.equal(parseOrphanCliArgs(['--min-age-hours=6']).ok, false);
});

// ── 적용 설계(PHASE 2) ───────────────────────────────────────────────────────

const candidate = (n: number, ageHours = 100): ClassifiedObject => ({ ...obj(imgPath(n), ageHours), class: 'SAFE_ORPHAN_CANDIDATE', ageHours });

function fakeApplyDeps(over: Partial<ApplyDeps> = {}) {
  const calls = { remove: [] as string[][], referenced: [] as string[][] };
  const store = new Set<string>();
  const deps: ApplyDeps = {
    referencedPaths: async (paths) => {
      calls.referenced.push(paths);
      return new Set();
    },
    remove: async (paths) => {
      calls.remove.push(paths);
      paths.forEach((p) => store.delete(p));
    },
    exists: async (p) => store.has(p),
    now: () => NOW,
    ...over,
  };
  return { deps, calls, store };
}

test('10. dry-run은 절대 remove를 호출하지 않는다', async () => {
  const { deps, calls } = fakeApplyDeps();
  const res = await applyOrphanCleanup({ mode: 'dry-run', batch: [candidate(1), candidate(2)], minAgeHours: 24 }, deps);
  assert.equal(calls.remove.length, 0);
  assert.equal(res.deleted.length, 0);
});

test('11. apply는 명시적 --apply 인자가 있어야만; 스크립트는 PHASE 1에서 apply 거부', () => {
  const none = parseOrphanCliArgs([]);
  assert.ok(none.ok && none.args.mode === 'dry-run');
  const dry = parseOrphanCliArgs(['--dry-run', '--verbose']);
  assert.ok(dry.ok && dry.args.mode === 'dry-run' && dry.args.verbose);
  const apply = parseOrphanCliArgs(['--apply']);
  assert.ok(apply.ok && apply.args.mode === 'apply');
  assert.equal(parseOrphanCliArgs(['--APPLY']).ok, false);
  assert.equal(parseOrphanCliArgs(['apply']).ok, false);

  const script = readFileSync(join(ROOT, 'scripts/community/audit-image-orphans.ts'), 'utf8');
  assert.match(script, /^const APPLY_ENABLED = false;$/m);
  assert.ok(!/\.remove\(|method:\s*'DELETE'|removeWithRetry|createCommunityImageStorage/.test(script), '스크립트에 삭제 경로 없음');
  assert.ok(!/prisma\.\w+\.(create|update|upsert|delete)\w*\(|\$executeRaw/.test(script), '스크립트에 DB 쓰기 없음');
});

test('12. 삭제 직전 DB 참조 재조회: 그 사이 참조된 경로는 지우지 않고, 재조회 실패 시 전부 중단', async () => {
  const { deps, calls, store } = fakeApplyDeps({ referencedPaths: async () => new Set([imgPath(2)]) });
  [1, 2, 3].forEach((n) => store.add(imgPath(n)));
  const res = await applyOrphanCleanup({ mode: 'apply', batch: [candidate(1), candidate(2), candidate(3)], minAgeHours: 24 }, deps);
  assert.deepEqual(calls.remove.flat(), [imgPath(1), imgPath(3)]);
  assert.equal(res.skippedReferenced, 1);
  assert.deepEqual(res.deleted, [imgPath(1), imgPath(3)]);
  assert.ok(store.has(imgPath(2)));

  const failing = fakeApplyDeps({ referencedPaths: async () => Promise.reject(new Error('db')) });
  const aborted = await applyOrphanCleanup({ mode: 'apply', batch: [candidate(1)], minAgeHours: 24 }, failing.deps);
  assert.equal(aborted.aborted, 'DB_RECHECK_FAILED');
  assert.equal(failing.calls.remove.length, 0);
});

test('12b. 적용 시 나이·경로·분류를 다시 검증(오래된 목록 재사용 방지)', async () => {
  const { deps, calls } = fakeApplyDeps({ now: () => NOW - 90 * HOUR });
  const notCandidate: ClassifiedObject = { ...candidate(3), class: 'REVIEW_REQUIRED' };
  const badPath: ClassifiedObject = { ...candidate(4), path: 'avatars/x.webp' };
  const res = await applyOrphanCleanup({ mode: 'apply', batch: [candidate(1, 100), candidate(2, 30), notCandidate, badPath], minAgeHours: 24 }, deps);
  // now를 90h 전으로 돌리면 100h짜리는 10h → 부적격, 30h짜리도 부적격.
  assert.equal(res.skippedIneligible, 4);
  assert.equal(calls.remove.length, 0);
});

test('13. batch cap: 한 번에 최대 100개, 오래된 순, 나머지는 deferred', () => {
  const cands = Array.from({ length: 150 }, (_, i) => candidate(i + 1, 25 + i));
  const plan = planOrphanCleanup({ candidates: cands, candidateBytes: 150_000 });
  assert.equal(plan.status, 'READY');
  assert.ok(plan.status === 'READY' && plan.batch.length === APPLY_MAX_DELETE_PER_RUN && plan.deferred === 50);
  assert.ok(plan.status === 'READY' && plan.batch[0].ageHours === 174);
  assert.equal(planOrphanCleanup({ candidates: [], candidateBytes: 0 }).status, 'NOTHING');
});

test('13b. apply는 cap을 넘는 batch를 거부하고, 실패·검증불가·부분 성공을 구분 보고', async () => {
  const { deps } = fakeApplyDeps();
  await assert.rejects(applyOrphanCleanup({ mode: 'apply', batch: Array.from({ length: 101 }, (_, i) => candidate(i + 1)), minAgeHours: 24 }, deps));

  let removeCalls = 0;
  const store = new Set([imgPath(1), imgPath(2), imgPath(3)]);
  const res = await applyOrphanCleanup(
    { mode: 'apply', batch: [candidate(1), candidate(2), candidate(3)], minAgeHours: 24 },
    {
      referencedPaths: async () => new Set(),
      remove: async (paths) => {
        removeCalls++;
        if (removeCalls === 1) throw new Error('transient');
        paths.filter((p) => p !== imgPath(2)).forEach((p) => store.delete(p));
      },
      exists: async (p) => {
        if (p === imgPath(3)) throw new Error('info failed');
        return store.has(p);
      },
      now: () => NOW,
    }
  );
  assert.equal(removeCalls, 2, 'bounded retry: 2회');
  assert.deepEqual(res.deleted, [imgPath(1)]);
  assert.deepEqual(res.failed, [imgPath(2)]);
  assert.deepEqual(res.unverified, [imgPath(3)]);
  assert.equal(res.partial, true);
});

test('14. 대량 발견 시 STOP(>500개 또는 >500MB) — 배치를 만들지 않는다', () => {
  const many = Array.from({ length: APPLY_STOP_OBJECT_COUNT + 1 }, (_, i) => candidate(i + 1));
  const stop = planOrphanCleanup({ candidates: many, candidateBytes: 1000 });
  assert.equal(stop.status, 'STOP');
  assert.ok(stop.status === 'STOP' && stop.reason === 'TOO_MANY_OBJECTS');
  const heavy = planOrphanCleanup({ candidates: [candidate(1)], candidateBytes: 500 * 1024 * 1024 + 1 });
  assert.ok(heavy.status === 'STOP' && heavy.reason === 'TOO_MANY_BYTES');
  const edge = planOrphanCleanup({ candidates: many.slice(0, APPLY_STOP_OBJECT_COUNT), candidateBytes: 500 * 1024 * 1024 });
  assert.equal(edge.status, 'READY');
});

// ── Storage 프로브 ───────────────────────────────────────────────────────────

test('14b. 프로브는 community-images list/info만 호출(삭제·다른 bucket 없음), 폴더 재귀·페이지·오류 전파', async () => {
  const seen: { url: string; method: string; body: unknown }[] = [];
  const tree: Record<string, { name: string; id: string | null; created_at?: string; metadata?: { size: number; mimetype: string } }[]> = {
    '': [{ name: 'posts', id: null }],
    posts: [{ name: USER, id: null }],
    [`posts/${USER}`]: [{ name: S1, id: null }],
    [`posts/${USER}/${S1}`]: [{ name: `${uuid(1)}.webp`, id: 'x', created_at: '2026-09-14T00:00:00Z', metadata: { size: 12, mimetype: 'image/webp' } }],
  };
  const probe = createReadOnlyImageStorageProbe({ url: 'https://p.supabase.co/', serviceRoleKey: 'k' }, async (url, init) => {
    seen.push({ url, method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes('/object/info/')) return new Response('', { status: 404 });
    const { prefix } = JSON.parse(String(init!.body));
    return Response.json(tree[prefix] ?? []);
  });
  const objects = await probe.listAllObjects();
  assert.deepEqual(objects, [{ path: imgPath(1), createdAt: '2026-09-14T00:00:00Z', updatedAt: null, size: 12, mimeType: 'image/webp' }]);
  assert.equal(await probe.exists(imgPath(1)), false);
  assert.ok(!('remove' in probe) && !('upload' in probe));
  for (const c of seen) {
    assert.ok(c.url.startsWith('https://p.supabase.co/storage/v1/object/list/community-images') || c.url.startsWith('https://p.supabase.co/storage/v1/object/info/community-images/'), c.url);
    assert.ok(c.method === 'POST' || c.method === 'GET');
  }

  const failing = createReadOnlyImageStorageProbe({ url: 'https://p.supabase.co', serviceRoleKey: 'k' }, async () => new Response('no', { status: 500 }));
  await assert.rejects(failing.listAllObjects(), (e: unknown) => e instanceof OrphanScanError && e.status === 500 && !String((e as Error).message).includes('k"'));
  const notArray = createReadOnlyImageStorageProbe({ url: 'https://p.supabase.co', serviceRoleKey: 'k' }, async () => Response.json({ error: 'x' }));
  await assert.rejects(notArray.listAllObjects(), (e: unknown) => e instanceof OrphanScanError && e.reason === 'SHAPE');
  const limited = createReadOnlyImageStorageProbe({ url: 'https://p.supabase.co', serviceRoleKey: 'k' }, async (_u, init) => {
    const { prefix } = JSON.parse(String(init!.body));
    return Response.json(tree[prefix] ?? []);
  });
  await assert.rejects(limited.listAllObjects(0), (e: unknown) => e instanceof OrphanScanError && e.reason === 'LIMIT');
});

test('14c. 페이지 크기(1000)만큼 오면 다음 offset을 조회한다', async () => {
  const offsets: number[] = [];
  const page = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `f${i}.webp`, id: 'x', created_at: null, metadata: null }));
  const probe = createReadOnlyImageStorageProbe({ url: 'https://p.supabase.co', serviceRoleKey: 'k' }, async (_u, init) => {
    const { offset } = JSON.parse(String(init!.body));
    offsets.push(offset);
    return Response.json(offset === 0 ? page(1000) : page(3));
  });
  const objects = await probe.listAllObjects();
  assert.deepEqual(offsets, [0, 1000]);
  assert.equal(objects.length, 1003);
});

test('14d. 경로 표시는 redact(userId·UUID 앞 4자만)', () => {
  const red = redactImagePath(imgPath(1));
  assert.ok(!red.includes(USER) && !red.includes(S1));
  assert.match(red, /^posts\/u:cmus…\/s:1111…\/f:0000…\.webp$/);
  assert.ok(!redactImagePath('avatars/someone@example.com/photo.png').includes('example.com'));
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

test('15. service role 키: 감사 모듈은 env를 읽지 않고, 클라이언트 코드·앱 코드가 감사 모듈을 import하지 않음', () => {
  const mod = readFileSync(join(ROOT, 'src/lib/community/image-orphan-audit.ts'), 'utf8');
  assert.ok(!/process\.env/.test(mod));
  assert.ok(!/NEXT_PUBLIC/.test(mod));
  for (const f of walk(join(ROOT, 'src'))) {
    if (f.endsWith('image-orphan-audit.ts') || f.endsWith('.test.ts')) continue;
    const src = readFileSync(f, 'utf8');
    assert.ok(!/image-orphan-audit/.test(src), `${f}: PHASE 1에서는 앱 런타임이 감사 모듈을 쓰지 않는다`);
  }
  assert.match(readFileSync(join(ROOT, 'src/lib/supabase/server-storage.ts'), 'utf8'), /^import 'server-only';/m);
  assert.equal(describeSupabaseKeyRole(undefined), 'missing');
  assert.equal(describeSupabaseKeyRole(`x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.y`), 'anon');
  assert.equal(describeSupabaseKeyRole(`x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.y`), 'service_role');
  assert.equal(describeSupabaseKeyRole('sb_publishable_abc'), 'publishable');
});

test('16. Data API OFF 유지: 앱·감사 코드가 /rest/v1(Data API)에 의존하지 않는다', () => {
  for (const f of walk(join(ROOT, 'src'))) {
    if (f.endsWith('.test.ts')) continue;
    assert.ok(!/\/rest\/v1/.test(readFileSync(f, 'utf8')), `${f}: Data API 호출`);
  }
  const script = readFileSync(join(ROOT, 'scripts/community/audit-image-orphans.ts'), 'utf8');
  // 스크립트는 상태 확인용 GET만(status 출력) — method 지정 없는 조회 두 건.
  const restCalls = script.match(/fetch\(`\$\{url\}\/rest\/v1\//g) ?? [];
  assert.equal(restCalls.length, 2);
  assert.ok(!/rest\/v1[^\n]*method:/.test(script));
});
