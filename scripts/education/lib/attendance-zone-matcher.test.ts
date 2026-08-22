import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as turf from '@turf/turf';
import { matchPointToZones, classifyApartmentZoneStatus, type MatchableZoneGroup, type ZoneIdentitySummary } from './attendance-zone-matcher';

// 간단한 1x1 정사각형 polygon들로 fixture 구성
function squareZone(zoneId: string, minLng: number, minLat: number, size: number, isShared = false): MatchableZoneGroup {
  const maxLng = minLng + size;
  const maxLat = minLat + size;
  const feature = turf.polygon([
    [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ],
  ]);
  return { zoneId, isShared, bbox: [minLng, minLat, maxLng, maxLat], parts: [feature] };
}

test('point inside a single polygon zone -> matched', () => {
  const zones = [squareZone('Z1', 0, 0, 1)];
  const matched = matchPointToZones(0.5, 0.5, zones);
  assert.deepEqual(matched, ['Z1']);
});

test('point outside all zones -> no match', () => {
  const zones = [squareZone('Z1', 0, 0, 1)];
  const matched = matchPointToZones(5, 5, zones);
  assert.deepEqual(matched, []);
});

test('point exactly on boundary -> counted as inside (explicit turf default policy)', () => {
  const zones = [squareZone('Z1', 0, 0, 1)];
  const matched = matchPointToZones(0, 0.5, zones); // 왼쪽 변 위
  assert.deepEqual(matched, ['Z1']);
});

test('point inside one part of a multi-part zone (same zoneId) -> matched once', () => {
  const part1 = turf.polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]);
  const part2 = turf.polygon([[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]]);
  const zones: MatchableZoneGroup[] = [{ zoneId: 'Z1', isShared: false, bbox: [0, 0, 11, 11], parts: [part1, part2] }];
  const matched = matchPointToZones(10.5, 10.5, zones);
  assert.deepEqual(matched, ['Z1']);
});

test('point inside two overlapping different zones -> both returned (overlap detection)', () => {
  const zones = [squareZone('Z1', 0, 0, 1), squareZone('Z2', 0.5, 0.5, 1)];
  const matched = matchPointToZones(0.7, 0.7, zones);
  assert.deepEqual(matched.sort(), ['Z1', 'Z2']);
});

test('bbox pre-filter excludes far zones without false negatives near the box', () => {
  const zones = [squareZone('Z1', 100, 100, 1)];
  const matched = matchPointToZones(0.5, 0.5, zones);
  assert.deepEqual(matched, []);
});

test('classifyApartmentZoneStatus: no zones -> NO_MATCH', () => {
  assert.equal(classifyApartmentZoneStatus([], new Map()), 'NO_MATCH');
});

test('classifyApartmentZoneStatus: 2+ zones -> OVERLAP regardless of identity', () => {
  const summaries = new Map<string, ZoneIdentitySummary>([
    ['Z1', { isShared: false, allSchoolsHighConfidence: true }],
    ['Z2', { isShared: false, allSchoolsHighConfidence: true }],
  ]);
  assert.equal(classifyApartmentZoneStatus(['Z1', 'Z2'], summaries), 'OVERLAP');
});

test('classifyApartmentZoneStatus: single non-shared zone, all HIGH -> MATCHED_SINGLE', () => {
  const summaries = new Map<string, ZoneIdentitySummary>([['Z1', { isShared: false, allSchoolsHighConfidence: true }]]);
  assert.equal(classifyApartmentZoneStatus(['Z1'], summaries), 'MATCHED_SINGLE');
});

test('classifyApartmentZoneStatus: single shared zone, all HIGH -> MATCHED_SHARED', () => {
  const summaries = new Map<string, ZoneIdentitySummary>([['Z1', { isShared: true, allSchoolsHighConfidence: true }]]);
  assert.equal(classifyApartmentZoneStatus(['Z1'], summaries), 'MATCHED_SHARED');
});

test('classifyApartmentZoneStatus: single zone with any non-HIGH school identity -> IDENTITY_UNRESOLVED (conservative, MEDIUM counted as unresolved)', () => {
  const summaries = new Map<string, ZoneIdentitySummary>([['Z1', { isShared: true, allSchoolsHighConfidence: false }]]);
  assert.equal(classifyApartmentZoneStatus(['Z1'], summaries), 'IDENTITY_UNRESOLVED');
});

test('classifyApartmentZoneStatus: matched zoneId missing from summary map -> IDENTITY_UNRESOLVED (defensive)', () => {
  assert.equal(classifyApartmentZoneStatus(['Z-missing'], new Map()), 'IDENTITY_UNRESOLVED');
});
