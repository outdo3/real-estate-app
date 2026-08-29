import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMolitItemsToTradeRows, identityKey, areaKey, groupKey } from './trade-history-logic.ts';
import * as regionalFeed from '../src/lib/regional-feed.ts';

// § PARITY TEST — trade-history-logic.ts의 identityKey/areaKey/groupKey는
// src/lib/regional-feed.ts 정의를 import 대신 복제한 것이다(파일 상단 주석 참고, tsc
// allowImportingTsExtensions 제약 때문). 두 정의가 어긋나면 라이브 통계 화면과 DB 저장
// identity가 갈라지는 심각한 회귀이므로, 대표 입력들로 항상 동일 출력을 내는지
// 검증한다.
test('PARITY: identityKey/areaKey/groupKey가 regional-feed.ts 원본과 동일하게 동작한다', () => {
  const cases = [
    { aptSeq: '26140-1164', name: '대신롯데캐슬', dong: '서대신동3가', excluUseArea: 84.7855, dealType: 'sale' },
    { aptSeq: null, name: '이름만있는단지', dong: '어떤동', excluUseArea: 59.99, dealType: 'sale' },
    { aptSeq: '26470-1040', name: '한솔솔파크', dong: '연산동', excluUseArea: null, dealType: 'sale' },
  ];
  for (const c of cases) {
    assert.equal(identityKey(c), regionalFeed.identityKey(c));
    assert.equal(areaKey(c), regionalFeed.areaKey(c));
    assert.equal(groupKey(c), regionalFeed.groupKey(c));
  }
});

function item(overrides = {}) {
  return {
    aptSeq: '26140-1164',
    name: '대신롯데캐슬',
    dong: '서대신동3가',
    jibun: '100-1',
    excluUseArea: 84.7855,
    dealAmount: 65000,
    dealDate: '2026-05-15',
    floorRaw: 10,
    buildYear: '2015',
    dealCanceled: false,
    cancelDate: '',
    registryDate: '',
    id: 'apt-26140-202605-0',
    typeLabel: '실거래',
    ...overrides,
  };
}

// §44 정규화 — amount/date/area/identity/invalid row
test('정상 item은 row로 변환되고 identity/group key가 계산된다', () => {
  const { rows, invalid } = normalizeMolitItemsToTradeRows([item()], '26140', '202605');
  assert.equal(invalid.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].identityKey, 'id:26140-1164');
  assert.equal(rows[0].groupKeyStr, 'id:26140-1164::84.7855::sale');
  assert.equal(rows[0].dealYear, 2026);
  assert.equal(rows[0].dealMonth, 5);
  assert.equal(rows[0].dealDay, 15);
  assert.equal(rows[0].floor, 10);
  assert.equal(rows[0].buildYear, 2015);
});

test('aptSeq 없으면 name+dong 폴백 identity를 쓴다', () => {
  const { rows } = normalizeMolitItemsToTradeRows([item({ aptSeq: null })], '26140', '202605');
  assert.equal(rows[0].identityKey, 'nd:대신롯데캐슬|서대신동3가');
});

// §22 INVALID DATA
test('금액이 0 이하이면 MISSING_AMOUNT로 분류하고 row를 만들지 않는다', () => {
  const { rows, invalid } = normalizeMolitItemsToTradeRows([item({ dealAmount: 0 })], '26140', '202605');
  assert.equal(rows.length, 0);
  assert.equal(invalid[0].reason, 'MISSING_AMOUNT');
});

test('전용면적이 없으면 MISSING_AREA로 분류한다', () => {
  const { invalid } = normalizeMolitItemsToTradeRows([item({ excluUseArea: null })], '26140', '202605');
  assert.equal(invalid[0].reason, 'MISSING_AREA');
});

test('거래일자 형식이 아니면 MISSING_DATE로 분류한다', () => {
  const { invalid } = normalizeMolitItemsToTradeRows([item({ dealDate: '' })], '26140', '202605');
  assert.equal(invalid[0].reason, 'MISSING_DATE');
});

test('aptSeq와 이름이 둘 다 없으면 MISSING_IDENTITY로 분류한다', () => {
  const { invalid } = normalizeMolitItemsToTradeRows([item({ aptSeq: null, name: '' })], '26140', '202605');
  assert.equal(invalid[0].reason, 'MISSING_IDENTITY');
});

test('API 에러 placeholder(typeLabel=에러)는 API_ERROR_PLACEHOLDER로 분류하고 row를 만들지 않는다', () => {
  const { rows, invalid } = normalizeMolitItemsToTradeRows([item({ typeLabel: '에러', dealAmount: 0 })], '26140', '202605');
  assert.equal(rows.length, 0);
  assert.equal(invalid[0].reason, 'API_ERROR_PLACEHOLDER');
});

// §47/§48 — 같은 것처럼 보이는 복수거래를 절대 하나로 합치지 않는다(occurrenceIndex)
test('완전히 동일한 자연키를 가진 두 거래는 병합되지 않고 occurrenceIndex로 구분된다', () => {
  const { rows, invalid } = normalizeMolitItemsToTradeRows([item(), item()], '26140', '202605');
  assert.equal(invalid.length, 0);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].occurrenceIndex, 0);
  assert.equal(rows[1].occurrenceIndex, 1);
  // 그 외 모든 자연키 필드는 동일해야 진짜 "같아 보이는 복수거래" 케이스다.
  assert.equal(rows[0].groupKeyStr, rows[1].groupKeyStr);
  assert.equal(rows[0].dealAmount, rows[1].dealAmount);
  assert.equal(rows[0].dealDate, rows[1].dealDate);
  assert.equal(rows[0].floor, rows[1].floor);
});

test('금액이 다르면 서로 다른 거래이므로 occurrenceIndex가 둘 다 0이다(자연키가 이미 다름)', () => {
  const { rows } = normalizeMolitItemsToTradeRows([item({ dealAmount: 65000 }), item({ dealAmount: 66000 })], '26140', '202605');
  assert.equal(rows[0].occurrenceIndex, 0);
  assert.equal(rows[1].occurrenceIndex, 0);
});

// §48 EXACT AREA — 84.7855 vs 84.9950 distinct
test('전용면적 소수점이 다르면 서로 다른 groupKey를 갖는다(84.7855 vs 84.9950)', () => {
  const { rows } = normalizeMolitItemsToTradeRows(
    [item({ excluUseArea: 84.7855 }), item({ excluUseArea: 84.995 })],
    '26140',
    '202605'
  );
  assert.notEqual(rows[0].groupKeyStr, rows[1].groupKeyStr);
  assert.equal(rows[0].exclusiveArea, 84.7855);
  assert.equal(rows[1].exclusiveArea, 84.995);
});

// §45 idempotency 관련 — 취소 필드는 자연키 밖이므로 취소 여부가 달라도 같은 자연키를 유지한다.
test('취소 여부는 자연키에 포함되지 않는다(취소 전/후가 같은 canonical row를 가리켜야 함)', () => {
  const { rows: activeRows } = normalizeMolitItemsToTradeRows([item({ dealCanceled: false })], '26140', '202605');
  const { rows: canceledRows } = normalizeMolitItemsToTradeRows(
    [item({ dealCanceled: true, cancelDate: '20260601' })],
    '26140',
    '202605'
  );
  assert.equal(activeRows[0].groupKeyStr, canceledRows[0].groupKeyStr);
  assert.equal(activeRows[0].dealAmount, canceledRows[0].dealAmount);
  assert.equal(activeRows[0].dealDate, canceledRows[0].dealDate);
  assert.equal(activeRows[0].floor, canceledRows[0].floor);
  assert.equal(activeRows[0].occurrenceIndex, canceledRows[0].occurrenceIndex);
  assert.equal(canceledRows[0].dealCanceled, true);
  assert.equal(canceledRows[0].cancelDate, '20260601');
});

test('층 정보가 없거나 숫자가 아니면 MISSING_FLOOR로 분류한다(자연키 구성요소라 null 저장 금지)', () => {
  const { rows, invalid } = normalizeMolitItemsToTradeRows([item({ floorRaw: '' })], '26140', '202605');
  assert.equal(rows.length, 0);
  assert.equal(invalid[0].reason, 'MISSING_FLOOR');
});

test('건축년도가 없거나 0 이하이면 buildYear는 null이다(0 이하를 실제 값으로 저장 금지)', () => {
  const { rows } = normalizeMolitItemsToTradeRows([item({ buildYear: '' })], '26140', '202605');
  assert.equal(rows[0].buildYear, null);
});
