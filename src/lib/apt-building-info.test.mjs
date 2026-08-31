import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBrTitleInfoRecord, isNumberedBuildingUnit } from './apt-building-info.ts';

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

// MASTER_HOUSEHOLD_VERIFICATION_V1 §13/§19 — isNumberedBuildingUnit 가드 테스트.
// 실측 fixture(BUSAN_APARTMENT_MASTER_DATA_INTEGRITY_V1 재검증, 부산 outlier 30건)
// 기반: 경동(aptSeq 26350-2) 등 27건이 "숫자+동"/"제N동" dongNm을 가졌고, 실제 단일
// 건물 단지 3건(일광/일루스타/성우이린타워)은 전부 dongNm이 공백이었다.

// A. single-building register row cannot become complex total without proof
test('A: "103동"처럼 구체적 건물번호 dongNm은 단지 전체값으로 신뢰하지 않는다(true)', () => {
  assert.equal(isNumberedBuildingUnit('103동'), true); // 실측: 경동(aptSeq 26350-2)
  assert.equal(isNumberedBuildingUnit('6동'), true); // 실측: 삼호가든맨션
  assert.equal(isNumberedBuildingUnit('제108동'), true); // 실측: 대림
});

// B. verified(=단일 건물임이 확인된) 값은 그대로 accepted
test('B: dongNm이 공백이면(진짜 단일 건물 단지) 신뢰 가능한 신호로 유지한다(false)', () => {
  assert.equal(isNumberedBuildingUnit(''), false);
  assert.equal(isNumberedBuildingUnit(' '), false); // 실측: 일광/일루스타/성우이린타워
});

// C. multi-building uncertain(패턴에 안 걸리는 애매한 경우)은 이 좁은 가드가 못 잡음을
// 명시적으로 문서화 — 향후 개선 여지, 알려진 한계(§25).
test('C: 숫자+동 패턴이 아닌 비정형 dongNm(애매한 경우)은 이 가드로 잡지 못한다(알려진 한계)', () => {
  assert.equal(isNumberedBuildingUnit('범일역 삼정그린코아 더 시티'), false); // 실측: 단지명이 그대로 dongNm에 들어간 사례
});

test('dongNm이 문자열이 아니거나 undefined/null이면 false를 반환한다', () => {
  assert.equal(isNumberedBuildingUnit(undefined), false);
  assert.equal(isNumberedBuildingUnit(null), false);
  assert.equal(isNumberedBuildingUnit(123), false);
});
