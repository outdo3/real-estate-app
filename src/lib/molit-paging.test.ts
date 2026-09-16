import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMolitData, MOLIT_PAGE_SIZE, type MolitRawPage } from './api-molit';
import {
  __resetMolitGateForTest,
  molitGateSnapshot,
  molitInFlightSize,
  MOLIT_CONCURRENCY,
} from './molit-rate-guard';
import { classifyMolitMonthResult } from './apt-trade-completeness';

// MOLIT_LIVE_PAGING_FIX_V1 — 라이브 경로의 페이지네이션을 네트워크 없이 검증한다.
// 실측 근거(MOLIT_QUOTA_SCALE_PROBE_V1): 서울 강남구 전월세 2026-03 totalCount 2,091
// (3페이지), 송파구 1,873(2페이지). 수정 전 라이브 경로는 1,000건만 보고 그것을
// "전부"라고 말했다.

const instant = async () => {};
const LAWD = '11680';

beforeEach(() => __resetMolitGateForTest());

/** 원본 MOLIT raw item 하나. 매핑 결과를 식별할 수 있도록 단지명에 일련번호를 넣는다. */
const rawRow = (n: number) => ({
  거래금액: '100,000',
  전용면적: 84.99,
  년: 2026,
  월: 3,
  일: 15,
  아파트: `단지${n}`,
  법정동: '역삼동',
  층: 5,
  지번: '100',
  건축년도: 2005,
  aptSeq: `11680-${n}`,
});

/** totalCount에 맞춰 페이지를 잘라 주는 가짜 서버. 호출된 pageNo를 기록한다. */
function fakeServer(totalCount: number, opts: { failPage?: number; totalCountOverride?: number | null; shortPage?: number } = {}) {
  const calls: number[] = [];
  const fetchPage = async (_params: unknown, pageNo: number): Promise<MolitRawPage> => {
    calls.push(pageNo);
    if (opts.failPage === pageNo) throw new Error('fetch failed');
    const start = (pageNo - 1) * MOLIT_PAGE_SIZE;
    let end = Math.min(start + MOLIT_PAGE_SIZE, totalCount);
    if (opts.shortPage === pageNo) end = Math.max(start, end - 5); // 서버가 약속보다 적게 줌
    const rawItems = [];
    for (let i = start; i < end; i++) rawItems.push(rawRow(i));
    return {
      rawItems,
      totalCount: opts.totalCountOverride !== undefined ? opts.totalCountOverride : totalCount,
    };
  };
  return { fetchPage, calls };
}

const run = (fetchPage: unknown, dealYmd = '202603') =>
  fetchMolitData({ type: 'rent', lawdCd: LAWD, dealYmd }, { sleep: instant, fetchPage: fetchPage as never });

// ── 1. 단일 페이지 parity ──────────────────────────────────────────────────

test('1,000건 이하 셀은 페이지를 한 번만 읽고 수정 전과 같은 결과를 준다', async () => {
  const { fetchPage, calls } = fakeServer(577);
  const items = await run(fetchPage);
  assert.equal(items.length, 577);
  assert.deepEqual(calls, [1], '추가 페이지를 요청하지 않는다');
  assert.equal(classifyMolitMonthResult(items), 'SUCCESS_WITH_DATA');
  assert.equal(items[0].rank, 1);
  assert.equal(items[576].rank, 577);
});

test('정상 0건은 실패가 아니라 빈 배열이다', async () => {
  const { fetchPage, calls } = fakeServer(0);
  const items = await run(fetchPage);
  assert.deepEqual(items, []);
  assert.deepEqual(calls, [1]);
  assert.equal(classifyMolitMonthResult(items), 'SUCCESS_EMPTY');
});

// ── 2. 경계: 정확히 1000 ───────────────────────────────────────────────────

test('정확히 1,000건이면 1페이지로 끝난다(불필요한 2페이지 요청 없음)', async () => {
  const { fetchPage, calls } = fakeServer(1000);
  const items = await run(fetchPage);
  assert.equal(items.length, 1000);
  assert.deepEqual(calls, [1]);
});

test('1,001건이면 2페이지를 읽고 1,001건을 모두 돌려준다', async () => {
  const { fetchPage, calls } = fakeServer(1001);
  const items = await run(fetchPage);
  assert.equal(items.length, 1001);
  assert.deepEqual(calls, [1, 2]);
});

// ── 3. 실측 재현: 서울 강남구 전월세 2026-03 = 2,091건 / 3페이지 ────────────

test('실측 재현: totalCount 2,091은 3페이지를 읽어 2,091건 전부를 돌려준다(절단 없음)', async () => {
  const { fetchPage, calls } = fakeServer(2091);
  const items = await run(fetchPage);
  assert.equal(items.length, 2091, '수정 전에는 1,000건만 보였다');
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(classifyMolitMonthResult(items), 'SUCCESS_WITH_DATA');
});

test('페이지 수는 ceil(totalCount / 1000)이고 페이지를 중복 요청하지 않는다', async () => {
  for (const [total, expected] of [
    [1, [1]],
    [1000, [1]],
    [1001, [1, 2]],
    [1873, [1, 2]],
    [2000, [1, 2]],
    [2091, [1, 2, 3]],
  ] as Array<[number, number[]]>) {
    __resetMolitGateForTest();
    const { fetchPage, calls } = fakeServer(total);
    await run(fetchPage);
    assert.deepEqual(calls, expected, `totalCount=${total}`);
    assert.equal(new Set(calls).size, calls.length, `totalCount=${total} 중복 페이지 요청 없음`);
  }
});

test('행 순서는 서버 페이지 순서 그대로이고 id/rank 인덱스가 끊기지 않는다', async () => {
  const { fetchPage } = fakeServer(2091);
  const items = await run(fetchPage);
  assert.equal(items[0].name, '단지0');
  assert.equal(items[999].name, '단지999');
  assert.equal(items[1000].name, '단지1000', '2페이지 첫 행이 1페이지 뒤에 이어진다');
  assert.equal(items[2090].name, '단지2090');
  // rank/id는 합쳐진 전체 배열 기준으로 한 번만 매겨진다(페이지마다 1부터 다시 시작하지 않는다).
  assert.equal(items[1000].rank, 1001);
  assert.equal(items[2090].rank, 2091);
  assert.equal(items[1000].id, 'rent-11680-202603-1000');
  assert.equal(new Set(items.map((i: { id: string }) => i.id)).size, 2091, '중복 행 없음');
});

// ── 4. 부분 실패 정책 — silent truncation 금지 ──────────────────────────────

test('2페이지가 끝내 실패하면 1,000건을 정상 데이터처럼 돌려주지 않고 실패로 알린다', async () => {
  const { fetchPage } = fakeServer(2091, { failPage: 2 });
  const items = await run(fetchPage);
  assert.equal(classifyMolitMonthResult(items), 'FAILED', '부분 결과를 성공으로 위장하지 않는다');
  assert.equal(items.length, 1, '기존 에러 플레이스홀더 계약 그대로');
  assert.equal(items[0].typeLabel, '에러');
});

test('마지막 페이지가 약속보다 적게 오면 부분으로 판정한다', async () => {
  const { fetchPage } = fakeServer(2091, { shortPage: 3 });
  const items = await run(fetchPage);
  assert.equal(classifyMolitMonthResult(items), 'FAILED');
  assert.match(items[0].name, /불완전/);
});

// ── 5. totalCount 이상값 ───────────────────────────────────────────────────

test('totalCount가 없어도 1페이지가 상한 미만이면 기존처럼 그대로 쓴다', async () => {
  const { fetchPage, calls } = fakeServer(42, { totalCountOverride: null });
  const items = await run(fetchPage);
  assert.equal(items.length, 42);
  assert.deepEqual(calls, [1]);
  assert.equal(classifyMolitMonthResult(items), 'SUCCESS_WITH_DATA');
});

test('totalCount가 없는데 1페이지가 상한까지 찼으면 절단 여부를 알 수 없으므로 실패로 처리한다', async () => {
  const { fetchPage } = fakeServer(1000, { totalCountOverride: null });
  const items = await run(fetchPage);
  assert.equal(classifyMolitMonthResult(items), 'FAILED', '모르는 것을 "전부"라고 말하지 않는다');
  assert.match(items[0].name, /절단 가능/);
});

test('totalCount가 숫자가 아니면 null과 같게 취급한다(0건으로 떨어뜨리지 않는다)', async () => {
  const fetchPage = async (): Promise<MolitRawPage> => ({
    rawItems: [rawRow(1)],
    totalCount: Number.isFinite(Number('없음')) ? Number('없음') : null,
  });
  const items = await run(fetchPage);
  assert.equal(items.length, 1);
  assert.notEqual(classifyMolitMonthResult(items), 'SUCCESS_EMPTY');
});

// ── 6. 게이트 / 동시성 / dedup ─────────────────────────────────────────────

test('페이지마다 공유 게이트를 통과한다 — 동시 실행 수가 MOLIT_CONCURRENCY를 넘지 않는다', async () => {
  let inFlight = 0;
  let peak = 0;
  const fetchPage = async (_p: unknown, pageNo: number): Promise<MolitRawPage> => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight--;
    const start = (pageNo - 1) * MOLIT_PAGE_SIZE;
    const end = Math.min(start + MOLIT_PAGE_SIZE, 2091);
    return { rawItems: Array.from({ length: end - start }, (_, i) => rawRow(start + i)), totalCount: 2091 };
  };
  // 서로 다른 6개 월을 동시에 — 각 셀이 3페이지씩 = 18 페이지 요청.
  const months = ['202601', '202602', '202603', '202604', '202605', '202606'];
  const results = await Promise.all(months.map((m) => run(fetchPage, m)));
  for (const items of results) assert.equal(items.length, 2091);
  assert.ok(peak <= MOLIT_CONCURRENCY, `동시 실행 peak=${peak} ≤ ${MOLIT_CONCURRENCY}`);
  assert.ok(molitGateSnapshot().peak <= MOLIT_CONCURRENCY);
});

test('한 셀의 페이지들은 순차로만 나간다(ungated 병렬 버스트 금지)', async () => {
  let inFlight = 0;
  let peak = 0;
  const fetchPage = async (_p: unknown, pageNo: number): Promise<MolitRawPage> => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setImmediate(r));
    inFlight--;
    const start = (pageNo - 1) * MOLIT_PAGE_SIZE;
    const end = Math.min(start + MOLIT_PAGE_SIZE, 3500);
    return { rawItems: Array.from({ length: end - start }, (_, i) => rawRow(start + i)), totalCount: 3500 };
  };
  const items = await run(fetchPage);
  assert.equal(items.length, 3500);
  assert.equal(peak, 1, '한 셀 안에서는 페이지가 동시에 나가지 않는다');
});

test('같은 셀을 동시에 요청하면 페이지 시퀀스를 한 번만 돈다(in-flight dedup 유지)', async () => {
  const { fetchPage, calls } = fakeServer(2091);
  const [a, b, c] = await Promise.all([run(fetchPage), run(fetchPage), run(fetchPage)]);
  assert.deepEqual(calls, [1, 2, 3], '3개 호출이 페이지 3장을 공유한다');
  assert.equal(a.length, 2091);
  assert.equal(b.length, 2091);
  assert.equal(c.length, 2091);
  assert.notEqual(a, b, '대기자는 각자 사본을 받는다');
  assert.equal(molitInFlightSize(), 0);
});

// ── 7. 비밀값 ──────────────────────────────────────────────────────────────

test('페이지 실패 메시지에도 서비스 키가 남지 않는다', async () => {
  const fetchPage = async (_p: unknown, pageNo: number): Promise<MolitRawPage> => {
    if (pageNo === 2) throw new Error('fetch failed http://apis.data.go.kr/x?serviceKey=SECRETSECRET&LAWD_CD=1');
    return { rawItems: Array.from({ length: 1000 }, (_, i) => rawRow(i)), totalCount: 2091 };
  };
  const items = await run(fetchPage);
  const blob = JSON.stringify(items);
  assert.ok(!blob.includes('SECRETSECRET'), '서비스 키가 응답으로 새지 않는다');
  assert.ok(!blob.includes('apis.data.go.kr'), '요청 URL이 응답으로 새지 않는다');
  assert.equal(classifyMolitMonthResult(items), 'FAILED');
});
