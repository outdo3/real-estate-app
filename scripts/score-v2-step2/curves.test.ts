// E-JIP SCORE V2 STEP 2 §59 — curve 후보 prototype 테스트. node:test, DB 없음.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  subwayDistanceScore, busDistanceScore, busCountScore, ageScore, scaleScore, parkingScore,
  elementaryDistanceScore, livingCountScore, attendanceZoneConfidenceAdjustment,
  type SubwayCurveCandidate, type AgeCurveCandidate, type ScaleCurveCandidate, type ParkingCurveCandidate,
} from './curves';

const SUBWAY_CANDIDATES: SubwayCurveCandidate[] = ['A_PIECEWISE_LINEAR', 'B_LOGISTIC', 'C_EXPONENTIAL_DECAY', 'D_MANUAL_ANCHORED_SATURATION'];
const AGE_CANDIDATES: AgeCurveCandidate[] = ['A_PIECEWISE', 'B_SLOW_DECAY_SATURATION', 'C_LIFECYCLE_BANDS'];
const SCALE_CANDIDATES: ScaleCurveCandidate[] = ['A_LOG_NORMALIZED', 'B_LOGISTIC', 'C_PIECEWISE'];
const PARKING_CANDIDATES: ParkingCurveCandidate[] = ['A_LOGISTIC_MID1_SCALE022', 'B_LOGISTIC_WIDE', 'C_PIECEWISE'];

test('SUBWAY: 100m > 300m > 800m > 1500m for every candidate(§11 monotonic dominance)', () => {
  for (const c of SUBWAY_CANDIDATES) {
    const s100 = subwayDistanceScore(100, c)!, s300 = subwayDistanceScore(300, c)!, s800 = subwayDistanceScore(800, c)!, s1500 = subwayDistanceScore(1500, c)!;
    assert.ok(s100 > s300, `${c}: 100m(${s100}) should be > 300m(${s300})`);
    assert.ok(s300 > s800, `${c}: 300m(${s300}) should be > 800m(${s800})`);
    assert.ok(s800 > s1500, `${c}: 800m(${s800}) should be > 1500m(${s1500})`);
  }
});

test('SUBWAY: near-distance saturation — 80m vs 120m diff <= 10pt for every candidate(§7)', () => {
  for (const c of SUBWAY_CANDIDATES) {
    const diff = Math.abs(subwayDistanceScore(80, c)! - subwayDistanceScore(120, c)!);
    assert.ok(diff <= 10, `${c}: 80m/120m diff=${diff} exceeds 10pt`);
  }
});

test('SUBWAY: 0m does not auto-score 100(station-center 한계 반영, §6)', () => {
  for (const c of SUBWAY_CANDIDATES) {
    assert.ok(subwayDistanceScore(0, c)! < 100);
  }
});

test('SUBWAY: null distance returns null, not a fake zero/default score', () => {
  for (const c of SUBWAY_CANDIDATES) assert.equal(subwayDistanceScore(null, c), null);
});

test('SUBWAY: monotonic over full observed range(19m~999m, no local reversal) — 전 후보', () => {
  for (const c of SUBWAY_CANDIDATES) {
    let prev = subwayDistanceScore(19, c)!;
    for (let d = 20; d <= 999; d += 20) {
      const cur = subwayDistanceScore(d, c)!;
      assert.ok(cur <= prev + 1e-9, `${c}: reversal at ${d}m (prev=${prev}, cur=${cur})`);
      prev = cur;
    }
  }
});

test('PARKING: 1.5 > 1.0 > 0.7 for every candidate', () => {
  for (const c of PARKING_CANDIDATES) {
    const s15 = parkingScore(1.5, c)!, s10 = parkingScore(1.0, c)!, s07 = parkingScore(0.7, c)!;
    assert.ok(s15 > s10 && s10 > s07, `${c}: expected 1.5(${s15}) > 1.0(${s10}) > 0.7(${s07})`);
  }
});

test('PARKING: 대신해모(1.09) < 협성(1.58) but gap far smaller than V1의 77pt(§17 V1 재발 방지)', () => {
  for (const c of PARKING_CANDIDATES) {
    const s109 = parkingScore(1.09, c)!, s158 = parkingScore(1.58, c)!;
    assert.ok(s109 < s158, `${c}: 1.09(${s109}) should be < 1.58(${s158})`);
    assert.ok(s158 - s109 < 50, `${c}: gap ${s158 - s109} should stay well below V1's 77pt`);
  }
});

test('PARKING: null ratio returns null, not fake zero', () => {
  for (const c of PARKING_CANDIDATES) assert.equal(parkingScore(null, c), null);
});

test('AGE: 5yr > 20yr > 35yr for every candidate(현재 상품성 기준, 재건축 기대 미반영)', () => {
  for (const c of AGE_CANDIDATES) {
    const s5 = ageScore(5, c)!, s20 = ageScore(20, c)!, s35 = ageScore(35, c)!;
    assert.ok(s5 > s20 && s20 > s35, `${c}: expected 5y(${s5}) > 20y(${s20}) > 35y(${s35})`);
  }
});

test('AGE: monotonic non-increasing across full 0~64y range for every candidate', () => {
  for (const c of AGE_CANDIDATES) {
    let prev = ageScore(0, c)!;
    for (let a = 1; a <= 64; a++) {
      const cur = ageScore(a, c)!;
      assert.ok(cur <= prev + 1e-9, `${c}: age reversal at ${a}y`);
      prev = cur;
    }
  }
});

test('SCALE: 1000 > 500 > 100 with saturating gaps(§15) for every candidate', () => {
  for (const c of SCALE_CANDIDATES) {
    const s100 = scaleScore(100, c)!, s500 = scaleScore(500, c)!, s1000 = scaleScore(1000, c)!;
    assert.ok(s100 < s500 && s500 < s1000, `${c}: expected 100(${s100}) < 500(${s500}) < 1000(${s1000})`);
    const gap100to500 = s500 - s100;
    const gap1000to1500 = scaleScore(1500, c)! - s1000;
    assert.ok(gap1000to1500 < gap100to500, `${c}: 1000->1500 gap(${gap1000to1500}) should be smaller than 100->500 gap(${gap100to500}), i.e. saturating`);
  }
});

test('SCALE: continuity at 699/700 boundary(§38) — no jump for any candidate', () => {
  for (const c of SCALE_CANDIDATES) {
    const diff = Math.abs(scaleScore(700, c)! - scaleScore(699, c)!);
    assert.ok(diff < 1, `${c}: 699/700 jump=${diff} too large`);
  }
});

test('BUS: distance-score is monotonic decreasing, count-score shows diminishing returns(§9)', () => {
  assert.ok(busDistanceScore(20)! > busDistanceScore(100)!);
  assert.ok(busDistanceScore(100)! > busDistanceScore(300)!);
  const gap2to5 = busCountScore(5)! - busCountScore(2)!;
  const gap20to25 = busCountScore(25)! - busCountScore(20)!;
  assert.ok(gap2to5 > gap20to25, `2->5 gap(${gap2to5}) should exceed 20->25 gap(${gap20to25})`);
});

test('ELEMENTARY: monotonic decreasing, 341m(협성) > 545m(대신해모) preserved as raw-fact dominance', () => {
  const s341 = elementaryDistanceScore(341);
  const s545 = elementaryDistanceScore(545);
  assert.ok(s341 > s545, `absolute curve must keep 341m(${s341}) > 545m(${s545}) — this is exactly the V1 inversion STEP2 must not repeat`);
});

test('LIVING: count saturation — half-life point yields ~ceil/2, diminishing beyond', () => {
  const halfLife = 6;
  const atHalfLife = livingCountScore(halfLife, halfLife)!;
  assert.ok(Math.abs(atHalfLife - 47.5) < 2, `expected ~47.5 at half-life point, got ${atHalfLife}`);
  const gapLow = livingCountScore(2 * halfLife, halfLife)! - livingCountScore(halfLife, halfLife)!;
  const gapHigh = livingCountScore(4 * halfLife, halfLife)! - livingCountScore(3 * halfLife, halfLife)!;
  assert.ok(gapLow > gapHigh, 'later doublings should add less score than earlier ones');
});

test('LIVING: null count returns null, not fake zero', () => {
  assert.equal(livingCountScore(null, 6), null);
});

test('CONFIDENCE: low-confidence attendance-zone status cannot masquerade as full confidence(§27,§59)', () => {
  assert.equal(attendanceZoneConfidenceAdjustment('AVAILABLE'), 0);
  assert.ok(attendanceZoneConfidenceAdjustment('REVIEW_REQUIRED') < 0, 'REVIEW_REQUIRED must reduce confidence');
  assert.ok(attendanceZoneConfidenceAdjustment('NOT_AVAILABLE') < attendanceZoneConfidenceAdjustment('REVIEW_REQUIRED'), 'NOT_AVAILABLE must be strictly worse than REVIEW_REQUIRED');
});

test('determinism: identical input always yields identical output(no randomness/time dependence)', () => {
  for (const c of SUBWAY_CANDIDATES) assert.equal(subwayDistanceScore(273, c), subwayDistanceScore(273, c));
  for (const c of PARKING_CANDIDATES) assert.equal(parkingScore(1.23, c), parkingScore(1.23, c));
});
