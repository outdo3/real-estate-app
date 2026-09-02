import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aptNamesMatch, resolveStrongIdentityAptSeqs, matchesTradeIdentity, deriveCanonicalAptSeq } from './apt-name-match';

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

// DECISION_JOURNEY_V1.1 — deriveCanonicalAptSeq: 이미 name+dong으로 검증된 trades에서
// downstream(지도/비교) 액션에 쓸 canonical aptSeq를 안전하게 뽑는다.

test('deriveCanonicalAptSeq: 모든 거래가 같은 aptSeq 하나면 그 값을 반환한다', () => {
  const trades = [{ aptSeq: '26350-2206' }, { aptSeq: '26350-2206' }, { aptSeq: null }];
  assert.equal(deriveCanonicalAptSeq(trades), '26350-2206');
});

test('deriveCanonicalAptSeq: aptSeq가 서로 다른 2개 이상이면(동일 이름+동에 복수 등록) 임의로 고르지 않고 null을 반환한다', () => {
  const trades = [{ aptSeq: '26350-2206' }, { aptSeq: '26350-2610' }];
  assert.equal(deriveCanonicalAptSeq(trades), null);
});

test('deriveCanonicalAptSeq: aptSeq가 전혀 없으면 null(=composite identity로 폴백)을 반환한다', () => {
  const trades = [{ aptSeq: null }, { aptSeq: undefined }];
  assert.equal(deriveCanonicalAptSeq(trades), null);
});

test('deriveCanonicalAptSeq: incoming aptSeq가 trades의 candidate set에 있으면 그 값을 채택한다', () => {
  const trades = [{ aptSeq: '26350-2206' }, { aptSeq: '26350-2610' }];
  assert.equal(deriveCanonicalAptSeq(trades, '26350-2610'), '26350-2610');
});

test('deriveCanonicalAptSeq: incoming aptSeq가 trades의 candidate set에 없으면(불일치) 신뢰하지 않고, 단일 후보가 있으면 그걸 쓴다 — 약한 이름 기준으로 다른 apartment를 선택하지 않는다', () => {
  const trades = [{ aptSeq: '26350-2206' }, { aptSeq: '26350-2206' }];
  assert.equal(deriveCanonicalAptSeq(trades, '99999-9999'), '26350-2206');
});

test('deriveCanonicalAptSeq: incoming aptSeq가 불일치하고 후보도 모호하면(2개 이상) null을 반환한다', () => {
  const trades = [{ aptSeq: '26350-2206' }, { aptSeq: '26350-2610' }];
  assert.equal(deriveCanonicalAptSeq(trades, '99999-9999'), null);
});
