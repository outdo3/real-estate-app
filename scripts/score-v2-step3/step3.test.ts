// E-JIP SCORE V2 STEP 3 §56 — sentinel/eligibility/missing-data/Pareto/weight/
// confidence/determinism 테스트. node:test, DB 없음(순수 함수만).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subwayDistanceScoreV3 } from './curves-v3';
import { composeM1BoundedRedistribution, composeM2PartialFixedDenominator, composeM3NeutralPrior, composeWithStrategy, DOMAIN_WEIGHT_CANDIDATES, composeTotalFromDomains, eligibilityFromCoverage } from './composition-v3';
import type { WeightedFactor } from '../score-v2-step2/composition';

// ---------------- Sentinel states(§3) ----------------
test('SENTINEL: VALUE는 정상 curve 계산', () => {
  const v = subwayDistanceScoreV3(140, 'VALUE', 'A_PIECEWISE_LINEAR');
  assert.ok(v != null && v > 80 && v < 95);
});
test('SENTINEL: CONFIRMED_ABSENT은 curve의 floor 값으로 명시적으로 채점되고 null이 아니다', () => {
  const v = subwayDistanceScoreV3(null, 'CONFIRMED_ABSENT', 'A_PIECEWISE_LINEAR');
  assert.equal(v, 5); // floor
  assert.notEqual(v, null);
});
test('SENTINEL: MISSING/COORD_INSUFFICIENT은 null(재분배 대상, 0점/floor 아님)', () => {
  assert.equal(subwayDistanceScoreV3(null, 'MISSING', 'A_PIECEWISE_LINEAR'), null);
  assert.equal(subwayDistanceScoreV3(null, 'COORD_INSUFFICIENT', 'A_PIECEWISE_LINEAR'), null);
});
test('SENTINEL: CONFIRMED_ABSENT < 모든 실측 VALUE(가장 먼 999m보다도 낮음)', () => {
  const absent = subwayDistanceScoreV3(null, 'CONFIRMED_ABSENT', 'A_PIECEWISE_LINEAR')!;
  const farValue = subwayDistanceScoreV3(999, 'VALUE', 'A_PIECEWISE_LINEAR')!;
  assert.ok(absent <= farValue);
});

// ---------------- Missing-data strategies(§10) ----------------
const threeFactors: WeightedFactor[] = [{ key: 'a', weight: 50, score: 80 }, { key: 'b', weight: 30, score: null }, { key: 'c', weight: 20, score: 60 }];

test('MISSING-DATA: M1(bounded redistribution)은 present factor 가중평균, missing은 절대 0으로 취급 안 함', () => {
  const r = composeM1BoundedRedistribution(threeFactors);
  assert.ok(r.score! > 60 && r.score! < 80); // a(80)/c(60) 가중평균 근처
  assert.deepEqual(r.missingFactors, ['b']);
});
test('MISSING-DATA: M2(partial fixed denominator)는 M1보다 항상 같거나 낮은 score(더 보수적)', () => {
  const m1 = composeM1BoundedRedistribution(threeFactors);
  const m2 = composeM2PartialFixedDenominator(threeFactors);
  assert.ok(m2.score! <= m1.score!);
});
test('MISSING-DATA: M3(neutral prior)은 결측을 50으로 대체 — score가 M1/M2 사이 또는 중립값 쪽으로 이동', () => {
  const m3 = composeM3NeutralPrior(threeFactors, 50);
  const allPresent = composeM1BoundedRedistribution([{ key: 'a', weight: 50, score: 80 }, { key: 'b', weight: 30, score: 50 }, { key: 'c', weight: 20, score: 60 }]);
  assert.ok(Math.abs(m3.score! - allPresent.score!) < 0.01); // b를 50으로 채운 것과 수학적으로 동일해야 함
});
test('MISSING-DATA: 전부 결측이면 세 전략 모두 null(fake-zero 금지)', () => {
  const allMissing: WeightedFactor[] = [{ key: 'a', weight: 50, score: null }, { key: 'b', weight: 50, score: null }];
  assert.equal(composeM1BoundedRedistribution(allMissing).score, null);
  assert.equal(composeM2PartialFixedDenominator(allMissing).score, null);
  assert.equal(composeM3NeutralPrior(allMissing).score, null);
});

// ---------------- Weight normalization(§18) ----------------
test('WEIGHT: 4개 domain-weight 후보 전부 합이 100', () => {
  for (const [label, w] of Object.entries(DOMAIN_WEIGHT_CANDIDATES)) {
    const sum = w.transport + w.living + w.education + w.complex;
    assert.equal(sum, 100, `${label} weight sum should be 100, got ${sum}`);
  }
});
test('WEIGHT: composeTotalFromDomains는 4개 domain 전부 존재 시 coverage=1', () => {
  const r = composeTotalFromDomains({ transport: 80, living: 70, education: 60, complex: 50 }, DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED'], 'M1_BOUNDED_REDISTRIBUTION');
  assert.equal(r.coverage, 1);
  assert.ok(r.score! > 50 && r.score! < 80);
});

// ---------------- Pareto dominance(§38-39, 합성 함수 자체의 무결성) ----------------
test('PARETO: 모든 domain에서 동일하거나 우위인 candidate는 total도 동일하거나 우위(가중평균의 수학적 성질)', () => {
  const weights = DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED'];
  const a = composeTotalFromDomains({ transport: 80, living: 70, education: 60, complex: 90 }, weights, 'M1_BOUNDED_REDISTRIBUTION');
  const b = composeTotalFromDomains({ transport: 70, living: 70, education: 60, complex: 90 }, weights, 'M1_BOUNDED_REDISTRIBUTION');
  assert.ok(a.score! >= b.score!); // a가 b를 transport에서만 우위, 나머지 동일 -> a total도 >= b
});

// ---------------- Score eligibility(§21) ----------------
test('ELIGIBILITY: identity 신뢰 불가(DISPLAY_ONLY 이하)면 coverage와 무관하게 NOT_ENOUGH_DATA(구덕금호 정책)', () => {
  assert.equal(eligibilityFromCoverage(false, 1.0), 'NOT_ENOUGH_DATA');
});
test('ELIGIBILITY: identity 신뢰 가능 + coverage>=0.75 -> SCORE_AVAILABLE', () => {
  assert.equal(eligibilityFromCoverage(true, 0.75), 'SCORE_AVAILABLE');
  assert.equal(eligibilityFromCoverage(true, 1.0), 'SCORE_AVAILABLE');
});
test('ELIGIBILITY: identity 신뢰 가능 + 0.4<=coverage<0.75 -> LIMITED', () => {
  assert.equal(eligibilityFromCoverage(true, 0.4), 'LIMITED');
  assert.equal(eligibilityFromCoverage(true, 0.74), 'LIMITED');
});
test('ELIGIBILITY: identity 신뢰 가능이라도 coverage<0.4 -> NOT_ENOUGH_DATA', () => {
  assert.equal(eligibilityFromCoverage(true, 0.39), 'NOT_ENOUGH_DATA');
  assert.equal(eligibilityFromCoverage(true, 0), 'NOT_ENOUGH_DATA');
});

// ---------------- Confidence(§43) ----------------
test('CONFIDENCE: coverage가 낮은 결과가 coverage=1인 결과와 동일한 신뢰도로 보이지 않는다(coverage 필드로 구분 가능)', () => {
  const full = composeTotalFromDomains({ transport: 80, living: 70, education: 60, complex: 90 }, DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED'], 'M1_BOUNDED_REDISTRIBUTION');
  const partial = composeTotalFromDomains({ transport: 80, living: null, education: null, complex: 90 }, DOMAIN_WEIGHT_CANDIDATES['W-A_BALANCED'], 'M1_BOUNDED_REDISTRIBUTION');
  assert.equal(full.coverage, 1);
  assert.ok(partial.coverage < full.coverage);
});

// ---------------- Determinism(§56) ----------------
test('DETERMINISM: 동일 입력 -> 동일 출력(모든 missing-data 전략)', () => {
  for (const strategy of ['M1_BOUNDED_REDISTRIBUTION', 'M2_PARTIAL_FIXED_DENOMINATOR', 'M3_NEUTRAL_PRIOR'] as const) {
    const a = composeWithStrategy(threeFactors, strategy);
    const b = composeWithStrategy(threeFactors, strategy);
    assert.deepEqual(a, b);
  }
});

// ---------------- No production imports(§56) ----------------
test('NO-PRODUCTION-IMPORT: STEP3 소스가 production score engine(src/lib/apartment-score/server)을 import하지 않는다', () => {
  const fs = require('fs');
  const path = require('path');
  const files = ['curves-v3.ts', 'composition-v3.ts', 'shared-loader.ts', 'step3-01-full-shadow.ts', 'step3-02-benchmark41.ts', 'step3-03-pairwise-blind-review.ts', 'step3-04-sensitivity-and-counterexamples.ts'];
  for (const f of files) {
    const src = fs.readFileSync(path.resolve(__dirname, f), 'utf-8');
    assert.ok(!src.includes("from '@/lib/apartment-score/server"), `${f} must not import production score engine`);
    assert.ok(!src.includes("from '../../src/lib/apartment-score/server"), `${f} must not import production score engine(relative)`);
  }
});
