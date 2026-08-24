import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveZoneSchool,
  resolveAllZoneSchools,
  normalizeName,
  bucketLevel,
  type CanonicalSchool,
  type ZoneSchoolLink,
} from './zone-school-identity-resolver';

function school(overrides: Partial<CanonicalSchool>): CanonicalSchool {
  return { id: 1, neisSchoolCode: 'X', schoolName: '테스트초등학교', schoolLevel: '초등학교', sigunguCode: '26140', latitude: 35.1, longitude: 129.0, ...overrides };
}
function link(overrides: Partial<ZoneSchoolLink>): ZoneSchoolLink {
  return { zoneId: 'Z1', schoolId: 'B1', schoolName: '테스트초등학교', schoolLevelRaw: '초등학교', lawdCd: '26140', ...overrides };
}

test('unique name+lawdCd+level match -> HIGH', () => {
  const pool = new Map([['26140', [school({ id: 1 })]]]);
  const r = resolveZoneSchool(link({}), pool);
  assert.equal(r.confidence, 'HIGH');
  assert.equal(r.matched?.id, 1);
});

test('same name, different lawdCd, not passed as allCanonical -> NO_MATCH (no silent cross-district guessing without explicit wide pool)', () => {
  const pool = new Map([['26999', [school({ id: 1, sigunguCode: '26999' })]]]);
  const r = resolveZoneSchool(link({ lawdCd: '26140' }), pool, []);
  assert.equal(r.confidence, 'NO_MATCH');
});

test('same name, different lawdCd, unique citywide -> MEDIUM (real 부산 공동학구 cross-district pattern, e.g. 금성초/공덕초)', () => {
  const other = school({ id: 1, sigunguCode: '26410' });
  const pool = new Map([['26410', [other]]]);
  const r = resolveZoneSchool(link({ lawdCd: '26140' }), pool, [other]);
  assert.equal(r.confidence, 'MEDIUM');
  assert.equal(r.matched?.id, 1);
});

test('same name, different lawdCd, ambiguous citywide (2+ matches) -> LOW, no auto merge', () => {
  const a = school({ id: 1, sigunguCode: '26410' });
  const b = school({ id: 2, sigunguCode: '26440' });
  const pool = new Map([['26410', [a]], ['26440', [b]]]);
  const r = resolveZoneSchool(link({ lawdCd: '26140' }), pool, [a, b]);
  assert.equal(r.confidence, 'LOW');
  assert.equal(r.matched, null);
});

test('same name+lawdCd but different school level -> NO_MATCH', () => {
  const pool = new Map([['26140', [school({ id: 1, schoolLevel: '중학교' })]]]);
  const r = resolveZoneSchool(link({ schoolLevelRaw: '초등학교' }), pool);
  assert.equal(r.confidence, 'NO_MATCH');
});

test('duplicate name within same lawdCd+level, no dong info to disambiguate -> LOW, no auto merge', () => {
  const pool = new Map([['26140', [school({ id: 1 }), school({ id: 2 })]]]);
  const r = resolveZoneSchool(link({}), pool);
  assert.equal(r.confidence, 'LOW');
  assert.equal(r.matched, null);
  assert.equal(r.candidates.length, 2);
});

test('empty pool for lawdCd and no citywide match -> NO_MATCH', () => {
  const r = resolveZoneSchool(link({ lawdCd: '26999' }), new Map(), []);
  assert.equal(r.confidence, 'NO_MATCH');
});

test('normalizeName strips whitespace only, no suffix stripping', () => {
  assert.equal(normalizeName('  장림 초등학교 '), '장림초등학교');
  assert.notEqual(normalizeName('장림초등학교'), normalizeName('장림초'));
});

test('bucketLevel classifies raw CSV level strings', () => {
  assert.equal(bucketLevel('초등학교'), 'ELEMENTARY');
  assert.equal(bucketLevel('중학교'), 'MIDDLE');
  assert.equal(bucketLevel('고등학교'), 'HIGH');
  assert.equal(bucketLevel(null), 'OTHER');
});

test('resolveAllZoneSchools integration: mixed HIGH/LOW/NO_MATCH', () => {
  const canonical: CanonicalSchool[] = [
    school({ id: 1, schoolName: '유일초등학교', sigunguCode: '26140' }),
    school({ id: 2, schoolName: '중복초등학교', sigunguCode: '26260' }),
    school({ id: 3, schoolName: '중복초등학교', sigunguCode: '26260' }),
  ];
  const links: ZoneSchoolLink[] = [
    link({ schoolName: '유일초등학교', lawdCd: '26140' }),
    link({ schoolName: '중복초등학교', lawdCd: '26260' }),
    link({ schoolName: '없는초등학교', lawdCd: '26140' }),
  ];
  const results = resolveAllZoneSchools(links, canonical);
  assert.equal(results[0].confidence, 'HIGH');
  assert.equal(results[1].confidence, 'LOW');
  assert.equal(results[2].confidence, 'NO_MATCH');
});
