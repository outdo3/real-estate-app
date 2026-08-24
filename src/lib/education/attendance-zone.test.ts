import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getApartmentEducationZone, getAttendanceZoneDatasetMeta } from './attendance-zone';

test('존재하지 않는 aptSeq -> null (부산 외 지역 등)', () => {
  assert.equal(getApartmentEducationZone('99999-9999'), null);
});

test('향원에이스타운(26140-35) -> SHARED, 대신초+동신초 canonical ID 포함', () => {
  const r = getApartmentEducationZone('26140-35');
  assert.ok(r);
  assert.equal(r!.elementary.status, 'SHARED');
  const names = r!.elementary.schools.map((s) => s.schoolName).sort();
  assert.deepEqual(names, ['대신초등학교', '동신초등학교']);
  assert.ok(r!.elementary.schools.every((s) => typeof s.schoolId === 'number'));
});

test('신화타워(26260-75) -> SHARED, MEDIUM 학교가 있어도 REVIEW_REQUIRED로 내려가지 않음', () => {
  const r = getApartmentEducationZone('26260-75');
  assert.ok(r);
  assert.equal(r!.elementary.status, 'SHARED');
  const confidences = r!.elementary.schools.map((s) => s.identityConfidence).sort();
  assert.deepEqual(confidences, ['HIGH', 'MEDIUM', 'MEDIUM']);
});

test('geometry invalid zone 매칭 아파트(26230-144, 한진) -> REVIEW_REQUIRED, "확인 중" 문구', () => {
  const r = getApartmentEducationZone('26230-144');
  assert.ok(r);
  assert.equal(r!.elementary.status, 'REVIEW_REQUIRED');
  assert.equal(r!.elementary.reasonCode, 'INVALID_ZONE_GEOMETRY');
});

test('zone 경계 근접 NO_MATCH(26230-264, 삼성비치타운) -> REVIEW_REQUIRED (데이터 없음 아님)', () => {
  const r = getApartmentEducationZone('26230-264');
  assert.ok(r);
  assert.equal(r!.elementary.status, 'REVIEW_REQUIRED');
  assert.equal(r!.elementary.reasonCode, 'ZONE_BOUNDARY_GAP');
});

test('좌표 없는 아파트(26440-147, 에코델타호반써밋스마트시티) -> NOT_AVAILABLE', () => {
  const r = getApartmentEducationZone('26440-147');
  assert.ok(r);
  assert.equal(r!.elementary.status, 'NOT_AVAILABLE');
  assert.equal(r!.middle.status, 'NOT_AVAILABLE');
});

test('가장 가까운 학교 fallback이 존재하지 않는다 — REVIEW_REQUIRED/NOT_AVAILABLE 케이스에 schools가 임의로 채워지지 않음', () => {
  const noMatch = getApartmentEducationZone('26230-264');
  const coordMissing = getApartmentEducationZone('26440-147');
  assert.deepEqual(noMatch!.elementary.schools, []);
  assert.deepEqual(coordMissing!.elementary.schools, []);
});

test('legal notice(공식 고지)가 항상 포함된다', () => {
  const r = getApartmentEducationZone('26140-35');
  assert.match(r!.elementary.notice, /교육지원청/);
});

test('getAttendanceZoneDatasetMeta — sourceDate/checksum/resolverVersion 노출', () => {
  const meta = getAttendanceZoneDatasetMeta();
  assert.equal(meta.sourceDate, '2026-03-20');
  assert.ok(meta.checksum.length > 0);
  assert.ok(meta.resolverVersion.startsWith('school-v2-c6b'));
});
