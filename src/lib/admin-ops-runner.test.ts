import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUDGET_EXCEEDED, difference, describeError, isolate, isTotalDbOutage, ok, unavailableLabels, unknown, valueOf, withBudget } from './admin-ops-runner';

// ADMIN_OPS_P2024_CONNECTION_POOL_FIX_V1 §11 — 장애 주입은 전부 여기(mock)에서 한다.
// Production에 고의 장애를 넣지 않는다.

class FakeP2024 extends Error {
  code = 'P2024';
  constructor() {
    super('Timed out fetching a new connection from the connection pool');
    this.name = 'PrismaClientKnownRequestError';
  }
}

// ── A. 단일 heavy query timeout → 전체 실패 아님 ──────────────────────────────

test('§A 무거운 쿼리 하나가 P2024로 죽어도 나머지 지표는 살아남는다', async () => {
  const failures: string[] = [];
  const note = (key: string) => failures.push(key);

  const total = await isolate('busanTotal', async () => 865291, note);
  const canceled = await isolate<number>('busanCanceled', async () => {
    throw new FakeP2024();
  }, note);
  const aptSeq = await isolate('aptSeqMissing', async () => 0, note);

  assert.equal(total.status, 'OK');
  assert.equal(canceled.status, 'UNKNOWN');
  assert.equal(aptSeq.status, 'OK');
  assert.deepEqual(failures, ['busanCanceled'], '실패가 다른 지표로 번졌다');
  // 전부 실패한 것이 아니므로 전체 장애가 아니다 → 라우트는 200을 낸다.
  assert.equal(isTotalDbOutage([total, canceled, aptSeq]), false);
});

test('§A 실패한 지표는 0이 아니라 null이다 — 거짓 0 금지', async () => {
  const canceled = await isolate<number>('busanCanceled', async () => {
    throw new FakeP2024();
  });
  assert.equal(valueOf(canceled), null);
  assert.notEqual(valueOf(canceled), 0);
});

test('§A 파생값도 거짓 숫자를 만들지 않는다 — 취소를 못 읽으면 유효(active)도 null', () => {
  const total = ok(865291);
  const canceledOk = ok(16314);
  const canceledUnknown = unknown<number>('PrismaClientKnownRequestError:P2024');

  assert.equal(difference(total, canceledOk), 848977);
  // 예전 코드는 `busanTotal - busanCanceled`였다. 취소 조회가 실패해 0이 되면
  // "유효 = 전체"가 되어 장애가 **정상보다 좋은 숫자**로 보인다. 그 경로를 막는다.
  assert.equal(difference(total, canceledUnknown), null);
  assert.equal(difference(unknown<number>('x'), canceledOk), null);
});

test('§A 못 읽은 지표의 이름이 화면 배너로 나간다', () => {
  const labels = unavailableLabels([
    { label: '부산 전체 row', metric: ok(1) },
    { label: '취소 거래 수', metric: unknown('PrismaClientKnownRequestError:P2024') },
    { label: '최근 거래일', metric: unknown('Error') },
  ]);
  assert.deepEqual(labels, ['취소 거래 수', '최근 거래일']);
});

// ── C. DB 전체 불가 → 전체 error ─────────────────────────────────────────────

test('§C 지표가 전부 실패하면 전체 장애로 판정한다', () => {
  const all = [unknown('x'), unknown('x'), unknown('x')];
  assert.equal(isTotalDbOutage(all), true);
  // 하나라도 살아 있으면 부분 실패다 — 전체 500으로 키우지 않는다.
  assert.equal(isTotalDbOutage([...all, ok(1)]), false);
  assert.equal(isTotalDbOutage([]), false, '빈 목록을 장애로 오판한다');
});

test('§9 로그에는 에러 종류만 남고 연결 문자열/쿼리 내용은 남지 않는다', () => {
  const d = describeError(new FakeP2024());
  assert.equal(d, 'PrismaClientKnownRequestError:P2024');
  assert.ok(!/postgres|password|@|connection pool/i.test(d), '민감 정보가 섞였다');
  assert.equal(describeError(new Error('boom')), 'Error');
  assert.equal(describeError('문자열 오류'), 'Error');
});

// ── 배선 계약: pool=1에서 절대 동시에 띄우지 않는다 ───────────────────────────

const ROOT = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const OPS_ROUTE = read('src/app/api/admin/ops/route.ts');
const OPS_UI = read('src/app/admin/ops/page.tsx');

test('§6 ops 라우트가 DB 쿼리를 Promise.all로 동시에 띄우지 않는다', () => {
  const code = stripComments(OPS_ROUTE);
  // 재발 방지의 핵심. connection_limit=1에서 Promise.all은 pool_timeout 타이머를
  // 동시에 돌려, 실행 시간이 30ms인 쿼리까지 대기 중 P2024로 죽인다(실측 7/9).
  assert.ok(!/Promise\.all\(\[[\s\S]*?prisma\./.test(code), 'prisma 쿼리가 다시 Promise.all로 묶였다');
  assert.ok(!/await Promise\.all\(\[\s*\n\s*getRentVerifiedRange/.test(code), 'coverage 쿼리가 다시 병렬이다');
  // 지표는 하나씩 await한다.
  assert.ok(/const busanTotalM = await m\('busanTotal'/.test(code));
  // 무거운 지표는 여러 줄에 걸쳐 있다(예산 + 전용 캐시) — 이름으로만 확인한다.
  assert.ok(/const busanCanceledM = await m\(/.test(code));
  assert.ok(/'busanCanceled',/.test(code));
  assert.ok(/const saleRunKindsM = await m\('saleRunKinds'/.test(code));
});

test('§5 각 지표가 isolate()를 통과한다 — 한 조각 실패가 전체로 번지지 않는다', () => {
  const code = stripComments(OPS_ROUTE);
  assert.ok(/const m = <T,>\(key: string, run: \(\) => Promise<T>\) => isolate\(key, run, noteDbFailure\);/.test(code));
  assert.ok(/if \(isTotalDbOutage\(dbMetrics\)\)/.test(code), '전체 장애 판정이 없다');
});

test('§9 부분 실패가 전용 category로 기록된다', () => {
  const code = stripComments(OPS_ROUTE);
  assert.ok(/category: 'ADMIN_OPS_DB_SUMMARY_FAILURE'/.test(code));
  assert.ok(/metricKey: key/.test(code), '어느 지표가 실패했는지 남기지 않는다');
  // 기존 두 category도 그대로 살아 있어야 한다(회귀 금지).
  assert.ok(/category: 'ADMIN_OPS_FAILURE'/.test(code));
  assert.ok(/category: 'ADMIN_OPS_REGION_MODEL_FAILURE'/.test(code));
});

test('§3-C 재조회 실패 시 마지막으로 확인한 값을 stale 표시와 함께 내려준다', () => {
  const code = stripComments(OPS_ROUTE);
  assert.ok(/lastKnownGood = \{ data, at: new Date\(\)\.toISOString\(\) \}/.test(code));
  assert.ok(/if \(lastKnownGood\)/.test(code));
  assert.ok(/stale: \{ isStale: true, capturedAt: lastKnownGood\.at \}/.test(code), 'stale임을 숨긴다');
});

test('§4 무거운 요약은 기존 캐시 헬퍼를 그대로 쓴다 — in-flight dedupe 포함', () => {
  const code = stripComments(OPS_ROUTE);
  assert.ok(/getOrSetCache\('admin-ops:summary-v1_2', CACHE_TTL_MS, buildSummary/.test(code));
  // server-cache가 같은 key의 동시 요청을 하나로 묶는다(thundering herd 방지).
  const cache = stripComments(read('src/lib/server-cache.ts'));
  assert.ok(/const inFlight = new Map<string, Promise<unknown>>\(\)/.test(cache));
  assert.ok(/const pending = inFlight\.get\(key\);/.test(cache));
});

test('§12 화면이 읽지 못한 값을 0으로 그리지 않는다', () => {
  assert.ok(/function num\(v: number \| null \| undefined\): string/.test(OPS_UI));
  assert.ok(/'확인 불가'/.test(OPS_UI));
  // 예전처럼 값에 바로 toLocaleString을 걸면 null에서 터지거나 0이 된다.
  const code = stripComments(OPS_UI);
  for (const field of ['busanTotal', 'busanActive', 'busanCanceled', 'aptSeqMissing']) {
    assert.ok(!new RegExp(`d\\.tradeHistory\\.${field}\\.toLocaleString`).test(code), `${field}가 직접 포맷된다`);
  }
  assert.ok(!/d\.rentCoverage\.totalRows\.toLocaleString/.test(code));
  // 못 읽은 지표로 "정상" 배지를 찍지 않는다.
  assert.ok(/d\.tradeHistory\.aptSeqMissing === null \? '확인 불가'/.test(code));
  assert.ok(/d\.coverage\.busan\.covered === null \? '확인 불가'/.test(code));
});

// ── D/E. 예산 + 캐시 ──────────────────────────────────────

test('§3-E 예산 안에 끝나면 값을 그대로 돌려준다', async () => {
  const r = await isolate('fast', withBudget(async () => 42, 500));
  assert.deepEqual(r, { status: 'OK', value: 42 });
});

test('§3-E 예산을 넘기면 그 지표만 UNKNOWN이 된다 — 화면은 멈추지 않는다', async () => {
  const started = Date.now();
  const r = await isolate('slow', withBudget(() => new Promise((res) => setTimeout(() => res(1), 400)), 60));
  const elapsed = Date.now() - started;
  assert.equal(r.status, 'UNKNOWN');
  assert.equal(valueOf(r), null, '예산 초과를 0으로 바꿈');
  assert.ok(elapsed < 350, `응답이 예산만큼에서 끝나지 않았다: ${elapsed}ms`);
  assert.equal(r.error, BUDGET_EXCEEDED, '예산 초과가 다른 오류와 구분되지 않는다');
});

test('§3-E 예산을 넘겨도 원래 작업은 계속 돌아 다음에는 진짜 값이 온다', async () => {
  // getOrSetCache의 in-flight 공유를 모사한다 — 첫 호출은 예산을 넘기지만
  // 백그라운드에서 완성된 값이 캐시되어 두 번째는 즉시 응답한다.
  let cached: number | null = null;
  let inflight: Promise<number> | null = null;
  const heavy = () => {
    if (cached !== null) return Promise.resolve(cached);
    if (!inflight) {
      inflight = new Promise<number>((res) => setTimeout(() => res(16314), 150)).then((v) => {
        cached = v;
        return v;
      });
    }
    return inflight;
  };

  const first = await isolate('busanCanceled', withBudget(heavy, 40));
  assert.equal(first.status, 'UNKNOWN', '예산 초과가 날아가지 않았다');

  await new Promise((r) => setTimeout(r, 200)); // 백그라운드 완료 대기
  const second = await isolate('busanCanceled', withBudget(heavy, 40));
  assert.deepEqual(second, { status: 'OK', value: 16314 }, '다음 요청이 진짜 숫자를 못 본다');
});

test('§3/§4 무거운 지표가 맨 뒤에서 돌고, 자기 TTL 캐시와 예산을 갖는다', () => {
  const code = stripComments(OPS_ROUTE);
  const canceledAt = code.indexOf("'busanCanceled',");
  const rentLatestAt = code.indexOf("const rentLatestDealM = await m(");
  assert.ok(canceledAt > -1, 'busanCanceled 지표를 찾지 못했다');
  assert.ok(canceledAt > rentLatestAt, '무거운 지표가 앞에 있어 다른 지표를 기다리게 한다');
  assert.ok(/withBudget\(/.test(code), '예산이 없다');
  assert.ok(/getOrSetCache\('admin-ops:busan-canceled', BUSAN_CANCELED_TTL_MS/.test(code), '전용 캐시가 없다');
  assert.ok(/const BUSAN_CANCELED_TTL_MS = 30 \* 60 \* 1000;/.test(code));
  assert.ok(/const BUSAN_CANCELED_BUDGET_MS = 4000;/.test(code));
});

test('§4 부분 실패한 요약을 5분 내내 고정하지 않는다', () => {
  // 운영 실측: 콜드 시작 한 번에 "취소 거래 수"가 빠졌는데, 그 요약이 그대로
  // 5분 캐시되어 이후 모든 요청이 확인 불가를 보였다(degradedCounts 1이 연속).
  const code = stripComments(OPS_ROUTE);
  assert.ok(/const DEGRADED_CACHE_TTL_MS = 30 \* 1000;/.test(code));
  assert.ok(/ttlFor: \(v\) => \(v\.overall\.degradedSources\.length > 0 \? DEGRADED_CACHE_TTL_MS : CACHE_TTL_MS\)/.test(code));
  // 헬퍼가 값별 TTL을 실제로 지원해야 한다(옵션을 조용히 무시하면 위 계약이 거짓말이 된다).
  const cache = stripComments(read('src/lib/server-cache.ts'));
  assert.ok(/const effectiveTtl = options\?\.ttlFor \? options\.ttlFor\(value\) : ttlMs;/.test(cache));
  assert.ok(/expiresAt: Date\.now\(\) \+ effectiveTtl/.test(cache));
});
