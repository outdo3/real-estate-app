import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName } from './normalize';

test('normalizeName — 공백 제거', () => {
  assert.equal(normalizeName(' 서대신 4 '), '서대신4');
});

test('normalizeName — "제" 제거', () => {
  assert.equal(normalizeName('제3구역'), '3구역');
});

test('normalizeName — 유형 접미사는 지우지 않는다(R3A 오매칭 실증 반영)', () => {
  // "거제2 재개발"과 "거제2 재건축"이 서로 다른 사업으로 유지돼야 한다.
  assert.equal(normalizeName('거제2 재개발'), '거2재개발');
  assert.equal(normalizeName('거제2 재건축'), '거2재건축');
  assert.notEqual(normalizeName('거제2 재개발'), normalizeName('거제2 재건축'));
});

test('normalizeName — 촉진5 같은 동명이인은 정규화만으로 구분되지 않는다(sido/sigungu가 별도로 필요)', () => {
  assert.equal(normalizeName('촉진5'), '촉진5');
});
