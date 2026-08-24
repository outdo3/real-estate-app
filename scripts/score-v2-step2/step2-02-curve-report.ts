/**
 * E-JIP SCORE V2 STEP 2 §6,9,13,15,17,23 — curve 후보별 anchor point 출력.
 * 순수 계산만(DB 접근 없음).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  subwayDistanceScore, busDistanceScore, busCountScore, ageScore, scaleScore, parkingScore,
  elementaryDistanceScore, livingCountScore, LIVING_CATEGORY_SPECS,
  type SubwayCurveCandidate, type AgeCurveCandidate, type ScaleCurveCandidate, type ParkingCurveCandidate,
} from './curves';

function table(rows: Record<string, unknown>[]) {
  console.table(rows);
  return rows;
}
const artifact: Record<string, unknown> = { generatedAt: new Date().toISOString() };

console.log('='.repeat(90));
console.log('[§6] SUBWAY distance curve candidates — score@anchor points');
console.log('='.repeat(90));
const subwayPoints = [100, 200, 300, 500, 800, 1000, 1500, 2000];
const subwayCandidates: SubwayCurveCandidate[] = ['A_PIECEWISE_LINEAR', 'B_LOGISTIC', 'C_EXPONENTIAL_DECAY', 'D_MANUAL_ANCHORED_SATURATION'];
artifact.subway = table(subwayPoints.map((d) => {
  const row: Record<string, unknown> = { distanceM: d };
  for (const c of subwayCandidates) row[c] = subwayDistanceScore(d, c)?.toFixed(1);
  return row;
}));

console.log('\n[§7] near-distance saturation check: score(80m) vs score(120m), diff must be <=10pt');
for (const c of subwayCandidates) {
  const s80 = subwayDistanceScore(80, c)!; const s120 = subwayDistanceScore(120, c)!;
  console.log(`  ${c}: 80m=${s80.toFixed(1)} 120m=${s120.toFixed(1)} diff=${Math.abs(s80 - s120).toFixed(2)} ${Math.abs(s80 - s120) <= 10 ? 'PASS' : 'FAIL'}`);
}

console.log('\n[§11] monotonic dominance check: 140m > 306m > 800m > 1500m must hold for all candidates');
for (const c of subwayCandidates) {
  const s = [140, 306, 800, 1500].map((d) => subwayDistanceScore(d, c)!);
  const monotonic = s[0] > s[1] && s[1] > s[2] && s[2] > s[3];
  console.log(`  ${c}: 140m=${s[0].toFixed(1)} 306m=${s[1].toFixed(1)} 800m=${s[2].toFixed(1)} 1500m=${s[3].toFixed(1)} ${monotonic ? 'PASS' : 'FAIL'}`);
}

console.log('\n' + '='.repeat(90));
console.log('[§9] BUS distance/count curve — sample points');
console.log('='.repeat(90));
artifact.busDistance = table([20, 50, 87, 133, 187, 300, 467].map((d) => ({ distanceM: d, score: busDistanceScore(d)?.toFixed(1) })));
artifact.busCount = table([1, 2, 5, 8, 12, 17, 22, 25, 30].map((n) => ({ count: n, score: busCountScore(n)?.toFixed(1) })));
console.log('diminishing-returns check: delta(2->5) vs delta(20->25):');
console.log(`  2->5: ${(busCountScore(5)! - busCountScore(2)!).toFixed(1)}pt   20->25: ${(busCountScore(25)! - busCountScore(20)!).toFixed(1)}pt`);

console.log('\n' + '='.repeat(90));
console.log('[§13] AGE curve candidates — score@age(years)');
console.log('='.repeat(90));
const agePoints = [0, 3, 5, 10, 15, 20, 25, 30, 35, 40, 50, 64];
const ageCandidates: AgeCurveCandidate[] = ['A_PIECEWISE', 'B_SLOW_DECAY_SATURATION', 'C_LIFECYCLE_BANDS'];
artifact.age = table(agePoints.map((a) => {
  const row: Record<string, unknown> = { ageYears: a };
  for (const c of ageCandidates) row[c] = ageScore(a, c)?.toFixed(1);
  return row;
}));
console.log('monotonic check(5>20>35) per candidate:');
for (const c of ageCandidates) {
  const s5 = ageScore(5, c)!; const s20 = ageScore(20, c)!; const s35 = ageScore(35, c)!;
  console.log(`  ${c}: 5y=${s5.toFixed(1)} 20y=${s20.toFixed(1)} 35y=${s35.toFixed(1)} ${s5 > s20 && s20 > s35 ? 'PASS' : 'FAIL'}`);
}

console.log('\n' + '='.repeat(90));
console.log('[§15] SCALE(households) curve candidates');
console.log('='.repeat(90));
const scalePoints = [20, 50, 100, 200, 300, 500, 699, 700, 1000, 1500, 2000, 3000];
const scaleCandidates: ScaleCurveCandidate[] = ['A_LOG_NORMALIZED', 'B_LOGISTIC', 'C_PIECEWISE'];
artifact.scale = table(scalePoints.map((h) => {
  const row: Record<string, unknown> = { households: h };
  for (const c of scaleCandidates) row[c] = scaleScore(h, c)?.toFixed(1);
  return row;
}));

console.log('\n' + '='.repeat(90));
console.log('[§17] PARKING curve candidates — score@ratio (V1 재발 방지 확인: 1.09 vs 1.58)');
console.log('='.repeat(90));
const parkingPoints = [0.5, 0.7, 0.9, 1.0, 1.09, 1.2, 1.4, 1.58, 1.8, 2.0];
const parkingCandidates: ParkingCurveCandidate[] = ['A_LOGISTIC_MID1_SCALE022', 'B_LOGISTIC_WIDE', 'C_PIECEWISE'];
artifact.parking = table(parkingPoints.map((r) => {
  const row: Record<string, unknown> = { ratio: r };
  for (const c of parkingCandidates) row[c] = parkingScore(r, c)?.toFixed(1);
  return row;
}));
for (const c of parkingCandidates) {
  const s109 = parkingScore(1.09, c)!; const s158 = parkingScore(1.58, c)!;
  console.log(`  ${c}: 1.09=${s109.toFixed(1)} 1.58=${s158.toFixed(1)} gap=${(s158 - s109).toFixed(1)}pt (V1 gap이었던 77pt와 비교)`);
}

console.log('\n' + '='.repeat(90));
console.log('[§23] ELEMENTARY distance curve — sample points');
console.log('='.repeat(90));
artifact.elementary = table([100, 200, 300, 341, 500, 545, 700, 1000].map((d) => ({ distanceM: d, score: elementaryDistanceScore(d).toFixed(1) })));

console.log('\n' + '='.repeat(90));
console.log('[§31] LIVING count saturation — sample per category');
console.log('='.repeat(90));
const livingArtifact: Record<string, unknown> = {};
for (const spec of LIVING_CATEGORY_SPECS) {
  const pts = [0, 1, 2, 5, 8, 12, 20, spec.cap];
  const vals = Object.fromEntries(pts.map((n) => [n, livingCountScore(n, spec.halfLife)!.toFixed(0)]));
  livingArtifact[spec.key] = { label: spec.label, halfLife: spec.halfLife, cap: spec.cap, scores: vals };
  console.log(`  ${spec.label}(halfLife=${spec.halfLife}): ${pts.map((n) => `${n}=${vals[n]}`).join(', ')}`);
}
artifact.living = livingArtifact;

fs.writeFileSync(path.resolve(__dirname, '../../data/score-v2-step2/curve-candidates.json'), JSON.stringify(artifact, null, 1));
console.log('\n[saved] data/score-v2-step2/curve-candidates.json');
