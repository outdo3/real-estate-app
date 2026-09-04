// OFFICETEL V1 STEP 2 §10 — master 정규화 / 다동 / 충돌 / 중복 계약 테스트.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMasterIdentity,
  classifyCollision,
  classifyJibunGroup,
  isRegistryOfficetelPurpose,
  masterNormalizedFields,
  planMasterInserts,
  registryBuildingName,
  registryJibun,
} from './identity.ts';

// ── 지번 복원 ──────────────────────────────────────────────────────
test('registryJibun: 0-padding을 벗기고 부번 0은 생략한다', () => {
  assert.equal(registryJibun('0062', '0014'), '62-14');
  assert.equal(registryJibun('1458', '0005'), '1458-5');
  assert.equal(registryJibun('0018', '0000'), '18');
  assert.equal(registryJibun('0018', ''), '18');
});

// ── 건물명 ────────────────────────────────────────────────────────
test('registryBuildingName: bldNm이 비면 dongNm을 표시명으로 승격(대연동 62-14 실측)', () => {
  assert.equal(registryBuildingName('쥬노벨 오피스텔', '쥬노벨 오피스텔'), '쥬노벨 오피스텔');
  assert.equal(registryBuildingName('KH마이우스', ' '), 'KH마이우스');
  assert.equal(registryBuildingName(' ', '나동'), '나동');
  assert.equal(registryBuildingName('', ''), '', '이름을 지어내지 않는다');
});

// ── 용도 판정 ──────────────────────────────────────────────────────
test('isRegistryOfficetelPurpose: 건축물대장상 용도 표기만 본다', () => {
  assert.equal(isRegistryOfficetelPurpose({ mainPurpsCdNm: '업무시설', etcPurps: '오피스텔, 근린생활시설' }), true);
  assert.equal(isRegistryOfficetelPurpose({ mainPurpsCdNm: '업무시설', etcPurps: '업무시설' }), false);
  assert.equal(isRegistryOfficetelPurpose({ mainPurpsCdNm: '공동주택', etcPurps: '아파트' }), false);
});

// ── identity: 다동 ────────────────────────────────────────────────
const base = { sggCd: '26290', umdNm: '대연동', bun: '0062', ji: '0014', platGbCd: '0' };

test('같은 지번 다른 동 → 다른 canonicalKey (병합 금지)', () => {
  const ga = buildMasterIdentity({ ...base, dongNm: '가동' });
  const na = buildMasterIdentity({ ...base, dongNm: '나동' });
  assert.equal(ga.ok && ga.canonicalKey, 'OFFI:26290:대연동:62-14:가동');
  assert.equal(na.ok && na.canonicalKey, 'OFFI:26290:대연동:62-14:나동');
  assert.notEqual(ga.canonicalKey, na.canonicalKey);
});

test('dongNm 없으면 building-level 키', () => {
  const r = buildMasterIdentity({ ...base, dongNm: '' });
  assert.equal(r.ok && r.canonicalKey, 'OFFI:26290:대연동:62-14:_');
  assert.equal(r.ok && r.buildingDong, null);
});

test('같은 지번에 dong 있는 행과 없는 행이 섞여도 building-level로 병합되지 않는다', () => {
  const withDong = buildMasterIdentity({ ...base, dongNm: '가동' });
  const without = buildMasterIdentity({ ...base, dongNm: '' });
  assert.notEqual(withDong.canonicalKey, without.canonicalKey);
});

test('산 지번(platGbCd=1)은 resolve하지 않는다', () => {
  assert.deepEqual(buildMasterIdentity({ ...base, platGbCd: '1', dongNm: '' }), { ok: false, reason: 'MOUNTAIN_LOT' });
});

test('malformed jibun은 resolve하지 않는다', () => {
  const r = buildMasterIdentity({ sggCd: '26290', umdNm: '대연동', bun: 'abc', ji: '', platGbCd: '0' });
  assert.equal(r.ok, false);
});

// ── 지번 그룹 형태 ────────────────────────────────────────────────
test('classifyJibunGroup: 4가지 형태를 구분한다', () => {
  assert.equal(classifyJibunGroup(['가동']), 'SINGLE');
  assert.equal(classifyJibunGroup([null]), 'SINGLE');
  assert.equal(classifyJibunGroup(['가동', '나동']), 'MULTI_ALL_NAMED');
  assert.equal(classifyJibunGroup([null, null]), 'MULTI_ALL_UNNAMED');
  assert.equal(classifyJibunGroup(['가동', null]), 'MIXED_DONG');
});

// ── 충돌 분류 ─────────────────────────────────────────────────────
const c = (o = {}) => ({ officetelName: 'A', useApprovalDate: '20070731', hoCnt: 234, etcPurpose: '오피스텔', ...o });

test('완전히 같은 중복행은 IDENTICAL_DUPLICATE', () => {
  assert.equal(classifyCollision([c(), c()]), 'IDENTICAL_DUPLICATE');
});

test('이름/승인일/호수/용도 중 하나라도 갈리면 AMBIGUOUS', () => {
  assert.equal(classifyCollision([c(), c({ officetelName: 'B' })]), 'AMBIGUOUS');
  assert.equal(classifyCollision([c(), c({ useApprovalDate: '20180206' })]), 'AMBIGUOUS');
  assert.equal(classifyCollision([c(), c({ hoCnt: 189 })]), 'AMBIGUOUS');
  assert.equal(classifyCollision([c(), c({ etcPurpose: '업무시설' })]), 'AMBIGUOUS');
});

// ── INSERT 계획 ───────────────────────────────────────────────────
test('planMasterInserts: 중복 collapse / ambiguous 제외 / unresolved 제외', () => {
  const rows = [
    { canonicalKey: 'K1', ...c() },
    { canonicalKey: 'K1', ...c() },                      // 완전 동일 → collapse
    { canonicalKey: 'K2', ...c({ officetelName: 'X' }) },
    { canonicalKey: 'K2', ...c({ officetelName: 'Y' }) }, // 갈림 → ambiguous
    { canonicalKey: null, ...c() },                      // unresolved
  ];
  const p = planMasterInserts(rows);
  assert.equal(p.inserts.length, 1, 'K1만 적재');
  assert.equal(p.inserts[0].canonicalKey, 'K1');
  assert.equal(p.collapsed, 1);
  assert.equal(p.ambiguous.length, 1);
  assert.equal(p.ambiguous[0].canonicalKey, 'K2');
  assert.equal(p.unresolved.length, 1);
});

test('planMasterInserts: ambiguous는 절대 적재 대상에 들어가지 않는다', () => {
  const rows = [
    { canonicalKey: 'K', ...c({ hoCnt: 10 }) },
    { canonicalKey: 'K', ...c({ hoCnt: 20 }) },
  ];
  const p = planMasterInserts(rows);
  assert.equal(p.inserts.length, 0);
  assert.equal(p.ambiguous.length, 1);
});

test('planMasterInserts: 적재 대상의 canonicalKey는 중복이 없다', () => {
  const rows = [
    { canonicalKey: 'A', ...c() }, { canonicalKey: 'A', ...c() },
    { canonicalKey: 'B', ...c() }, { canonicalKey: 'C', ...c() },
  ];
  const p = planMasterInserts(rows);
  assert.equal(new Set(p.inserts.map((x) => x.canonicalKey)).size, p.inserts.length);
});

// ── 정규화 필드 ───────────────────────────────────────────────────
test('masterNormalizedFields는 identity.ts와 같은 규칙을 쓴다', () => {
  const f = masterNormalizedFields({ umdNm: '일광읍 삼성리', jibun: '0890-0000', buildingDong: ' 나동 ', officetelName: '쥬노벨 오피스텔' });
  assert.equal(f.normalizedUmdNm, '일광읍삼성리');
  assert.equal(f.normalizedJibun, '890-0');
  assert.equal(f.normalizedBuildingDong, '나동');
  assert.equal(f.normalizedName, '쥬노벨');
});

test('buildingDong 없으면 normalizedBuildingDong도 null (자리표시자를 저장하지 않는다)', () => {
  const f = masterNormalizedFields({ umdNm: '좌동', jibun: '1458-5', buildingDong: null, officetelName: 'A' });
  assert.equal(f.normalizedBuildingDong, null);
});
