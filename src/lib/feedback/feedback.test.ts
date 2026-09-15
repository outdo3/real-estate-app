import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_COPY,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_RATE_LIMIT,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  PAGE_QUERY_BLOCKED_KEYS,
  nextStatusFields,
  sanitizePagePath,
  sanitizePageQuery,
  validateFeedbackInput,
} from './feedback-rules';
import {
  submitFeedback,
  updateFeedbackStatus,
  parseAdminListFilters,
  toAdminFeedbackItem,
  type FeedbackCreateData,
  type FeedbackRepo,
  type FeedbackRow,
  type MasterLookup,
  type SubmitDeps,
  type AdminFeedbackRepo,
} from './feedback-service';
import { buildFeedbackEmail, sendFeedbackEmail, RESEND_ENDPOINT } from './feedback-email';
import { deriveFeedbackHashKey, extractClientIp, hashRequesterIp } from './ip-hash';
import { createInMemoryRequestLimiter } from '../community/image-upload-rate-limit';
import { ANALYTICS_EVENT_NAMES, FEEDBACK_EVENT_ACTIONS, feedbackActionType, eventUrl } from '../analytics/events';

/**
 * USER_FEEDBACK_V1 — 제출·검증·개인정보·rate limit·관리자·메일·analytics·migration 보안.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── fakes ──────────────────────────────────────────────────────────────────

function fakeRepo(opts: { failCreate?: boolean; failCount?: boolean } = {}) {
  const rows: (FeedbackCreateData & { id: string; createdAt: Date; notifiedAt: Date | null })[] = [];
  let clock = new Date('2026-09-16T01:00:00.000Z');
  const repo: FeedbackRepo = {
    async countRecent(key, since) {
      if (opts.failCount) throw new Error('db down');
      return rows.filter((r) => r.createdAt >= since && ('userId' in key ? r.userId === key.userId : r.ipHash === key.ipHash)).length;
    },
    async create(data) {
      if (opts.failCreate) throw new Error('insert failed');
      const row = { ...data, id: `fb${rows.length + 1}`, createdAt: clock, notifiedAt: null };
      rows.push(row);
      return { id: row.id, createdAt: row.createdAt };
    },
    async markNotified(id, at) {
      const r = rows.find((x) => x.id === id);
      if (r) r.notifiedAt = at;
    },
  };
  return { repo, rows, setClock: (d: Date) => { clock = d; } };
}

const masters: MasterLookup = {
  async findByAptSeq(aptSeq) {
    return aptSeq === '26350-9' ? { aptSeq: '26350-9', name: '롯데', lawdCd: '26350' } : null;
  },
};

function deps(over: Partial<SubmitDeps> & { repo: FeedbackRepo; now?: () => Date }) {
  const tasks: (() => Promise<void>)[] = [];
  const logs: string[] = [];
  const d: SubmitDeps = {
    masters,
    localGuard: createInMemoryRequestLimiter({ windowMs: FEEDBACK_RATE_LIMIT.windowMs, max: 100, maxKeys: 100 }),
    now: () => new Date('2026-09-16T01:00:00.000Z'),
    schedule: (t) => { tasks.push(t); },
    notify: async () => ({ ok: true, providerId: 'email_1' }),
    siteUrl: 'https://e-jip.com',
    log: (m) => { logs.push(m); },
    ...over,
  };
  return { d, tasks, logs, runScheduled: async () => { for (const t of tasks.splice(0)) await t(); } };
}

const VALID = { category: 'DATA_ERROR', message: '실거래가가 실제와 달라요. 확인 부탁드립니다.' };

// ── 1~4 입력 검증 ───────────────────────────────────────────────────────────

test('1. 유형 허용 목록과 한글 표시가 요청서와 같다', () => {
  assert.deepEqual([...FEEDBACK_CATEGORIES], ['BUG', 'DATA_ERROR', 'FEATURE_REQUEST', 'USABILITY', 'OTHER']);
  assert.deepEqual(FEEDBACK_CATEGORIES.map((c) => FEEDBACK_CATEGORY_LABELS[c]), ['오류 신고', '데이터 오류', '기능 건의', '이용 불편', '기타']);
  assert.deepEqual([...FEEDBACK_STATUSES], ['NEW', 'REVIEWING', 'DONE']);
  assert.deepEqual(FEEDBACK_STATUSES.map((s) => FEEDBACK_STATUS_LABELS[s]), ['처리전', '확인중', '완료']);
  for (const c of FEEDBACK_CATEGORIES) assert.equal(validateFeedbackInput({ category: c, message: VALID.message }).ok, true);
});

test('2. 허용 밖 유형은 거절', async () => {
  for (const bad of ['bug', 'SPAM', '', null, 3, ['BUG']]) {
    assert.deepEqual(validateFeedbackInput({ category: bad, message: VALID.message }), { ok: false, error: 'INVALID_CATEGORY' });
  }
  const { repo, rows } = fakeRepo();
  const r = await submitFeedback({ body: { ...VALID, category: 'ADMIN' }, userId: null, ipHash: 'v1:x', userAgent: null }, deps({ repo }).d);
  assert.equal(r.status, 400);
  assert.equal(rows.length, 0);
});

test('3. 빈 메시지(공백만 포함)는 거절', async () => {
  for (const m of ['', '    ', '\n\n', 'ㅇㅇ', undefined]) {
    assert.equal(validateFeedbackInput({ category: 'BUG', message: m }).ok, false);
  }
  const { repo, rows } = fakeRepo();
  const r = await submitFeedback({ body: { category: 'BUG', message: '   ' }, userId: null, ipHash: null, userAgent: null }, deps({ repo }).d);
  assert.equal(r.status, 400);
  assert.equal(r.body.success, false);
  assert.equal(rows.length, 0);
});

test('4. 최대 길이 3000자(trim 기준) — 3000은 허용, 3001은 거절', () => {
  assert.equal(FEEDBACK_MESSAGE_MAX, 3000);
  assert.equal(validateFeedbackInput({ category: 'BUG', message: 'a'.repeat(3000) }).ok, true);
  assert.deepEqual(validateFeedbackInput({ category: 'BUG', message: 'a'.repeat(3001) }), { ok: false, error: 'MESSAGE_TOO_LONG' });
  assert.equal(validateFeedbackInput({ category: 'BUG', message: `  ${'a'.repeat(3000)}  ` }).ok, true, '앞뒤 공백은 길이에서 제외');
});

// ── 5~6 익명/로그인 ─────────────────────────────────────────────────────────

test('5. 비로그인 제출 — userId 없이 저장, ipHash만 한도 키', async () => {
  const { repo, rows } = fakeRepo();
  const { d } = deps({ repo });
  const r = await submitFeedback({ body: VALID, userId: null, ipHash: 'v1:abc', userAgent: 'Mozilla/5.0' }, d);
  assert.equal(r.status, 201);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, null);
  assert.equal(rows[0].ipHash, 'v1:abc');
  assert.equal(rows[0].category, 'DATA_ERROR');
  assert.equal(rows[0].message, VALID.message);
});

test('6. 로그인 제출 — userId 저장, IP 해시는 쓰지 않음', async () => {
  const { repo, rows } = fakeRepo();
  const r = await submitFeedback({ body: VALID, userId: 'user_1', ipHash: null, userAgent: null }, deps({ repo }).d);
  assert.equal(r.status, 201);
  assert.equal(rows[0].userId, 'user_1');
  assert.equal(rows[0].ipHash, null);
  const route = code('src/app/api/feedback/route.ts');
  assert.match(route, /const ipHash = userId \? null : hashRequesterIp\(/, '로그인 사용자는 IP 해시를 만들지 않는다');
});

// ── 7~8 단지 context ────────────────────────────────────────────────────────

test('7. aptSeq 후보가 master와 정확히 일치할 때만 canonical 단지 정보 저장', async () => {
  const { repo, rows } = fakeRepo();
  await submitFeedback({ body: { ...VALID, aptSeq: '26350-9', pagePath: '/apt/롯데' }, userId: null, ipHash: 'v1:a', userAgent: null }, deps({ repo }).d);
  assert.deepEqual([rows[0].aptSeq, rows[0].apartmentName, rows[0].lawdCd], ['26350-9', '롯데', '26350']);
});

test('8. 틀린·형식 불일치 aptSeq는 추측하지 않고 단지 정보 없이 저장', async () => {
  const { repo, rows } = fakeRepo();
  const { d } = deps({ repo });
  for (const aptSeq of ['26350-10', '롯데', '26350', '26350-9 ', 'x26350-9', 12345]) {
    await submitFeedback({ body: { ...VALID, aptSeq, apartmentName: '롯데', lawdCd: '26350' }, userId: `u_${String(aptSeq)}`, ipHash: null, userAgent: null }, d);
  }
  // '26350-9 '(뒤 공백)은 trim 후 정확히 일치 → 허용되는 유일한 정규화. 나머지는 모두 단지 정보 없음.
  const withApt = rows.filter((r) => r.aptSeq !== null);
  assert.equal(withApt.length, 1);
  assert.equal(withApt[0].aptSeq, '26350-9');
  for (const r of rows.filter((x) => x.aptSeq === null)) {
    assert.equal(r.apartmentName, null, '클라이언트가 보낸 이름을 저장하지 않는다');
    assert.equal(r.lawdCd, null);
  }
});

// ── 9~11 개인정보 ───────────────────────────────────────────────────────────

test('9. 원문 쿼리는 저장하지 않고 허용 키만 남긴다', async () => {
  assert.equal(sanitizePageQuery('lawdCd=26350&dong=%EC%9A%B0%EB%8F%99&aptSeq=26350-9&utm_source=x&foo=bar'), 'lawdCd=26350&dong=%EC%9A%B0%EB%8F%99&aptSeq=26350-9');
  assert.equal(sanitizePageQuery('foo=bar&x=1'), null);
  assert.equal(sanitizePagePath('/apt/롯데?lawdCd=26350#top'), '/apt/롯데');
  for (const bad of ['https://evil.com/x', '//evil.com', 'apt/x', '/a b', '/' + 'a'.repeat(300)]) assert.equal(sanitizePagePath(bad), null);
  const { repo, rows } = fakeRepo();
  await submitFeedback({ body: { ...VALID, pagePath: '/stats/volume?period=7d&email=a@b.com', pageQuery: 'period=7d&email=a@b.com&phone=010' }, userId: null, ipHash: 'v1:a', userAgent: null }, deps({ repo }).d);
  assert.equal(rows[0].pagePath, '/stats/volume');
  assert.equal(rows[0].pageQuery, 'period=7d');
});

test('10. 인증·OAuth 파라미터(code·state·token·callbackUrl·error·session·auth·oauth)는 저장되지 않는다', async () => {
  const q = PAGE_QUERY_BLOCKED_KEYS.map((k) => `${k}=secret-${k}`).join('&') + '&lawdCd=26470';
  assert.deepEqual([...PAGE_QUERY_BLOCKED_KEYS], ['code', 'state', 'token', 'callbackUrl', 'error', 'session', 'auth', 'oauth']);
  assert.equal(sanitizePageQuery(q), 'lawdCd=26470');
  const { repo, rows } = fakeRepo();
  await submitFeedback({ body: { ...VALID, pageQuery: q, sessionToken: 'abc', password: 'pw', cookie: 'next-auth.session-token=zzz' }, userId: 'u', ipHash: null, userAgent: null }, deps({ repo }).d);
  const stored = JSON.stringify(rows[0]);
  for (const s of ['secret-', 'sessionToken', 'next-auth', 'password', 'zzz']) assert.ok(!stored.includes(s), `${s} 저장 금지`);
  // 저장 필드는 고정 목록뿐(클라이언트 임의 필드가 들어갈 자리가 없다)
  assert.deepEqual(Object.keys(rows[0]).sort(), ['aptSeq', 'apartmentName', 'category', 'createdAt', 'id', 'ipHash', 'lawdCd', 'message', 'notifiedAt', 'pagePath', 'pageQuery', 'userAgent', 'userId'].sort());
});

test('11. 원문 IP는 저장·반환되지 않는다 — 날짜가 섞인 HMAC만', () => {
  const headers = new Map([['x-forwarded-for', '203.0.113.7, 10.0.0.1']]);
  const ip = extractClientIp({ get: (n) => headers.get(n) ?? null });
  assert.equal(ip, '203.0.113.7');
  const key = deriveFeedbackHashKey({ NEXTAUTH_SECRET: 'test-secret-value' });
  assert.ok(key);
  const h1 = hashRequesterIp(ip, key, new Date('2026-09-16T01:00:00Z'))!;
  const h2 = hashRequesterIp(ip, key, new Date('2026-09-17T01:00:00Z'))!;
  assert.match(h1, /^v1:[0-9a-f]{64}$/);
  assert.ok(!h1.includes('203.0.113.7'));
  assert.notEqual(h1, h2, 'KST 날짜가 바뀌면 같은 IP도 다른 값');
  assert.equal(hashRequesterIp(ip, key, new Date('2026-09-16T14:59:00Z')), h1, '같은 KST 날짜 안에서는 같은 값');
  assert.ok(!key!.toString('utf8').includes('test-secret-value'), '파생 키는 원 비밀이 아니다');
  assert.equal(deriveFeedbackHashKey({ FEEDBACK_HASH_SECRET: 'dedicated', NEXTAUTH_SECRET: 'x' })!.toString('utf8'), 'dedicated');
  assert.equal(deriveFeedbackHashKey({}), null);
  assert.equal(extractClientIp({ get: (n) => (n === 'x-forwarded-for' ? '<script>' : null) }), null);
  const schema = read('prisma/schema.prisma');
  const model = schema.slice(schema.indexOf('model UserFeedback {'), schema.indexOf('@@map("user_feedback")'));
  assert.ok(!/\bip\b\s+String|ipAddress|remoteAddr/i.test(model), '원문 IP 컬럼 없음');
});

// ── 12~13 rate limit ────────────────────────────────────────────────────────

test('12. 비로그인 rate limit — 같은 ipHash 10분 5건, 6번째 429, 창이 지나면 다시 허용', async () => {
  const { repo, rows, setClock } = fakeRepo();
  let now = new Date('2026-09-16T01:00:00.000Z');
  const { d } = deps({ repo, now: () => now });
  for (let i = 0; i < 5; i++) {
    const r = await submitFeedback({ body: VALID, userId: null, ipHash: 'v1:same', userAgent: null }, d);
    assert.equal(r.status, 201);
  }
  const blocked = await submitFeedback({ body: VALID, userId: null, ipHash: 'v1:same', userAgent: null }, d);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.success === false && blocked.body.error, FEEDBACK_COPY.rateLimited);
  assert.equal((await submitFeedback({ body: VALID, userId: null, ipHash: 'v1:other', userAgent: null }, d)).status, 201, '다른 요청자는 영향 없음');
  now = new Date(now.getTime() + FEEDBACK_RATE_LIMIT.windowMs + 1000);
  setClock(now);
  assert.equal((await submitFeedback({ body: VALID, userId: null, ipHash: 'v1:same', userAgent: null }, d)).status, 201);
  assert.equal(rows.length, 7);
});

test('13. 로그인 rate limit — userId 기준(다른 IP여도 같은 사용자면 합산)', async () => {
  const { repo } = fakeRepo();
  const { d } = deps({ repo });
  for (let i = 0; i < 5; i++) assert.equal((await submitFeedback({ body: VALID, userId: 'user_9', ipHash: null, userAgent: null }, d)).status, 201);
  assert.equal((await submitFeedback({ body: VALID, userId: 'user_9', ipHash: null, userAgent: null }, d)).status, 429);
  assert.equal((await submitFeedback({ body: VALID, userId: 'user_8', ipHash: null, userAgent: null }, d)).status, 201);
  // 공유 한도 조회 실패는 제출을 막지 않는다(fail-open), 로컬 가드가 보조
  const failing = fakeRepo({ failCount: true });
  const f = deps({ repo: failing.repo, localGuard: createInMemoryRequestLimiter({ windowMs: 600000, max: 2, maxKeys: 10 }) });
  assert.equal((await submitFeedback({ body: VALID, userId: 'u', ipHash: null, userAgent: null }, f.d)).status, 201);
  assert.equal((await submitFeedback({ body: VALID, userId: 'u', ipHash: null, userAgent: null }, f.d)).status, 201);
  assert.equal((await submitFeedback({ body: VALID, userId: 'u', ipHash: null, userAgent: null }, f.d)).status, 429, '로컬 가드');
  assert.ok(f.logs.includes('[FEEDBACK_RATE_LIMIT_QUERY_FAILED]'));
});

// ── 14~18 관리자 ────────────────────────────────────────────────────────────

test('14. 관리자 API는 requireAdmin() 통과 전에는 DB에 닿지 않는다(401/403 그대로 반환)', () => {
  for (const p of ['src/app/api/admin/feedback/route.ts', 'src/app/api/admin/feedback/[id]/route.ts']) {
    const src = code(p);
    const guard = src.indexOf('const { error, status } = await requireAdmin();');
    const reject = src.indexOf('if (error) return NextResponse.json({ success: false, error }, { status });');
    const firstDb = src.search(/prismaAdminFeedbackRepo\.|updateFeedbackStatus\(/);
    assert.ok(guard > 0 && reject > guard && firstDb > reject, `${p}: 관리자 판정 → 거절 → DB 순서`);
  }
  const helpers = code('src/lib/auth-helpers.ts');
  assert.match(helpers, /if \(!user\) return \{ error: '로그인이 필요합니다\.' as const, status: 401 as const, user: null \};/);
  assert.match(helpers, /if \(!isAdminSessionUser\(user as any\)\) return \{ error: '관리자만 사용할 수 있습니다\.' as const, status: 403 as const/);
  assert.match(code('src/proxy.ts'), /matcher: \['\/admin\/:path\*'\]/, '관리자 페이지도 proxy에서 막힌다');
});

function fakeAdminRepo(seed: FeedbackRow[]) {
  const rows = [...seed];
  const repo: AdminFeedbackRepo = {
    async list(filters, take, skip) {
      const filtered = rows
        .filter((r) => (!filters.status || r.status === filters.status) && (!filters.category || r.category === filters.category))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return { rows: filtered.slice(skip, skip + take), total: filtered.length };
    },
    async findStatus(id) {
      const r = rows.find((x) => x.id === id);
      return r ? { status: r.status, resolvedAt: r.resolvedAt } : null;
    },
    async update(id, data) {
      const r = rows.find((x) => x.id === id)!;
      Object.assign(r, data, { updatedAt: new Date() });
      return r;
    },
  };
  return { repo, rows };
}

const row = (o: Partial<FeedbackRow>): FeedbackRow => ({
  id: 'fb', category: 'BUG', message: 'm', status: 'NEW', userId: null, pagePath: '/my', pageQuery: null, aptSeq: null, apartmentName: null,
  lawdCd: null, userAgent: 'UA', ipHash: 'v1:secret', notifiedAt: null, adminNote: null, resolvedAt: null,
  createdAt: new Date('2026-09-16T00:00:00Z'), updatedAt: new Date('2026-09-16T00:00:00Z'), ...o,
});

test('15. 관리자 목록 — 최신순, 목록 항목에 ipHash·userId 원값을 내보내지 않음', async () => {
  const { repo } = fakeAdminRepo([
    row({ id: 'a', createdAt: new Date('2026-09-15T00:00:00Z') }),
    row({ id: 'b', createdAt: new Date('2026-09-16T00:00:00Z'), userId: 'user_1' }),
  ]);
  const { rows, total } = await repo.list(parseAdminListFilters(new URLSearchParams()), 30, 0);
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a']);
  assert.equal(total, 2);
  const item = toAdminFeedbackItem(rows[0]);
  assert.equal(item.loggedIn, true);
  assert.ok(!('ipHash' in item) && !('userId' in item));
  assert.match(code('src/lib/feedback/feedback-repo-prisma.ts'), /orderBy: \{ createdAt: 'desc' \}/);
});

test('16. 필터 — 상태·유형(허용 값만, 이상한 값은 무시)', async () => {
  const { repo } = fakeAdminRepo([
    row({ id: '1', status: 'NEW', category: 'BUG' }),
    row({ id: '2', status: 'DONE', category: 'BUG' }),
    row({ id: '3', status: 'NEW', category: 'DATA_ERROR' }),
  ]);
  const f = parseAdminListFilters(new URLSearchParams('status=NEW&category=BUG&page=0'));
  assert.deepEqual(f, { status: 'NEW', category: 'BUG', page: 1 });
  assert.deepEqual((await repo.list(f, 30, 0)).rows.map((r) => r.id), ['1']);
  assert.deepEqual(parseAdminListFilters(new URLSearchParams("status=HACK&category=';DROP")), { status: null, category: null, page: 1 });
});

test('17. 상태 전환 NEW → REVIEWING → DONE (관리자 메모 포함)', async () => {
  const { repo, rows } = fakeAdminRepo([row({ id: 'x' })]);
  const t1 = new Date('2026-09-16T02:00:00Z');
  assert.equal((await updateFeedbackStatus('x', { status: 'REVIEWING' }, repo, t1)).status, 200);
  assert.equal(rows[0].status, 'REVIEWING');
  assert.equal(rows[0].resolvedAt, null);
  const r = await updateFeedbackStatus('x', { status: 'DONE', adminNote: '  데이터 재수집 완료  ' }, repo, t1);
  assert.equal(r.status, 200);
  assert.equal(rows[0].status, 'DONE');
  assert.equal(rows[0].adminNote, '데이터 재수집 완료');
  assert.equal((await updateFeedbackStatus('x', { status: 'CLOSED' }, repo, t1)).status, 400);
  assert.equal((await updateFeedbackStatus('missing', { status: 'DONE' }, repo, t1)).status, 404);
  assert.equal((await updateFeedbackStatus('x', { status: 'DONE', adminNote: 'a'.repeat(2001) }, repo, t1)).status, 400);
});

test('18. resolvedAt — DONE 진입 시 now, DONE→DONE 유지, DONE에서 나가면 null', () => {
  const t1 = new Date('2026-09-16T02:00:00Z');
  const t2 = new Date('2026-09-17T02:00:00Z');
  assert.deepEqual(nextStatusFields({ status: 'NEW', resolvedAt: null }, 'DONE', t1), { status: 'DONE', resolvedAt: t1 });
  assert.deepEqual(nextStatusFields({ status: 'DONE', resolvedAt: t1 }, 'DONE', t2), { status: 'DONE', resolvedAt: t1 }, '다시 저장해도 완료 시각 유지');
  assert.deepEqual(nextStatusFields({ status: 'DONE', resolvedAt: null }, 'DONE', t2), { status: 'DONE', resolvedAt: t2 });
  assert.deepEqual(nextStatusFields({ status: 'DONE', resolvedAt: t1 }, 'REVIEWING', t2), { status: 'REVIEWING', resolvedAt: null });
  assert.deepEqual(nextStatusFields({ status: 'REVIEWING', resolvedAt: null }, 'NEW', t2), { status: 'NEW', resolvedAt: null });
});

// ── 19~20 메일 ─────────────────────────────────────────────────────────────

test('19. 메일 성공(2xx) → 응답 뒤에 notifiedAt 기록, 메일에 개인정보 없음', async () => {
  const { repo, rows } = fakeRepo();
  const sent: { subject: string; text: string }[] = [];
  const { d, runScheduled } = deps({ repo, notify: async (e) => { sent.push(e); return { ok: true, providerId: 'id_1' }; } });
  const r = await submitFeedback({ body: { ...VALID, aptSeq: '26350-9', pagePath: '/apt/롯데', pageQuery: 'lawdCd=26350' }, userId: 'user_secret_id', ipHash: null, userAgent: 'SecretUA/1.0' }, d);
  assert.equal(r.status, 201);
  assert.equal(rows[0].notifiedAt, null, '응답 시점에는 아직 발송 전');
  await runScheduled();
  assert.ok((rows[0].notifiedAt as unknown) instanceof Date, '발송 성공 후 notifiedAt 기록');
  assert.equal(sent[0].subject, '[이집 새 의견] 데이터 오류');
  for (const s of ['user_secret_id', 'SecretUA', 'v1:', 'lawdCd=26350']) assert.ok(!sent[0].text.includes(s), `메일에 ${s} 없음`);
  for (const s of ['새 의견이 접수되었습니다.', '데이터 오류', VALID.message, '/apt/롯데', '롯데 (26350-9)', '로그인 사용자', 'https://e-jip.com/admin/feedback']) {
    assert.ok(sent[0].text.includes(s), `메일에 ${s}`);
  }
});

test('20. 메일 실패·미설정·예외 → 저장된 의견은 그대로, notifiedAt null, 로그만', async () => {
  for (const notify of [
    async () => ({ ok: false as const, reason: 'HTTP_ERROR' as const, httpStatus: 422 }),
    async () => ({ ok: false as const, reason: 'NOT_CONFIGURED' as const }),
    async () => { throw new Error('boom'); },
  ]) {
    const { repo, rows } = fakeRepo();
    const { d, runScheduled, logs } = deps({ repo, notify });
    const r = await submitFeedback({ body: VALID, userId: null, ipHash: 'v1:a', userAgent: null }, d);
    assert.equal(r.status, 201, '제출 성공은 메일과 무관');
    await runScheduled();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].notifiedAt, null);
    assert.ok(logs.some((l) => l.startsWith('[FEEDBACK_NOTIFY_FAILED] id=fb1 reason=')));
    assert.ok(!logs.join(' ').includes(VALID.message), '로그에 메시지 원문 없음');
  }
  // DB 저장 실패는 메일을 예약하지 않고 안전한 실패 문구
  const failing = fakeRepo({ failCreate: true });
  const f = deps({ repo: failing.repo });
  const r = await submitFeedback({ body: VALID, userId: null, ipHash: 'v1:a', userAgent: null }, f.d);
  assert.equal(r.status, 500);
  assert.equal(r.body.success === false && r.body.error, FEEDBACK_COPY.failure);
  assert.equal(f.tasks.length, 0);
});

test('Resend 호출 — 환경변수 없으면 호출 안 함, 2xx만 성공, 키·주소를 결과에 싣지 않음', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const okFetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ id: 'e_1' }), { status: 200 }); }) as unknown as typeof fetch;
  const env = { RESEND_API_KEY: 're_test', FEEDBACK_NOTIFICATION_EMAIL: 'ops@example.com', FEEDBACK_EMAIL_FROM: 'noreply@example.com' };
  const email = buildFeedbackEmail({ id: 'x', category: 'BUG', message: 'm', pagePath: null, apartmentName: null, aptSeq: null, loggedIn: false, createdAt: new Date('2026-09-16T00:00:00Z') }, 'https://e-jip.com/');
  assert.deepEqual(await sendFeedbackEmail(email, { RESEND_API_KEY: 're_test' }, okFetch), { ok: false, reason: 'NOT_CONFIGURED' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await sendFeedbackEmail(email, env, okFetch), { ok: true, providerId: 'e_1' });
  assert.equal(calls[0].url, RESEND_ENDPOINT);
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer re_test');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { from: 'noreply@example.com', to: ['ops@example.com'], subject: '[이집 새 의견] 오류 신고', text: email.text });
  const bad = (async () => new Response('{"message":"invalid key re_test"}', { status: 403 })) as unknown as typeof fetch;
  const res = await sendFeedbackEmail(email, env, bad);
  assert.deepEqual(res, { ok: false, reason: 'HTTP_ERROR', httpStatus: 403 });
  assert.ok(!JSON.stringify(res).includes('re_test'));
  assert.ok(email.text.includes('접수 시간:\n2026-09-16 09:00 (KST)'));
  assert.ok(!/nodemailer|resend['"]/.test(read('package.json')), '메일 npm 패키지 추가 없음');
});

// ── 21~22 analytics ────────────────────────────────────────────────────────

test('21. analytics — feedback_open(값 없음)·feedback_submit(유형만)', () => {
  assert.ok(ANALYTICS_EVENT_NAMES.includes('feedback_open') && ANALYTICS_EVENT_NAMES.includes('feedback_submit'));
  assert.deepEqual([...FEEDBACK_EVENT_ACTIONS.feedback_submit], [...FEEDBACK_CATEGORIES]);
  assert.deepEqual([...FEEDBACK_EVENT_ACTIONS.feedback_open], []);
  assert.equal(feedbackActionType('feedback_submit', 'DATA_ERROR'), 'DATA_ERROR');
  assert.equal(eventUrl('feedback_submit', 'DATA_ERROR'), '/__event__/feedback_submit?action=DATA_ERROR');
  const tracker = code('src/lib/analytics/track-feedback.ts');
  assert.match(tracker, /trackEvent\('feedback_open'\);/);
  assert.match(tracker, /trackEvent\('feedback_submit', \{ actionType: category \}\);/);
  assert.match(code('src/app/api/log/event/route.ts'), /personalFitActionType\(name, rawActionType\) \?\?\s*feedbackActionType\(name, rawActionType\);/);
  const ga = code('src/lib/analytics/ga-events.ts');
  assert.ok(!/feedback_/.test(ga), 'GA4 매핑 없음');
});

test('22. analytics 금지 값(메시지·사용자·이메일·aptSeq·단지명·쿼리·IP·UA)은 보낼 수 없다', () => {
  for (const bad of [VALID.message, 'user_1', 'a@b.com', '26350-9', '롯데', 'lawdCd=26350', 'v1:abc', 'Mozilla/5.0']) {
    assert.equal(feedbackActionType('feedback_submit', bad), null);
  }
  assert.equal(feedbackActionType('feedback_open', 'BUG'), null, 'open은 값이 없다');
  assert.equal(feedbackActionType('report_view', 'BUG'), null);
  const tracker = code('src/lib/analytics/track-feedback.ts');
  assert.ok(!/complexId|aptName|message|userId|aptSeq|pagePath|userAgent|ipHash/.test(tracker));
  const client = code('src/app/feedback/feedback-client.tsx');
  assert.match(client, /trackFeedbackSubmit\(category\);/);
  assert.match(client, /trackFeedbackOpen\(\);/);
  assert.equal((client.match(/trackFeedback(Open|Submit)\(/g) ?? []).length, 2);
});

// ── 23~24 migration·보안 ───────────────────────────────────────────────────

test('23. migration — 추가만, TEXT+CHECK(허용 목록 일치), API role 권한 회수 + RLS ON, 정책·FORCE·GRANT 없음', () => {
  const sql = read('prisma/migrations/20260916090000_user_feedback_v1/migration.sql').replace(/--.*$/gm, '');
  assert.match(sql, /CREATE TABLE "user_feedback"/);
  assert.ok(!/CREATE TYPE|ENUM/i.test(sql), 'PG enum 사용 안 함');
  assert.ok(!/\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i.test(sql.replace(/"updated_at"/g, '')), '파괴적/데이터 변경 없음');
  assert.ok(!/ALTER TABLE "(?!user_feedback")/.test(sql), '다른 테이블 변경 없음');
  assert.ok(!/REFERENCES/i.test(sql), 'FK 없음');
  const list = (s: string) => s.match(/'([A-Z_]+)'/g)!.map((x) => x.slice(1, -1));
  assert.deepEqual(list(sql.match(/"user_feedback_category_check" CHECK \("category" IN \(([^)]*)\)\)/)![1]), [...FEEDBACK_CATEGORIES]);
  assert.deepEqual(list(sql.match(/"user_feedback_status_check" CHECK \("status" IN \(([^)]*)\)\)/)![1]), [...FEEDBACK_STATUSES]);
  assert.match(sql, /"status" TEXT NOT NULL DEFAULT 'NEW'/);
  assert.match(sql, /api_roles CONSTANT TEXT\[\] := ARRAY\['anon', 'authenticated', 'service_role'\];/);
  assert.match(sql, /EXECUTE format\('REVOKE ALL ON TABLE "user_feedback" FROM %I', r\);/);
  assert.match(sql, /ALTER TABLE "user_feedback" ENABLE ROW LEVEL SECURITY;/);
  assert.ok(!/CREATE POLICY|FORCE ROW LEVEL SECURITY|\bGRANT\b/i.test(sql));
  assert.match(sql, /set_config\('lock_timeout', '3s', true\)/);
  for (const col of ['admin_note', 'ip_hash', 'notified_at', 'resolved_at', 'page_query', 'user_agent']) assert.match(sql, new RegExp(`"${col}" `));
  // Prisma 모델과 컬럼 매핑 일치
  const schema = read('prisma/schema.prisma');
  const model = schema.slice(schema.indexOf('model UserFeedback {'), schema.indexOf('@@map("user_feedback")') + 30);
  for (const col of ['user_id', 'page_path', 'page_query', 'apt_seq', 'apartment_name', 'lawd_cd', 'user_agent', 'ip_hash', 'notified_at', 'admin_note', 'resolved_at', 'created_at', 'updated_at']) {
    assert.match(model, new RegExp(`@map\\("${col}"\\)`));
    assert.match(sql, new RegExp(`"${col}"`));
  }
  assert.match(model, /status\s+String\s+@default\("NEW"\)/);
});

test('24. Data API 가정 유지 — 의견 코드는 Supabase 클라이언트·service role 키를 쓰지 않고 서버 Prisma만 쓴다', () => {
  const files = [
    'src/app/api/feedback/route.ts',
    'src/app/api/admin/feedback/route.ts',
    'src/app/api/admin/feedback/[id]/route.ts',
    'src/lib/feedback/feedback-repo-prisma.ts',
    'src/lib/feedback/feedback-service.ts',
    'src/app/feedback/feedback-client.tsx',
    'src/app/admin/feedback/page.tsx',
  ];
  for (const f of files) {
    const src = read(f);
    assert.ok(!/@supabase|createClient\(|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_KEY|\/rest\/v1/.test(src), `${f}: Supabase Data API 경로 없음`);
  }
  assert.match(read('src/lib/feedback/feedback-repo-prisma.ts'), /import 'server-only';/);
  const client = read('src/app/feedback/feedback-client.tsx') + read('src/app/admin/feedback/page.tsx');
  assert.ok(!/RESEND_API_KEY|FEEDBACK_NOTIFICATION_EMAIL|FEEDBACK_EMAIL_FROM|FEEDBACK_HASH_SECRET|NEXTAUTH_SECRET/.test(client), '클라이언트에 서버 env 이름 없음');
  assert.ok(!/NEXT_PUBLIC_(RESEND|FEEDBACK)/.test(read('src/app/api/feedback/route.ts') + read('src/lib/feedback/feedback-email.ts')));
});

test('모바일 폼 — 44px 이상 터치 영역, 16px 입력, 제출 중 비활성, 성공/실패 문구', () => {
  const css = read('src/app/feedback/page.module.css');
  assert.match(css, /\.categoryBtn \{[\s\S]*?min-height: 44px;/);
  assert.match(css, /\.submitBtn \{[\s\S]*?min-height: 48px;/);
  assert.match(css, /\.textarea \{[\s\S]*?font-size: 16px;/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  const client = code('src/app/feedback/feedback-client.tsx');
  assert.match(client, /disabled=\{!canSubmit\}/);
  assert.match(client, /&& !submitting;/);
  assert.match(client, /maxLength=\{FEEDBACK_MESSAGE_MAX\}/);
  assert.equal(FEEDBACK_COPY.success, '의견을 보내주셔서 감사합니다.');
  assert.equal(FEEDBACK_COPY.failure, '의견을 보내지 못했어요. 잠시 후 다시 시도해 주세요.');
  assert.equal(FEEDBACK_COPY.placeholder, '어떤 점이 불편했는지 알려주세요.');
  // 진입점: MY에서 로그인 여부와 무관하게(세션 분기 밖) 노출
  const my = code('src/app/my/page.tsx');
  const logoutEnd = my.indexOf('로그아웃');
  const entry = my.indexOf('href="/feedback?from=%2Fmy"');
  assert.ok(entry > logoutEnd, '로그인 분기(로그아웃 버튼) 뒤, 공통 영역에 있다');
});
