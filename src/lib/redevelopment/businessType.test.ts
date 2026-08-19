import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapMolitBusinessType, mapBusanBusinessType, parseMolitBusinessTypeCode } from './businessType';

test('mapMolitBusinessType — 국토부 5개 코드 전부 매핑', () => {
  assert.equal(mapMolitBusinessType('1)재개발(주택정비)'), 'REDEVELOPMENT');
  assert.equal(mapMolitBusinessType('2)재개발(도시정비)'), 'REDEVELOPMENT');
  assert.equal(mapMolitBusinessType('3)재건축(공동주택)'), 'RECONSTRUCTION');
  assert.equal(mapMolitBusinessType('4)재건축(단독주택)'), 'RECONSTRUCTION');
  assert.equal(mapMolitBusinessType('5)주거환경개선'), 'RESIDENTIAL_ENVIRONMENT');
});

test('mapMolitBusinessType — 알 수 없는 코드는 UNKNOWN이 아니라 OTHER(코드는 파싱됐으나 매핑 밖)', () => {
  assert.equal(mapMolitBusinessType('9)신규유형'), 'OTHER');
});

test('mapMolitBusinessType — 코드 자체가 없으면 UNKNOWN', () => {
  assert.equal(mapMolitBusinessType('분류불가'), 'UNKNOWN');
});

test('parseMolitBusinessTypeCode', () => {
  assert.equal(parseMolitBusinessTypeCode('3)재건축(공동주택)'), '3');
  assert.equal(parseMolitBusinessTypeCode('분류불가'), null);
});

test('mapBusanBusinessType — areaName 접미사 4종', () => {
  assert.equal(mapBusanBusinessType('명서1 재개발'), 'REDEVELOPMENT');
  assert.equal(mapBusanBusinessType('거제2 재건축'), 'RECONSTRUCTION');
  assert.equal(mapBusanBusinessType('당리 가로주택정비'), 'BLOCK_HOUSING');
  assert.equal(mapBusanBusinessType('무슨동 소규모재건축'), 'SMALL_RECONSTRUCTION');
});

test('mapBusanBusinessType — 접미사가 겹치는 긴 접미사 우선', () => {
  assert.equal(mapBusanBusinessType('가로주택정비사업'), 'BLOCK_HOUSING');
  assert.equal(mapBusanBusinessType('소규모재건축사업'), 'SMALL_RECONSTRUCTION');
});

test('mapBusanBusinessType — 접미사 없으면 UNKNOWN', () => {
  assert.equal(mapBusanBusinessType('이름뿐인구역'), 'UNKNOWN');
});
