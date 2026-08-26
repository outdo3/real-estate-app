import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBrTitleInfoRecord } from './apt-building-info.ts';

// 실측 원본(연산동한솔솔파크, APARTMENT_BASIC_DATA_COVERAGE_AUDIT_V1 §5) 기반.
const realRecord = {
  hhldCnt: '165',
  vlRat: '535.3',
  bcRat: '59.82',
  indrAutoUtcnt: '201',
  oudrAutoUtcnt: '3',
  indrMechUtcnt: '0',
  oudrMechUtcnt: '0',
  useAprDay: '20071226',
  mainPurpsCdNm: '공동주택',
};

test('표제부 단일 레코드에서 세대수/용적률/건폐율/주차대수/준공년도를 정확히 추출한다', () => {
  const info = parseBrTitleInfoRecord(realRecord);
  assert.equal(info.totalHouseholds, 165);
  assert.equal(info.far, 535.3);
  assert.equal(info.bcr, 59.82);
  assert.equal(info.parkingCount, 204); // 201 + 3 + 0 + 0
  assert.equal(info.approvalDate, '2007년');
  assert.equal(info.mainPurpose, '공동주택');
});

test('옥내/옥외 자주식+기계식 주차 4개 필드를 모두 합산한다', () => {
  const info = parseBrTitleInfoRecord({
    ...realRecord,
    indrAutoUtcnt: '10',
    oudrAutoUtcnt: '5',
    indrMechUtcnt: '3',
    oudrMechUtcnt: '2',
  });
  assert.equal(info.parkingCount, 20);
});

test('0 또는 음수 값은 "미확보"로 취급해 null을 반환한다(0을 실제 0으로 저장하지 않음)', () => {
  const info = parseBrTitleInfoRecord({
    ...realRecord,
    vlRat: '0',
    bcRat: '-1',
    hhldCnt: '0',
    indrAutoUtcnt: '0',
    oudrAutoUtcnt: '0',
    indrMechUtcnt: '0',
    oudrMechUtcnt: '0',
  });
  assert.equal(info.far, null);
  assert.equal(info.bcr, null);
  assert.equal(info.totalHouseholds, null);
  assert.equal(info.parkingCount, null);
});

test('필드가 아예 없거나 파싱 불가능한 값이면 null로 안전하게 처리한다', () => {
  const info = parseBrTitleInfoRecord({});
  assert.equal(info.far, null);
  assert.equal(info.bcr, null);
  assert.equal(info.totalHouseholds, null);
  assert.equal(info.parkingCount, null);
  assert.equal(info.approvalDate, null);
  assert.equal(info.mainPurpose, null);
});

test('useAprDay 형식이 8자리 숫자가 아니면 준공년도를 추출하지 않는다', () => {
  const info = parseBrTitleInfoRecord({ ...realRecord, useAprDay: '2007' });
  assert.equal(info.approvalDate, null);
});

test('레코드 자체가 null이면 null을 반환한다', () => {
  assert.equal(parseBrTitleInfoRecord(null), null);
});
