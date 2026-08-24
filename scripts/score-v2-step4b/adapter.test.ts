import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptToV2Input } from '../../src/lib/score-v2/adapter';
import type { RawMasterInfo, RawLocationFeature } from '../../src/lib/apartment-score/server/types';

function mockMaster(overrides: Partial<RawMasterInfo> = {}): RawMasterInfo {
  return {
    aptSeq: 'TEST1',
    sggCd: '11110',
    sigungu: '종로구',
    umdName: '명륜동',
    buildYear: 2020,
    totalHouseholds: 500,
    parkingCount: 600,
    mainBuildingCount: 5,
    ...overrides,
  };
}

function mockLocation(overrides: Partial<RawLocationFeature> = {}): RawLocationFeature {
  return {
    aptSeq: 'TEST1',
    qualityFlag: 'complete',
    nearestSubwayDistanceM: 500,
    subwayCount1000m: 1,
    nearestBusStopDistanceM: 100,
    busStopCount300m: 5,
    martCount1000m: 1,
    convenienceCount500m: 10,
    pharmacyCount500m: 3,
    hospitalCount1000m: 10,
    parkCount1000m: 2,
    daycareKindergartenCount500m: 5,
    nearestElementaryDistanceM: 300,
    elementaryCount1000m: 2,
    beachDistanceM: null,
    ...overrides,
  };
}

test('ADAPTER: parking known', () => {
  const input = adaptToV2Input(mockMaster({ parkingCount: 600, totalHouseholds: 500 }), mockLocation());
  assert.equal(input.parkingRawStatus, 'KNOWN');
  assert.equal(input.parkingRatio, 1.2);
});

test('ADAPTER: parking missing (count null)', () => {
  const input = adaptToV2Input(mockMaster({ parkingCount: null, totalHouseholds: 500 }), mockLocation());
  assert.equal(input.parkingRawStatus, 'MISSING');
  assert.equal(input.parkingRatio, null);
});

test('ADAPTER: parking missing (households null)', () => {
  const input = adaptToV2Input(mockMaster({ parkingCount: 500, totalHouseholds: null }), mockLocation());
  assert.equal(input.parkingRawStatus, 'MISSING');
  assert.equal(input.parkingRatio, null);
});

test('ADAPTER: subway VALUE', () => {
  const input = adaptToV2Input(mockMaster(), mockLocation({ nearestSubwayDistanceM: 150 }));
  assert.equal(input.subwayStatus, 'VALUE');
  assert.equal(input.nearestSubwayDistanceM, 150);
});

test('ADAPTER: subway CONFIRMED_ABSENT (distance null & quality complete)', () => {
  const input = adaptToV2Input(
    mockMaster(),
    mockLocation({ nearestSubwayDistanceM: null, qualityFlag: 'complete' })
  );
  assert.equal(input.subwayStatus, 'CONFIRMED_ABSENT');
  assert.equal(input.nearestSubwayDistanceM, null);
});

test('ADAPTER: subway MISSING (distance null & quality partial)', () => {
  const input = adaptToV2Input(
    mockMaster(),
    mockLocation({ nearestSubwayDistanceM: null, qualityFlag: 'partial' })
  );
  assert.equal(input.subwayStatus, 'MISSING');
  assert.equal(input.nearestSubwayDistanceM, null);
});

test('ADAPTER: identityEligible = false when location is null', () => {
  const input = adaptToV2Input(mockMaster(), null);
  assert.equal(input.identityEligible, false);
  assert.equal(input.subwayStatus, 'MISSING');
  assert.equal(input.living.martCount1000m, null);
});

test('ADAPTER: education straight-line mapping', () => {
  const input = adaptToV2Input(mockMaster(), mockLocation({ nearestElementaryDistanceM: 450 }));
  assert.equal(input.nearestElementaryDistanceM, 450);
  assert.equal(input.attendanceZoneStatus, 'NOT_AVAILABLE');
});
