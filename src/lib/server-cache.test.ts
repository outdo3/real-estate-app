import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getOrSetCache } from './server-cache';

// APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX §CACHE_SAFETY
// 실패한 MOLIT 월 응답이 "성공 결과"와 같은 1시간 캐시에 들어가면, 한 번의 스로틀링이
// 그 지역·월을 1시간 동안 계속 축소된 값으로 보이게 만든다. shouldCache 옵션은
// "이 값은 캐시에 남기지 말라"를 호출부가 정할 수 있게 하고, 옵션을 안 주면 기존
// 동작(무조건 캐시) 그대로다 — 다른 라우트의 캐시 의미는 바뀌지 않는다.

let keySeq = 0;
const uniqueKey = (label: string) => `test:${label}:${keySeq++}:${process.hrtime.bigint()}`;

test('옵션을 주지 않으면 기존 동작 그대로 캐시된다(다른 라우트 회귀 없음)', async () => {
  const key = uniqueKey('default');
  let calls = 0;
  const fetcher = async () => { calls++; return { value: calls }; };

  assert.deepEqual(await getOrSetCache(key, 60_000, fetcher), { value: 1 });
  assert.deepEqual(await getOrSetCache(key, 60_000, fetcher), { value: 1 });
  assert.equal(calls, 1, '두 번째 호출은 캐시 히트여야 한다');
});

test('shouldCache가 false면 값을 반환하되 캐시에 남기지 않는다(다음 요청은 다시 조회)', async () => {
  const key = uniqueKey('nocache');
  let calls = 0;
  const fetcher = async () => { calls++; return { failed: true, calls }; };

  const first = await getOrSetCache(key, 60_000, fetcher, { shouldCache: (v) => !v.failed });
  assert.deepEqual(first, { failed: true, calls: 1 }, '실패해도 값 자체는 호출부에 그대로 전달된다');

  const second = await getOrSetCache(key, 60_000, fetcher, { shouldCache: (v) => !v.failed });
  assert.equal(second.calls, 2, '캐시에 남지 않았으므로 다시 조회되어야 한다');
  assert.equal(calls, 2);
});

test('캐시 회복: 실패 응답 다음의 성공 응답은 정상 캐시된다(부분 결과가 고착되지 않는다)', async () => {
  const key = uniqueKey('recover');
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return calls === 1 ? { failed: true, items: [] } : { failed: false, items: [1, 2, 3] };
  };
  const opts = { shouldCache: (v: { failed: boolean }) => !v.failed };

  const failedRead = await getOrSetCache(key, 60_000, fetcher, opts);
  assert.equal(failedRead.failed, true);

  const recovered = await getOrSetCache(key, 60_000, fetcher, opts);
  assert.deepEqual(recovered.items, [1, 2, 3], '두 번째 요청은 이전 실패가 아니라 새 성공 결과를 받아야 한다');

  let extraCalls = 0;
  const thirdRead = await getOrSetCache(key, 60_000, async () => { extraCalls++; return { failed: false, items: [] }; }, opts);
  assert.deepEqual(thirdRead.items, [1, 2, 3], '회복된 성공 결과는 이후 캐시 히트로 재사용된다');
  assert.equal(extraCalls, 0);
});

test('캐시 오염 방지: 이미 캐시된 정상 결과는 이후 실패로 덮이지 않는다', async () => {
  const key = uniqueKey('poison');
  const good = await getOrSetCache(key, 60_000, async () => ({ failed: false, items: [1, 2, 3] }), {
    shouldCache: (v: { failed: boolean }) => !v.failed,
  });
  assert.deepEqual(good.items, [1, 2, 3]);

  let failedFetcherCalls = 0;
  const afterTransientFailure = await getOrSetCache(
    key,
    60_000,
    async () => { failedFetcherCalls++; return { failed: true, items: [] }; },
    { shouldCache: (v: { failed: boolean }) => !v.failed }
  );
  assert.deepEqual(afterTransientFailure.items, [1, 2, 3], '캐시된 정상 결과가 그대로 유지되어야 한다');
  assert.equal(failedFetcherCalls, 0, 'TTL 안에서는 재조회 자체가 일어나지 않는다');
});

test('TTL이 지나면 재조회한다(shouldCache와 무관한 기존 동작)', async () => {
  const key = uniqueKey('ttl');
  let calls = 0;
  const fetcher = async () => { calls++; return calls; };
  await getOrSetCache(key, 1, fetcher);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await getOrSetCache(key, 1, fetcher), 2);
});

test('동시 요청은 여전히 하나의 fetcher 실행을 공유한다(in-flight 중복 제거 유지)', async () => {
  const key = uniqueKey('inflight');
  let calls = 0;
  const fetcher = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return { failed: true, calls };
  };
  const opts = { shouldCache: (v: { failed: boolean }) => !v.failed };
  const [a, b] = await Promise.all([getOrSetCache(key, 60_000, fetcher, opts), getOrSetCache(key, 60_000, fetcher, opts)]);
  assert.equal(calls, 1, '동시에 들어온 두 요청은 같은 실행을 기다려야 한다');
  assert.deepEqual(a, b);
});
