import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ADMIN_FAILURE_CATEGORIES,
  DEDUPE_WINDOW_MS,
  __resetAdminFailureDedupeForTest,
  logAdminFailure,
  shouldLogAdminFailure,
} from './log-admin-failure';
import { buildErrorLogMessage, redactSensitive } from '@/lib/log-redaction';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');

// ── A/B. 실패 경로가 실제로 계측돼 있는가 (category별) ─────────────────────────

test('A · 관리자 핵심 실패 경로가 error_logs 기록을 호출한다', () => {
  const dashboard = read('src/app/api/admin/dashboard/route.ts');
  const ops = read('src/app/api/admin/ops/route.ts');
  const behavior = read('src/app/api/admin/behavior/route.ts');

  assert.ok(dashboard.includes('logAdminFailure'), '대시보드 실패가 기록되지 않는다');
  assert.ok(ops.includes('logAdminFailure'), '운영센터 실패가 기록되지 않는다');
  assert.ok(behavior.includes('logAdminFailure'), '행동분석 실패가 기록되지 않는다');

  assert.ok(dashboard.includes("'ADMIN_DASHBOARD_FAILURE'"));
  assert.ok(ops.includes("'ADMIN_OPS_FAILURE'"));
  assert.ok(behavior.includes("'ADMIN_BEHAVIOR_FAILURE'"));
});

test('B · 부분 실패(subsystem)는 전체 실패와 다른 category로 기록된다', () => {
  const ops = read('src/app/api/admin/ops/route.ts');
  assert.ok(ops.includes("'ADMIN_OPS_REGION_MODEL_FAILURE'"), 'region model 부분 실패가 구분되지 않는다');
  // 같은 파일에 두 category가 모두 있어야 "전체 실패 / 조각 실패"가 갈린다.
  assert.ok(ops.includes("'ADMIN_OPS_FAILURE'"));
  assert.notEqual(
    ops.indexOf("'ADMIN_OPS_REGION_MODEL_FAILURE'"),
    ops.indexOf("'ADMIN_OPS_FAILURE'"),
    '두 category가 같은 지점에서 나오면 구분이 아니다'
  );
});

test('모든 category가 상수 목록에 선언돼 있다(오타 방지)', () => {
  for (const c of ['ADMIN_DASHBOARD_FAILURE', 'ADMIN_OPS_FAILURE', 'ADMIN_OPS_REGION_MODEL_FAILURE', 'ADMIN_BEHAVIOR_FAILURE']) {
    assert.ok((ADMIN_FAILURE_CATEGORIES as readonly string[]).includes(c), `${c} 미선언`);
  }
});

// ── C. 로깅 실패가 관리자 처리를 더 망가뜨리지 않는다 ─────────────────────────

test('C · error_logs INSERT가 실패해도 logAdminFailure는 throw하지 않는다', () => {
  __resetAdminFailureDedupeForTest();
  // 쓰기 구현을 주입해 **DB에 닿지 않는다**. 동기 throw와 rejected promise 양쪽을 본다.
  const throwsSync: Parameters<typeof logAdminFailure>[1] = () => {
    throw new Error('insert failed');
  };
  assert.doesNotThrow(() =>
    logAdminFailure({ category: 'ADMIN_OPS_FAILURE', endpoint: '/api/admin/ops', error: new Error('db down') }, throwsSync)
  );

  __resetAdminFailureDedupeForTest();
  const rejects: Parameters<typeof logAdminFailure>[1] = () => Promise.reject(new Error('insert failed'));
  assert.doesNotThrow(() =>
    logAdminFailure({ category: 'ADMIN_OPS_FAILURE', endpoint: '/api/admin/ops', error: new Error('db down') }, rejects)
  );
});

test('C · 기록 내용이 실제로 넘어간다 — category/endpoint/latency (DB 없이 확인)', () => {
  __resetAdminFailureDedupeForTest();
  const calls: { message: string; url?: string }[] = [];
  logAdminFailure(
    { category: 'ADMIN_OPS_FAILURE', endpoint: '/api/admin/ops', error: new Error('db down'), latencyMs: 1234.6 },
    async (message, url) => { calls.push({ message, url }); }
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].message.startsWith('[ADMIN_OPS_FAILURE][Error] db down'));
  assert.ok(calls[0].message.includes('latencyMs=1235'));
  assert.equal(calls[0].url, '/api/admin/ops');
});

test('C · 호출부가 await하지 않아도 되도록 void를 반환한다(응답 경로를 붙잡지 않는다)', () => {
  __resetAdminFailureDedupeForTest();
  const returned = logAdminFailure(
    { category: 'ADMIN_DASHBOARD_FAILURE', endpoint: '/api/admin/dashboard', error: new Error('x') },
    async () => {}
  );
  assert.equal(returned, undefined, 'Promise를 돌려주면 호출부가 실수로 await할 수 있다');
});

test('E · 이 테스트 파일은 Production DB에 쓰지 않는다 — 쓰기는 주입으로만 한다', () => {
  const code = read('src/lib/admin/log-admin-failure.test.ts');
  // prisma를 직접 끌어오지 않는다(끌어오면 기본 writer가 실제 DB에 쓴다).
  // 리터럴을 쪼개 이 검사 문장 자신이 매칭되지 않게 한다.
  const prismaImport = '@/lib' + '/prisma';
  assert.ok(!code.includes(`from '${prismaImport}'`), '테스트가 prisma를 직접 import한다');
  // 모듈이 주입 seam을 제공하는지 — 기본 인자가 있어 length는 1이다.
  assert.equal(typeof logAdminFailure, 'function');
  assert.equal(logAdminFailure.length, 1, 'writer 주입 seam이 사라졌다');
});

test('C · 라우트는 로깅을 await하지 않는다 — 실패 응답이 늦어지면 안 된다', () => {
  for (const rel of [
    'src/app/api/admin/dashboard/route.ts',
    'src/app/api/admin/ops/route.ts',
    'src/app/api/admin/behavior/route.ts',
  ]) {
    assert.ok(!read(rel).includes('await logAdminFailure'), `${rel}가 로깅을 await한다`);
  }
});

// ── D. 민감정보가 기록되지 않는다 ─────────────────────────────────────────────

test('D · DB connection string은 마스킹된다', () => {
  const out = redactSensitive('connect failed postgresql://user:pw@host:5432/db?sslmode=require');
  assert.ok(!out.includes('user:pw'), 'DB 자격증명이 남았다');
  assert.ok(out.includes('[redacted-connection-string]'));
});

test('D · MOLIT serviceKey 등 키 파라미터는 값이 통째로 지워진다', () => {
  const out = redactSensitive('fetch failed https://api.example.com/v1?serviceKey=AbCd123%2Fxyz&lawdCd=26140');
  assert.ok(!out.includes('AbCd123'), 'serviceKey 값이 남았다');
  assert.ok(out.includes('[redacted]'));
  assert.ok(out.includes('lawdCd=26140'), '비밀이 아닌 값까지 지우면 진단이 불가능해진다');
});

test('D · 토큰/비밀번호/헤더가 마스킹된다', () => {
  const samples: [string, string][] = [
    ['access_token=ya29.someLongToken', 'ya29.someLongToken'],
    ['password: hunter2', 'hunter2'],
    ['client_secret=s3cr3tvalue', 's3cr3tvalue'],
    ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc', 'eyJhbGciOiJIUzI1NiJ9.abc'],
    ['Cookie: next-auth.session-token=abc123', 'abc123'],
  ];
  for (const [input, secret] of samples) {
    const out = redactSensitive(input);
    assert.ok(!out.includes(secret), `마스킹되지 않음: ${input} -> ${out}`);
  }
});

test('D · buildErrorLogMessage도 같은 마스킹을 거친다', () => {
  const msg = buildErrorLogMessage('ADMIN_OPS_FAILURE', new Error('P1001 postgresql://u:p@h/db unreachable'));
  assert.ok(!msg.includes('u:p@h'));
  assert.ok(msg.startsWith('[ADMIN_OPS_FAILURE]'), 'category가 message 접두사로 실려야 한다(스키마에 컬럼이 없다)');
});

test('D · 기록 필드는 스키마에 있는 것뿐이다 — IP/헤더/개인정보 컬럼을 만들지 않는다', () => {
  const code = read('src/lib/admin/log-admin-failure.ts');
  for (const forbidden of ['ip', 'userAgent', 'user_agent', 'headers', 'cookies', 'session']) {
    assert.ok(
      !new RegExp(`data:\\s*\\{[^}]*${forbidden}`, 'i').test(code),
      `ErrorLog에 없는 필드를 쓰려 한다: ${forbidden}`
    );
  }
});

// ── E. 정상 요청은 로그를 만들지 않는다 ───────────────────────────────────────

test('E · 성공 경로에는 로깅 호출이 없다 — catch 블록 안에서만 부른다', () => {
  for (const rel of [
    'src/app/api/admin/dashboard/route.ts',
    'src/app/api/admin/behavior/route.ts',
  ]) {
    const code = read(rel);
    const idxCatch = code.indexOf('} catch (error) {');
    const idxLog = code.indexOf('logAdminFailure({');
    assert.ok(idxCatch >= 0 && idxLog > idxCatch, `${rel}: 로깅이 catch 밖에 있다`);
  }
});

// ── 중복 억제(flood control) ─────────────────────────────────────────────────

test('같은 장애가 반복돼도 창 안에서는 한 번만 기록한다', () => {
  const seen = new Map<string, number>();
  const key = '/api/admin/ops|[ADMIN_OPS_FAILURE][Error] db down';
  assert.equal(shouldLogAdminFailure(seen, key, 0), true, '첫 발생은 기록해야 한다');
  assert.equal(shouldLogAdminFailure(seen, key, 1_000), false);
  assert.equal(shouldLogAdminFailure(seen, key, DEDUPE_WINDOW_MS - 1), false);
});

test('창이 지나면 다시 기록한다 — 장애가 계속된다는 사실을 잃지 않는다', () => {
  const seen = new Map<string, number>();
  const key = 'k';
  assert.equal(shouldLogAdminFailure(seen, key, 0), true);
  assert.equal(shouldLogAdminFailure(seen, key, DEDUPE_WINDOW_MS), true);
});

test('서로 다른 장애는 서로를 억제하지 않는다', () => {
  const seen = new Map<string, number>();
  assert.equal(shouldLogAdminFailure(seen, '/api/admin/ops|A', 0), true);
  assert.equal(shouldLogAdminFailure(seen, '/api/admin/ops|B', 0), true, '다른 오류가 억제되면 진단을 놓친다');
  assert.equal(shouldLogAdminFailure(seen, '/api/admin/dashboard|A', 0), true, '다른 엔드포인트도 별개다');
});

test('오래된 억제 항목은 정리돼 메모리가 무한히 늘지 않는다', () => {
  const seen = new Map<string, number>();
  for (let i = 0; i < 50; i++) shouldLogAdminFailure(seen, `k${i}`, 0);
  assert.equal(seen.size, 50);
  shouldLogAdminFailure(seen, 'fresh', DEDUPE_WINDOW_MS + 1);
  assert.equal(seen.size, 1, '창이 지난 항목이 남아 있다');
});

// ── 시스템 상태 라우트는 의도적으로 제외돼 있다 ───────────────────────────────

test('system-health는 기존 read-only 계약대로 쓰기를 추가하지 않았다', () => {
  const code = read('src/app/api/admin/system-health/route.ts');
  assert.ok(!code.includes('logAdminFailure'), 'ErrorLog를 읽는 라우트가 쓰기를 하면 read-only 계약이 깨진다');
  assert.ok(!code.includes('prisma.errorLog.create'));
});
