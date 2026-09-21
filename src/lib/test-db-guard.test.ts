import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  NON_PRODUCTION_DB_HOSTS,
  assertTestWriteAllowed,
  detectTestRuntime,
  isProductionDatabaseUrl,
  isReadOnlyPrismaAction,
  resolveTestDbPolicy,
} from './test-db-guard';

const PROD = 'postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres';
const LOCAL = 'postgresql://u:p@localhost:5432/app';
const TESTDB = 'postgresql://u:p@127.0.0.1:5433/app_test';
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');

// ── 러너 감지 ────────────────────────────────────────────────────────────────

test('node:test(= npx tsx --test)를 감지한다 — package script를 우회해도 잡힌다', () => {
  // 실측값: Node가 자동으로 NODE_TEST_CONTEXT=child-v8 을 넣는다.
  assert.equal(detectTestRuntime({ NODE_TEST_CONTEXT: 'child-v8' }), 'NODE_TEST_CONTEXT');
});

test('vitest / jest / NODE_ENV=test / --test 플래그도 감지한다', () => {
  assert.equal(detectTestRuntime({ VITEST: 'true' }), 'VITEST');
  assert.equal(detectTestRuntime({ JEST_WORKER_ID: '1' }), 'JEST_WORKER_ID');
  assert.equal(detectTestRuntime({ NODE_ENV: 'test' }), 'NODE_ENV_TEST');
  assert.equal(detectTestRuntime({}, ['--test']), 'EXEC_ARGV_TEST');
  assert.equal(detectTestRuntime({}, ['--test-isolation=process']), 'EXEC_ARGV_TEST');
});

test('운영 런타임은 테스트로 오인되지 않는다', () => {
  assert.equal(detectTestRuntime({ NODE_ENV: 'production', VERCEL_ENV: 'production' }, []), null);
});

test('이 테스트 프로세스 자신이 실제로 테스트로 감지된다(자기 검증)', () => {
  assert.ok(detectTestRuntime(process.env as Record<string, string | undefined>, process.execArgv));
});

// ── DB 판별 ──────────────────────────────────────────────────────────────────

test('로컬 호스트 allowlist만 비-Production이다(추측 금지, 모르면 Production)', () => {
  for (const h of NON_PRODUCTION_DB_HOSTS) {
    // IPv6는 URL 문법상 대괄호가 필요하고, URL.hostname도 대괄호째 돌려준다.
    const authority = h.includes(':') ? `[${h}]` : h;
    assert.equal(isProductionDatabaseUrl(`postgresql://u:p@${authority}:5432/db`), false, h);
  }
  assert.equal(isProductionDatabaseUrl(PROD), true);
  assert.equal(isProductionDatabaseUrl('postgresql://u:p@some-unknown-host/db'), true, '모르는 원격은 Production으로 본다');
  assert.equal(isProductionDatabaseUrl('not a url'), true, '파싱 불가는 Production으로 본다');
  assert.equal(isProductionDatabaseUrl(undefined), false, 'URL이 없으면 연결 자체가 없다');
});

test('scripts/_prod-db-guard는 이 판정을 **위임**한다(사본을 다시 만들지 않는다)', () => {
  const code = read('scripts/_prod-db-guard.ts');
  assert.ok(code.includes("from '../src/lib/test-db-guard'"), 'scripts 가드가 판정을 위임하지 않는다');
  assert.ok(!/const localHosts\s*=/.test(code), 'scripts 가드가 호스트 목록 사본을 다시 들고 있다 — 두 판정이 갈라진다');
});

test('두 가드가 같은 입력에 같은 답을 낸다(parity)', async () => {
  const scriptsGuard = await import('../../scripts/_prod-db-guard');
  const cases = [
    'postgresql://u:p@localhost:5432/db',
    'postgresql://u:p@127.0.0.1:5432/db',
    'postgresql://u:p@[::1]:5432/db',
    'postgresql://u:p@0.0.0.0:5432/db',
    'postgresql://u:p@host.docker.internal:5432/db',
    PROD,
    'postgresql://u:p@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres',
    'postgresql://u:p@some-unknown-host/db',
    'not a url',
  ];
  for (const url of cases) {
    assert.equal(
      scriptsGuard.isProductionDatabaseUrl(url),
      isProductionDatabaseUrl(url),
      `두 가드의 판정이 다르다 (입력 형태: ${url.replace(/\/\/[^@]*@/, '//[redacted]@')})`
    );
  }
  assert.equal(scriptsGuard.isProductionDatabaseUrl(undefined), isProductionDatabaseUrl(undefined));
});

test('IPv6 localhost가 이제 로컬로 판정된다(회귀 방지) — 두 가드 모두', async () => {
  const scriptsGuard = await import('../../scripts/_prod-db-guard');
  const ipv6 = 'postgresql://u:p@[::1]:5432/db';
  assert.equal(isProductionDatabaseUrl(ipv6), false);
  assert.equal(scriptsGuard.isProductionDatabaseUrl(ipv6), false, '패치 전에는 여기서 true(=Production)였다');
});

// ── 정책 ─────────────────────────────────────────────────────────────────────

test('A · Production DB + 테스트 모드 → 쓰기 거부', () => {
  const p = resolveTestDbPolicy({ NODE_TEST_CONTEXT: 'child-v8', DATABASE_URL: PROD });
  assert.equal(p.writesAllowed, false);
  assert.equal(p.productionDb, true);
  assert.equal(p.testDatabaseConfigured, false);
  assert.match(p.reason, /NO_TEST_DATABASE_CONFIGURED/);
});

test('B · TEST_DATABASE_URL(비-Production) + 테스트 모드 → 허용', () => {
  const p = resolveTestDbPolicy({ NODE_TEST_CONTEXT: 'child-v8', DATABASE_URL: PROD, TEST_DATABASE_URL: TESTDB });
  assert.equal(p.writesAllowed, true, 'DATABASE_URL이 Production이어도 TEST_DATABASE_URL을 쓴다');
  assert.equal(p.testDatabaseConfigured, true);
});

test('B2 · TEST_DATABASE_URL이 Production을 가리키면 여전히 거부한다', () => {
  const p = resolveTestDbPolicy({ NODE_TEST_CONTEXT: 'child-v8', DATABASE_URL: LOCAL, TEST_DATABASE_URL: PROD });
  assert.equal(p.writesAllowed, false, 'TEST_ 접두사만 믿고 통과시키면 안 된다');
});

test('C · 로컬 DB + 테스트 모드 → 허용', () => {
  const p = resolveTestDbPolicy({ NODE_TEST_CONTEXT: 'child-v8', DATABASE_URL: LOCAL });
  assert.equal(p.writesAllowed, true);
});

test('D · 운영 런타임(Production DB, 테스트 아님) → 정상 동작', () => {
  const p = resolveTestDbPolicy({ NODE_ENV: 'production', DATABASE_URL: PROD }, []);
  assert.equal(p.testSignal, null);
  assert.equal(p.writesAllowed, true, '가드가 운영 앱을 막으면 안 된다');
});

// ── 쓰기 차단(fail-closed) ───────────────────────────────────────────────────

test('읽기 operation은 통과한다 — 의도된 read-only 통합 테스트를 깨지 않는다', () => {
  for (const a of ['findMany', 'findFirst', 'count', 'aggregate', 'groupBy', 'queryRaw']) {
    assert.ok(isReadOnlyPrismaAction(a), a);
    assert.doesNotThrow(() => assertTestWriteAllowed(a, 'ApartmentTradeHistory', { NODE_TEST_CONTEXT: '1', DATABASE_URL: PROD }));
  }
});

test('쓰기 operation은 Production DB + 테스트 모드에서 차단된다', () => {
  for (const a of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany', 'executeRaw']) {
    assert.equal(isReadOnlyPrismaAction(a), false, a);
    assert.throws(
      () => assertTestWriteAllowed(a, 'ErrorLog', { NODE_TEST_CONTEXT: '1', DATABASE_URL: PROD }),
      /Refusing to run tests against Production database/,
      a
    );
  }
});

test('모르는 operation은 쓰기로 본다(fail-closed)', () => {
  assert.equal(isReadOnlyPrismaAction('someFutureMutation'), false);
  assert.throws(() => assertTestWriteAllowed('someFutureMutation', 'X', { NODE_TEST_CONTEXT: '1', DATABASE_URL: PROD }));
});

test('E · 로컬/테스트 DB에서는 쓰기가 막히지 않는다', () => {
  assert.doesNotThrow(() => assertTestWriteAllowed('create', 'ErrorLog', { NODE_TEST_CONTEXT: '1', DATABASE_URL: LOCAL }));
  assert.doesNotThrow(() => assertTestWriteAllowed('create', 'ErrorLog', { NODE_TEST_CONTEXT: '1', DATABASE_URL: PROD, TEST_DATABASE_URL: TESTDB }));
});

test('운영 런타임에서는 쓰기가 막히지 않는다', () => {
  assert.doesNotThrow(() => assertTestWriteAllowed('create', 'ErrorLog', { NODE_ENV: 'production', DATABASE_URL: PROD }, []));
});

// ── F. 비밀값 노출 금지 ──────────────────────────────────────────────────────

test('F · 차단 메시지에 DATABASE_URL·호스트·자격증명이 들어가지 않는다', () => {
  try {
    assertTestWriteAllowed('create', 'ErrorLog', { NODE_TEST_CONTEXT: '1', DATABASE_URL: PROD });
    assert.fail('던졌어야 한다');
  } catch (e) {
    const msg = (e as Error).message;
    assert.ok(!msg.includes('db.abcdefgh.supabase.co'), '호스트가 노출됐다');
    assert.ok(!msg.includes('u:p'), '자격증명이 노출됐다');
    assert.ok(!msg.includes(PROD));
    assert.ok(msg.includes('Refusing to run tests against Production database'));
  }
});

// ── §12. 사고 경로 재현 ──────────────────────────────────────────────────────

test('§12 · 사고 경로 재현 — 주입 없이 기본 writer를 탔다면 쓰기 직전에 차단된다', async () => {
  // 사고 당시 경로: logAdminFailure → logServerError → prisma.errorLog.create.
  // 그 마지막 단계에 해당하는 가드를 같은 인자로 호출한다. **실제 DB에는 닿지 않는다.**
  assert.throws(
    () => assertTestWriteAllowed('create', 'ErrorLog', { NODE_TEST_CONTEXT: 'child-v8', DATABASE_URL: PROD }),
    /Refusing to run tests against Production database/
  );

  // 그리고 실제 writer(logServerError)가 그 가드를 실제로 호출하는지 소스로 확인한다.
  const code = read('src/lib/log-server-error.ts');
  assert.ok(code.includes('assertTestWriteAllowed'), 'writer가 가드를 거치지 않는다');
  const guardIdx = code.indexOf('assertTestWriteAllowed(');
  const writeIdx = code.indexOf('prisma.errorLog.create');
  assert.ok(guardIdx >= 0 && writeIdx > guardIdx, '가드가 쓰기보다 뒤에 있다');
});

test('§9 · prisma 싱글턴에도 가드가 붙어 있다(2중 보호)', () => {
  const code = read('src/lib/prisma.ts');
  assert.ok(code.includes('assertTestWriteAllowed'), 'prisma 미들웨어 가드가 없다');
  assert.ok(code.includes('policy.testSignal'), '운영 런타임에도 미들웨어가 붙으면 안 된다');
  assert.ok(code.includes('TEST_DATABASE_URL'), 'TEST_DATABASE_URL 우선 사용이 빠졌다');
});

test('§13 · admin 로깅 테스트는 여전히 writer를 주입한다(기본 writer 미사용)', () => {
  const code = read('src/lib/admin/log-admin-failure.ts');
  assert.ok(code.includes('write: AdminFailureWriter = defaultWriter'), '주입 seam이 사라졌다');
  assert.ok(code.includes("await import('@/lib/log-server-error')"), '기본 writer가 정적 import로 돌아갔다 — 테스트가 prisma를 끌어온다');
});
