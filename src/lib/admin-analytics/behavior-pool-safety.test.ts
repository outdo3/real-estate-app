import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isolate, unavailableLabels, valueOf } from '../admin-ops-runner';
import { rangeStart } from './query';

// BEHAVIOR_ANALYTICS_CONNECTION_POOL_SAFETY_V1 — 행동 분석의 DB 쿼리가 pool=1에서 동시에
// connection을 요청하지 않는다는 것과, 한 지표 실패가 거짓 0이 되지 않는다는 것을 고정한다.
// 숫자 동일성(A~G)의 운영 증거는 docs/development/BEHAVIOR_ANALYTICS_CONNECTION_POOL_SAFETY_V1.md
// (옛 구현 ↔ 새 구현 Production 대조, delta 0)에 있고, 여기서는 그 정의가 바뀌지 않았음을 고정한다.

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|--).*$/gm, '');
const QUERY = read('src/lib/admin-analytics/query.ts');
const ROUTE = read('src/app/api/admin/behavior/route.ts');
const PAGE = read('src/app/admin/behavior/page.tsx');
const summaryBody = () => {
  const code = stripComments(QUERY);
  const start = code.indexOf('export async function getBehaviorSummary');
  return code.slice(start, code.indexOf('const kpi: BehaviorKpi', start));
};

// ── 가짜 pool: connection 1개, pool_timeout ms 안에 못 얻으면 P2024 ─────────────────────
// Prisma의 실제 동작(요청 시점부터 pool_timeout 타이머가 돈다)을 그대로 흉내 낸다.
function fakePool(timeoutMs: number) {
  let busy = false;
  const queue: { grant: () => void }[] = [];
  const release = () => {
    const next = queue.shift();
    if (next) next.grant();
    else busy = false;
  };
  const acquire = () =>
    new Promise<void>((resolveAcq, rejectAcq) => {
      if (!busy) {
        busy = true;
        resolveAcq();
        return;
      }
      const entry = { grant: () => { clearTimeout(timer); resolveAcq(); } };
      const timer = setTimeout(() => {
        queue.splice(queue.indexOf(entry), 1);
        rejectAcq(Object.assign(new Error('Timed out fetching a new connection'), { code: 'P2024' }));
      }, timeoutMs);
      queue.push(entry);
    });
  const run = async (ms: number) => {
    await acquire();
    await new Promise((r) => setTimeout(r, ms));
    release();
  };
  return { run };
}

const SIX = 6;

test('§8 pool=1 + 다른 요청이 connection 점유 중 — Promise.all은 줄 뒤쪽이 P2024, 순차는 0', async () => {
  // 점유 150ms, pool_timeout 200ms, 쿼리 30ms × 6
  const parallelPool = fakePool(200);
  const occupierA = parallelPool.run(150);
  const par = await Promise.allSettled(Array.from({ length: SIX }, () => parallelPool.run(30)));
  await occupierA;
  const parRejected = par.filter((r) => r.status === 'rejected').length;

  const seqPool = fakePool(200);
  const occupierB = seqPool.run(150);
  let seqRejected = 0;
  for (let i = 0; i < SIX; i++) {
    try {
      await seqPool.run(30);
    } catch {
      seqRejected++;
    }
  }
  await occupierB;

  assert.ok(parRejected >= 3, `Promise.all이 기대만큼 죽지 않았다(${parRejected}/6) — 시뮬레이션 전제가 틀렸다`);
  assert.equal(seqRejected, 0, '순차 실행에서 P2024가 났다');
});

// ── I. 순차 실행 · 순서 ───────────────────────────────────────────────────────────────

test('§I getBehaviorSummary 안에 Promise.all/allSettled가 없다', () => {
  const body = summaryBody();
  assert.ok(!/Promise\.all(Settled)?\(/.test(body), '행동 분석이 DB 쿼리를 동시에 띄운다');
  assert.ok(!/Promise\.all(Settled)?\(/.test(stripComments(ROUTE)), '라우트가 DB 쿼리를 동시에 띄운다');
});

test('§I 쿼리 6개가 정해진 순서로 하나씩 await된다 — 핵심 집계가 맨 앞', () => {
  const body = summaryBody();
  const order = [
    'const counts = await fetchCombinedCounts(since)',
    "await m('engagedSessions', () => countEngagedSessions(since))",
    "await m('searchCount', () => prisma.searchLog.count(",
    "await m('popularApartments', () => fetchPopularApartments(since))",
    "await m('popularRegions', () => fetchPopularRegions(since))",
    "await m('nextActionBreakdown', () => fetchNextActionBreakdown(since))",
  ];
  let at = -1;
  for (const step of order) {
    const i = body.indexOf(step);
    assert.ok(i > at, `순서가 다르거나 빠졌다: ${step}`);
    at = i;
  }
  // 새 추상화가 아니라 ops·dashboard와 같은 헬퍼
  assert.ok(/import \{ isolate, unavailableLabels, valueOf \} from '@\/lib\/admin-ops-runner';/.test(QUERY));
});

// ── H. 한 지표 실패 ───────────────────────────────────────────────────────────────────

test('§H 한 지표가 P2024로 죽어도 나머지는 산다 — 실패 칸은 null이고 이름이 실린다', async () => {
  const seen: string[] = [];
  const onErr = (k: string) => seen.push(k);
  const ok = await isolate('popularRegions', async () => [{ lawdCd: '26350', dong: '우동', detailViews: 3 }], onErr);
  const dead = await isolate('popularApartments', async () => { throw Object.assign(new Error('pool'), { code: 'P2024' }); }, onErr);
  assert.equal(valueOf(dead), null, '실패한 목록이 빈 배열/0으로 덮였다');
  assert.deepEqual(valueOf(ok), [{ lawdCd: '26350', dong: '우동', detailViews: 3 }]);
  assert.deepEqual(seen, ['popularApartments']);
  assert.deepEqual(unavailableLabels([{ label: '인기 단지 TOP 10', metric: dead }, { label: '관심 지역 TOP 10', metric: ok }]), ['인기 단지 TOP 10']);
});

test('§H 부분 실패 지표 5개가 전부 degradedMetrics에 연결돼 있다 — 핵심 집계는 예전처럼 전체 실패', () => {
  const body = summaryBody();
  for (const label of ['참여 세션', '검색(AI 검색) 수', '인기 단지 TOP 10', '관심 지역 TOP 10', '다음 행동 유형']) {
    assert.ok(body.includes(`label: '${label}'`), `${label}이 degradedMetrics에 없다`);
  }
  // 핵심 집계는 isolate로 감싸지 않는다 — 실패하면 KPI를 정직하게 보여줄 수 없으므로 전체 실패(500).
  assert.ok(!/m\('combinedCounts'/.test(body));
});

test('§H 라우트: 부분 실패는 전용 category로 기록하고, 전체 실패 category는 그대로다', () => {
  const code = stripComments(ROUTE);
  assert.ok(/category: 'ADMIN_BEHAVIOR_METRIC_FAILURE'/.test(code));
  assert.ok(/category: 'ADMIN_BEHAVIOR_FAILURE'/.test(code));
  assert.ok(/'ADMIN_BEHAVIOR_METRIC_FAILURE',/.test(read('src/lib/admin/log-admin-failure.ts')));
});

test('§10 캐시: 7일/30일 TTL은 그대로, 오늘은 캐시 없음, 부분 실패 결과는 캐시하지 않는다', () => {
  const code = stripComments(ROUTE);
  assert.ok(/const CACHE_TTL_MS = 5 \* 60 \* 1000;/.test(code), 'TTL이 바뀌었다');
  assert.ok(/range === 'today'\s*\?\s*await getBehaviorSummary\(range, \{ onMetricError \}\)/.test(code), '오늘이 캐시를 탄다');
  assert.ok(/shouldCache: \(v\) => v\.degradedMetrics\.length === 0/.test(code), '부분 실패 결과를 5분간 붙잡는다');
});

test('§4 화면이 조회 실패(null)를 0이나 "데이터 없음"으로 그리지 않는다', () => {
  assert.ok(/n === null \? '확인 불가'/.test(PAGE), 'num()이 null을 처리하지 않는다');
  for (const list of ['popularApartments', 'popularRegions', 'nextActionBreakdown']) {
    assert.ok(new RegExp(`d\\.${list} === null \\? \\(\\s*<div className=\\{styles\\.noData\\}>확인 불가</div>`).test(PAGE), `${list} 실패가 "데이터 없음"으로 보인다`);
  }
  assert.ok(/d\.degradedMetrics\.length > 0/.test(PAGE), '부분 실패 배너가 없다');
});

// ── B~G. 정의 불변 ────────────────────────────────────────────────────────────────────

test('§B~D 기간 계약 그대로 — 오늘/7일/30일 = KST 달력일', () => {
  const now = new Date('2026-09-22T03:30:00.000Z'); // 12:30 KST
  assert.equal(rangeStart('today', now).toISOString(), '2026-09-21T15:00:00.000Z');
  assert.equal(rangeStart('7d', now).toISOString(), '2026-09-15T15:00:00.000Z');
  assert.equal(rangeStart('30d', now).toISOString(), '2026-08-23T15:00:00.000Z');
});

test('§E~G 참여 세션·퍼널·finance_fit_start 제외 정의가 그대로다', () => {
  const code = stripComments(QUERY);
  assert.ok(/const engagedSessions = valueOf\(engagedM\);/.test(code));
  assert.ok(/export async function countEngagedSessions\(since: Date\)/.test(code));
  assert.ok(/split_part\(url, '\?', 1\) IN \(\$\{Prisma\.join\(\[\.\.\.DECISION_ACTION_EVENT_URLS\]\)\}\)/.test(code), '퍼널 결정 단계 정의가 바뀌었다');
  const decision = code.slice(code.indexOf('as detail_sessions'), code.indexOf('as decision_sessions'));
  assert.ok(!decision.includes('finance_fit_start'), 'finance_fit_start가 퍼널에 돌아왔다');
});
