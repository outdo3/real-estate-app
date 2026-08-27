import assert from 'node:assert/strict';
import test from 'node:test';
import { findZoneRelatedApartments } from './school-apartment-relations.ts';

const apartments = [
  {
    aptSeq: '26140-1164',
    aptName: '대신롯데캐슬',
    sigungu: '서구',
    dong: '서대신동3가',
    elementary: { schools: [{ neisSchoolCode: '7171056', schoolName: '대신초등학교' }] },
    middle: { schools: [{ neisSchoolCode: '7171011', schoolName: '경남중학교' }] },
  },
  {
    aptSeq: '26140-1129',
    aptName: '대신공원한신휴플러스',
    sigungu: '서구',
    dong: '서대신동3가',
    elementary: { schools: [{ neisSchoolCode: '7171046', schoolName: '구덕초등학교' }] },
    middle: { schools: [{ neisSchoolCode: '7171011', schoolName: '경남중학교' }] },
  },
  {
    // 해운대구의 동명 학교(다른 neisSchoolCode) — 코드 기준 매칭이면 절대 섞이지 않아야 한다.
    aptSeq: '26350-9999',
    aptName: '해운대다른단지',
    sigungu: '해운대구',
    dong: '우동',
    elementary: { schools: [{ neisSchoolCode: '9999999', schoolName: '구덕초등학교' }] },
    middle: { schools: [] },
  },
];

test('findZoneRelatedApartments: neisSchoolCode가 있으면 코드로만 매칭(동명이교 안전)', () => {
  const result = findZoneRelatedApartments(apartments, { neisSchoolCode: '7171046', schoolName: '구덕초등학교' });
  assert.equal(result.length, 1);
  assert.equal(result[0].aptSeq, '26140-1129');
  assert.equal(result[0].relation, 'ATTENDANCE_ZONE');
});

test('findZoneRelatedApartments: 다른 지역의 동명 학교(다른 code)는 매칭되지 않는다', () => {
  const result = findZoneRelatedApartments(apartments, { neisSchoolCode: '7171046', schoolName: '구덕초등학교' });
  assert.ok(!result.some((r) => r.aptSeq === '26350-9999'));
});

test('findZoneRelatedApartments: 중학교 학교군 relation은 MIDDLE_GROUP으로 분리된다', () => {
  const result = findZoneRelatedApartments(apartments, { neisSchoolCode: '7171011', schoolName: '경남중학교' });
  const relations = result.map((r) => r.relation);
  assert.ok(relations.every((r) => r === 'MIDDLE_GROUP'));
  assert.equal(result.length, 2);
});

test('findZoneRelatedApartments: 같은 단지가 초등 통학구역에도 있으면 ATTENDANCE_ZONE을 우선한다', () => {
  const result = findZoneRelatedApartments(apartments, { neisSchoolCode: '7171056', schoolName: '대신초등학교' });
  assert.equal(result.length, 1);
  assert.equal(result[0].relation, 'ATTENDANCE_ZONE');
});

test('findZoneRelatedApartments: neisSchoolCode가 없으면 이름 완전일치로만 폴백한다(부분일치 없음)', () => {
  const result = findZoneRelatedApartments(apartments, { neisSchoolCode: null, schoolName: '구덕초등학교' });
  // 이름만으로는 서구/해운대구 두 학교 모두 매칭된다 — 이것이 코드 우선 원칙이 필요한 이유.
  assert.equal(result.length, 2);
});

test('findZoneRelatedApartments: 매칭되는 단지가 없으면 빈 배열(다른 학교로 fallback 없음)', () => {
  const result = findZoneRelatedApartments(apartments, { neisSchoolCode: '0000000', schoolName: '존재하지않는학교' });
  assert.deepEqual(result, []);
});
