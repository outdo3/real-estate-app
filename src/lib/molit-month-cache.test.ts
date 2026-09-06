import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchMolitMonthCached, molitMonthCacheKey } from './molit-month-cache';

// APT_DETAIL_MOLIT_PARTIAL_FAILURE_TRUST_FIX §CACHE_SAFETY / §CACHE_POISONING
// 네트워크 없이(주입한 fetcher로) 캐시 동작만 검증한다. 실제 키 네임스페이스를 오염시키지
// 않도록 테스트 전용 lawdCd를 쓴다.

let seq = 0;
const testLawdCd = () => `T${seq++}${process.hrtime.bigint().toString().slice(-6)}`;

const ERROR_PLACEHOLDER = [{ id: 'error-apt', name: 'API 에러: 초당 서비스 요청제한 횟수 초과 에러', typeLabel: '에러' }];
const OK_ROWS = [{ name: '해운대경동제이드', typeLabel: '실거래', aptSeq: '26350-2206' }];

test('캐시 키는 기존 형식(molit:{type}:{lawdCd}:{dealYmd}) 그대로다 — 다른 라우트와 캐시를 계속 공유한다', () => {
  assert.equal(molitMonthCacheKey('apt', '26140', '202608'), 'molit:apt:26140:202608');
});

test('성공 월은 캐시된다(두 번째 호출은 fetcher를 다시 부르지 않는다)', async () => {
  const lawdCd = testLawdCd();
  let calls = 0;
  const fetchMonth = async () => { calls++; return OK_ROWS; };

  const first = await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth });
  assert.equal(first.status, 'SUCCESS_WITH_DATA');
  assert.equal(first.items.length, 1);

  const second = await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth });
  assert.equal(second.status, 'SUCCESS_WITH_DATA');
  assert.equal(calls, 1);
});

test('성공했지만 0건인 월도 캐시된다 — 진짜 무거래는 실패가 아니다', async () => {
  const lawdCd = testLawdCd();
  let calls = 0;
  const fetchMonth = async () => { calls++; return []; };

  const first = await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth });
  assert.equal(first.status, 'SUCCESS_EMPTY');

  await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth });
  assert.equal(calls, 1, '무거래 월을 매번 재조회하면 안 된다(실패로 취급 금지)');
});

test('실패 월은 캐시되지 않는다 — 다음 요청이 다시 조회한다', async () => {
  const lawdCd = testLawdCd();
  let calls = 0;
  const fetchMonth = async () => { calls++; return ERROR_PLACEHOLDER; };

  const first = await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth });
  assert.equal(first.status, 'FAILED');

  await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth });
  assert.equal(calls, 2, '실패가 캐시되면 그 셀이 TTL 내내 축소된 값으로 고정된다');
});

test('회복: 부분 실패 직후 성공하면 두 번째 요청은 완전한 결과를 받는다', async () => {
  const lawdCd = testLawdCd();
  let calls = 0;
  const fetchMonth = async () => { calls++; return calls === 1 ? ERROR_PLACEHOLDER : OK_ROWS; };

  const failed = await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth });
  assert.equal(failed.status, 'FAILED');

  const recovered = await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth });
  assert.equal(recovered.status, 'SUCCESS_WITH_DATA');
  assert.equal(recovered.items.length, 1);

  let extra = 0;
  const cached = await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth: async () => { extra++; return []; } });
  assert.equal(cached.status, 'SUCCESS_WITH_DATA', '회복된 결과가 캐시되어 재사용된다');
  assert.equal(extra, 0);
});

test('오염 방지: 캐시된 정상 월은 이후 일시적 실패로 덮이지 않는다', async () => {
  const lawdCd = testLawdCd();
  await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth: async () => OK_ROWS });

  let failCalls = 0;
  const after = await fetchMolitMonthCached(
    { type: 'apt', lawdCd, dealYmd: '202608' },
    { fetchMonth: async () => { failCalls++; return ERROR_PLACEHOLDER; } }
  );
  assert.equal(after.status, 'SUCCESS_WITH_DATA');
  assert.equal(after.items.length, 1);
  assert.equal(failCalls, 0);
});

test('fetcher가 throw해도 0건으로 낙관하지 않고 FAILED로 돌려준다', async () => {
  const lawdCd = testLawdCd();
  let calls = 0;
  const fetchMonth = async () => { calls++; throw new Error('network down'); };

  const result = await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth });
  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.items, []);

  await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth });
  assert.equal(calls, 2, 'throw한 실패도 캐시되면 안 된다');
});

test('type/lawdCd/dealYmd가 다르면 서로 다른 셀로 캐시된다', async () => {
  const lawdCd = testLawdCd();
  const fetchMonth = async () => OK_ROWS;
  const a = await fetchMolitMonthCached({ type: 'apt', lawdCd, dealYmd: '202608' }, { fetchMonth });
  const b = await fetchMolitMonthCached({ type: 'rent', lawdCd, dealYmd: '202608' }, { fetchMonth: async () => [] });
  assert.equal(a.status, 'SUCCESS_WITH_DATA');
  assert.equal(b.status, 'SUCCESS_EMPTY');
});
