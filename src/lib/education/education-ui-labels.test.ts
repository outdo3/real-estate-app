import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZONE_LABEL,
  middleSummaryValue,
  shouldRenderZoneSchoolList,
  middleGroupIsSingleSchool,
  kindergartenSummaryValue,
  highSchoolSummaryValue,
} from './education-ui-labels';

test('ZONE_LABEL — "배정학교" 표현이 어디에도 없다', () => {
  for (const label of Object.values(ZONE_LABEL)) {
    assert.ok(!label.includes('배정학교'));
  }
});

test('shouldRenderZoneSchoolList — AVAILABLE/SHARED만 학교 목록 렌더, REVIEW_REQUIRED/NOT_AVAILABLE는 상태 텍스트만', () => {
  assert.equal(shouldRenderZoneSchoolList('AVAILABLE'), true);
  assert.equal(shouldRenderZoneSchoolList('SHARED'), true);
  assert.equal(shouldRenderZoneSchoolList('REVIEW_REQUIRED'), false);
  assert.equal(shouldRenderZoneSchoolList('NOT_AVAILABLE'), false);
});

test('middleSummaryValue — 학교군 데이터 있으면 "OO학교군 · N개교"', () => {
  const v = middleSummaryValue({ status: 'AVAILABLE', groupName: '9학교군', schools: [{ schoolName: 'A' }, { schoolName: 'B' }] });
  assert.equal(v, '9학교군 · 2개교');
});

test('middleSummaryValue — 단일 "배정 중학교" 문구를 만들지 않는다(항상 학교군 형식 또는 상태 라벨)', () => {
  const v = middleSummaryValue({ status: 'AVAILABLE', groupName: '지사중학구', schools: [{ schoolName: '지사중학교' }] });
  assert.ok(!v.includes('배정'));
  assert.equal(v, '지사중학구 · 1개교');
});

test('middleSummaryValue — REVIEW_REQUIRED면 상태 라벨', () => {
  assert.equal(middleSummaryValue({ status: 'REVIEW_REQUIRED', groupName: null, schools: [] }), '확인 중');
});

test('middleSummaryValue — null이면 "확인 불가"', () => {
  assert.equal(middleSummaryValue(null), '확인 불가');
});

test('middleGroupIsSingleSchool — 1개교면 true, 그 외 false', () => {
  assert.equal(middleGroupIsSingleSchool({ status: 'AVAILABLE', groupName: 'A중학구', schools: [{ schoolName: 'A중학교' }] }), true);
  assert.equal(middleGroupIsSingleSchool({ status: 'AVAILABLE', groupName: 'B학교군', schools: [{ schoolName: 'X' }, { schoolName: 'Y' }] }), false);
  assert.equal(middleGroupIsSingleSchool(null), false);
});

test('kindergartenSummaryValue — 0곳이면 "없음"이 아니라 반경 명시 문구', () => {
  const v = kindergartenSummaryValue(0);
  assert.ok(!v.includes('0곳'));
  assert.match(v, /이내 없음/);
});

test('kindergartenSummaryValue — N곳이면 "주변 N곳"', () => {
  assert.equal(kindergartenSummaryValue(3), '주변 3곳');
});

test('highSchoolSummaryValue — 0곳이면 반경 명시 문구, N곳이면 "주변 N곳"', () => {
  assert.match(highSchoolSummaryValue(0), /이내 없음/);
  assert.equal(highSchoolSummaryValue(2), '주변 2곳');
});
