import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PhaseTimer, SLOW_REQUEST_THRESHOLD_MS, buildSlowSummary, formatPhases, newRequestId } from './phase-timer';

// ADMIN_OPS_LATENCY_INSTRUMENTATION_V1 — 계측 자체가 거짓말을 하면 다음 판단이 전부 틀어진다.
// 시계를 주입해 결정론적으로 검증한다.

/** 호출할 때마다 정해진 값을 돌려주는 가짜 시계. */
function fakeClock(...values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('구간 시간을 각각 기록한다', async () => {
  // start=0, a시작=0 a끝=100, b시작=100 b끝=250, total=250
  const t = new PhaseTimer(fakeClock(0, 0, 100, 100, 250, 250));
  await t.track('a', async () => 1);
  await t.track('b', async () => 2);
  assert.deepEqual(t.phases(), [
    { phase: 'a', ms: 100 },
    { phase: 'b', ms: 150 },
  ]);
  assert.equal(t.totalMs, 250);
});

test('같은 이름을 여러 번 재면 합산한다 — 반복 호출되는 지표용', async () => {
  const t = new PhaseTimer(fakeClock(0, 0, 10, 10, 35, 35));
  await t.track('db:x', async () => 1);
  await t.track('db:x', async () => 1);
  assert.deepEqual(t.phases(), [{ phase: 'db:x', ms: 35 }]);
});

test('예외가 나도 시간은 기록하고 그대로 다시 던진다', async () => {
  const t = new PhaseTimer(fakeClock(0, 0, 40, 40));
  await assert.rejects(
    () => t.track('boom', async () => { throw new Error('실패'); }),
    /실패/
  );
  assert.deepEqual(t.phases(), [{ phase: 'boom', ms: 40 }]);
});

test('동기 구간도 잰다 — 파일 읽기·직렬화', () => {
  const t = new PhaseTimer(fakeClock(0, 0, 7, 7));
  const v = t.trackSync('serialize', () => 'ok');
  assert.equal(v, 'ok');
  assert.deepEqual(t.phases(), [{ phase: 'serialize', ms: 7 }]);
});

test('중첩 구간을 이중으로 빼지 않는다 — unaccounted는 최상위만 기준으로 한다', async () => {
  // 바깥 0→200(200ms), 그 안에 안쪽 50→150(100ms). total 200.
  // 안쪽까지 빼면 unaccounted가 -100이 되어 거짓이 된다.
  const t = new PhaseTimer(fakeClock(0, 0, 50, 150, 200, 200, 200));
  await t.track('outer', async () => {
    await t.track('inner', async () => 1);
  });
  const phases = t.phases();
  assert.equal(phases.find((p) => p.phase === 'outer')!.ms, 200);
  assert.equal(phases.find((p) => p.phase === 'inner')!.ms, 100);
  assert.equal(t.unaccountedMs(), 0, '중첩을 이중으로 빼 음수가 됐다');
});

test('어느 구간에도 안 잡힌 시간이 unaccounted로 드러난다 — 계측 구멍을 숨기지 않는다', async () => {
  // start=0, a: 100→300(200ms), total=500 → 300ms가 미계측
  const t = new PhaseTimer(fakeClock(0, 100, 300, 500, 500));
  await t.track('a', async () => 1);
  assert.equal(t.unaccountedMs(), 300);
});

// ── 느린 요청만 기록 ─────────────────────────────────────────────────────────

test('§3 임계치 미만이면 아무것도 남기지 않는다 — 로그 폭주 금지', () => {
  const line = buildSlowSummary({
    endpoint: '/api/admin/ops', requestId: 'abcd1234',
    totalMs: SLOW_REQUEST_THRESHOLD_MS - 1, phases: [{ phase: 'a', ms: 10 }], unaccountedMs: 0,
  });
  assert.equal(line, null);
});

test('§3 임계치 이상이면 한 줄로 요약한다', () => {
  const line = buildSlowSummary({
    endpoint: '/api/admin/ops', requestId: 'abcd1234', totalMs: 5421,
    phases: [{ phase: 'auth', ms: 12 }, { phase: 'db:busanTotal', ms: 180 }],
    unaccountedMs: 42, extra: { cache: 'rebuild', reqIdx: 1 },
  });
  assert.ok(line);
  assert.match(line!, /^\[ADMIN_OPS_SLOW\] \/api\/admin\/ops rid=abcd1234 total=5421 unaccounted=42/);
  assert.match(line!, /cache=rebuild reqIdx=1/);
  assert.match(line!, /auth=12 db:busanTotal=180/);
});

test('§2 로그에 민감정보가 실리지 않는다 — 구간 이름과 숫자뿐', () => {
  const line = buildSlowSummary({
    endpoint: '/api/admin/ops', requestId: newRequestId(), totalMs: 9999,
    phases: [{ phase: 'db:busanCanceled', ms: 21 }], unaccountedMs: 0,
  })!;
  for (const forbidden of ['postgres://', 'password', 'SELECT', 'lawd_cd', '@', 'session', 'cookie', 'token']) {
    assert.ok(!line.toLowerCase().includes(forbidden.toLowerCase()), `민감/원문 토큰이 섞였다: ${forbidden}`);
  }
});

test('requestId는 난수 8자이고 매번 다르다 — 사용자와 연결되지 않는다', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newRequestId()));
  assert.equal(ids.size, 50, 'requestId가 겹친다');
  for (const id of ids) assert.match(id, /^[0-9a-z]{8}$/);
});

test('formatPhases는 phase=ms 나열이다', () => {
  assert.equal(formatPhases([{ phase: 'a', ms: 1 }, { phase: 'b', ms: 2.5 }]), 'a=1 b=2.5');
});

// ── 배선 계약 ────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const OPS = stripComments(read('src/app/api/admin/ops/route.ts'));

test('§1 성공 경로의 주요 구간이 전부 계측된다', () => {
  for (const phase of ['auth', 'cacheOrBuild', 'serialize', 'regionModel', 'proxy:sidoList', 'proxy:sigunguAll']) {
    assert.ok(OPS.includes(`'${phase}'`) || OPS.includes(`\`${phase}\``), `${phase} 구간이 계측되지 않는다`);
  }
  // DB 지표는 헬퍼 한 곳에서 일괄 계측된다.
  assert.ok(/timer\.track\(`db:\$\{key\}`/.test(OPS), 'DB 지표가 개별 계측되지 않는다');
  // 파일 읽기도 구간이다.
  for (const phase of ['file:manifest', 'file:cancelSnapshot', 'file:legacyBootstrap', 'file:cronRegistration']) {
    assert.ok(OPS.includes(phase), `${phase} 구간이 없다`);
  }
});

test('§4 캐시 hit / in-flight 대기 / rebuild를 구분한다', () => {
  assert.ok(/let ranBuild = false;/.test(OPS));
  assert.ok(/ranBuild = true;/.test(OPS));
  assert.ok(/ranBuild \? 'rebuild' :/.test(OPS));
  assert.ok(/'inflight-wait'/.test(OPS), 'in-flight 대기를 hit과 구분하지 않는다');
});

test('§3/§10 계측이 DB에 쓰지 않는다 — 서버 로그만', () => {
  // logIfSlow는 console.warn만 쓴다. error_logs 경로(logAdminFailure)는 오류용 그대로.
  const slowFn = OPS.slice(OPS.indexOf('function logIfSlow'), OPS.indexOf('async function buildNationwideRegionModel'));
  assert.ok(/console\.warn\(line\)/.test(slowFn));
  assert.ok(!/logAdminFailure|prisma\.|create\(/.test(slowFn), '성능 로그가 DB로 간다');
});

test('§7 콜드 인스턴스 판별 근거가 응답에 실린다', () => {
  assert.ok(/const MODULE_INIT_AT = Date\.now\(\);/.test(OPS));
  assert.ok(/let instanceRequestCount = 0;/.test(OPS));
  assert.ok(/likelyColdInstance: requestIndex === 1/.test(OPS));
});

test('§11 회귀 금지 — 기존 계약이 그대로 남아 있다', () => {
  assert.ok(/isTotalDbOutage\(dbMetrics\)/.test(OPS), '전체 장애 판정이 사라졌다');
  assert.ok(/withBudget\(/.test(OPS), '예산이 사라졌다');
  assert.ok(/lastKnownGood/.test(OPS), 'last-known-good이 사라졌다');
  assert.ok(/ttlFor: \(v\) =>/.test(OPS), 'degraded TTL이 사라졌다');
  assert.ok(!/Promise\.all\(\[[\s\S]*?prisma\./.test(OPS), 'prisma 쿼리가 다시 병렬이 됐다');
  assert.ok(/category: 'ADMIN_OPS_DB_SUMMARY_FAILURE'/.test(OPS));
});
