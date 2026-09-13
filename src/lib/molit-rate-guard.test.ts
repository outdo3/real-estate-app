import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  classifyMolitFailure,
  isRetryableMolitFailure,
  molitBackoffDelayMs,
  runMolitGuarded,
  currentMolitPacingMs,
  molitGateSnapshot,
  molitInFlightSize,
  __resetMolitGateForTest,
  MOLIT_BACKOFF_STEPS_MS,
  MOLIT_BASE_PACING_MS,
  MOLIT_BREAKER_PROBE_MS,
  MOLIT_BREAKER_WAIT_MESSAGE,
  MOLIT_BULK_SLOT_EVERY,
  MOLIT_CONCURRENCY,
  MOLIT_COOLDOWN_MAX_EXTRA_MS,
  MOLIT_COOLDOWN_STEP_MS,
  MOLIT_COOLDOWN_WINDOW_MS,
  MOLIT_MAX_ATTEMPTS,
  MOLIT_RETRY_BUDGET_MS,
} from './molit-rate-guard';
import { fetchMolitData } from './api-molit';
import {
  classifyMolitMonthResult,
  foldMonthResults,
  resolveTradeApiError,
  summarizeTradeCompleteness,
} from './apt-trade-completeness';

// E-JIP MOLIT PARTIAL FAILURE REDUCTION V1 — 네트워크 없이(주입한 1회 시도 함수와 가상
// 시계로) 게이트/차단기/재시도/dedup/신뢰 의미를 결정적으로 검증한다.

const RL_KO = 'OpenAPI Error: 초당 서비스 요청제한 횟수 초과 에러';
const RL_EN = 'OpenAPI Error: LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR';
const instant = async () => {};

/** sleep이 가상 시간을 앞으로 민다. 여러 요청이 같은 시계를 공유한다. */
function virtualClock(start = 1_000_000) {
  const clock = {
    t: start,
    now: () => clock.t,
    sleep: async (ms: number) => { clock.t += ms; await Promise.resolve(); },
  };
  return clock;
}

let seq = 0;
const uniqueLawdCd = () => `R${seq++}${process.hrtime.bigint().toString().slice(-6)}`;

const OK_ROW = (dealYmd: string) => ({ id: `apt-x-${dealYmd}-0`, name: '해운대경동제이드', typeLabel: '실거래', dealAmount: 50000, dealDate: `${dealYmd.slice(0, 4)}-${dealYmd.slice(4)}-10`, dealCanceled: false, cancelDate: '' });

beforeEach(() => __resetMolitGateForTest());

// 1
test('초당 요청제한 오류를 RATE_LIMIT으로 인식한다(한글 원문 / 영문 코드 / 차단기 대기 메시지)', () => {
  assert.equal(classifyMolitFailure(RL_KO), 'RATE_LIMIT');
  assert.equal(classifyMolitFailure(RL_EN), 'RATE_LIMIT');
  assert.equal(classifyMolitFailure(MOLIT_BREAKER_WAIT_MESSAGE), 'RATE_LIMIT');
  // 일일 한도는 기다려도 풀리지 않는다 — 재시도 대상이 아니다.
  assert.notEqual(classifyMolitFailure('OpenAPI Error: LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR'), 'RATE_LIMIT');
  assert.notEqual(classifyMolitFailure('OpenAPI Error: 서비스 요청제한 횟수 초과 에러'), 'RATE_LIMIT');
});

// 2 + 6
test('재시도는 RATE_LIMIT에만 적용된다 — 타임아웃/인증/잘못된 요청/파싱 실패는 1회로 끝나고 차단기도 열지 않는다', async () => {
  assert.equal(isRetryableMolitFailure('RATE_LIMIT'), true);
  for (const message of [
    'The operation was aborted due to timeout',
    'OpenAPI Error: SERVICE_KEY_IS_NOT_REGISTERED_ERROR',
    'DATA_GO_KR_API_KEY is not defined in environment variables.',
    '지원하지 않는 거래 유형입니다.',
    'No items found. Response: <html>...',
  ]) {
    let calls = 0;
    const { outcome, stats } = await runMolitGuarded(async () => { calls++; return { ok: false as const, message }; }, { sleep: instant });
    assert.equal(outcome.ok, false, message);
    assert.equal(calls, 1, `재시도하면 안 된다: ${message}`);
    assert.equal(stats.attempts, 1);
    assert.equal(stats.rateLimitHits, 0);
    assert.equal(isRetryableMolitFailure(classifyMolitFailure(message)), false, message);
    assert.equal(molitGateSnapshot().halfOpen, false, `제한이 아닌 실패가 차단기를 열었다: ${message}`);
  }
});

// 3
test('재시도 횟수는 MOLIT_MAX_ATTEMPTS로 bounded다(차단기 대기가 없는 경우)', async () => {
  const clock = virtualClock();
  let calls = 0;
  const { outcome, stats } = await runMolitGuarded(
    async () => { calls++; return { ok: false as const, message: RL_KO }; },
    { ...clock, breakerProbeMs: 0, retryBudgetMs: 60_000 }
  );
  assert.equal(outcome.ok, false);
  assert.equal(calls, MOLIT_MAX_ATTEMPTS);
  assert.equal(stats.attempts, MOLIT_MAX_ATTEMPTS);
  assert.equal(stats.rateLimitHits, MOLIT_MAX_ATTEMPTS);
  assert.equal(stats.finalFailureClass, 'RATE_LIMIT');
});

test('계속 잠겨 있으면 예산 안에서 끝난다 — 네트워크 시도는 최대 횟수보다 적고, 60초 잠금을 붙잡지 않는다', async () => {
  const clock = virtualClock();
  const start = clock.t;
  let calls = 0;
  const { outcome, stats } = await runMolitGuarded(async () => { calls++; return { ok: false as const, message: RL_KO }; }, clock);
  assert.equal(outcome.ok, false);
  assert.equal(classifyMolitFailure((outcome as { message: string }).message), 'RATE_LIMIT');
  assert.ok(calls <= MOLIT_MAX_ATTEMPTS);
  assert.ok(calls < MOLIT_MAX_ATTEMPTS, `잠금 중 probe 간격을 지키면 최대 횟수까지 두드리지 않는다(calls=${calls})`);
  assert.equal(stats.shortCircuited, true);
  // 첫 시도(페이싱 포함) + 예산 + 마지막 페이싱 여유 안에서 끝난다.
  const elapsed = clock.t - start;
  assert.ok(elapsed <= MOLIT_RETRY_BUDGET_MS + MOLIT_BASE_PACING_MS + MOLIT_COOLDOWN_MAX_EXTRA_MS + 50, `elapsed=${elapsed}`);
});

// 4
test('backoff는 재시도마다 늘어난다(jitter 최악의 경우에도 단조 증가)', async () => {
  // 구간 자체가 겹치지 않아야 jitter가 순서를 뒤집지 못한다.
  for (let i = 1; i < MOLIT_BACKOFF_STEPS_MS.length; i++) {
    assert.ok(MOLIT_BACKOFF_STEPS_MS[i][0] > MOLIT_BACKOFF_STEPS_MS[i - 1][1], `구간 ${i}가 이전 구간과 겹친다`);
  }
  // 대기 순서는 [페이싱, backoff, 페이싱, backoff, …, 페이싱]이다(차단기 대기 없음 설정).
  // 적응형 쿨다운이 페이싱을 넓히므로 크기로는 둘을 가를 수 없어 순서로 backoff를 고른다.
  const sleeps: number[] = [];
  await runMolitGuarded(async () => ({ ok: false as const, message: RL_KO }), {
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 1,
    breakerProbeMs: 0,
    retryBudgetMs: 60_000,
  });
  assert.equal(sleeps.length, MOLIT_MAX_ATTEMPTS * 2 - 1);
  const backoffs = sleeps.filter((_, i) => i % 2 === 1);
  assert.equal(backoffs.length, MOLIT_MAX_ATTEMPTS - 1);
  for (let i = 1; i < backoffs.length; i++) assert.ok(backoffs[i] > backoffs[i - 1], `backoff가 늘지 않았다: ${backoffs}`);
});

// 5
test('jitter는 각 구간 [lo, hi] 안에 머문다(random이 범위를 벗어나도 clamp)', () => {
  for (let i = 1; i <= MOLIT_BACKOFF_STEPS_MS.length; i++) {
    const [lo, hi] = MOLIT_BACKOFF_STEPS_MS[i - 1];
    for (const r of [0, 0.25, 0.5, 0.999, 1, -5, 7]) {
      const d = molitBackoffDelayMs(i, () => r);
      assert.ok(d >= lo && d <= hi, `retry ${i} r=${r} → ${d} not in [${lo},${hi}]`);
    }
  }
  assert.ok(molitBackoffDelayMs(99, () => 1) <= MOLIT_BACKOFF_STEPS_MS[MOLIT_BACKOFF_STEPS_MS.length - 1][1]);
});

// 7
test('성공한 요청은 다시 부르지 않는다 — 제한 1회 뒤 probe가 성공하면 정확히 2회로 끝난다', async () => {
  let calls = 0;
  const first = await runMolitGuarded(async () => { calls++; return { ok: true as const, value: [1] }; }, { sleep: instant });
  assert.equal(first.outcome.ok, true);
  assert.equal(calls, 1);

  const clock = virtualClock();
  calls = 0;
  const second = await runMolitGuarded(async () => {
    calls++;
    return calls === 1 ? { ok: false as const, message: RL_KO } : { ok: true as const, value: [1] };
  }, clock);
  assert.equal(second.outcome.ok, true);
  assert.equal(calls, 2);
  assert.equal(second.stats.rateLimitHits, 1);
  assert.equal(molitGateSnapshot().halfOpen, false, 'probe 성공 뒤 차단기가 닫힌다');
});

// 8
test('실패한 월만 재시도된다 — 같은 조회의 다른 월은 한 번씩만 호출된다', async () => {
  const clock = virtualClock();
  const lawdCd = uniqueLawdCd();
  const months = ['202601', '202602', '202603', '202604'];
  const calls = new Map<string, number>();
  const fetchOnce = async ({ dealYmd }: { dealYmd: string }) => {
    const n = (calls.get(dealYmd) || 0) + 1;
    calls.set(dealYmd, n);
    if (dealYmd === '202603' && n === 1) throw new Error(RL_KO);
    return [OK_ROW(dealYmd)];
  };
  const results = await Promise.all(months.map((dealYmd) => fetchMolitData({ type: 'apt', lawdCd, dealYmd }, { ...clock, fetchOnce: fetchOnce as never })));
  assert.deepEqual(Object.fromEntries(calls), { '202601': 1, '202602': 1, '202603': 2, '202604': 1 });
  for (const r of results) assert.equal(classifyMolitMonthResult(r), 'SUCCESS_WITH_DATA');
});

// 9 + 13 + 15(데이터 쪽)
test('재시도/예산을 다 써도 실패한 월은 FAILED로 남는다 — partial 유지, apiError는 전 월 실패일 때만', async () => {
  const clock = virtualClock();
  const lawdCd = uniqueLawdCd();
  const months = ['202601', '202602', '202603'];
  const fetchOnce = async ({ dealYmd }: { dealYmd: string }) => {
    if (dealYmd === '202602') throw new Error(RL_KO);
    return [OK_ROW(dealYmd)];
  };
  const outcomes = await Promise.all(months.map(async (dealYmd) => {
    const items = await fetchMolitData({ type: 'apt', lawdCd, dealYmd }, { ...clock, fetchOnce: fetchOnce as never });
    return { dealYmd, items, status: classifyMolitMonthResult(items) };
  }));
  const failedCell = outcomes.find((o) => o.dealYmd === '202602')!;
  assert.equal(failedCell.status, 'FAILED');
  assert.equal(failedCell.items[0].typeLabel, '에러');
  assert.match(failedCell.items[0].name, /초당 서비스 요청제한/);

  const folded = foldMonthResults(outcomes);
  const summary = summarizeTradeCompleteness(folded.cells);
  assert.equal(summary.partial, true);
  assert.equal(summary.allFailed, false);
  assert.deepEqual(summary.failedMonths, ['202602']);
  assert.equal(resolveTradeApiError(summary, folded.upstreamFailureMessage), null, '부분 실패는 apiError로 승격되지 않는다');
  assert.equal(folded.items.some((i) => i.typeLabel === '에러'), false, '실패 월의 플레이스홀더는 거래 목록에 섞이지 않는다');

  // 전 월 실패 → apiError는 기존 그대로 원본 사유(제한).
  __resetMolitGateForTest();
  const lawd2 = uniqueLawdCd();
  const allFail = await Promise.all(months.map(async (dealYmd) => {
    const items = await fetchMolitData({ type: 'apt', lawdCd: lawd2, dealYmd }, { ...clock, fetchOnce: (async () => { throw new Error(RL_KO); }) as never });
    return { dealYmd, items, status: classifyMolitMonthResult(items) };
  }));
  const f2 = foldMonthResults(allFail);
  const s2 = summarizeTradeCompleteness(f2.cells);
  assert.equal(s2.allFailed, true);
  assert.match(resolveTradeApiError(s2, f2.upstreamFailureMessage) || '', /초당 서비스 요청제한/);
});

// 10
test('in-flight dedup: 같은 (유형, lawdCd, 월) 동시 요청은 네트워크 1회 — 결과는 호출자별 사본, 완료 후 저장하지 않는다', async () => {
  const lawdCd = uniqueLawdCd();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const fetchOnce = async ({ dealYmd }: { dealYmd: string }) => { calls++; await gate; return [OK_ROW(dealYmd)]; };
  const deps = { sleep: instant, fetchOnce: fetchOnce as never };

  const a = fetchMolitData({ type: 'apt', lawdCd, dealYmd: '202605' }, deps);
  const b = fetchMolitData({ type: 'apt', lawdCd, dealYmd: '202605' }, deps);
  // 유형이 다르면 같은 월이어도 별도 요청이다.
  const c = fetchMolitData({ type: 'rent', lawdCd, dealYmd: '202605' }, deps);
  await new Promise((r) => setImmediate(r));
  release();
  const [ra, rb, rc] = await Promise.all([a, b, c]);

  assert.equal(calls, 2, 'apt 1회 + rent 1회');
  assert.deepEqual(ra, rb);
  assert.notEqual(ra, rb, '배열을 공유하면 한 호출부의 in-place 정렬이 다른 호출부로 샌다');
  assert.notEqual(ra[0], rb[0], 'item 객체도 공유하면 안 된다');
  (ra[0] as { dealAmount: number }).dealAmount = -1;
  assert.equal((rb[0] as { dealAmount: number }).dealAmount, 50000);
  assert.equal(rc.length, 1);
  assert.equal(molitInFlightSize(), 0, '완료 후 in-flight map에 남으면 안 된다');

  // 결과를 캐시하지 않는다 — TTL/신선도 정책은 이 모듈이 바꾸지 않는다.
  await fetchMolitData({ type: 'apt', lawdCd, dealYmd: '202605' }, { sleep: instant, fetchOnce: (async () => { calls++; return []; }) as never });
  assert.equal(calls, 3);
});

// 11
test('게이트는 설정한 동시성을 넘지 않는다(요청 30건 동시 투입)', async () => {
  let live = 0;
  let peak = 0;
  const tick = () => new Promise<void>((r) => setImmediate(r));
  await Promise.all(Array.from({ length: 30 }, () => runMolitGuarded(async () => {
    live++;
    peak = Math.max(peak, live);
    await tick(); await tick();
    live--;
    return { ok: true as const, value: 1 };
  }, { sleep: tick })));
  assert.ok(peak <= MOLIT_CONCURRENCY, `peak=${peak}`);
  assert.equal(peak, MOLIT_CONCURRENCY, '대기열이 있을 때는 슬롯을 다 써야 한다(처리량 보존)');
  assert.ok(molitGateSnapshot().peak <= MOLIT_CONCURRENCY);
  assert.equal(molitGateSnapshot().active, 0);
  assert.equal(molitGateSnapshot().queued, 0);
});

test('차단기: 잠금 중에는 요청 20건이 동시에 기다려도 네트워크로는 probe 간격마다 1건만 나간다', async () => {
  const clock = virtualClock();
  let locked = true;
  const sentAt: number[] = [];
  const attempt = async () => {
    sentAt.push(clock.t);
    return locked ? { ok: false as const, message: RL_KO } : { ok: true as const, value: 1 };
  };
  // 첫 요청으로 잠금을 감지시킨다.
  await runMolitGuarded(attempt, { ...clock, retryBudgetMs: 0 });
  assert.equal(molitGateSnapshot().halfOpen, true);
  const tripSends = sentAt.length;

  // 잠금 해제는 두 번째 probe 시점 이후로 둔다.
  const unlockAt = clock.t + MOLIT_BREAKER_PROBE_MS + 100;
  const waiters = Array.from({ length: 20 }, () => runMolitGuarded(async () => {
    if (clock.t >= unlockAt) locked = false;
    return attempt();
  }, clock));
  const results = await Promise.all(waiters);

  const duringLock = sentAt.slice(tripSends).filter((t) => t < unlockAt);
  // 잠금 구간에서는 probe 간격(5s)마다 최대 1건.
  const windows = new Map<number, number>();
  for (const t of duringLock) {
    const w = Math.floor((t - sentAt[0]) / MOLIT_BREAKER_PROBE_MS);
    windows.set(w, (windows.get(w) || 0) + 1);
  }
  for (const [w, n] of windows) assert.ok(n <= 1, `probe 창 ${w}에서 ${n}건이 잠긴 키로 나갔다`);
  assert.ok(results.some((r) => r.outcome.ok), '잠금이 예산 안에 풀리면 대기 요청이 회복한다');
});

test('차단기가 예산 안에 풀리지 않으면 네트워크 호출 없이 RATE_LIMIT 실패로 끝난다(성공 위장 없음)', async () => {
  const clock = virtualClock();
  await runMolitGuarded(async () => ({ ok: false as const, message: RL_KO }), { ...clock, retryBudgetMs: 0 });
  let calls = 0;
  const { outcome, stats } = await runMolitGuarded(async () => { calls++; return { ok: true as const, value: 1 }; }, { ...clock, retryBudgetMs: 1000 });
  assert.equal(calls, 0, '잠긴 키를 두드리지 않는다');
  assert.equal(outcome.ok, false);
  assert.equal((outcome as { message: string }).message, MOLIT_BREAKER_WAIT_MESSAGE);
  assert.equal(stats.shortCircuited, true);
  assert.equal(stats.finalFailureClass, 'RATE_LIMIT');
});

test('잠금이 예산보다 오래 이어지면 새 요청은 기다리지 않고 바로 실패한다 — 청크가 차례로 예산을 다시 쓰지 않는다', async () => {
  const clock = virtualClock();
  const attempt = async () => ({ ok: false as const, message: RL_KO });
  // 청크 1: 잠금을 만나 예산 안에서 기다리다 실패.
  const chunk1Start = clock.t;
  await Promise.all(Array.from({ length: 12 }, () => runMolitGuarded(attempt, clock)));
  const chunk1Elapsed = clock.t - chunk1Start;
  assert.ok(molitGateSnapshot().halfOpen);

  // 청크 2~5: 확인된 잠금이 이미 예산을 넘겼으므로 거의 즉시 끝나야 한다.
  let networkCalls = 0;
  const later = clock.t;
  for (let chunk = 0; chunk < 4; chunk++) {
    await Promise.all(Array.from({ length: 12 }, () => runMolitGuarded(async () => { networkCalls++; return attempt(); }, clock)));
  }
  const laterElapsed = clock.t - later;
  assert.ok(laterElapsed < chunk1Elapsed, `뒤 청크들이 다시 예산을 기다렸다(첫 청크 ${chunk1Elapsed}ms, 뒤 4청크 ${laterElapsed}ms)`);
  assert.ok(networkCalls <= 4 + Math.ceil(laterElapsed / MOLIT_BREAKER_PROBE_MS), `잠긴 키로 ${networkCalls}건이 나갔다(probe 간격만 허용)`);
});

test('조용한 기간 뒤 첫 요청들은 오래된 잠금 기록 때문에 한꺼번에 즉시 실패하지 않는다', async () => {
  const clock = virtualClock();
  await runMolitGuarded(async () => ({ ok: false as const, message: RL_KO }), clock);
  assert.ok(molitGateSnapshot().halfOpen, '예산 소진 뒤에도 half-open으로 남아 있다(성공을 못 봤으므로)');

  // 트래픽 없이 5분 경과 — 그 사이 잠금은 풀렸다.
  clock.t += 5 * 60_000;
  let calls = 0;
  const results = await Promise.all(Array.from({ length: 12 }, () => runMolitGuarded(async () => { calls++; return { ok: true as const, value: 1 }; }, clock)));
  assert.equal(results.filter((r) => r.outcome.ok).length, 12, '첫 probe가 성공하면 나머지도 기다렸다가 성공해야 한다');
  assert.equal(calls, 12);
  assert.equal(molitGateSnapshot().halfOpen, false);
});

test('제한 이전에 출발한 요청의 뒤늦은 성공은 차단기를 닫지 않는다', async () => {
  const clock = virtualClock();
  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((r) => { releaseSlow = r; });
  // 먼저 출발한 느린 요청
  const slow = runMolitGuarded(async () => { await slowGate; return { ok: true as const, value: 'slow' }; }, clock);
  await new Promise((r) => setImmediate(r));
  // 그 사이 다른 요청이 제한을 맞는다.
  clock.t += 10;
  await runMolitGuarded(async () => ({ ok: false as const, message: RL_KO }), { ...clock, retryBudgetMs: 0 });
  assert.equal(molitGateSnapshot().halfOpen, true);
  releaseSlow();
  await slow;
  assert.equal(molitGateSnapshot().halfOpen, true, '제한 전에 보낸 요청의 성공으로 half-open을 닫으면 대기열이 잠긴 키로 몰린다');
});

test('backoff/차단기 대기 중에는 슬롯을 놓는다 — 대기하는 요청이 동시성 슬롯을 차지하지 않는다', async () => {
  let resolveWait!: () => void;
  const waitGate = new Promise<void>((r) => { resolveWait = r; });
  let t = 1_000_000;
  // 슬롯 안에서 쥐는 페이싱(200 + 200k ms)은 의도된 간격이라 그대로 흘려보내고, 그 밖의
  // 대기(backoff / 차단기)만 멈춰 세운 채 슬롯 점유를 확인한다.
  const pacingValues = new Set(Array.from({ length: MOLIT_COOLDOWN_MAX_EXTRA_MS / MOLIT_COOLDOWN_STEP_MS + 1 }, (_, k) => MOLIT_BASE_PACING_MS + MOLIT_COOLDOWN_STEP_MS * k));
  // random=0 → backoff는 각 구간 하한. 페이싱 값과 겹치지 않아야 이 테스트가 의미가 있다.
  for (const [lo] of MOLIT_BACKOFF_STEPS_MS) assert.equal(pacingValues.has(lo), false, `backoff ${lo}ms가 페이싱 값과 겹친다`);
  const deps = { now: () => t, random: () => 0, sleep: async (ms: number) => { if (!pacingValues.has(ms)) await waitGate; t += ms; } };
  let n = 0;
  const limited = Array.from({ length: MOLIT_CONCURRENCY }, () => runMolitGuarded(async () => (++n <= MOLIT_CONCURRENCY ? { ok: false as const, message: RL_KO } : { ok: true as const, value: 1 }), deps));
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert.equal(molitGateSnapshot().active, 0, `대기 중인데 슬롯을 쥐고 있다: ${JSON.stringify(molitGateSnapshot())}`);
  resolveWait();
  await Promise.all(limited);
});

test('적응형 쿨다운: 제한을 맞으면 페이싱이 넓어지고(상한 있음), 잠금+창이 지나면 기본값으로 돌아온다', async () => {
  const clock = virtualClock();
  assert.equal(currentMolitPacingMs(clock.t), MOLIT_BASE_PACING_MS);
  await runMolitGuarded(async () => ({ ok: false as const, message: 'OpenAPI Error: SERVICE_KEY_IS_NOT_REGISTERED_ERROR' }), clock);
  assert.equal(currentMolitPacingMs(clock.t), MOLIT_BASE_PACING_MS, '제한이 아닌 실패는 쿨다운을 켜지 않는다');

  let n = 0;
  await runMolitGuarded(async () => (++n === 1 ? { ok: false as const, message: RL_KO } : { ok: true as const, value: 1 }), clock);
  assert.ok(currentMolitPacingMs(clock.t) > MOLIT_BASE_PACING_MS, '제한 직후 페이싱이 넓어져야 한다');
  assert.ok(currentMolitPacingMs(clock.t) <= MOLIT_BASE_PACING_MS + MOLIT_COOLDOWN_MAX_EXTRA_MS, '추가 페이싱은 상한이 있다');

  clock.t = molitGateSnapshot().cooldownUntil + 1;
  assert.equal(currentMolitPacingMs(clock.t), MOLIT_BASE_PACING_MS, '창이 지나면 정상 페이싱');
  await runMolitGuarded(async () => ({ ok: true as const, value: 1 }), clock);
  assert.equal(molitGateSnapshot().extraPacingMs, 0, '창 이후 성공이 오면 쿨다운 상태를 비운다');
  assert.ok(molitGateSnapshot().cooldownUntil >= molitGateSnapshot().breakerUntil + MOLIT_COOLDOWN_WINDOW_MS - 1);
});

// 12
test('정상 0건과 취소 필드 의미는 그대로다 — 빈 월은 실패가 아니고 재시도하지 않는다', async () => {
  const lawdCd = uniqueLawdCd();
  let calls = 0;
  const empty = await fetchMolitData({ type: 'apt', lawdCd, dealYmd: '202601' }, { sleep: instant, fetchOnce: (async () => { calls++; return []; }) as never });
  assert.deepEqual(empty, []);
  assert.equal(calls, 1);
  assert.equal(classifyMolitMonthResult(empty), 'SUCCESS_EMPTY');

  const canceled = { ...OK_ROW('202602'), dealCanceled: true, cancelDate: '26.02.20' };
  const rows = await fetchMolitData({ type: 'apt', lawdCd, dealYmd: '202602' }, { sleep: instant, fetchOnce: (async () => [canceled]) as never });
  assert.equal((rows[0] as { dealCanceled: boolean }).dealCanceled, true);
  assert.equal((rows[0] as { cancelDate: string }).cancelDate, '26.02.20');
});

// 14
test('다른 월/다른 지역 데이터로 fallback하지 않는다 — 실패 월의 플레이스홀더는 자기 월만 가리킨다', async () => {
  const clock = virtualClock();
  const lawdCd = uniqueLawdCd();
  const fetchOnce = async ({ dealYmd, lawdCd: l }: { dealYmd: string; lawdCd: string }) => {
    if (dealYmd === '202607') throw new Error(RL_KO);
    return [{ ...OK_ROW(dealYmd), id: `apt-${l}-${dealYmd}-0` }];
  };
  const [ok, failed] = await Promise.all([
    fetchMolitData({ type: 'apt', lawdCd, dealYmd: '202606' }, { ...clock, fetchOnce: fetchOnce as never }),
    fetchMolitData({ type: 'apt', lawdCd, dealYmd: '202607' }, { ...clock, fetchOnce: fetchOnce as never }),
  ]);
  assert.equal(classifyMolitMonthResult(ok), 'SUCCESS_WITH_DATA');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].typeLabel, '에러');
  assert.equal(failed[0].id, `error-apt-${lawdCd}-202607`);

  // 같은 월의 다른 지역 성공이 이 지역의 실패를 덮지 않는다(dedup 키에 lawdCd 포함).
  __resetMolitGateForTest();
  const [mine, otherRegion] = await Promise.all([
    fetchMolitData({ type: 'apt', lawdCd, dealYmd: '202608' }, { sleep: instant, fetchOnce: (async () => { throw new Error('OpenAPI Error: SERVICE_KEY_IS_NOT_REGISTERED_ERROR'); }) as never }),
    fetchMolitData({ type: 'apt', lawdCd: `${lawdCd}X`, dealYmd: '202608' }, { sleep: instant, fetchOnce: (async () => [OK_ROW('202608')]) as never }),
  ]);
  assert.equal(classifyMolitMonthResult(mine), 'FAILED');
  assert.equal(classifyMolitMonthResult(otherRegion), 'SUCCESS_WITH_DATA');
});

test('최종 실패 메시지에 서비스 키가 남지 않는다(마스킹 유지)', async () => {
  const lawdCd = uniqueLawdCd();
  const rows = await fetchMolitData({ type: 'apt', lawdCd, dealYmd: '202601' }, {
    sleep: instant,
    fetchOnce: (async () => { throw new Error('fetch failed http://apis.data.go.kr/x?serviceKey=SECRETSECRET&LAWD_CD=1'); }) as never,
  });
  assert.equal(rows[0].typeLabel, '에러');
  assert.doesNotMatch(String(rows[0].name), /SECRETSECRET/);
});

// 15(라우트 쪽) + 호출 경로
test('상세 라우트는 여전히 최종 부분 실패를 [MOLIT_PARTIAL]로 기록하고, 모든 월 요청은 공유 게이트를 지난다', () => {
  const root = path.resolve(__dirname, '..', '..');
  const route = readFileSync(path.join(root, 'src/app/api/apt/[name]/route.ts'), 'utf8');
  assert.match(route, /\[MOLIT_PARTIAL\]/);
  assert.match(route, /completeness\.partial && !completeness\.allFailed/);
  assert.match(route, /fetchMolitMonthCached/);

  const monthCache = readFileSync(path.join(root, 'src/lib/molit-month-cache.ts'), 'utf8');
  assert.match(monthCache, /fetchMolitData\(p\)/, '상세 월 캐시는 fetchMolitData(=게이트)를 거친다');

  const api = readFileSync(path.join(root, 'src/lib/api-molit.ts'), 'utf8');
  assert.match(api, /export async function fetchMolitData[\s\S]*?dedupMolitInFlight/);
  assert.match(api, /runMolitGuarded/);

  // 통계 헬퍼가 자체 세마포어를 다시 만들면 두 풀이 합산돼 제한을 넘는다(이번 원인).
  const stats = readFileSync(path.join(root, 'src/lib/molit-stats-helpers.ts'), 'utf8');
  assert.doesNotMatch(stats, /GLOBAL_MOLIT_CONCURRENCY|molitWaitQueue|acquireMolitSlot/);
});

// ── FINAL PRE-LAUNCH REGRESSION AUDIT V2 — 대기열 lane ─────────────────────────────
// 부산 전체 갭투자 통계 콜드 조회(384건)가 같은 인스턴스의 상세 조회를 FIFO로 막던 문제.

const flushMicro = async (n = 20) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

function laneHarness() {
  const started: string[] = [];
  const gates = new Map<string, () => void>();
  const blocking = (id: string, lane: 'interactive' | 'bulk') =>
    runMolitGuarded(async () => {
      started.push(id);
      await new Promise<void>((r) => gates.set(id, r));
      return { ok: true as const, value: id };
    }, { sleep: instant, lane });
  const instantTask = (id: string, lane: 'interactive' | 'bulk') =>
    runMolitGuarded(async () => { started.push(id); return { ok: true as const, value: id }; }, { sleep: instant, lane });
  return { started, gates, blocking, instantTask };
}

test('lane: 슬롯이 비면 줄 서 있던 통계(bulk)보다 상세(interactive)가 먼저 나간다', async () => {
  const h = laneHarness();
  const blockers = Array.from({ length: MOLIT_CONCURRENCY }, (_, i) => h.blocking(`block${i}`, 'interactive'));
  await flushMicro();
  const bulk = Array.from({ length: 8 }, (_, i) => h.instantTask(`bulk${i}`, 'bulk'));
  await flushMicro();
  const interactive = [h.instantTask('detail0', 'interactive'), h.instantTask('detail1', 'interactive')];
  await flushMicro();
  assert.equal(molitGateSnapshot().queuedBulk, 8);
  assert.equal(molitGateSnapshot().queuedInteractive, 2);

  h.gates.get('block0')!();
  await flushMicro(200);
  const afterBlockers = h.started.slice(MOLIT_CONCURRENCY);
  assert.deepEqual(afterBlockers.slice(0, 3), ['detail0', 'detail1', 'bulk0'], `순서: ${afterBlockers.join(',')}`);

  for (let i = 1; i < MOLIT_CONCURRENCY; i++) h.gates.get(`block${i}`)!();
  await Promise.all([...blockers, ...bulk, ...interactive]);
  assert.equal(molitGateSnapshot().queued, 0);
  assert.ok(molitGateSnapshot().peak <= MOLIT_CONCURRENCY, '총 동시성은 그대로다');
});

test('lane: 둘 다 기다리면 bulk도 MOLIT_BULK_SLOT_EVERY번째마다 슬롯을 받는다(통계가 굶지 않는다)', async () => {
  const h = laneHarness();
  const blockers = Array.from({ length: MOLIT_CONCURRENCY }, (_, i) => h.blocking(`block${i}`, 'interactive'));
  await flushMicro();
  const bulk = Array.from({ length: 8 }, (_, i) => h.instantTask(`B${i}`, 'bulk'));
  const inter = Array.from({ length: 12 }, (_, i) => h.instantTask(`I${i}`, 'interactive'));
  await flushMicro();

  h.gates.get('block0')!();
  await flushMicro(400);
  const order = h.started.slice(MOLIT_CONCURRENCY).map((id) => id[0]).join('');
  // 둘 다 기다리는 동안: I I I B 반복(4번째마다 bulk), interactive가 다 빠지면 남은 bulk.
  assert.equal(MOLIT_BULK_SLOT_EVERY, 4);
  assert.equal(order, 'IIIBIIIBIIIBIIIBBBBB', `순서: ${order}`);

  for (let i = 1; i < MOLIT_CONCURRENCY; i++) h.gates.get(`block${i}`)!();
  await Promise.all([...blockers, ...bulk, ...inter]);
});

test('lane: 줄 서 있던 bulk 요청에 같은 월의 상세 요청이 합류하면 interactive로 승격된다(우선순위 역전 없음)', async () => {
  const h = laneHarness();
  const lawdCd = uniqueLawdCd();
  const blockers = Array.from({ length: MOLIT_CONCURRENCY }, (_, i) => h.blocking(`block${i}`, 'interactive'));
  await flushMicro();
  const calls: string[] = [];
  const fetchOnce = (async ({ dealYmd }: { dealYmd: string }) => { calls.push(dealYmd); h.started.push(`net:${dealYmd}`); return [OK_ROW(dealYmd)]; }) as never;
  const statsJobs = ['202601', '202602', '202603'].map((dealYmd) =>
    fetchMolitData({ type: 'rent', lawdCd, dealYmd }, { sleep: instant, lane: 'bulk', fetchOnce }));
  await flushMicro();
  assert.equal(molitGateSnapshot().queuedBulk, 3);

  // 상세페이지가 같은 지역의 202603 전월세를 요청 — 새 네트워크 호출 없이 합류 + 승격.
  const detail = fetchMolitData({ type: 'rent', lawdCd, dealYmd: '202603' }, { sleep: instant, fetchOnce });
  await flushMicro();
  assert.equal(molitGateSnapshot().queuedBulk, 2);
  assert.equal(molitGateSnapshot().queuedInteractive, 1);

  h.gates.get('block0')!();
  await flushMicro(200);
  assert.equal(h.started[MOLIT_CONCURRENCY], 'net:202603', `승격된 요청이 먼저 나가야 한다: ${h.started.join(',')}`);

  for (let i = 1; i < MOLIT_CONCURRENCY; i++) h.gates.get(`block${i}`)!();
  const [detailRows] = await Promise.all([detail, ...statsJobs, ...blockers]);
  assert.equal(classifyMolitMonthResult(detailRows as unknown[]), 'SUCCESS_WITH_DATA');
  assert.equal(calls.filter((c) => c === '202603').length, 1, '같은 월을 두 번 부르지 않는다');
});

test('lane 배선: 통계 헬퍼는 bulk, 상세 월 캐시와 그 밖의 호출은 기본 interactive', () => {
  const root = path.resolve(__dirname, '..', '..');
  const stats = readFileSync(path.join(root, 'src/lib/molit-stats-helpers.ts'), 'utf8');
  assert.match(stats, /fetchMolitData\(\{ type, lawdCd, dealYmd \}, \{ lane: 'bulk' \}\)/);
  const monthCache = readFileSync(path.join(root, 'src/lib/molit-month-cache.ts'), 'utf8');
  assert.doesNotMatch(monthCache, /lane/, '상세 월 캐시가 bulk로 줄 서면 안 된다');
  const api = readFileSync(path.join(root, 'src/lib/api-molit.ts'), 'utf8');
  assert.match(api, /deps\?\.lane \?\? 'interactive'/);
});
