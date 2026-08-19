import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUSINESS_TYPE_VALUES, STAGE_VALUES, BUSINESS_TYPE_LABELS, STAGE_LABELS, stageGroup, sourceLabel, sidoShortLabel, formatDataUpdatedAt, projectStatusLabel } from './labels';
import { SIDO_LIST } from '@/lib/regions';

test('BUSINESS_TYPE_LABELS — 모든 canonical 값에 라벨이 있다', () => {
  for (const v of BUSINESS_TYPE_VALUES) {
    assert.ok(BUSINESS_TYPE_LABELS[v], v);
  }
});

test('STAGE_LABELS — 모든 canonical 값에 라벨이 있다', () => {
  for (const v of STAGE_VALUES) {
    assert.ok(STAGE_LABELS[v], v);
  }
});

test('sourceLabel — raw enum을 사용자용 한글로 변환(MOLIT/BUSAN_CITY 그대로 노출 금지)', () => {
  assert.equal(sourceLabel('MOLIT'), '국토교통부');
  assert.equal(sourceLabel('BUSAN_CITY'), '부산광역시');
});

test('sourceLabel — 알 수 없는 source는 원본 그대로(지어내지 않음)', () => {
  assert.equal(sourceLabel('UNKNOWN_SOURCE'), 'UNKNOWN_SOURCE');
});

test('sidoShortLabel — SIDO_LIST 17개 시도 전부 짧은 라벨이 있다', () => {
  for (const sido of SIDO_LIST) {
    assert.ok(sidoShortLabel(sido), sido);
    assert.notEqual(sidoShortLabel(sido), sido); // 전부 실제로 축약돼야 한다
  }
});

test('formatDataUpdatedAt — YYYY.MM 형식', () => {
  assert.equal(formatDataUpdatedAt('2026-08-19T12:00:00.000Z'), '2026.08');
});

test('formatDataUpdatedAt — 잘못된 값은 빈 문자열(지어내지 않음)', () => {
  assert.equal(formatDataUpdatedAt('not-a-date'), '');
});

test('projectStatusLabel — 4가지 canonical 값 전부 라벨 있음', () => {
  assert.equal(projectStatusLabel('ACTIVE'), '진행 중');
  assert.equal(projectStatusLabel('COMPLETED'), '완료');
  assert.equal(projectStatusLabel('CANCELLED'), '취소');
  assert.equal(projectStatusLabel('UNKNOWN'), '확인 중');
});

test('stageGroup — 준공/이전고시는 done, 해제/조합해산은 stopped', () => {
  assert.equal(stageGroup('COMPLETED'), 'done');
  assert.equal(stageGroup('TRANSFER_REGISTERED'), 'done');
  assert.equal(stageGroup('CANCELLED'), 'stopped');
  assert.equal(stageGroup('DISSOLVED'), 'stopped');
  assert.equal(stageGroup('CONSTRUCTION'), 'active');
  assert.equal(stageGroup('UNKNOWN'), 'unknown');
});
