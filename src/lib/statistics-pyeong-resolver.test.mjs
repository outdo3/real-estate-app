import assert from 'node:assert/strict';
import test from 'node:test';
import { matchTrustworthyPyeong, resolvePyeongFromApartments, resolveApartmentContextFromApartments, pyeongLookupKeyId } from './statistics-pyeong-resolver.ts';

function unitType(canonicalExclusiveArea, representativePyeong, source = 'OFFICIAL_LABEL') {
  return { canonicalExclusiveArea, representativePyeong, representativePyeongSource: source };
}

test('matchTrustworthyPyeong: 정확히 일치하는 raw area만 신뢰(84.7855 vs 84.9950 collision-safe)', () => {
  const unitTypes = [unitType(84.7855, 34), unitType(84.995, 34), unitType(59.98, 25)];
  assert.equal(matchTrustworthyPyeong(unitTypes, 84.7855), 34);
  assert.equal(matchTrustworthyPyeong(unitTypes, 84.995), 34);
  assert.equal(matchTrustworthyPyeong(unitTypes, 59.98), 25);
});

test('matchTrustworthyPyeong: 일치하는 raw area가 없으면 null(추정 금지)', () => {
  const unitTypes = [unitType(84.7855, 34)];
  assert.equal(matchTrustworthyPyeong(unitTypes, 101.23), null);
});

test('matchTrustworthyPyeong: representativePyeongSource=UNKNOWN이면 null(가짜/미확보 값 신뢰 안 함)', () => {
  const unitTypes = [unitType(84.7855, 34, 'UNKNOWN')];
  assert.equal(matchTrustworthyPyeong(unitTypes, 84.7855), null);
});

test('matchTrustworthyPyeong: representativePyeong 자체가 null이면 null', () => {
  const unitTypes = [unitType(84.7855, null)];
  assert.equal(matchTrustworthyPyeong(unitTypes, 84.7855), null);
});

test('matchTrustworthyPyeong: Decimal 왕복 오차 수준의 미세 차이는 같은 값으로 인정', () => {
  const unitTypes = [unitType(84.78550000001, 34)];
  assert.equal(matchTrustworthyPyeong(unitTypes, 84.7855), 34);
});

test('resolvePyeongFromApartments: aptSeq 단일 매칭 우선', () => {
  const keys = [{ name: 'X아파트', dong: 'Y동', aptSeq: 'AS1', rawAreaM2: 84.7855 }];
  const apartments = [
    { aptSeq: 'AS1', name: 'X아파트', dong: 'Y동', unitTypes: [unitType(84.7855, 34)] },
  ];
  const result = resolvePyeongFromApartments(keys, apartments);
  assert.equal(result.get(pyeongLookupKeyId(keys[0])), 34);
});

test('resolvePyeongFromApartments: 같은 aptSeq+같은 name/dong으로 Apartment row가 2건 이상이면(완전 중복 데이터) 매칭하지 않는다', () => {
  const keys = [{ name: 'X아파트', dong: 'Y동', aptSeq: 'AS1', rawAreaM2: 84.7855 }];
  const apartments = [
    { aptSeq: 'AS1', name: 'X아파트', dong: 'Y동', unitTypes: [unitType(84.7855, 34)] },
    { aptSeq: 'AS1', name: 'X아파트', dong: 'Y동', unitTypes: [unitType(84.7855, 34)] },
  ];
  const result = resolvePyeongFromApartments(keys, apartments);
  assert.equal(result.has(pyeongLookupKeyId(keys[0])), false);
});

test('resolvePyeongFromApartments: aptSeq가 모호해도 name+dong이 유일하게 하나로 확정되면 그 매칭은 신뢰한다', () => {
  const keys = [{ name: 'X아파트', dong: 'Y동', aptSeq: 'AS1', rawAreaM2: 84.7855 }];
  const apartments = [
    { aptSeq: 'AS1', name: 'X아파트', dong: 'Y동', unitTypes: [unitType(84.7855, 34)] },
    { aptSeq: 'AS1', name: 'X아파트(구표기)', dong: 'Y동', unitTypes: [unitType(84.7855, 34)] },
  ];
  const result = resolvePyeongFromApartments(keys, apartments);
  assert.equal(result.get(pyeongLookupKeyId(keys[0])), 34);
});

test('resolvePyeongFromApartments: aptSeq 없으면 name+dong 단일 매칭으로 폴백', () => {
  const keys = [{ name: 'X아파트', dong: 'Y동', aptSeq: null, rawAreaM2: 59.98 }];
  const apartments = [{ aptSeq: null, name: 'X아파트', dong: 'Y동', unitTypes: [unitType(59.98, 25)] }];
  const result = resolvePyeongFromApartments(keys, apartments);
  assert.equal(result.get(pyeongLookupKeyId(keys[0])), 25);
});

test('resolvePyeongFromApartments: name+dong도 여러 건이면(동명이단지) 매칭하지 않는다(다른 단지 fallback 금지)', () => {
  const keys = [{ name: 'X아파트', dong: 'Y동', aptSeq: null, rawAreaM2: 59.98 }];
  const apartments = [
    { aptSeq: null, name: 'X아파트', dong: 'Y동', unitTypes: [unitType(59.98, 25)] },
    { aptSeq: 'AS2', name: 'X아파트', dong: 'Y동', unitTypes: [unitType(59.98, 25)] },
  ];
  const result = resolvePyeongFromApartments(keys, apartments);
  assert.equal(result.has(pyeongLookupKeyId(keys[0])), false);
});

test('resolvePyeongFromApartments: 해당하는 Apartment row 자체가 없으면 조용히 미포함(null 취급, crash 없음)', () => {
  const keys = [{ name: '없는단지', dong: 'Z동', aptSeq: null, rawAreaM2: 84.7855 }];
  const result = resolvePyeongFromApartments(keys, []);
  assert.equal(result.size, 0);
});

test('resolveApartmentContextFromApartments: pyeong과 동일한 identity 규칙(aptSeq 단일매칭/name+dong 폴백)으로 세대수/입주연도를 채운다', () => {
  const keys = [{ name: 'X아파트', dong: 'Y동', aptSeq: 'AS1', rawAreaM2: 0 }];
  const apartments = [{ aptSeq: 'AS1', name: 'X아파트', dong: 'Y동', totalHouseholds: 500, approvalDate: '2011년' }];
  const result = resolveApartmentContextFromApartments(keys, apartments);
  const ctx = result.get(pyeongLookupKeyId(keys[0]));
  assert.equal(ctx.totalHouseholds, 500);
  assert.equal(ctx.approvalDate, '2011년');
});

test('resolveApartmentContextFromApartments: name+dong 동명이단지면(다른 단지 fallback 금지) 매칭하지 않는다', () => {
  const keys = [{ name: 'X아파트', dong: 'Y동', aptSeq: null, rawAreaM2: 0 }];
  const apartments = [
    { aptSeq: null, name: 'X아파트', dong: 'Y동', totalHouseholds: 500, approvalDate: '2011년' },
    { aptSeq: 'AS2', name: 'X아파트', dong: 'Y동', totalHouseholds: 900, approvalDate: '2015년' },
  ];
  const result = resolveApartmentContextFromApartments(keys, apartments);
  assert.equal(result.has(pyeongLookupKeyId(keys[0])), false);
});
