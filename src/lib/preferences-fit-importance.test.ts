import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { FIT_AXES, FIT_AXIS_LABELS, parseFitImportance, readStoredFitImportance, type FitImportance } from './fit-importance';
import {
  handleGetPreferences,
  handlePutPreferences,
  parsePreferencesPatch,
  type PreferencesAuth,
  type PreferencesStore,
  type StoredPreferences,
} from './preferences-handlers';

/**
 * PERSONALIZED_SCORE_V1 P2-A — 중요도 저장 검증·API 계약.
 * 저장소는 실제 Prisma upsert 의미(주어진 필드만 갱신, null=DB NULL)를 흉내 내는 fake로, 라우트 배선은 소스 검사로 고정.
 */

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const VALID: FitImportance = { transport: 5, living: 3, newness: 4, parking: 5, elementarySchoolAccess: 2 };
const authAs = (id: string): PreferencesAuth => ({ error: null, status: 200, user: { id } });
const ANON: PreferencesAuth = { error: '로그인이 필요합니다.', status: 401, user: null };

function fakeStore(seed: Record<string, StoredPreferences> = {}) {
  const rows = new Map<string, StoredPreferences>(Object.entries(seed).map(([k, v]) => [k, structuredClone(v)]));
  const calls = { find: [] as string[], upsert: [] as string[] };
  const store: PreferencesStore = {
    async find(userId) {
      calls.find.push(userId);
      const r = rows.get(userId);
      return r ? structuredClone(r) : null;
    },
    async upsert(userId, patch) {
      calls.upsert.push(userId);
      const cur = rows.get(userId) ?? { purposes: [], fitImportance: null }; // DB default [] / NULL
      const next: StoredPreferences = {
        purposes: patch.purposes !== undefined ? patch.purposes : cur.purposes,
        fitImportance: patch.fitImportance !== undefined ? patch.fitImportance : cur.fitImportance,
      };
      rows.set(userId, structuredClone(next));
      return structuredClone(next);
    },
  };
  return { store, rows, calls };
}

// ── 검증 ──────────────────────────────────────────────────────────────────────

test('축 key·표시명: 정확히 5개, "학군" 없음', () => {
  assert.deepEqual([...FIT_AXES], ['transport', 'living', 'newness', 'parking', 'elementarySchoolAccess']);
  assert.deepEqual(FIT_AXIS_LABELS, { transport: '교통', living: '생활편의', newness: '신축', parking: '주차', elementarySchoolAccess: '초등학교 접근성' });
  const src = read('src/lib/fit-importance.ts').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/학군|schoolDistrict|school_district/i.test(src));
});

test('1·2·3. 유효한 5축 객체, 경계값 1과 5 통과(입력과 분리된 새 객체)', () => {
  const r = parseFitImportance(VALID);
  assert.ok(r.ok);
  assert.deepEqual(r.value, VALID);
  assert.notEqual(r.value, VALID);
  const ones = Object.fromEntries(FIT_AXES.map((a) => [a, 1]));
  const fives = Object.fromEntries(FIT_AXES.map((a) => [a, 5]));
  assert.ok(parseFitImportance(ones).ok);
  assert.ok(parseFitImportance(fives).ok);
});

test('4·5·6·7. 0·6·소수·문자열 숫자·null·NaN·Infinity·중첩 값 거부', () => {
  for (const bad of [0, 6, -1, 2.5, '3', null, NaN, Infinity, { v: 3 }, [3], true]) {
    const r = parseFitImportance({ ...VALID, living: bad });
    assert.deepEqual(r, { ok: false, error: 'INVALID_VALUE' }, `living=${String(bad)}`);
  }
});

test('8·9. 모르는 key·누락 key 거부(완전한 5축만)', () => {
  assert.deepEqual(parseFitImportance({ ...VALID, schoolDistrict: 3 }), { ok: false, error: 'UNKNOWN_KEY' });
  const { parking: _omit, ...missing } = VALID;
  void _omit;
  assert.deepEqual(parseFitImportance(missing), { ok: false, error: 'MISSING_KEY' });
  assert.deepEqual(parseFitImportance({}), { ok: false, error: 'MISSING_KEY' });
});

test('10. 배열·null·문자열·숫자·클래스 인스턴스·프로토타입 오염 시도 거부', () => {
  for (const bad of [[], [5, 3, 4, 5, 2], null, undefined, 'x', 5, new Date(), new Map()]) {
    assert.equal(parseFitImportance(bad).ok, false, String(bad));
  }
  const polluted = JSON.parse('{"transport":5,"living":3,"newness":4,"parking":5,"elementarySchoolAccess":2,"__proto__":{"admin":true}}');
  assert.deepEqual(parseFitImportance(polluted), { ok: false, error: 'UNKNOWN_KEY' });
  assert.equal(({} as Record<string, unknown>).admin, undefined);
  const inherited = Object.create({ transport: 5, living: 3, newness: 4, parking: 5, elementarySchoolAccess: 2 });
  assert.equal(parseFitImportance(inherited).ok, false, '상속 속성은 key로 인정하지 않는다');
});

test('저장값 읽기: NULL/규칙 위반 저장값은 미설정(null)', () => {
  assert.equal(readStoredFitImportance(null), null);
  assert.equal(readStoredFitImportance(undefined), null);
  assert.equal(readStoredFitImportance({}), null);
  assert.equal(readStoredFitImportance({ ...VALID, living: 9 }), null);
  assert.deepEqual(readStoredFitImportance(VALID), VALID);
});

test('PUT body 파싱: 빈 객체 fitImportance는 400(미설정/설정 경계 유지), null은 초기화, 필드 없음 400', () => {
  assert.equal(parsePreferencesPatch({ fitImportance: {} }).ok, false);
  assert.deepEqual(parsePreferencesPatch({ fitImportance: null }), { ok: true, patch: { fitImportance: null } });
  assert.equal(parsePreferencesPatch({}).ok, false);
  assert.equal(parsePreferencesPatch([]).ok, false);
  assert.equal(parsePreferencesPatch(null).ok, false);
  assert.deepEqual(parsePreferencesPatch({ purposes: ['BUY'] }), { ok: true, patch: { purposes: ['BUY'] } });
  assert.equal(parsePreferencesPatch({ purposes: ['BUY'], fitImportance: { transport: 5 } }).ok, false, '둘 중 하나라도 잘못되면 아무것도 저장 안 함');
  assert.equal(parsePreferencesPatch({ purposes: ['NOPE'] }).ok, false, '기존 purposes 검증 유지');
});

// ── API 계약 ──────────────────────────────────────────────────────────────────

test('11·12. GET: 미설정 null / 설정값 반환, 행 없음 → purposes [] + fitImportance null', async () => {
  const { store } = fakeStore({ u1: { purposes: ['BUY'], fitImportance: null }, u2: { purposes: [], fitImportance: VALID } });
  assert.deepEqual((await handleGetPreferences(authAs('u1'), store)).body, { success: true, data: { purposes: ['BUY'], fitImportance: null } });
  assert.deepEqual((await handleGetPreferences(authAs('u2'), store)).body, { success: true, data: { purposes: [], fitImportance: VALID } });
  assert.deepEqual((await handleGetPreferences(authAs('nobody'), store)).body, { success: true, data: { purposes: [], fitImportance: null } });
});

test('11. null로 초기화: fitImportance만 NULL, purposes 유지', async () => {
  const { store, rows } = fakeStore({ u1: { purposes: ['BUY', 'JEONSE'], fitImportance: VALID } });
  const res = await handlePutPreferences(authAs('u1'), { fitImportance: null }, store);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true, data: { purposes: ['BUY', 'JEONSE'], fitImportance: null } });
  assert.deepEqual(rows.get('u1'), { purposes: ['BUY', 'JEONSE'], fitImportance: null });
});

test('13. purposes만 수정 → fitImportance 유지 (MY 화면의 기존 요청 형태 {purposes})', async () => {
  const { store, rows } = fakeStore({ u1: { purposes: ['BUY'], fitImportance: VALID } });
  const res = await handlePutPreferences(authAs('u1'), { purposes: ['SELL'] }, store);
  assert.deepEqual(res.body, { success: true, data: { purposes: ['SELL'], fitImportance: VALID } });
  assert.deepEqual(rows.get('u1')!.fitImportance, VALID);
  assert.match(read('src/app/my/page.tsx'), /body: JSON\.stringify\(\{ purposes: next \}\)/);
});

test('14. fitImportance만 수정 → purposes 유지, 행이 없으면 purposes [] 기본값으로 생성', async () => {
  const { store, rows } = fakeStore({ u1: { purposes: ['BUY', 'INVEST'], fitImportance: null } });
  const res = await handlePutPreferences(authAs('u1'), { fitImportance: VALID }, store);
  assert.deepEqual(res.body, { success: true, data: { purposes: ['BUY', 'INVEST'], fitImportance: VALID } });
  const created = await handlePutPreferences(authAs('u9'), { fitImportance: VALID }, store);
  assert.deepEqual(created.body, { success: true, data: { purposes: [], fitImportance: VALID } });
  assert.deepEqual(rows.get('u9'), { purposes: [], fitImportance: VALID });
});

test('잘못된 fitImportance는 400이고 저장소를 부르지 않는다(기존 값 보존)', async () => {
  const { store, rows, calls } = fakeStore({ u1: { purposes: ['BUY'], fitImportance: VALID } });
  for (const bad of [{}, { ...VALID, living: 0 }, { ...VALID, extra: 1 }, [1, 2, 3, 4, 5], '5']) {
    const res = await handlePutPreferences(authAs('u1'), { fitImportance: bad }, store);
    assert.equal(res.status, 400);
  }
  assert.equal(calls.upsert.length, 0);
  assert.deepEqual(rows.get('u1'), { purposes: ['BUY'], fitImportance: VALID });
});

test('15·16. 다른 사용자 읽기/쓰기 불가: 저장소 key는 세션 사용자뿐, body의 userId 무시', async () => {
  const { store, rows, calls } = fakeStore({ victim: { purposes: ['BUY'], fitImportance: VALID } });
  const read1 = await handleGetPreferences(authAs('attacker'), store);
  assert.deepEqual(read1.body, { success: true, data: { purposes: [], fitImportance: null } });
  await handlePutPreferences(authAs('attacker'), { userId: 'victim', fitImportance: { ...VALID, transport: 1 } }, store);
  assert.deepEqual(rows.get('victim'), { purposes: ['BUY'], fitImportance: VALID });
  assert.deepEqual([...calls.find, ...calls.upsert], ['attacker', 'attacker']);
  const route = read('src/app/api/my/preferences/route.ts');
  assert.ok(!/searchParams|userId:\s*body|body\.userId|params/.test(route));
  assert.match(route, /const auth = await requireUser\(\);/);
});

test('17. 비로그인·차단 계정: 기존과 같은 401/403, 저장소 호출 없음', async () => {
  const { store, calls } = fakeStore();
  const g = await handleGetPreferences(ANON, store);
  const p = await handlePutPreferences(ANON, { fitImportance: VALID }, store);
  const banned = await handlePutPreferences({ error: '커뮤니티 이용이 제한된 계정입니다.', status: 403, user: null }, { purposes: [] }, store);
  assert.deepEqual([g.status, p.status, banned.status], [401, 401, 403]);
  assert.deepEqual(g.body, { success: false, error: '로그인이 필요합니다.' });
  assert.equal(calls.find.length + calls.upsert.length, 0);
});

test('저장 실패 로그에 선호 내용·오류 원문을 넣지 않는다', async () => {
  const logs: unknown[] = [];
  const failing: PreferencesStore = {
    find: async () => Promise.reject(Object.assign(new Error('Invalid invocation {"fitImportance":{"transport":5}}'), { code: 'P2000' })),
    upsert: async () => Promise.reject(Object.assign(new Error('data: {"fitImportance":{"transport":5}}'), { code: 'P2002' })),
  };
  const g = await handleGetPreferences(authAs('u1'), failing, (m, meta) => logs.push([m, meta]));
  const p = await handlePutPreferences(authAs('u1'), { fitImportance: VALID }, failing, (m, meta) => logs.push([m, meta]));
  assert.deepEqual([g.status, p.status], [500, 500]);
  assert.deepEqual(logs, [['Failed to get preferences', { code: 'P2000' }], ['Failed to update preferences', { code: 'P2002' }]]);
  assert.ok(!JSON.stringify([g.body, p.body]).includes('transport'));
});

// ── 배선·스키마·migration·보안 ─────────────────────────────────────────────────

test('route: 필드별 부분 갱신·null은 DbNull·no-store·오류 원문 미로그', () => {
  const route = read('src/app/api/my/preferences/route.ts');
  const storeSrc = read('src/lib/preferences-prisma-store.ts');
  assert.match(route, /const store = createPreferencesStore\(prisma\);/);
  assert.match(storeSrc, /patch\.fitImportance === null \? Prisma\.DbNull : patch\.fitImportance/);
  assert.match(storeSrc, /\.\.\.\(patch\.purposes !== undefined && \{ purposes: patch\.purposes \}\)/);
  assert.match(storeSrc, /\.\.\.\(fit !== undefined && \{ fitImportance: fit \}\)/);
  assert.match(route, /'Cache-Control': 'private, no-store'/);
  assert.match(route, /export const dynamic = 'force-dynamic';/);
  assert.ok(!/console\.error\([^)]*err\b/.test(route));
});

test('18. schema·migration: nullable Json 열 1개만 추가, default 없음, purposes 불변', () => {
  const schema = read('prisma/schema.prisma');
  const start = schema.indexOf('model UserPreference {');
  const model = schema.slice(start, schema.indexOf('@@map("user_preferences")', start));
  assert.match(model, /fitImportance Json\?\s+@map\("fit_importance"\)/);
  assert.match(model, /purposes\s+Json\s+@default\("\[\]"\)/);
  assert.ok(!/fitImportance[^\n]*@default/.test(model));
  const sql = read('prisma/migrations/20260915130000_personalized_score_v1_fit_importance/migration.sql').replace(/--.*$/gm, '');
  assert.match(sql, /ALTER TABLE "user_preferences" ADD COLUMN "fit_importance" JSONB;/);
  assert.ok(!/DEFAULT|NOT NULL|UPDATE|DELETE|DROP|GRANT|REVOKE|POLICY|ROW LEVEL|purposes/i.test(sql));
  assert.match(sql, /set_config\('lock_timeout', '3s', true\)/);
});

test('19. Batch A 보안 상태를 되돌리는 SQL이 없다(GRANT·RLS 해제 없음)', () => {
  const dir = join(ROOT, 'prisma/migrations/20260915130000_personalized_score_v1_fit_importance');
  const sql = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n').replace(/--.*$/gm, '');
  assert.ok(!/\bGRANT\b|DISABLE ROW LEVEL|NO FORCE|CREATE POLICY/i.test(sql));
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test('20. analytics·URL·로그로 중요도 값이 나가지 않는다', () => {
  const analytics = read('src/lib/analytics/trackEvent.ts');
  const ctx = analytics.slice(analytics.indexOf('export interface TrackEventContext'), analytics.indexOf('}', analytics.indexOf('export interface TrackEventContext')));
  assert.ok(!/fitImportance|importance/i.test(ctx), 'analytics context에 중요도 필드 없음');
  for (const f of walk(join(ROOT, 'src'))) {
    const src = readFileSync(f, 'utf8');
    if (!/fitImportance/.test(src)) continue;
    assert.ok(!/trackEvent\([^)]*fitImportance|gtag\([^)]*fitImportance/.test(src), `${f}: analytics로 전송`);
    assert.ok(!/console\.(log|info|warn|error)\([^)]*fitImportance/.test(src), `${f}: 로그 출력`);
    assert.ok(!/[?&]fitImportance=|searchParams\.(set|append)\(['"]fitImportance/.test(src), `${f}: URL에 포함`);
  }
});

test('범위: 중요도 사용처는 API·계산 엔진(P2-B)뿐, UI는 아직 없다', () => {
  const users = walk(join(ROOT, 'src')).filter((f) => /fit-importance|fit_importance|[fF]itImportance/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(/\\/g, '/').slice(f.replace(/\\/g, '/').indexOf('src/')));
  assert.deepEqual(users.sort(), ['src/app/api/my/preferences/route.ts', 'src/lib/fit-importance.ts', 'src/lib/personalized-score.ts', 'src/lib/preferences-handlers.ts', 'src/lib/preferences-prisma-store.ts'].sort());
  assert.ok(!users.some((f) => f.endsWith('.tsx')), 'UI(P2-C 이후) 없음');
});
