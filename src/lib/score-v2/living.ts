/**
 * E-JIP SCORE V2 — Living domain (L-A).
 *
 * L-A composition (STEP 3 §16, STEP 3.7 확인):
 *   convenience 30% / mart 20% / pharmacy 25% / hospital 25%
 *
 * park과 daycare는 evidence로만 기록, L-A score에는 미편입.
 * (park: halfLife=6, daycare: halfLife=3 — evidence로 제공)
 *
 * dense area count 폭증 방지: halfLife 포화 공식 사용.
 * category missing과 count=0을 분리: null = 수집 없음, 0 = 수집했으나 0개.
 */

import type { LivingRawCounts, DomainResult } from './types';
import { livingCountScore, LIVING_CATEGORY_SPECS } from './curves';

// ---------------------------------------------------------------------------
// L-A composition weights
// ---------------------------------------------------------------------------

/**
 * L-A domain composition weights (STEP 3 §16).
 * park(halfLife=6) / daycare(halfLife=3)는 evidence에만 포함.
 */
const LA_WEIGHTS: Partial<Record<keyof LivingRawCounts, number>> = {
  convenienceCount500m: 30,
  martCount1000m: 20,
  pharmacyCount500m: 25,
  hospitalCount1000m: 25,
} as const;

interface WeightedScore {
  key: string;
  weight: number;
  score: number | null;
}

/**
 * Bounded redistribution helper (living 전용).
 * 결측 category의 weight는 present들이 비례 재분배 (흡수상한 40%).
 */
function composeBounded(factors: WeightedScore[]): {
  score: number | null;
  coverage: number;
  usedFactors: string[];
  missingFactors: string[];
} {
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const present = factors.filter((f) => f.score != null);
  const missing = factors.filter((f) => f.score == null);

  if (present.length === 0) {
    return { score: null, coverage: 0, usedFactors: [], missingFactors: factors.map((f) => f.key) };
  }

  const presentWeightSum = present.reduce((s, f) => s + f.weight, 0);
  const missingWeightSum = totalWeight - presentWeightSum;
  const maxAbsorbShare = 0.4;
  const maxRedistributable = presentWeightSum * (maxAbsorbShare / (1 - maxAbsorbShare));
  const redistributed = Math.min(missingWeightSum, maxRedistributable);
  const effectiveWeightSum = presentWeightSum + redistributed;

  const normalizedScore = present.reduce(
    (acc, f) => acc + (f.weight / presentWeightSum) * f.score!,
    0
  );

  return {
    score: normalizedScore,
    coverage: effectiveWeightSum / totalWeight,
    usedFactors: present.map((f) => f.key),
    missingFactors: missing.map((f) => f.key),
  };
}

// ---------------------------------------------------------------------------
// Living domain
// ---------------------------------------------------------------------------

/**
 * Living L-A domain score 계산.
 *
 * 각 category의 factor score를 개별 계산 후 weighted composition.
 * null = 수집 없음 (coverage 하락), 0 = 수집했으나 0개 (score 0 근방).
 * 둘의 처리가 다름: null은 composeBounded에서 결측으로, 0은 livingCountScore(0, h)=0으로.
 */
export function livingDomain(counts: LivingRawCounts): DomainResult {
  // halfLife lookup
  const halfLifeMap = Object.fromEntries(
    LIVING_CATEGORY_SPECS.map((s) => [s.key, s.halfLife])
  ) as Record<keyof LivingRawCounts, number>;

  // Factor scores for L-A composition categories
  const convSc = livingCountScore(counts.convenienceCount500m, halfLifeMap.convenienceCount500m);
  const martSc = livingCountScore(counts.martCount1000m, halfLifeMap.martCount1000m);
  const pharmSc = livingCountScore(counts.pharmacyCount500m, halfLifeMap.pharmacyCount500m);
  const hospSc = livingCountScore(counts.hospitalCount1000m, halfLifeMap.hospitalCount1000m);

  // Evidence-only scores (park, daycare)
  const parkSc = livingCountScore(counts.parkCount1000m, halfLifeMap.parkCount1000m);
  const daycareSc = livingCountScore(counts.daycareKindergartenCount500m, halfLifeMap.daycareKindergartenCount500m);

  // L-A composition: convenience 30 / mart 20 / pharmacy 25 / hospital 25
  const factors: WeightedScore[] = [
    { key: 'convenienceCount500m',  weight: LA_WEIGHTS.convenienceCount500m!,  score: convSc },
    { key: 'martCount1000m',        weight: LA_WEIGHTS.martCount1000m!,        score: martSc },
    { key: 'pharmacyCount500m',     weight: LA_WEIGHTS.pharmacyCount500m!,     score: pharmSc },
    { key: 'hospitalCount1000m',    weight: LA_WEIGHTS.hospitalCount1000m!,    score: hospSc },
  ];

  const result = composeBounded(factors);

  return {
    score: result.score,
    coverage: result.coverage,
    usedFactors: result.usedFactors,
    missingFactors: result.missingFactors,
    evidence: {
      // raw counts
      martCount1000m: counts.martCount1000m,
      convenienceCount500m: counts.convenienceCount500m,
      pharmacyCount500m: counts.pharmacyCount500m,
      hospitalCount1000m: counts.hospitalCount1000m,
      parkCount1000m: counts.parkCount1000m,
      daycareKindergartenCount500m: counts.daycareKindergartenCount500m,
      // factor scores
      martScore: martSc,
      convenienceScore: convSc,
      pharmacyScore: pharmSc,
      hospitalScore: hospSc,
      // evidence-only (not in L-A composition)
      parkScore: parkSc,
      daycareScore: daycareSc,
    },
  };
}
