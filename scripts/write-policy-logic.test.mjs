import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRow } from './write-policy-logic.ts';

function row(overrides = {}) {
  return {
    lawdCd: '26140', dealYmd: '202608', aptSeq: '26140-1', identityKey: 'id:26140-1', dealType: 'sale',
    groupKeyStr: 'id:26140-1::84.0::sale', aptName: '테스트단지', dong: '테스트동', jibun: null,
    exclusiveArea: 84.0, dealAmount: 50000, dealYear: 2026, dealMonth: 8, dealDay: 1, dealDate: '2026-08-01',
    floor: 5, buildYear: 2020, dealCanceled: false, cancelDate: null, registryDate: null, occurrenceIndex: 0, rawUid: null,
    ...overrides,
  };
}
function existing(overrides = {}) {
  return { id: 1, aptName: '테스트단지', dong: '테스트동', dealCanceled: false, ...overrides };
}

test('aptSeq 있고 기존 row 없으면 insert', () => {
  assert.equal(classifyRow(row({ aptSeq: '26140-1' }), undefined), 'insert');
});

test('aptSeq 없고 기존 row 없으면 reviewRequired(name+dong만으로 canonical apartment에 편입 금지)', () => {
  assert.equal(classifyRow(row({ aptSeq: null }), undefined), 'reviewRequired');
});

test('aptSeq가 빈 문자열이어도 reviewRequired(falsy 취급)', () => {
  assert.equal(classifyRow(row({ aptSeq: '' }), undefined), 'reviewRequired');
});

test('기존 row와 aptName이 다르면 aptSeq 유무와 무관하게 conflict', () => {
  assert.equal(classifyRow(row({ aptName: '다른단지' }), existing({ aptName: '테스트단지' })), 'conflict');
});

test('기존 row와 dong이 다르면 conflict', () => {
  assert.equal(classifyRow(row({ dong: '다른동' }), existing({ dong: '테스트동' })), 'conflict');
});

test('기존 row와 dealCanceled가 같으면 noop', () => {
  assert.equal(classifyRow(row({ dealCanceled: false }), existing({ dealCanceled: false })), 'noop');
  assert.equal(classifyRow(row({ dealCanceled: true }), existing({ dealCanceled: true })), 'noop');
});

test('false→true는 updateFalseToTrue(반영)', () => {
  assert.equal(classifyRow(row({ dealCanceled: true }), existing({ dealCanceled: false })), 'updateFalseToTrue');
});

test('true→false는 updateTrueToFalseSkipped(§14 가드, 절대 되돌리지 않음)', () => {
  assert.equal(classifyRow(row({ dealCanceled: false }), existing({ dealCanceled: true })), 'updateTrueToFalseSkipped');
});

test('기존 row가 있으면 aptSeq 유무와 무관하게 insert/reviewRequired로 가지 않는다(신규 판정만 aptSeq 게이트 적용)', () => {
  assert.equal(classifyRow(row({ aptSeq: null, dealCanceled: true }), existing({ dealCanceled: false })), 'updateFalseToTrue');
});
