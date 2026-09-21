import assert from 'node:assert/strict';
import test from 'node:test';

// ADMIN_DASHBOARD_TRUST_FIX_V1 §6/§7 — /admin/ops가 자주 통째로 죽던 원인은
// 이 모듈의 외부 프록시 호출이었다(감사 §9: timeout 없이 18회 순차 호출).
// 여기서 고정하는 계약은 두 가지다.
//   1) 외부 프록시가 실패/지연해도 **throw하지 않고** 빈 목록으로 떨어진다.
//   2) 그 덕분에 호출부(ops 요약)는 "조각 하나 실패"로 처리할 수 있고,
//      화면 전체를 실패로 만들 이유가 사라진다.
//
// 네트워크를 실제로 타지 않도록 global fetch를 갈아끼운다. 캐시가 모듈 수준이라
// 테스트마다 fresh import로 격리한다.

async function freshRegionUtils() {
  // 쿼리스트링으로 모듈 캐시를 우회한다(각 테스트가 빈 캐시에서 시작해야 한다).
  return import(`./region-utils?t=${Date.now()}-${Math.random()}`);
}

test('프록시가 거부하면 getSidoList는 throw하지 않고 빈 목록을 준다', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED');
  }) as typeof fetch;
  try {
    const { getSidoList } = await freshRegionUtils();
    const list = await getSidoList();
    assert.deepEqual(list, []);
  } finally {
    globalThis.fetch = original;
  }
});

test('프록시가 5xx면 getSigunguListForSido도 빈 목록으로 떨어진다', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch;
  try {
    const { getSigunguListForSido } = await freshRegionUtils();
    const list = await getSigunguListForSido('26');
    assert.deepEqual(list, []);
  } finally {
    globalThis.fetch = original;
  }
});

test('호출에 AbortSignal(timeout)이 실제로 실려 나간다 — 무한 대기 금지', async () => {
  const original = globalThis.fetch;
  let sawSignal = false;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sawSignal = !!init?.signal;
    throw new Error('stop here');
  }) as unknown as typeof fetch;
  try {
    const { getSidoList } = await freshRegionUtils();
    await getSidoList();
    assert.equal(sawSignal, true, 'fetch에 abort signal이 없으면 프록시 지연 시 함수가 매달린다');
  } finally {
    globalThis.fetch = original;
  }
});

test('abort(지연)도 실패와 같게 다뤄진다 — 매달리지 않고 빈 목록', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const e = new Error('The operation was aborted due to timeout');
    e.name = 'TimeoutError';
    throw e;
  }) as unknown as typeof fetch;
  try {
    const { getSidoList } = await freshRegionUtils();
    const list = await getSidoList();
    assert.deepEqual(list, []);
  } finally {
    globalThis.fetch = original;
  }
});
