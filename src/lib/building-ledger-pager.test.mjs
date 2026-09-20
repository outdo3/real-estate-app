import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAllLedgerPages, ledgerPageCount, dedupeLedgerItems, LEDGER_PAGE_SIZE } from './building-ledger-pager.ts';

// BUILDING_LEDGER_PAGINATION_FIX_V1 — 실측 계약(해운대구 우동 1104-1, getBrTitleInfo):
//   pageNo 없음      → 서버가 numOfRows를 무시하고 1건만, totalCount=14
//   pageNo=1&100건   → 14건 전부
// 여기서는 네트워크 없이 그 계약을 가짜 fetcher로 고정한다.

/** totalCount는 알려주면서 페이지당 pageSize건씩 주는 정상 서버. */
const server = (total, pageSize = LEDGER_PAGE_SIZE) => {
  const all = Array.from({ length: total }, (_, i) => ({ mgmBldrgstPk: String(1000 + i), dongNm: `${i + 1}동` }));
  const calls = [];
  const fetchPage = async (pageNo, numOfRows) => {
    calls.push({ pageNo, numOfRows });
    const size = Math.min(numOfRows, pageSize);
    const start = (pageNo - 1) * size;
    return { kind: 'OK', items: all.slice(start, start + size), totalCount: total };
  };
  return { fetchPage, calls, all };
};

test('A · totalCount=1이면 한 페이지만 부른다', async () => {
  const s = server(1);
  const r = await fetchAllLedgerPages(s.fetchPage);
  assert.equal(r.status, 'COMPLETE');
  assert.equal(r.items.length, 1);
  assert.equal(r.pages, 1);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].pageNo, 1, 'pageNo는 항상 명시한다 — 빼면 서버가 1건만 준다');
});

test('B · totalCount > numOfRows면 전 페이지를 모은다', async () => {
  const s = server(14, 5);
  const r = await fetchAllLedgerPages(s.fetchPage, { numOfRows: 5 });
  assert.equal(r.status, 'COMPLETE');
  assert.equal(r.items.length, 14, '14건 전부');
  assert.equal(r.pages, 3, '5+5+4');
  assert.deepEqual(s.calls.map((c) => c.pageNo), [1, 2, 3]);
});

test('B-1 · 실측 계약 재현 — pageNo 없이 1건만 주던 응답을 전부 모은다', async () => {
  // 예전 동작: numOfRows=5를 보내도 서버가 1건만 주고 totalCount=14.
  const all = Array.from({ length: 14 }, (_, i) => ({ mgmBldrgstPk: String(2000 + i) }));
  const legacyTruncated = { kind: 'OK', items: [all[0]], totalCount: 14 };
  assert.equal(legacyTruncated.items.length, 1, '예전 경로가 보던 것은 1건뿐');
  // 고친 뒤: pageNo를 붙여 전부 모은다.
  const s = server(14, 100);
  const r = await fetchAllLedgerPages(s.fetchPage);
  assert.equal(r.items.length, 14);
  assert.notEqual(r.items.length, legacyTruncated.items.length);
});

test('C · 중간 페이지가 비면 PARTIAL — 잘린 응답을 조용히 받아들이지 않는다', async () => {
  const fetchPage = async (pageNo) =>
    pageNo === 1
      ? { kind: 'OK', items: [{ mgmBldrgstPk: 'a' }, { mgmBldrgstPk: 'b' }], totalCount: 5 }
      : { kind: 'OK', items: [], totalCount: 5 };
  const r = await fetchAllLedgerPages(fetchPage, { numOfRows: 2 });
  assert.equal(r.status, 'PARTIAL');
  assert.deepEqual(r.items, [], 'PARTIAL이면 값을 내주지 않는다');
  assert.match(r.detail, /collected=2 totalCount=5/);
});

test('C-1 · 페이지 오류·제한은 빈 결과로 위장하지 않는다', async () => {
  const err = await fetchAllLedgerPages(async () => ({ kind: 'ERROR', detail: 'http=500' }));
  assert.equal(err.status, 'ERROR');
  const rl = await fetchAllLedgerPages(async (p) => (p === 1
    ? { kind: 'OK', items: [{ mgmBldrgstPk: 'a' }], totalCount: 3 }
    : { kind: 'RATE_LIMITED', detail: 'quota' }), { numOfRows: 1 });
  assert.equal(rl.status, 'RATE_LIMITED');
  assert.deepEqual(rl.items, []);
});

test('D · 공식 식별자가 같은 레코드만 중복 제거한다(식별자 없으면 제거하지 않음)', () => {
  const withPk = dedupeLedgerItems([{ mgmBldrgstPk: '1' }, { mgmBldrgstPk: '1' }, { mgmBldrgstPk: '2' }]);
  assert.equal(withPk.items.length, 2);
  assert.equal(withPk.removed, 1);
  // 식별자가 없으면 같은 모양이어도 합치지 않는다 — 비공식 값으로 동일 건물이라 추측하지 않는다.
  const noPk = dedupeLedgerItems([{ dongNm: '101동' }, { dongNm: '101동' }]);
  assert.equal(noPk.items.length, 2);
  assert.equal(noPk.removed, 0);
});

test('D-1 · 중복 제거 뒤 totalCount에 못 미치면 PARTIAL', async () => {
  const fetchPage = async (pageNo) => (pageNo > 2
    ? { kind: 'OK', items: [], totalCount: 2 }
    : { kind: 'OK', items: [{ mgmBldrgstPk: 'same' }], totalCount: 2 });
  const r = await fetchAllLedgerPages(fetchPage, { numOfRows: 1 });
  assert.equal(r.status, 'PARTIAL');
  assert.equal(r.duplicatesRemoved, 1);
});

test('E · totalCount=0이면 EMPTY(오류가 아니다)', async () => {
  const r = await fetchAllLedgerPages(async () => ({ kind: 'OK', items: [], totalCount: 0 }));
  assert.equal(r.status, 'EMPTY');
  assert.equal(r.totalCount, 0);
});

test('F · maxPages 상한에 걸리면 PARTIAL(무한 루프 없음)', async () => {
  const s = server(500, 1);
  const r = await fetchAllLedgerPages(s.fetchPage, { numOfRows: 1, maxPages: 3 });
  assert.equal(r.status, 'PARTIAL');
  assert.ok(s.calls.length <= 3);
});

test('ledgerPageCount — 올림, 0/음수 방어', () => {
  assert.equal(ledgerPageCount(14, 5), 3);
  assert.equal(ledgerPageCount(100, 100), 1);
  assert.equal(ledgerPageCount(101, 100), 2);
  assert.equal(ledgerPageCount(0, 100), 0);
  assert.equal(ledgerPageCount(10, 0), 0);
});
