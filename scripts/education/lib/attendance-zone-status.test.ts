import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFinalAttendanceStatus, type ZoneMatchInput } from './attendance-zone-status';

function base(overrides: Partial<ZoneMatchInput> = {}): ZoneMatchInput {
  return {
    geometryStatus: 'MATCHED_SINGLE',
    isShared: false,
    isAsymmetric: false,
    geometryInvalid: false,
    schools: [{ schoolName: '테스트초등학교', identityConfidence: 'HIGH' }],
    ...overrides,
  };
}

test('COORDINATE_MISSING -> NOT_AVAILABLE, "확인할 수 없어요" wording', () => {
  const r = resolveFinalAttendanceStatus(base({ geometryStatus: 'COORDINATE_MISSING' }));
  assert.equal(r.status, 'NOT_AVAILABLE');
  assert.equal(r.reasonCode, 'COORDINATE_MISSING');
});

test('geometry NO_MATCH(경계 근접) -> REVIEW_REQUIRED, not NOT_AVAILABLE (데이터 없음 아님, 확인 중)', () => {
  const r = resolveFinalAttendanceStatus(base({ geometryStatus: 'NO_MATCH' }));
  assert.equal(r.status, 'REVIEW_REQUIRED');
  assert.equal(r.reasonCode, 'ZONE_BOUNDARY_GAP');
});

test('OVERLAP -> REVIEW_REQUIRED', () => {
  const r = resolveFinalAttendanceStatus(base({ geometryStatus: 'OVERLAP' }));
  assert.equal(r.status, 'REVIEW_REQUIRED');
  assert.equal(r.reasonCode, 'OVERLAPPING_ZONES');
});

test('invalid geometry zone(장림/개포/신덕류), identity 전부 HIGH여도 -> REVIEW_REQUIRED (MATCHED로 위장하지 않음)', () => {
  const r = resolveFinalAttendanceStatus(base({ geometryInvalid: true }));
  assert.equal(r.status, 'REVIEW_REQUIRED');
  assert.equal(r.reasonCode, 'INVALID_ZONE_GEOMETRY');
});

test('school identity LOW 포함 -> REVIEW_REQUIRED', () => {
  const r = resolveFinalAttendanceStatus(base({ schools: [{ schoolName: 'A', identityConfidence: 'LOW' }] }));
  assert.equal(r.status, 'REVIEW_REQUIRED');
  assert.equal(r.reasonCode, 'SCHOOL_IDENTITY_UNRESOLVED');
});

test('school identity NO_MATCH 포함(신연초 케이스) -> REVIEW_REQUIRED', () => {
  const r = resolveFinalAttendanceStatus(base({ schools: [{ schoolName: '신연초등학교(휴교)', identityConfidence: 'NO_MATCH' }] }));
  assert.equal(r.status, 'REVIEW_REQUIRED');
  assert.equal(r.reasonCode, 'SCHOOL_IDENTITY_UNRESOLVED');
});

test('단일 zone, HIGH -> AVAILABLE (향원에이스타운류 아닌 일반 단일 케이스)', () => {
  const r = resolveFinalAttendanceStatus(base());
  assert.equal(r.status, 'AVAILABLE');
  assert.equal(r.reasonCode, 'SINGLE_ZONE');
});

test('공동학구 대칭, 전부 HIGH -> SHARED (향원에이스타운: 대신초 HIGH + 동신초 HIGH)', () => {
  const r = resolveFinalAttendanceStatus(base({
    isShared: true,
    isAsymmetric: false,
    schools: [{ schoolName: '대신초등학교', identityConfidence: 'HIGH' }, { schoolName: '동신초등학교', identityConfidence: 'HIGH' }],
  }));
  assert.equal(r.status, 'SHARED');
  assert.equal(r.reasonCode, 'JOINT_ZONE_SYMMETRIC');
});

test('공동(일방)학구, 본교 HIGH + opt-in 학교 MEDIUM(행정구역 교차) -> SHARED, REVIEW_REQUIRED 아님 (신화타워: 온천초 HIGH/공덕초·금성초 MEDIUM)', () => {
  const r = resolveFinalAttendanceStatus(base({
    isShared: true,
    isAsymmetric: true,
    schools: [
      { schoolName: '온천초등학교', identityConfidence: 'HIGH' },
      { schoolName: '공덕초등학교', identityConfidence: 'MEDIUM' },
      { schoolName: '금성초등학교', identityConfidence: 'MEDIUM' },
    ],
  }));
  assert.equal(r.status, 'SHARED');
  assert.equal(r.reasonCode, 'JOINT_ZONE_ASYMMETRIC');
});

test('MEDIUM만 있고 invalid geometry가 겹치면 REVIEW_REQUIRED가 우선(geometry 신뢰도가 identity보다 먼저 걸러짐)', () => {
  const r = resolveFinalAttendanceStatus(base({
    isShared: true,
    geometryInvalid: true,
    schools: [{ schoolName: '온천초등학교', identityConfidence: 'HIGH' }, { schoolName: '금성초등학교', identityConfidence: 'MEDIUM' }],
  }));
  assert.equal(r.status, 'REVIEW_REQUIRED');
  assert.equal(r.reasonCode, 'INVALID_ZONE_GEOMETRY');
});
