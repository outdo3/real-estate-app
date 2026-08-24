// SCHOOL V2-C2B-A §17 — resolver fixture tests. DB/네트워크 접근 없음, node:test로 실행
// (이 프로젝트가 src/lib/redevelopment/*.test.ts에서 이미 쓰는 관례 그대로:
// `npx tsx --test <file>`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOne, resolveAll, normalizeName, bucketNeisLevel, bucketSchoolInfoKind, type CanonicalSchool, type SchoolInfoRecord } from './schoolinfo-identity-resolver';

function canonical(overrides: Partial<CanonicalSchool>): CanonicalSchool {
  return {
    id: 1,
    neisSchoolCode: '1234567',
    schoolName: '테스트초등학교',
    schoolLevel: '초등학교',
    sigunguCode: '26140',
    dongName: null,
    roadAddress: null,
    ...overrides,
  };
}

function si(overrides: Partial<SchoolInfoRecord>): SchoolInfoRecord {
  return {
    schulCode: 'S020000001',
    schulNm: '테스트초등학교',
    schulKndScCode: '02',
    sggCode: '26140',
    addrBrkdn: '부산광역시 서구 동대신동',
    bnhhYn: 'N',
    ...overrides,
  };
}

function poolOf(...records: SchoolInfoRecord[]): Map<string, SchoolInfoRecord[]> {
  const m = new Map<string, SchoolInfoRecord[]>();
  for (const r of records) m.set(r.sggCode, [...(m.get(r.sggCode) || []), r]);
  return m;
}

test('exact unique — 이름+시군구+학교급 유일 매칭이면 HIGH', () => {
  const c = canonical({});
  const pool = poolOf(si({}));
  const result = resolveOne(c, pool);
  assert.equal(result.confidence, 'HIGH');
  assert.equal(result.matched?.schulCode, 'S020000001');
});

test('same name, other sigungu — 시군구 다르면 그 SchoolInfo row는 후보에도 안 들어감(NO_MATCH)', () => {
  const c = canonical({ sigunguCode: '26140' }); // 서구
  const pool = poolOf(si({ sggCode: '26350' })); // 해운대구에만 존재
  const result = resolveOne(c, pool);
  assert.equal(result.confidence, 'NO_MATCH');
  assert.equal(result.matched, null);
});

test('same name, same sigungu, 2건, 동으로 구분 가능 — HIGH (실제 강서구 송정초 유사 케이스)', () => {
  const c = canonical({ sigunguCode: '26440', dongName: '송정동' });
  const pool = poolOf(
    si({ schulCode: 'A', sggCode: '26440', addrBrkdn: '부산광역시 강서구 송정동' }),
    si({ schulCode: 'B', sggCode: '26440', addrBrkdn: '부산광역시 강서구 신호동' })
  );
  const result = resolveOne(c, pool);
  assert.equal(result.confidence, 'HIGH');
  assert.equal(result.matched?.schulCode, 'A');
});

test('same name, same sigungu, 동 정보 없음(canonical dongName null) — LOW, 자동 매칭 금지', () => {
  const c = canonical({ sigunguCode: '26440', dongName: null });
  const pool = poolOf(
    si({ schulCode: 'A', sggCode: '26440', addrBrkdn: '부산광역시 강서구 송정동' }),
    si({ schulCode: 'B', sggCode: '26440', addrBrkdn: '부산광역시 강서구 신호동' })
  );
  const result = resolveOne(c, pool);
  assert.equal(result.confidence, 'LOW');
  assert.equal(result.matched, null);
});

test('same name, same sigungu, 동까지 같아도 여전히 2건 이상 — LOW (강서구 실제 사례 방어)', () => {
  const c = canonical({ sigunguCode: '26440', dongName: '강동동' });
  const pool = poolOf(
    si({ schulCode: 'A', sggCode: '26440', addrBrkdn: '부산광역시 강서구 강동동 4981-5' }),
    si({ schulCode: 'B', sggCode: '26440', addrBrkdn: '부산광역시 강서구 강동동 4982' })
  );
  const result = resolveOne(c, pool);
  assert.equal(result.confidence, 'LOW');
  assert.equal(result.matched, null);
  assert.equal(result.candidates.length, 2);
});

test('school kind mismatch — 이름은 같으나 학교급이 다르면 후보에서 제외(NO_MATCH), 교차 매칭 금지', () => {
  const c = canonical({ schoolLevel: '초등학교' });
  const pool = poolOf(si({ schulKndScCode: '03' })); // 이름은 같은데 중학교
  const result = resolveOne(c, pool);
  assert.equal(result.confidence, 'NO_MATCH');
  assert.equal(result.matched, null);
});

test('address mismatch — 동 후보 중 canonical dongName과 일치하는 게 없으면 LOW(그 후보로 억지 확정 안 함)', () => {
  const c = canonical({ sigunguCode: '26440', dongName: '대저2동' });
  const pool = poolOf(
    si({ schulCode: 'A', sggCode: '26440', addrBrkdn: '부산광역시 강서구 송정동' }),
    si({ schulCode: 'B', sggCode: '26440', addrBrkdn: '부산광역시 강서구 신호동' })
  );
  const result = resolveOne(c, pool);
  assert.equal(result.confidence, 'LOW');
  assert.equal(result.matched, null);
});

test('branch school(분교) — 유일 후보라도 BNHH_YN=Y면 자동 확정하지 않고 MEDIUM', () => {
  const c = canonical({});
  const pool = poolOf(si({ bnhhYn: 'Y' }));
  const result = resolveOne(c, pool);
  assert.equal(result.confidence, 'MEDIUM');
  assert.equal(result.matched?.schulCode, 'S020000001'); // 후보로는 제시하되 자동 HIGH 아님
});

test('null address(canonical sigunguCode 자체가 없음) — NO_MATCH, 크래시 없음', () => {
  const c = canonical({ sigunguCode: null });
  const pool = poolOf(si({}));
  const result = resolveOne(c, pool);
  assert.equal(result.confidence, 'NO_MATCH');
});

test('ambiguous candidate — 실제 강서구 3그룹과 동일 패턴, resolveAll로 돌려도 전부 LOW(오매칭 0건)', () => {
  const canonicalList: CanonicalSchool[] = [
    canonical({ id: 1, schoolName: '송정초등학교', sigunguCode: '26440', dongName: null }),
    canonical({ id: 2, schoolName: '대저중앙초등학교', sigunguCode: '26440', dongName: null }),
    canonical({ id: 3, schoolName: '가락중학교', sigunguCode: '26440', dongName: null, schoolLevel: '중학교' }),
  ];
  const schoolInfoList: SchoolInfoRecord[] = [
    si({ schulCode: 'SJ1', schulNm: '송정초등학교', sggCode: '26440', addrBrkdn: '부산광역시 강서구 송정동' }),
    si({ schulCode: 'SJ2', schulNm: '송정초등학교', sggCode: '26440', addrBrkdn: '부산광역시 강서구 신호동' }),
    si({ schulCode: 'DJ1', schulNm: '대저중앙초등학교', sggCode: '26440', addrBrkdn: '부산광역시 강서구 대저2동' }),
    si({ schulCode: 'DJ2', schulNm: '대저중앙초등학교', sggCode: '26440', addrBrkdn: '부산광역시 강서구 강동동 4981-5' }),
    si({ schulCode: 'GR1', schulNm: '가락중학교', schulKndScCode: '03', sggCode: '26440', addrBrkdn: '부산광역시 강서구 죽림동' }),
    si({ schulCode: 'GR2', schulNm: '가락중학교', schulKndScCode: '03', sggCode: '26440', addrBrkdn: '부산광역시 강서구 강동동 4982' }),
  ];
  const results = resolveAll(canonicalList, schoolInfoList);
  const wrongMerges = results.filter((r) => r.confidence === 'HIGH');
  assert.equal(wrongMerges.length, 0, 'canonical dongName이 없는 상태에서는 절대 HIGH로 자동 확정되면 안 된다(오매칭 방지)');
  for (const r of results) assert.equal(r.confidence, 'LOW');
});

test('normalizeName — 공백/전각 차이만 흡수, suffix 제거 없음', () => {
  assert.equal(normalizeName(' 대신 초등학교 '), normalizeName('대신초등학교'));
  assert.notEqual(normalizeName('대신초등학교'), normalizeName('대신')); // suffix 제거 안 됨을 재확인
});

test('bucketNeisLevel / bucketSchoolInfoKind — 세분화된 NEIS 레벨도 4+1 버킷으로 정확히 매핑', () => {
  assert.equal(bucketNeisLevel('초등학교'), 'ELEMENTARY');
  assert.equal(bucketNeisLevel('각종학교(중)'), 'MIDDLE');
  assert.equal(bucketNeisLevel('방송통신고등학교'), 'HIGH');
  assert.equal(bucketNeisLevel('특수학교'), 'SPECIAL');
  assert.equal(bucketNeisLevel('공동실습소'), 'OTHER');
  assert.equal(bucketSchoolInfoKind('02'), 'ELEMENTARY');
  assert.equal(bucketSchoolInfoKind('03'), 'MIDDLE');
  assert.equal(bucketSchoolInfoKind('04'), 'HIGH');
  assert.equal(bucketSchoolInfoKind('05'), 'SPECIAL');
  assert.equal(bucketSchoolInfoKind('09'), 'OTHER');
});
