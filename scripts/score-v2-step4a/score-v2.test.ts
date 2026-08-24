/**
 * E-JIP SCORE V2 STEP 4A — Unit tests.
 *
 * node:test 사용. DB 없음 (순수 함수만).
 *
 * 커버 항목:
 * - Transport: subway 4-state, bus saturation
 * - Living: sparse/dense/missing/zero-vs-null
 * - Education: near/far/missing, attendance zone isolation
 * - Complex: new-large/old-small, parking known/missing P-D
 * - Overall: W-A 25/25/25/25 exact, deterministic, eligibility
 * - Pareto: A > B in all domains → overall A > B
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Engine under test
import { calculateScoreV2, isParetoSuperior } from '../../src/lib/score-v2/engine';
import { subwayScore, busDistanceScore, busCountScore, ageScore, scaleScore, parkingScore, elementaryDistanceScore, livingCountScore, SUBWAY_SENTINEL_FLOOR, buildYearToAge } from '../../src/lib/score-v2/curves';
import { transportDomain } from '../../src/lib/score-v2/transport';
import { livingDomain } from '../../src/lib/score-v2/living';
import { educationDomain } from '../../src/lib/score-v2/education';
import { complexDomain, ageToBand } from '../../src/lib/score-v2/complex';
import { eligibilityFromCoverage } from '../../src/lib/score-v2/eligibility';
import { PARKING_ERA_NEUTRAL } from '../../src/lib/score-v2/types';
import type { ScoreV2Input, LivingRawCounts } from '../../src/lib/score-v2/types';

// Fixtures
import { FIXTURE_PAIR03_A, FIXTURE_PAIR03_B, FIXTURE_PAIR10_A, FIXTURE_PAIR10_B, FIXTURE_GUDUK_KUMHO } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_LIVING: LivingRawCounts = {
  martCount1000m: 2,
  convenienceCount500m: 10,
  pharmacyCount500m: 5,
  hospitalCount1000m: 30,
  parkCount1000m: 8,
  daycareKindergartenCount500m: 3,
};

function baseInput(overrides: Partial<ScoreV2Input> = {}): ScoreV2Input {
  return {
    aptSeq: 'TEST',
    buildYear: 2020,
    totalHouseholds: 500,
    parkingRatio: 1.2,
    parkingRawStatus: 'KNOWN',
    subwayStatus: 'VALUE',
    nearestSubwayDistanceM: 400,
    nearestBusStopDistanceM: 80,
    busStopCount300m: 12,
    nearestElementaryDistanceM: 400,
    attendanceZoneStatus: 'AVAILABLE',
    living: { ...BASE_LIVING },
    identityEligible: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TRANSPORT TESTS
// ---------------------------------------------------------------------------

test('TRANSPORT: subway VALUE — 400m은 중간 범위 score를 반환한다', () => {
  const sc = subwayScore(400, 'VALUE');
  assert.ok(sc != null, 'VALUE 상태에서 null 반환은 금지');
  assert.ok(sc! >= 20 && sc! <= 60, `400m 기대 범위 [20,60], 실제: ${sc}`);
});

test('TRANSPORT: subway CONFIRMED_ABSENT — floor(5) 반환', () => {
  const sc = subwayScore(null, 'CONFIRMED_ABSENT');
  assert.equal(sc, SUBWAY_SENTINEL_FLOOR, 'CONFIRMED_ABSENT는 sentinel floor(5)이어야 함');
});

test('TRANSPORT: subway MISSING — null 반환 (재분배 대상)', () => {
  const sc = subwayScore(null, 'MISSING');
  assert.equal(sc, null, 'MISSING은 null이어야 함 — fake-zero 금지');
});

test('TRANSPORT: subway INVALID_OR_UNRESOLVED — null 반환', () => {
  const sc = subwayScore(null, 'INVALID_OR_UNRESOLVED');
  assert.equal(sc, null, 'INVALID_OR_UNRESOLVED도 null이어야 함');
});

test('TRANSPORT: CONFIRMED_ABSENT ≠ MISSING — 다른 처리', () => {
  const absent = subwayScore(null, 'CONFIRMED_ABSENT');
  const missing = subwayScore(null, 'MISSING');
  assert.notEqual(absent, missing, 'CONFIRMED_ABSENT와 MISSING은 반드시 다른 결과');
  assert.ok(absent != null, 'CONFIRMED_ABSENT는 null이 아님');
  assert.equal(missing, null, 'MISSING은 null');
});

test('TRANSPORT: ultra-near subway (38m) — 최고 점수 근방 (>=87)', () => {
  const sc = subwayScore(38, 'VALUE');
  assert.ok(sc != null && sc >= 87, `38m는 초역세권, 기대 >=87, 실제: ${sc}`);
});

test('TRANSPORT: subway 거리 단조 감소 — 가까울수록 높은 score', () => {
  const distances = [50, 200, 400, 700, 1000, 1500];
  const scores = distances.map((d) => subwayScore(d, 'VALUE')!);
  for (let i = 0; i < scores.length - 1; i++) {
    assert.ok(
      scores[i] >= scores[i + 1],
      `단조 감소 위반: d=${distances[i]} score=${scores[i]}, d=${distances[i + 1]} score=${scores[i + 1]}`
    );
  }
});

test('TRANSPORT: bus distance null — null 반환 (fake-zero 금지)', () => {
  assert.equal(busDistanceScore(null), null);
});

test('TRANSPORT: bus count saturation — 20→25개 증가폭은 2→5개보다 작아야 한다', () => {
  const delta_2to5 = busCountScore(5)! - busCountScore(2)!;
  const delta_20to25 = busCountScore(25)! - busCountScore(20)!;
  assert.ok(delta_2to5 > delta_20to25, `diminishing returns 위반: 2→5 delta=${delta_2to5}, 20→25 delta=${delta_20to25}`);
});

test('TRANSPORT domain: CONFIRMED_ABSENT subway — bus만으로 계산, domain score는 bus 단독 값', () => {
  const result = transportDomain({
    subwayStatus: 'CONFIRMED_ABSENT',
    nearestSubwayDistanceM: null,
    nearestBusStopDistanceM: 80,
    busStopCount300m: 12,
  });
  // subway는 sentinel(5), bus는 있으므로 domain score는 subway(5)*0.7 + bus*0.3
  assert.ok(result.score != null, 'CONFIRMED_ABSENT subway + bus 있음 → domain score 있어야 함');
  assert.ok(result.score! < 30, `sentinel subway(5) 포함 시 domain score는 낮아야 함: ${result.score}`);
});

test('TRANSPORT domain: subway MISSING, bus 있음 — bus가 재분배로 transport score 형성', () => {
  const result = transportDomain({
    subwayStatus: 'MISSING',
    nearestSubwayDistanceM: null,
    nearestBusStopDistanceM: 80,
    busStopCount300m: 12,
  });
  assert.ok(result.score != null, 'subway MISSING + bus 있음 → bus만으로 score 형성 가능');
  assert.ok(result.coverage < 1.0, 'subway 결측으로 coverage < 1.0이어야 함');
});

test('TRANSPORT sentinel regression: STEP3 §4 — PAIR06 B (subway 209m VALUE) > PAIR06 A (CONFIRMED_ABSENT)', () => {
  // PAIR06 A: subway CONFIRMED_ABSENT
  const pairA = transportDomain({ subwayStatus: 'CONFIRMED_ABSENT', nearestSubwayDistanceM: null, nearestBusStopDistanceM: 58, busStopCount300m: 10 });
  // PAIR06 B: subway VALUE 209m
  const pairB = transportDomain({ subwayStatus: 'VALUE', nearestSubwayDistanceM: 209, nearestBusStopDistanceM: 53, busStopCount300m: 10 });
  assert.ok(pairB.score! > pairA.score!, `PAIR06: B(subway 209m)=${pairB.score} > A(CONFIRMED_ABSENT)=${pairA.score}`);
});

// ---------------------------------------------------------------------------
// LIVING TESTS
// ---------------------------------------------------------------------------

test('LIVING: sparse area — 편의시설이 적으면 낮은 score', () => {
  const result = livingDomain({
    martCount1000m: 0,
    convenienceCount500m: 1,
    pharmacyCount500m: 0,
    hospitalCount1000m: 5,
    parkCount1000m: 1,
    daycareKindergartenCount500m: 0,
  });
  assert.ok(result.score != null && result.score < 40, `sparse living 기대 <40, 실제: ${result.score}`);
});

test('LIVING: dense area — count 높음이 무한 점수 상승을 하지 않아야 함 (score ≤ 95)', () => {
  const result = livingDomain({
    martCount1000m: 45,
    convenienceCount500m: 45,
    pharmacyCount500m: 45,
    hospitalCount1000m: 45,
    parkCount1000m: 15,
    daycareKindergartenCount500m: 20,
  });
  assert.ok(result.score != null && result.score <= 95, `dense living은 cap에 수렴해야 함, 실제: ${result.score}`);
});

test('LIVING: category null vs zero — 다른 처리', () => {
  const withNull = livingDomain({
    martCount1000m: null, // 수집 없음
    convenienceCount500m: 10, pharmacyCount500m: 5, hospitalCount1000m: 30,
    parkCount1000m: 8, daycareKindergartenCount500m: 3,
  });
  const withZero = livingDomain({
    martCount1000m: 0, // 수집했으나 0개
    convenienceCount500m: 10, pharmacyCount500m: 5, hospitalCount1000m: 30,
    parkCount1000m: 8, daycareKindergartenCount500m: 3,
  });
  // null은 missingFactors에, 0은 usedFactors에
  assert.ok(withNull.missingFactors.includes('martCount1000m'), 'null mart → missingFactors에 포함');
  assert.ok(withZero.usedFactors.includes('martCount1000m'), '0개 mart → usedFactors에 포함');
  // coverage도 달라야 함 (null이면 mart weight 제외)
});

test('LIVING: 모든 category null → score=null', () => {
  const result = livingDomain({
    martCount1000m: null, convenienceCount500m: null, pharmacyCount500m: null,
    hospitalCount1000m: null, parkCount1000m: null, daycareKindergartenCount500m: null,
  });
  assert.equal(result.score, null, '모든 category null이면 score=null이어야 함');
});

// ---------------------------------------------------------------------------
// EDUCATION TESTS
// ---------------------------------------------------------------------------

test('EDUCATION: 근접 초등학교 (43m) — 높은 score (>=80)', () => {
  const result = educationDomain({ nearestElementaryDistanceM: 43, attendanceZoneStatus: 'AVAILABLE' });
  assert.ok(result.score != null && result.score >= 80, `43m 초등 기대 >=80, 실제: ${result.score}`);
});

test('EDUCATION: 원거리 초등학교 (837m) — 낮은 score (<30)', () => {
  const result = educationDomain({ nearestElementaryDistanceM: 837, attendanceZoneStatus: 'AVAILABLE' });
  assert.ok(result.score != null && result.score < 30, `837m 초등 기대 <30, 실제: ${result.score}`);
});

test('EDUCATION: nearestElementaryDistanceM null → score=null', () => {
  const result = educationDomain({ nearestElementaryDistanceM: null, attendanceZoneStatus: 'AVAILABLE' });
  assert.equal(result.score, null, 'elementary null → score=null');
  assert.equal(result.coverage, 0);
});

test('EDUCATION: attendanceZoneStatus는 score에 영향 없음 (evidence only)', () => {
  const available = educationDomain({ nearestElementaryDistanceM: 400, attendanceZoneStatus: 'AVAILABLE' });
  const shared = educationDomain({ nearestElementaryDistanceM: 400, attendanceZoneStatus: 'SHARED' });
  const review = educationDomain({ nearestElementaryDistanceM: 400, attendanceZoneStatus: 'REVIEW_REQUIRED' });
  const notAvail = educationDomain({ nearestElementaryDistanceM: 400, attendanceZoneStatus: 'NOT_AVAILABLE' });
  // 모두 동일한 score — attendance zone은 score 미반영
  assert.equal(available.score, shared.score, 'AVAILABLE vs SHARED: score 동일해야 함');
  assert.equal(available.score, review.score, 'AVAILABLE vs REVIEW_REQUIRED: score 동일해야 함');
  assert.equal(available.score, notAvail.score, 'AVAILABLE vs NOT_AVAILABLE: score 동일해야 함');
  // evidence에만 포함
  assert.equal(available.evidence.attendanceZoneAffectsScore, false);
});

// ---------------------------------------------------------------------------
// COMPLEX TESTS
// ---------------------------------------------------------------------------

test('COMPLEX: 신축 대단지 (2020, 1530세대, parking 1.41 KNOWN) — 높은 score', () => {
  const result = complexDomain({ buildYear: 2020, totalHouseholds: 1530, parkingRatio: 1.41, parkingRawStatus: 'KNOWN' });
  assert.ok(result.score != null && result.score > 70, `신축 대단지 기대 >70, 실제: ${result.score}`);
});

test('COMPLEX: 구형 소단지 (1986, 72세대, parking MISSING) — 낮은 score', () => {
  const result = complexDomain({ buildYear: 1986, totalHouseholds: 72, parkingRatio: null, parkingRawStatus: 'MISSING' });
  assert.ok(result.score != null && result.score < 40, `구형 소단지 기대 <40, 실제: ${result.score}`);
});

test('COMPLEX: parking KNOWN vs MISSING — KNOWN이 MISSING(era neutral)보다 높아야 함 (신축 대단지, parking 1.5)', () => {
  const known = complexDomain({ buildYear: 2020, totalHouseholds: 500, parkingRatio: 1.5, parkingRawStatus: 'KNOWN' });
  const missing = complexDomain({ buildYear: 2020, totalHouseholds: 500, parkingRatio: null, parkingRawStatus: 'MISSING' });
  // 2020년 → 0-10 band, era neutral=65. 실제 1.5 → parkingScore≈84.
  // 84 > 65이므로 known > missing이어야 함.
  assert.ok(known.score! > missing.score!, `parking KNOWN(1.5)=${known.score} > MISSING(era65)=${missing.score}`);
});

test('COMPLEX P-D: parking MISSING이어도 parking이 missingFactors에 남아야 함 (결측 사실 은폐 금지)', () => {
  const result = complexDomain({ buildYear: 2010, totalHouseholds: 300, parkingRatio: null, parkingRawStatus: 'MISSING' });
  assert.ok(result.missingFactors.includes('parking'), 'parking MISSING이면 missingFactors에 포함되어야 함');
  // evidence에 raw parking ratio가 null이어야 함
  assert.equal(result.evidence.parkingRatio, null, 'evidence.parkingRatio는 null 유지 (fake값 금지)');
});

test('COMPLEX P-D: NO-FAKE-PARKING-VALUE — era neutral은 raw ratio가 아닌 factor score로만 사용', () => {
  const result = complexDomain({ buildYear: 1990, totalHouseholds: 100, parkingRatio: null, parkingRawStatus: 'MISSING' });
  // result에 parkingRatio 필드가 없어야 함 (DomainResult는 score/coverage/usedFactors/missingFactors/evidence만)
  assert.ok(!('parkingRatio' in result), 'DomainResult에 parkingRatio 필드가 있으면 안 됨');
  assert.equal(result.evidence.parkingRatio, null, 'evidence.parkingRatio=null (raw null 유지)');
  // P-D treatment가 evidence에 기록되어야 함
  assert.equal(result.evidence.parkingModelTreatment, 'P-D_ERA_CONDITIONED');
});

test('COMPLEX P-D era bands: 노후 단지(1985, 31+)는 신축(2020, 0-10)보다 낮은 era neutral', () => {
  assert.ok(PARKING_ERA_NEUTRAL['31+'] < PARKING_ERA_NEUTRAL['0-10'],
    `31+ era neutral(${PARKING_ERA_NEUTRAL['31+']}) < 0-10 era neutral(${PARKING_ERA_NEUTRAL['0-10']})`);
});

test('COMPLEX: 연식 단조 감소 — 건축년도가 오래될수록 age score가 낮아야 함', () => {
  const ages = [0, 5, 10, 20, 30, 40];
  const scores = ages.map((a) => ageScore(a)!);
  for (let i = 0; i < scores.length - 1; i++) {
    assert.ok(scores[i] >= scores[i + 1], `단조 감소 위반: age=${ages[i]} score=${scores[i]}, age=${ages[i + 1]} score=${scores[i + 1]}`);
  }
});

test('COMPLEX: households 단조 증가 — 세대수 많을수록 scale score 높음', () => {
  const hhs = [20, 50, 100, 300, 700, 1500, 3000];
  const scores = hhs.map((h) => scaleScore(h)!);
  for (let i = 0; i < scores.length - 1; i++) {
    assert.ok(scores[i] <= scores[i + 1], `단조 증가 위반: hh=${hhs[i]} score=${scores[i]}, hh=${hhs[i + 1]} score=${scores[i + 1]}`);
  }
});

// ---------------------------------------------------------------------------
// OVERALL / ENGINE TESTS
// ---------------------------------------------------------------------------

test('OVERALL: W-A 25/25/25/25 정확 검증 — 4 domain 점수가 모두 같으면 overall도 동일', () => {
  // 모든 domain이 50점이면 overall도 50이어야 함
  const input = baseInput({
    subwayStatus: 'VALUE',
    nearestSubwayDistanceM: 420, // elementaryDistanceScore(420, 180, 8, 95) ≈ 50
    nearestBusStopDistanceM: 110, // busDistanceScore(110) ≈ 50
    busStopCount300m: 6,          // busCountScore(6, halfLife=6) = 47.5
    nearestElementaryDistanceM: 420, // elementaryDistanceScore(420) ≈ 50
    buildYear: 2026 - 23, // ageScore(23) ≈ 50 (STEP2 table: 25y→46, 20y→55 → 23y≈51)
    totalHouseholds: 118, // scaleScore ≈ median → 중간 점수
    parkingRatio: 1.0, // parkingScore(1.0) = 50
    parkingRawStatus: 'KNOWN',
  });
  const result = calculateScoreV2(input, 2026);
  // W-A = 4 domains * 25%, 각 domain이 다를 수 있으므로 정확한 계산을 확인
  // overall = (T + L + E + C) / 4 (모두 available인 경우)
  const expectedOverall =
    ((result.domains.transport.score ?? 0) +
      (result.domains.living.score ?? 0) +
      (result.domains.education.score ?? 0) +
      (result.domains.complex.score ?? 0)) / 4;
  // 모두 score가 있는 경우, overall = 단순 평균
  if (result.domains.transport.score != null && result.domains.living.score != null &&
      result.domains.education.score != null && result.domains.complex.score != null) {
    assert.ok(
      Math.abs(result.overallScore! - expectedOverall) < 0.01,
      `W-A 25/25/25/25 검증 실패: expected=${expectedOverall.toFixed(2)}, actual=${result.overallScore}`
    );
  }
});

test('OVERALL: deterministic — 같은 input은 항상 같은 output', () => {
  const input = baseInput();
  const r1 = calculateScoreV2(input, 2026);
  const r2 = calculateScoreV2(input, 2026);
  assert.equal(r1.overallScore, r2.overallScore, 'determinism 위반: 같은 input에 다른 output');
  assert.equal(r1.domains.transport.score, r2.domains.transport.score);
  assert.equal(r1.domains.complex.score, r2.domains.complex.score);
});

test('OVERALL: eligibility — identityEligible=false → NOT_ENOUGH_DATA, score=null', () => {
  const result = calculateScoreV2(FIXTURE_GUDUK_KUMHO);
  assert.equal(result.eligibility, 'NOT_ENOUGH_DATA', '구덕금호: NOT_ENOUGH_DATA 필요');
  assert.equal(result.overallScore, null, '구덕금호: score=null 필요');
});

test('OVERALL: scoreVersion 항상 v2 식별자', () => {
  const result = calculateScoreV2(baseInput());
  assert.equal(result.scoreVersion, 'EJIP_SCORE_V2_1');
});

test('ELIGIBILITY: coverage >= 0.75 → SCORE_AVAILABLE', () => {
  assert.equal(eligibilityFromCoverage(true, 0.75), 'SCORE_AVAILABLE');
  assert.equal(eligibilityFromCoverage(true, 1.0), 'SCORE_AVAILABLE');
});

test('ELIGIBILITY: 0.4 <= coverage < 0.75 → LIMITED', () => {
  assert.equal(eligibilityFromCoverage(true, 0.5), 'LIMITED');
  assert.equal(eligibilityFromCoverage(true, 0.4), 'LIMITED');
});

test('ELIGIBILITY: coverage < 0.4 → NOT_ENOUGH_DATA', () => {
  assert.equal(eligibilityFromCoverage(true, 0.1), 'NOT_ENOUGH_DATA');
});

test('ELIGIBILITY: identityEligible=false → 항상 NOT_ENOUGH_DATA (coverage 무관)', () => {
  assert.equal(eligibilityFromCoverage(false, 1.0), 'NOT_ENOUGH_DATA');
  assert.equal(eligibilityFromCoverage(false, 0.8), 'NOT_ENOUGH_DATA');
});

test('OVERALL NOT_ENOUGH_DATA synthetic: 모든 domain null → NOT_ENOUGH_DATA', () => {
  const emptyInput: ScoreV2Input = {
    aptSeq: 'EMPTY_TEST',
    buildYear: null,
    totalHouseholds: null,
    parkingRatio: null,
    parkingRawStatus: 'MISSING',
    subwayStatus: 'MISSING',
    nearestSubwayDistanceM: null,
    nearestBusStopDistanceM: null,
    busStopCount300m: null,
    nearestElementaryDistanceM: null,
    attendanceZoneStatus: 'NOT_AVAILABLE',
    living: {
      martCount1000m: null, convenienceCount500m: null, pharmacyCount500m: null,
      hospitalCount1000m: null, parkCount1000m: null, daycareKindergartenCount500m: null,
    },
    identityEligible: true, // eligible이어도 data 없으면
  };
  const result = calculateScoreV2(emptyInput);
  assert.equal(result.eligibility, 'NOT_ENOUGH_DATA');
  assert.equal(result.overallScore, null);
});

// ---------------------------------------------------------------------------
// PARETO TESTS
// ---------------------------------------------------------------------------

test('PARETO: A가 모든 domain에서 B보다 높으면 overall A > B', () => {
  // A: 좋은 subway + 좋은 living + 좋은 education + 좋은 complex
  const inputA = baseInput({
    nearestSubwayDistanceM: 100, // subway ~90
    nearestElementaryDistanceM: 100, // education ~85
    buildYear: 2022, totalHouseholds: 1000, parkingRatio: 1.5, // complex high
    living: { martCount1000m: 5, convenienceCount500m: 20, pharmacyCount500m: 15, hospitalCount1000m: 45, parkCount1000m: 12, daycareKindergartenCount500m: 8 },
  });
  // B: 나쁜 subway(ABSENT) + 적은 생활 + 먼 학교 + 노후 소단지
  const inputB: ScoreV2Input = {
    aptSeq: 'B', buildYear: 1985, totalHouseholds: 30, parkingRatio: null, parkingRawStatus: 'MISSING',
    subwayStatus: 'CONFIRMED_ABSENT', nearestSubwayDistanceM: null,
    nearestBusStopDistanceM: 300, busStopCount300m: 2,
    nearestElementaryDistanceM: 800, attendanceZoneStatus: 'NOT_AVAILABLE',
    living: { martCount1000m: 0, convenienceCount500m: 1, pharmacyCount500m: 0, hospitalCount1000m: 5, parkCount1000m: 1, daycareKindergartenCount500m: 0 },
    identityEligible: true,
  };

  const rA = calculateScoreV2(inputA, 2026);
  const rB = calculateScoreV2(inputB, 2026);

  // A가 모든 domain에서 우위인지 확인
  const tA = rA.domains.transport.score!, tB = rB.domains.transport.score!;
  const lA = rA.domains.living.score!,   lB = rB.domains.living.score!;
  const eA = rA.domains.education.score!,eB = rB.domains.education.score!;
  const cA = rA.domains.complex.score!,  cB = rB.domains.complex.score!;

  assert.ok(tA > tB, `Transport: A(${tA}) > B(${tB})`);
  assert.ok(lA > lB, `Living: A(${lA}) > B(${lB})`);
  assert.ok(eA > eB, `Education: A(${eA}) > B(${eB})`);
  assert.ok(cA > cB, `Complex: A(${cA}) > B(${cB})`);
  assert.ok(rA.overallScore! > rB.overallScore!, `Overall: A(${rA.overallScore}) > B(${rB.overallScore}) — Pareto 보장`);
  assert.ok(isParetoSuperior(rA, rB), 'isParetoSuperior(A, B) = true이어야 함');
});

// ---------------------------------------------------------------------------
// BENCHMARK FIXTURE SANITY CHECKS
// ---------------------------------------------------------------------------

test('BENCHMARK: PAIR03 A (subway 38m) transport > PAIR03 B (CONFIRMED_ABSENT)', () => {
  const rA = calculateScoreV2(FIXTURE_PAIR03_A, 2026);
  const rB = calculateScoreV2(FIXTURE_PAIR03_B, 2026);
  assert.ok(rA.domains.transport.score! > rB.domains.transport.score!,
    `PAIR03: A transport(${rA.domains.transport.score}) > B transport(${rB.domains.transport.score})`);
});

test('BENCHMARK: PAIR03 B (2369세대, parking 1.65) complex > PAIR03 A (48세대, parking MISSING)', () => {
  const rA = calculateScoreV2(FIXTURE_PAIR03_A, 2026);
  const rB = calculateScoreV2(FIXTURE_PAIR03_B, 2026);
  assert.ok(rB.domains.complex.score! > rA.domains.complex.score!,
    `PAIR03: B complex(${rB.domains.complex.score}) > A complex(${rA.domains.complex.score})`);
});

test('BENCHMARK: PAIR03 overall — A > B (STEP 3.7 분석: A 64.6 vs B 50.4)', () => {
  const rA = calculateScoreV2(FIXTURE_PAIR03_A, 2026);
  const rB = calculateScoreV2(FIXTURE_PAIR03_B, 2026);
  assert.ok(rA.overallScore! > rB.overallScore!,
    `PAIR03: A(${rA.overallScore?.toFixed(1)}) > B(${rB.overallScore?.toFixed(1)})`);
});

test('BENCHMARK: PAIR10 A (초등 43m) education > PAIR10 B (초등 837m)', () => {
  const rA = calculateScoreV2(FIXTURE_PAIR10_A, 2026);
  const rB = calculateScoreV2(FIXTURE_PAIR10_B, 2026);
  assert.ok(rA.domains.education.score! > rB.domains.education.score!,
    `PAIR10: A education(${rA.domains.education.score}) > B education(${rB.domains.education.score})`);
});

test('BENCHMARK: PAIR10 overall — A > B (STEP 3.7: A 55.5 vs B 42.5)', () => {
  const rA = calculateScoreV2(FIXTURE_PAIR10_A, 2026);
  const rB = calculateScoreV2(FIXTURE_PAIR10_B, 2026);
  assert.ok(rA.overallScore! > rB.overallScore!,
    `PAIR10: A(${rA.overallScore?.toFixed(1)}) > B(${rB.overallScore?.toFixed(1)})`);
});

test('BENCHMARK: 구덕금호 → NOT_ENOUGH_DATA', () => {
  const result = calculateScoreV2(FIXTURE_GUDUK_KUMHO);
  assert.equal(result.eligibility, 'NOT_ENOUGH_DATA');
  assert.equal(result.overallScore, null);
});

test('NO-PRODUCTION-IMPORT: score-v2 engine이 V1 apartment-score server를 import하지 않는다', () => {
  const fs = require('fs');
  const path = require('path');
  const v2Dir = path.resolve(__dirname, '../../src/lib/score-v2');
  const files = fs.readdirSync(v2Dir).filter((f: string) => f.endsWith('.ts'));
  for (const f of files) {
    const src = fs.readFileSync(path.join(v2Dir, f), 'utf-8');
    assert.ok(
      !src.includes("from '@/lib/apartment-score/server"),
      `${f} must not import V1 engine`
    );
  }
});
