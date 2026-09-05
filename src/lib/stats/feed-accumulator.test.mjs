// PERFORMANCE_V2 §18 — 거래량 하단 목록 사라짐 버그 회귀 테스트.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFeedQueryKey,
  emptyFeedPages,
  mergeFeedPage,
  flattenFeedPages,
  resolveVisibleFeed,
  groupTradesByDate,
} from './feed-accumulator.ts';

const REGION = { lawdCd: '26140', sidoCode: '26', dong: 'all' };
const keyFor = (dealType, preset = '7d') => buildFeedQueryKey({ ...REGION, preset, dealType });
const t = (id, date = '2026-09-01') => ({ uid: id, dealDate: date });

test('쿼리 키에 dealType이 포함된다 — 없으면 필터 전환이 누적본을 못 가른다', () => {
  assert.notEqual(keyFor(''), keyFor('sale'));
  assert.notEqual(keyFor('sale'), keyFor('jeonse'));
  assert.ok(keyFor('').endsWith('deal:all'));
  assert.ok(keyFor('sale').endsWith('deal:sale'));
});

test('지역/기간도 키를 가른다', () => {
  assert.notEqual(keyFor('sale', '7d'), keyFor('sale', '30d'));
  assert.notEqual(
    buildFeedQueryKey({ ...REGION, preset: '7d', dealType: 'sale' }),
    buildFeedQueryKey({ ...REGION, lawdCd: null, preset: '7d', dealType: 'sale' })
  );
});

// ── 핵심 회귀: 전체 → 매매 → 전체 ────────────────────────────────────────
test('REGRESSION 전체 → 매매 → 전체: 캐시 히트로 돌아와도 목록이 남아 있다', () => {
  const kAll = keyFor(''), kSale = keyFor('sale');

  // 1) 전체 — 응답 도착
  let pages = mergeFeedPage(emptyFeedPages(kAll), kAll, 0, [t('a1'), t('a2')]);
  assert.equal(resolveVisibleFeed(pages, kAll).trades.length, 2);

  // 2) 매매 — 새 응답 도착
  pages = mergeFeedPage(pages, kSale, 0, [t('s1')]);
  assert.equal(resolveVisibleFeed(pages, kSale).trades.length, 1);

  // 3) 전체로 복귀 — SWR 캐시 히트라 onSuccess는 불리지 않지만, data는 있다.
  //    화면은 그 data로부터 목록을 **파생**하므로 병합만 하면 즉시 복구된다.
  pages = mergeFeedPage(pages, kAll, 0, [t('a1'), t('a2')]);
  const v = resolveVisibleFeed(pages, kAll);
  assert.equal(v.trades.length, 2, '전체로 돌아왔을 때 목록이 비어 있으면 안 된다');
  assert.equal(v.isStale, false);
});

test('REGRESSION 전체 → 전세', () => {
  const kAll = keyFor(''), kJeonse = keyFor('jeonse');
  let pages = mergeFeedPage(emptyFeedPages(kAll), kAll, 0, [t('a1')]);
  pages = mergeFeedPage(pages, kJeonse, 0, [t('j1'), t('j2')]);
  const v = resolveVisibleFeed(pages, kJeonse);
  assert.equal(v.trades.length, 2);
  assert.equal(v.isStale, false);
});

test('REGRESSION 매매 → 전세 → 전체', () => {
  const kSale = keyFor('sale'), kJeonse = keyFor('jeonse'), kAll = keyFor('');
  let pages = mergeFeedPage(emptyFeedPages(kSale), kSale, 0, [t('s1')]);
  pages = mergeFeedPage(pages, kJeonse, 0, [t('j1')]);
  pages = mergeFeedPage(pages, kAll, 0, [t('a1'), t('a2'), t('a3')]);
  assert.deepEqual(resolveVisibleFeed(pages, kAll).trades.map((x) => x.uid), ['a1', 'a2', 'a3']);
});

test('REGRESSION 지역 변경 후 필터 변경: 이전 지역 누적이 새 지역으로 새지 않는다', () => {
  const kBusanSale = buildFeedQueryKey({ ...REGION, preset: '7d', dealType: 'sale' });
  const kOtherSale = buildFeedQueryKey({ ...REGION, lawdCd: '26350', preset: '7d', dealType: 'sale' });
  let pages = mergeFeedPage(emptyFeedPages(kBusanSale), kBusanSale, 0, [t('x1'), t('x2')]);
  // 지역이 바뀌면 키가 달라 이전 누적은 stale로 표시되고, 새 응답이 오면 교체된다.
  assert.equal(resolveVisibleFeed(pages, kOtherSale).isStale, true);
  pages = mergeFeedPage(pages, kOtherSale, 0, [t('y1')]);
  assert.deepEqual(resolveVisibleFeed(pages, kOtherSale).trades.map((x) => x.uid), ['y1']);
});

// ── 페이지네이션 ────────────────────────────────────────────────────────
test('더보기: offset 순서대로 누적된다', () => {
  const k = keyFor('');
  let pages = mergeFeedPage(emptyFeedPages(k), k, 0, [t('p1'), t('p2')]);
  pages = mergeFeedPage(pages, k, 50, [t('p3')]);
  pages = mergeFeedPage(pages, k, 100, [t('p4')]);
  assert.deepEqual(flattenFeedPages(pages).map((x) => x.uid), ['p1', 'p2', 'p3', 'p4']);
});

test('더보기 중 필터를 바꾸면 누적 페이지가 전부 버려진다', () => {
  const k = keyFor(''), k2 = keyFor('sale');
  let pages = mergeFeedPage(emptyFeedPages(k), k, 0, [t('p1')]);
  pages = mergeFeedPage(pages, k, 50, [t('p2')]);
  pages = mergeFeedPage(pages, k2, 0, [t('s1')]);
  assert.deepEqual(flattenFeedPages(pages).map((x) => x.uid), ['s1']);
});

test('같은 내용 재병합은 이전 객체를 그대로 돌려준다(불필요한 리렌더 방지)', () => {
  const k = keyFor('');
  const rows = [t('p1')];
  const a = mergeFeedPage(emptyFeedPages(k), k, 0, rows);
  const b = mergeFeedPage(a, k, 0, rows);
  assert.equal(a, b);
});

// ── §16 체감 성능: 전환 중 목록을 비우지 않는다 ─────────────────────────
test('필터 전환 직후에는 이전 목록을 stale로 유지한다(깜빡임 방지)', () => {
  const kAll = keyFor(''), kSale = keyFor('sale');
  const pages = mergeFeedPage(emptyFeedPages(kAll), kAll, 0, [t('a1'), t('a2')]);
  const v = resolveVisibleFeed(pages, kSale); // 새 응답 도착 전
  assert.equal(v.trades.length, 2, '전환 중 목록이 비면 안 된다');
  assert.equal(v.isStale, true, 'stale로 표시돼야 한다');
});

// ── 그룹핑 ──────────────────────────────────────────────────────────────
test('날짜별 그룹은 최신 우선, 중복 헤더 없음', () => {
  const g = groupTradesByDate([t('a', '2026-09-01'), t('b', '2026-09-03'), t('c', '2026-09-01')]);
  assert.deepEqual(g.map((x) => x.date), ['2026-09-03', '2026-09-01']);
  assert.deepEqual(g[1].trades.map((x) => x.uid), ['a', 'c']);
});

test('빈 목록은 빈 그룹', () => {
  assert.deepEqual(groupTradesByDate([]), []);
});
