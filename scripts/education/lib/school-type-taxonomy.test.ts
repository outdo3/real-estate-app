// SCHOOL V2-C2B-B §15 — canonical taxonomy fixture tests. node:test, DB/네트워크 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalSchoolTypeBucket, FINAL_SCHOOL_TYPE_TAXONOMY, NON_STANDARD_LEVEL_PATTERN } from './school-type-taxonomy';

test('canonical bucket mapping — 부산 664건 전수에 실제 존재하는 14개 원문값 전부 매핑됨', () => {
  const expectedCount = 14;
  assert.equal(Object.keys(FINAL_SCHOOL_TYPE_TAXONOMY).length, expectedCount);
});

test('canonical bucket mapping — ELEMENTARY/SPECIAL 정규 케이스', () => {
  assert.equal(finalSchoolTypeBucket('초등학교'), 'ELEMENTARY');
  assert.equal(finalSchoolTypeBucket('특수학교'), 'SPECIAL');
});

test('previous C2A/C2B-A discrepancy regression — 각종학교/평생학교 계열은 MIDDLE/HIGH로 확정(둘 다 놓쳤던 케이스)', () => {
  assert.equal(finalSchoolTypeBucket('각종학교(중)'), 'MIDDLE');
  assert.equal(finalSchoolTypeBucket('각종학교(고)'), 'HIGH');
  assert.equal(finalSchoolTypeBucket('평생학교(중)-2년6학기'), 'MIDDLE');
  assert.equal(finalSchoolTypeBucket('평생학교(고)-3년6학기'), 'HIGH');
  assert.equal(finalSchoolTypeBucket('평생학교(고)-2년6학기'), 'HIGH');
});

test('previous C2A/C2B-A discrepancy regression — 고등기술학교는 HIGH로 확정(C2B-A가 놓쳤던 케이스, C2A 근거 채택)', () => {
  assert.equal(finalSchoolTypeBucket('고등기술학교'), 'HIGH');
});

test('middle sample normalization — 방송통신중학교는 MIDDLE', () => {
  assert.equal(finalSchoolTypeBucket('방송통신중학교'), 'MIDDLE');
});

test('high sample normalization — 방송통신고등학교는 HIGH', () => {
  assert.equal(finalSchoolTypeBucket('방송통신고등학교'), 'HIGH');
});

test('OTHER behavior — 공동실습소/외국인학교만 OTHER, 다른 카테고리와 섞이지 않음', () => {
  assert.equal(finalSchoolTypeBucket('공동실습소'), 'OTHER');
  assert.equal(finalSchoolTypeBucket('외국인학교'), 'OTHER');
});

test('not-applicable semantics — 알려진 14종 밖의 새 원문값은 UNKNOWN_RAW_VALUE로 드러남(조용히 다른 버킷에 섞이지 않음)', () => {
  assert.equal(finalSchoolTypeBucket('전혀새로운학교유형'), 'UNKNOWN_RAW_VALUE');
});

test('not-applicable semantics — null은 OTHER(§2 방침: raw 없으면 OTHER로 명시적 처리)', () => {
  assert.equal(finalSchoolTypeBucket(null), 'OTHER');
});

test('NON_STANDARD_LEVEL_PATTERN — SOURCE_NOT_APPLICABLE 판정에 쓰이는 패턴이 실제 비표준 유형만 잡음', () => {
  assert.equal(NON_STANDARD_LEVEL_PATTERN.test('방송통신고등학교'), true);
  assert.equal(NON_STANDARD_LEVEL_PATTERN.test('평생학교(고)-3년6학기'), true);
  assert.equal(NON_STANDARD_LEVEL_PATTERN.test('외국인학교'), true);
  assert.equal(NON_STANDARD_LEVEL_PATTERN.test('공동실습소'), true);
  assert.equal(NON_STANDARD_LEVEL_PATTERN.test('각종학교(고)'), true);
  assert.equal(NON_STANDARD_LEVEL_PATTERN.test('고등학교'), false);
  assert.equal(NON_STANDARD_LEVEL_PATTERN.test('중학교'), false);
  assert.equal(NON_STANDARD_LEVEL_PATTERN.test('초등학교'), false);
  assert.equal(NON_STANDARD_LEVEL_PATTERN.test('특수학교'), false);
});
