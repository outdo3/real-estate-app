import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aptNamesMatch, resolveStrongIdentityAptSeqs, matchesTradeIdentity } from './apt-name-match';

// SEARCH_DETAIL_IDENTITY_HOTFIX_V2 — regression fixtures based on real production data
// (부산 해운대구 우동, ApartmentTradeHistory 실측): "경동"(aptSeq 26350-2, 지번 974,
// 1995년 준공)과 "해운대경동제이드"(aptSeq 26350-2206, 지번 763, 2012년 준공)는 같은
// 법정동(우동)에 있는 완전히 다른 두 단지다.

test('aptNamesMatch: 기존 느슨한 부분포함 규칙 자체는 그대로다(회귀 없음 확인용) — 경동은 해운대경동제이드의 substring', () => {
  assert.equal(aptNamesMatch('경동', '해운대경동제이드'), true);
});

test('resolveStrongIdentityAptSeqs: 요청 이름과 정규화 후 완전히 일치하는 exact match가 있으면 그 aptSeq만 반환한다', () => {
  const items = [
    { name: '경동', dong: '우동', aptSeq: '26350-2' },
    { name: '해운대경동제이드', dong: '우동', aptSeq: '26350-2206' },
    { name: '센텀경동리인', dong: '우동', aptSeq: '26350-2334' },
    { name: '해운대경동리인뷰2차', dong: '우동', aptSeq: '26350-2610' },
  ];
  const seqs = resolveStrongIdentityAptSeqs(items, '해운대경동제이드', '우동');
  assert.deepEqual([...seqs], ['26350-2206']);
});

test('matchesTradeIdentity: exact match(strongAptSeqs)가 있으면 substring만 매칭되는 다른 단지는 거부한다 — 해운대경동제이드 검색에 경동이 섞이지 않는다', () => {
  const items = [
    { name: '경동', dong: '우동', aptSeq: '26350-2' },
    { name: '해운대경동제이드', dong: '우동', aptSeq: '26350-2206' },
  ];
  const strongAptSeqs = resolveStrongIdentityAptSeqs(items, '해운대경동제이드', '우동');

  assert.equal(matchesTradeIdentity(items[0], '해운대경동제이드', strongAptSeqs), false, '경동(aptSeq 26350-2)은 거부되어야 한다');
  assert.equal(matchesTradeIdentity(items[1], '해운대경동제이드', strongAptSeqs), true, '해운대경동제이드(aptSeq 26350-2206) 본인은 통과해야 한다');
});

test('matchesTradeIdentity: 반대 방향(경동 검색)도 다른 단지(해운대경동제이드)를 끌어오지 않는다', () => {
  const items = [
    { name: '경동', dong: '우동', aptSeq: '26350-2' },
    { name: '해운대경동제이드', dong: '우동', aptSeq: '26350-2206' },
  ];
  const strongAptSeqs = resolveStrongIdentityAptSeqs(items, '경동', '우동');
  assert.deepEqual([...strongAptSeqs], ['26350-2']);
  assert.equal(matchesTradeIdentity(items[1], '경동', strongAptSeqs), false);
  assert.equal(matchesTradeIdentity(items[0], '경동', strongAptSeqs), true);
});

test('resolveStrongIdentityAptSeqs: exact match가 dong 안에 전혀 없으면 빈 집합을 반환한다(legacy alias 폴백 트리거)', () => {
  const items = [
    { name: '서대신금호어울림', dong: '서대신동3가', aptSeq: '26140-10' },
  ];
  const seqs = resolveStrongIdentityAptSeqs(items, '금호어울림', '서대신동3가');
  assert.equal(seqs.size, 0);
});

test('matchesTradeIdentity: strongAptSeqs가 비어있으면(exact match 없음) 기존 aptNamesMatch 느슨한 규칙으로 폴백한다 — 정당한 alias 케이스 보존', () => {
  const item = { name: '서대신금호어울림', aptSeq: '26140-10' };
  const emptySet = new Set<string>();
  assert.equal(matchesTradeIdentity(item, '금호어울림', emptySet), true);
});

test('matchesTradeIdentity: aptSeq가 없는 항목은 exact match 확보 시 정규화 이름 완전일치로만 인정한다(substring 금지)', () => {
  const strongAptSeqs = resolveStrongIdentityAptSeqs(
    [{ name: '해운대경동제이드', dong: '우동', aptSeq: '26350-2206' }],
    '해운대경동제이드',
    '우동'
  );
  assert.equal(matchesTradeIdentity({ name: '경동', aptSeq: null }, '해운대경동제이드', strongAptSeqs), false);
  assert.equal(matchesTradeIdentity({ name: '해운대경동제이드', aptSeq: null }, '해운대경동제이드', strongAptSeqs), true);
});

test('resolveStrongIdentityAptSeqs: dong이 없으면(레거시 name-only URL) 전체 항목에서 exact match를 찾는다', () => {
  const items = [
    { name: '경동', dong: '우동', aptSeq: '26350-2' },
    { name: '해운대경동제이드', dong: '우동', aptSeq: '26350-2206' },
  ];
  const seqs = resolveStrongIdentityAptSeqs(items, '해운대경동제이드');
  assert.deepEqual([...seqs], ['26350-2206']);
});
