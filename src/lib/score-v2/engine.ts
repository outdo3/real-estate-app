/**
 * E-JIP SCORE V2 — Core engine entry point.
 *
 * Frozen candidate (STEP 3.7, FINAL_CANDIDATE_FROZEN=YES):
 *   Transport = T1 (Subway 70% + Bus 30%, sentinel-aware)
 *   Parking Missing = P-D (era-conditioned neutral prior)
 *   Education = E-A (elementary 100%)
 *   Living = L-A (convenience 30 / mart 20 / pharmacy 25 / hospital 25)
 *   Weight = W-A (Transport 25% / Living 25% / Education 25% / Complex 25%)
 *
 * 설계 원칙:
 * - O(1) per apartment: 전체 단지 scan 없음.
 * - Deterministic: 같은 input → 같은 output (locale/time/ordering 독립).
 * - DB 접근 없음: raw facts를 input으로 받는다 (호출부가 DB에서 공급).
 * - Relative percentile 계산 없음: 호출부가 relativeContext를 공급.
 *
 * V1 engine (src/lib/apartment-score/server/calculate.ts)을 수정하지 않는다.
 */

import type { ScoreV2Input, ScoreV2Result, DomainResult } from './types';
import { SCORE_V2_VERSION } from './types';
import { transportDomain } from './transport';
import { livingDomain } from './living';
import { educationDomain } from './education';
import { complexDomain } from './complex';
import { eligibilityFromCoverage } from './eligibility';

// ---------------------------------------------------------------------------
// W-A: domain weights (STEP 3.7 역산 확인: 25/25/25/25 등가 가중치)
// ---------------------------------------------------------------------------

const DOMAIN_WEIGHTS = {
  transport: 25,
  living: 25,
  education: 25,
  complex: 25,
} as const;

const TOTAL_DOMAIN_WEIGHT = 100; // sum(DOMAIN_WEIGHTS)

// ---------------------------------------------------------------------------
// Internal: domain-level bounded redistribution (W-A)
// ---------------------------------------------------------------------------

interface DomainScore {
  key: keyof typeof DOMAIN_WEIGHTS;
  weight: number;
  score: number | null;
}

/**
 * Domain-level W-A composition.
 * 결측 domain의 weight를 present domain들이 bounded redistribution.
 * (흡수 상한 40% — STEP 2 §18-B와 동일 정책)
 */
function composeDomains(domains: DomainScore[]): {
  score: number | null;
  coverage: number;
} {
  const present = domains.filter((d) => d.score != null);
  const totalWeight = domains.reduce((s, d) => s + d.weight, 0);

  if (present.length === 0) return { score: null, coverage: 0 };

  const presentWeightSum = present.reduce((s, d) => s + d.weight, 0);
  const missingWeightSum = totalWeight - presentWeightSum;
  const maxAbsorbShare = 0.4;
  const maxRedistributable = presentWeightSum * (maxAbsorbShare / (1 - maxAbsorbShare));
  const redistributed = Math.min(missingWeightSum, maxRedistributable);
  const effectiveWeightSum = presentWeightSum + redistributed;

  const score = present.reduce(
    (acc, d) => acc + (d.weight / presentWeightSum) * d.score!,
    0
  );

  return {
    score,
    coverage: effectiveWeightSum / totalWeight,
  };
}

// ---------------------------------------------------------------------------
// V2 Score Engine
// ---------------------------------------------------------------------------

/**
 * V2 Core Score engine 진입점.
 *
 * 순수 함수: input → output. DB write 없음, API 호출 없음.
 *
 * @param input - raw facts (DB에서 읽어 호출부가 제공)
 * @param referenceYear - 연식 계산 기준년도. 기본값 2026. determinism 보장.
 * @returns ScoreV2Result
 */
export function calculateScoreV2(
  input: ScoreV2Input,
  referenceYear = 2026
): ScoreV2Result {
  // identityEligible=false → 즉시 NOT_ENOUGH_DATA
  if (!input.identityEligible) {
    const emptyDomain: DomainResult = {
      score: null,
      coverage: 0,
      usedFactors: [],
      missingFactors: [],
      evidence: { reason: 'IDENTITY_NOT_ELIGIBLE' },
    };
    return {
      scoreVersion: SCORE_V2_VERSION,
      eligibility: 'NOT_ENOUGH_DATA',
      overallScore: null,
      domains: {
        transport: emptyDomain,
        living: emptyDomain,
        education: emptyDomain,
        complex: emptyDomain,
      },
      overallCoverage: 0,
      relativeContext: null,
      missingReasons: ['IDENTITY_NOT_ELIGIBLE'],
    };
  }

  // ---- Domain 계산 ----
  const transportResult = transportDomain({
    subwayStatus: input.subwayStatus,
    nearestSubwayDistanceM: input.nearestSubwayDistanceM,
    nearestBusStopDistanceM: input.nearestBusStopDistanceM,
    busStopCount300m: input.busStopCount300m,
  });

  const livingResult = livingDomain(input.living);

  const educationResult = educationDomain({
    nearestElementaryDistanceM: input.nearestElementaryDistanceM,
    attendanceZoneStatus: input.attendanceZoneStatus,
  });

  const complexResult = complexDomain(
    {
      buildYear: input.buildYear,
      totalHouseholds: input.totalHouseholds,
      parkingRatio: input.parkingRatio,
      parkingRawStatus: input.parkingRawStatus,
    },
    referenceYear
  );

  // ---- W-A 종합점수 (25/25/25/25) ----
  const domainScores: DomainScore[] = [
    { key: 'transport',  weight: DOMAIN_WEIGHTS.transport,  score: transportResult.score },
    { key: 'living',     weight: DOMAIN_WEIGHTS.living,     score: livingResult.score },
    { key: 'education',  weight: DOMAIN_WEIGHTS.education,  score: educationResult.score },
    { key: 'complex',    weight: DOMAIN_WEIGHTS.complex,    score: complexResult.score },
  ];

  const { score: overallScore, coverage: overallCoverage } = composeDomains(domainScores);

  // ---- Eligibility ----
  const eligibility = eligibilityFromCoverage(input.identityEligible, overallCoverage);

  // ---- Missing reasons ----
  const missingReasons: string[] = [];
  if (transportResult.score == null) missingReasons.push('TRANSPORT_MISSING');
  if (livingResult.score == null) missingReasons.push('LIVING_MISSING');
  if (educationResult.score == null) missingReasons.push('EDUCATION_MISSING');
  if (complexResult.score == null) missingReasons.push('COMPLEX_MISSING');
  // domain별 내부 결측 factor 기록
  for (const f of transportResult.missingFactors) missingReasons.push(`transport.${f}_MISSING`);
  for (const f of complexResult.missingFactors) missingReasons.push(`complex.${f}_MISSING`);

  return {
    scoreVersion: SCORE_V2_VERSION,
    eligibility,
    overallScore: eligibility !== 'NOT_ENOUGH_DATA' ? overallScore : null,
    domains: {
      transport: transportResult,
      living: livingResult,
      education: educationResult,
      complex: complexResult,
    },
    overallCoverage,
    relativeContext: null, // 호출부가 공급 (engine 책임 아님)
    missingReasons,
  };
}

/**
 * 두 단지의 V2 score를 비교해 Pareto dominance를 확인한다.
 * 모든 domain에서 A >= B이고 적어도 하나에서 A > B이면 true.
 * test 유틸리티 — production flow에서는 사용하지 않는다.
 */
export function isParetoSuperior(a: ScoreV2Result, b: ScoreV2Result): boolean {
  const domains = ['transport', 'living', 'education', 'complex'] as const;
  const allGte = domains.every((d) => {
    const sa = a.domains[d].score;
    const sb = b.domains[d].score;
    if (sa == null || sb == null) return false; // 결측이면 Pareto 판정 불가
    return sa >= sb;
  });
  const anyGt = domains.some((d) => {
    const sa = a.domains[d].score;
    const sb = b.domains[d].score;
    if (sa == null || sb == null) return false;
    return sa > sb;
  });
  return allGte && anyGt;
}
