import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCanonicalFields } from './merge';
import { SOURCE_BUSAN, SOURCE_MOLIT } from './types';
import type { ParsedSourceRecord } from './types';

function record(overrides: Partial<ParsedSourceRecord>): ParsedSourceRecord {
  return {
    source: SOURCE_MOLIT,
    sourceRecordId: 'test-id',
    rawName: '서대신4',
    sido: '부산광역시',
    sigungu: '서구',
    rawBusinessType: '1)재개발(주택정비)',
    rawBusinessTypeCode: '1',
    businessType: 'REDEVELOPMENT',
    rawStage: '7)착공',
    rawStageCode: '7',
    stage: 'CONSTRUCTION',
    rawHouseholdCount: '542',
    householdCount: 542,
    rawLocation: null,
    rawPayload: {},
    normalizedName: '서대신4',
    ...overrides,
  };
}

test('서대신4 — MOLIT+BUSAN 병합 시 세대수/단계는 BUSAN 우선(R2 source priority)', () => {
  const molit = record({ source: SOURCE_MOLIT, householdCount: 542, rawHouseholdCount: '542' });
  const busan = record({
    source: SOURCE_BUSAN,
    sourceRecordId: 'busan-1',
    householdCount: 542,
    rawHouseholdCount: '542',
    rawLocation: '대영로45번길20, 3층(서대신동2가)',
  });
  const result = mergeCanonicalFields([molit, busan]);
  assert.equal(result.primarySource, SOURCE_MOLIT); // 존재/canonicalName은 국토부 우선
  assert.equal(result.householdCount, 542);
  assert.equal(result.stage, 'CONSTRUCTION');
  assert.equal(result.businessType, 'REDEVELOPMENT');
  assert.equal(result.needsReview, false);
});

test('가로주택정비/소규모재건축 — 국토부에 대응 코드가 없어 부산 businessType이 우선', () => {
  const molit = record({ source: SOURCE_MOLIT, businessType: 'UNKNOWN', rawBusinessType: null });
  const busan = record({ source: SOURCE_BUSAN, sourceRecordId: 'busan-2', businessType: 'BLOCK_HOUSING' });
  const result = mergeCanonicalFields([molit, busan]);
  assert.equal(result.businessType, 'BLOCK_HOUSING');
});

test('MOLIT-only(아미1/아미3 패턴) — 부산 소스 없이도 정상 병합, 세대수 0은 null로 처리되지 않고 그대로', () => {
  const molit = record({
    source: SOURCE_MOLIT,
    businessType: 'RESIDENTIAL_ENVIRONMENT',
    stage: 'ZONE_DESIGNATED',
    householdCount: null,
    rawHouseholdCount: '0',
  });
  const result = mergeCanonicalFields([molit]);
  assert.equal(result.primarySource, SOURCE_MOLIT);
  assert.equal(result.businessType, 'RESIDENTIAL_ENVIRONMENT');
});

test('businessType 충돌 — needsReview=true(R3A 국토부 내부 중복 패턴: 주거환경개선+세대수0 vs 재개발+실세대수)', () => {
  const oldSnapshot = record({
    source: SOURCE_MOLIT,
    sourceRecordId: 'old',
    businessType: 'RESIDENTIAL_ENVIRONMENT',
    stage: 'ZONE_DESIGNATED',
    householdCount: null,
    rawHouseholdCount: '0',
  });
  const current = record({
    source: SOURCE_MOLIT,
    sourceRecordId: 'current',
    businessType: 'REDEVELOPMENT',
    stage: 'MANAGEMENT_DISPOSITION_APPROVED',
    householdCount: 1449,
    rawHouseholdCount: '1449',
  });
  const result = mergeCanonicalFields([oldSnapshot, current]);
  assert.equal(result.needsReview, true);
  assert.match(result.needsReviewReason ?? '', /businessType 충돌/);
});

test('세대수 30%+ 불일치 — needsReview=true(명서1: 1521 vs 785 패턴)', () => {
  const a = record({ source: SOURCE_MOLIT, sourceRecordId: 'a', householdCount: 1521, rawHouseholdCount: '1521' });
  const b = record({ source: SOURCE_BUSAN, sourceRecordId: 'b', householdCount: 785, rawHouseholdCount: '785' });
  const result = mergeCanonicalFields([a, b]);
  assert.equal(result.needsReview, true);
  assert.match(result.needsReviewReason ?? '', /세대수/);
});

test('mergeCanonicalFields — 빈 배열이면 에러(호출부 버그를 조용히 삼키지 않음)', () => {
  assert.throws(() => mergeCanonicalFields([]));
});
