import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSchoolStat, isValidBusanCoordinate, studentsPerClass, studentsPerTeacher, normalizeGradeSlot } from './schoolinfo-stat-validate.ts';

test('validateSchoolStat: 정상값은 valid', () => {
  const result = validateSchoolStat({ studentCount: 420, classCount: 21, teacherCount: 24 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.reasons, []);
});

test('validateSchoolStat: 음수는 invalid', () => {
  assert.equal(validateSchoolStat({ studentCount: -1, classCount: 10, teacherCount: 5 }).valid, false);
  assert.equal(validateSchoolStat({ studentCount: 10, classCount: -1, teacherCount: 5 }).valid, false);
  assert.equal(validateSchoolStat({ studentCount: 10, classCount: 10, teacherCount: -1 }).valid, false);
});

test('validateSchoolStat: 학생 있는데 학급 0이면 invalid(추정 보정 없음, REVIEW로 유도)', () => {
  const result = validateSchoolStat({ studentCount: 100, classCount: 0, teacherCount: 5 });
  assert.equal(result.valid, false);
});

test('validateSchoolStat: 학생이 실제로 0명인 학교(폐교 직전 등)는 정직하게 valid', () => {
  const result = validateSchoolStat({ studentCount: 0, classCount: 0, teacherCount: 0 });
  assert.equal(result.valid, true);
});

test('validateSchoolStat: null 필드는 검증을 건너뛴다(미확보와 0을 혼동하지 않음)', () => {
  const result = validateSchoolStat({ studentCount: null, classCount: null, teacherCount: null });
  assert.equal(result.valid, true);
});

test('isValidBusanCoordinate: 실제 부산 좌표는 valid', () => {
  assert.equal(isValidBusanCoordinate(35.1204504376, 129.0125451943), true);
});

test('isValidBusanCoordinate: 부산 범위 밖 좌표는 invalid(예: 서울)', () => {
  assert.equal(isValidBusanCoordinate(37.5665, 126.978), false);
});

test('isValidBusanCoordinate: null/NaN은 invalid', () => {
  assert.equal(isValidBusanCoordinate(null, 129.01), false);
  assert.equal(isValidBusanCoordinate(35.12, NaN), false);
});

test('studentsPerClass: 정상 계산, 반올림 1자리', () => {
  assert.equal(studentsPerClass(420, 21), 20);
  assert.equal(studentsPerClass(392, 21), 18.7);
});

test('studentsPerClass: classCount 0/null이면 0으로 나누지 않고 null', () => {
  assert.equal(studentsPerClass(100, 0), null);
  assert.equal(studentsPerClass(100, null), null);
  assert.equal(studentsPerClass(null, 10), null);
});

test('studentsPerTeacher: 정상 계산', () => {
  assert.equal(studentsPerTeacher(420, 24), 17.5);
});

test('studentsPerTeacher: teacherCount 0/null이면 null(0 나눗셈 금지)', () => {
  assert.equal(studentsPerTeacher(100, 0), null);
  assert.equal(studentsPerTeacher(100, null), null);
});

// 실제 발생했던 버그: 학년별 슬롯이 undefined인 경우(중/고교는 3개 학년만
// 사용) Prisma Json 컬럼에 그대로 넣으면 런타임 예외가 난다 — null로 정규화해야
// 한다. 0(실제 원본값)과 null(슬롯 없음)을 혼동하지 않는다.
test('normalizeGradeSlot: undefined는 null로 정규화한다(Prisma Json 컬럼 제약)', () => {
  assert.equal(normalizeGradeSlot(undefined), null);
});

test('normalizeGradeSlot: 실제 null/0/양수는 그대로 보존한다', () => {
  assert.equal(normalizeGradeSlot(null), null);
  assert.equal(normalizeGradeSlot(0), 0);
  assert.equal(normalizeGradeSlot(24), 24);
});
