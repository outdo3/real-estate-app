import assert from 'node:assert/strict';
import test from 'node:test';
import { reconstructProvenance, bucketOf } from './audit-ledger-unknown-source-trust.ts';
import { diffField, isBlank } from './analyze-ledger-unknown-source-trust.ts';

const m = (o = {}) => ({ mgmBldrgstPk: null, mainBuildingCount: null, far: null, bcr: null, households: null, parking: null, ...o });

// ── provenance 복원: PK 자릿수가 계열을 가른다 ──

test('22자리 PK는 총괄표제부 계열로 본다', () => {
  const r = reconstructProvenance(m({ mgmBldrgstPk: '1000000000000002478010' }));
  assert.equal(r.provenance, 'LEGACY_BUILDING_LEDGER_RECAP');
});

test('9~10자리 PK는 표제부 계열로 본다', () => {
  const r = reconstructProvenance(m({ mgmBldrgstPk: '1036120239' }));
  assert.equal(r.provenance, 'LEGACY_BUILDING_LEDGER_TITLE');
});

test('표제부 PK인데 FAR/BCR이 없으면 현재 backfill 경로의 산출물이 아니라고 기록한다', () => {
  const r = reconstructProvenance(m({ mgmBldrgstPk: '102915593' }));
  assert.equal(r.provenance, 'LEGACY_BUILDING_LEDGER_TITLE');
  assert.match(r.evidence, /FAR\/BCR 없음/);
});

test('PK는 없지만 mainBuildingCount가 있으면 총괄표제부 계열 — 표제부에는 없는 필드다', () => {
  assert.equal(reconstructProvenance(m({ mainBuildingCount: 8 })).provenance, 'LEGACY_BUILDING_LEDGER_RECAP');
});

test('PK 없이 대장성 값만 있으면 출처 미기록 구 import로 분류한다', () => {
  assert.equal(reconstructProvenance(m({ households: 120 })).provenance, 'HISTORICAL_IMPORT');
});

test('아무 근거도 없으면 UNKNOWN_REMAINS — 추정하지 않는다', () => {
  assert.equal(reconstructProvenance(m()).provenance, 'UNKNOWN_REMAINS');
});

// ── 빈 문자열은 값이 아니다 ──

test('빈 문자열과 공백은 값 없음으로 본다', () => {
  assert.equal(isBlank(null), true);
  assert.equal(isBlank(undefined), true);
  assert.equal(isBlank(''), true);
  assert.equal(isBlank('   '), true);
  assert.equal(isBlank('부산광역시 중구 중구로 81'), false);
  assert.equal(isBlank(0), false, '숫자 0은 값이다');
});

// ── stored vs safe 비교 ──

test('safe가 값을 못 만들고 저장값이 있으면 STORED_BUT_NOW_WITHHELD', () => {
  assert.equal(diffField(90, null, false, false), 'STORED_BUT_NOW_WITHHELD');
});

test('safe가 보류 판정이면 REVIEW_REQUIRED가 우선한다', () => {
  assert.equal(diffField(90, null, false, true), 'REVIEW_REQUIRED');
});

test('저장값도 없고 safe도 없으면 SOURCE_EMPTY', () => {
  assert.equal(diffField(null, null, false, false), 'SOURCE_EMPTY');
});

test('저장값이 없고 safe가 있으면 NEW_SAFE_VALUE_AVAILABLE — 보정이 아니라 채움이다', () => {
  assert.equal(diffField(null, 1076, true, false), 'NEW_SAFE_VALUE_AVAILABLE');
});

test('값이 같으면 UNCHANGED, 다르면 SAFE_VALUE_DIFF', () => {
  assert.equal(diffField(1076, 1076, true, false), 'UNCHANGED');
  assert.equal(diffField(90, 1076, true, false), 'SAFE_VALUE_DIFF');
});

test('문자열 비교는 앞뒤 공백을 무시한다', () => {
  assert.equal(diffField(' 부산광역시 중구 중구로 81 ', '부산광역시 중구 중구로 81', true, false), 'UNCHANGED');
});

// ── 레코드 수 구간 ──

test('레코드 수 구간은 경계에서 정확하다', () => {
  assert.equal(bucketOf(1), '1');
  assert.equal(bucketOf(2), '2-5');
  assert.equal(bucketOf(5), '2-5');
  assert.equal(bucketOf(6), '6-10');
  assert.equal(bucketOf(10), '6-10');
  assert.equal(bucketOf(11), '11-20');
  assert.equal(bucketOf(20), '11-20');
  assert.equal(bucketOf(21), '21+');
  assert.equal(bucketOf(35), '21+');
});
