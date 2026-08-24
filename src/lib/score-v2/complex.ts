/**
 * E-JIP SCORE V2 — Complex domain (C3 + P-D parking missing).
 *
 * Complex = Age 45% + Scale 40% + Parking 15% (C3 composition, STEP 3.7 확인).
 *
 * Parking missing 처리 = P-D era-conditioned neutral prior (STEP 3.5 §6-8):
 * - KNOWN: 실제 parkingScore(ratio) 사용.
 * - MISSING: ageBand별 KNOWN 단지의 parking factor score 평균으로 대체.
 *   raw parking ratio를 생성하지 않는다 — factor score 내부 대체값이다.
 *
 * P-D era neutral (STEP 3.5 step35.test.ts ctx 상수 — DB 실측값):
 *   '0-10' → 65, '11-20' → 68, '21-30' → 53, '31+' → 22
 *
 * 중요:
 * - parking = 0 / parking = 추정 1.0 / parking = 시대 평균값(raw)으로 채우는 것 금지.
 * - P-D는 factor score(0~100) 공간에서만 동작한다.
 * - coverage: parking MISSING이면 parking weight(15)은 coverage 손실로 표시.
 */

import type { ParkingRawStatus, DomainResult } from './types';
import { PARKING_ERA_NEUTRAL, type ParkingEraBand } from './types';
import { ageScore, scaleScore, parkingScore, buildYearToAge } from './curves';

// ---------------------------------------------------------------------------
// Complex domain input
// ---------------------------------------------------------------------------

export interface ComplexInput {
  buildYear: number | null;
  totalHouseholds: number | null;
  parkingRatio: number | null;       // raw ratio (KNOWN이면 실제값, MISSING이면 null)
  parkingRawStatus: ParkingRawStatus;
}

// ---------------------------------------------------------------------------
// Age band helper (STEP 3.5 §6)
// ---------------------------------------------------------------------------

/** 연식을 P-D era band 키로 변환. */
export function ageToBand(ageYears: number | null): ParkingEraBand {
  if (ageYears == null) return '21-30'; // 연식 미상이면 중간 band (coverage 감소됨)
  if (ageYears <= 10) return '0-10';
  if (ageYears <= 20) return '11-20';
  if (ageYears <= 30) return '21-30';
  return '31+';
}

// ---------------------------------------------------------------------------
// Complex domain
// ---------------------------------------------------------------------------

/**
 * Complex domain score 계산 (C3 + P-D).
 *
 * composition: age 45% / scale 40% / parking 15%
 *
 * parking MISSING 처리 (P-D):
 *   parking factor score를 ageBand별 era neutral로 대체.
 *   coverage에는 parking(15)을 반영하지 않는다 (coverage 손실로 기록).
 *   missingFactors에 'parking'이 여전히 포함됨 = "결측 사실을 숨기지 않는다".
 *
 * parking KNOWN 처리:
 *   parkingScore(ratio) 실제값 사용. era neutral 미개입.
 */
export function complexDomain(input: ComplexInput, referenceYear = 2026): DomainResult {
  // age
  const ageYears = input.buildYear != null ? buildYearToAge(input.buildYear, referenceYear) : null;
  const ageSc = ageScore(ageYears);

  // scale
  const scaleSc = scaleScore(input.totalHouseholds);

  // parking
  const parkingKnown = input.parkingRawStatus === 'KNOWN';
  const parkingSc = parkingKnown
    ? parkingScore(input.parkingRatio) // KNOWN: 실제 ratio curve
    : null;                            // MISSING: raw score=null (P-D treatment 별도)

  // P-D: parking MISSING 시 era neutral을 composition 내부에서 대체값으로 사용.
  // raw parkingRatio는 절대 채우지 않는다 — factor score 수준에서만 대체.
  const eraBand = ageToBand(ageYears);
  const parkingForComposition: number | null = parkingKnown
    ? parkingSc                        // KNOWN
    : PARKING_ERA_NEUTRAL[eraBand];    // MISSING → era neutral (P-D)

  // C3 composition: age 45 / scale 40 / parking 15
  // P-D를 사용하더라도 parking은 missingFactors에 유지 (coverage 손실 유지)
  const factors = [
    { key: 'age',     weight: 45, score: ageSc },
    { key: 'scale',   weight: 40, score: scaleSc },
    // parking: KNOWN이면 실제, MISSING이면 era neutral을 score로 넣되
    // coverage 계산용으로는 null을 유지 → 아래에서 별도 처리
    { key: 'parking', weight: 15, score: parkingForComposition },
  ];

  // Coverage 계산: parking MISSING이면 coverage에 parking weight 제외
  const totalWeight = 100;
  const presentForCoverage = [
    { key: 'age',     weight: 45, score: ageSc },
    { key: 'scale',   weight: 40, score: scaleSc },
    // parking MISSING이면 coverage 계산에서 제외 (P-D가 score를 채워도 "결측" 사실 유지)
    { key: 'parking', weight: 15, score: parkingKnown ? parkingSc : null },
  ];

  const presentForCoverageCases = presentForCoverage.filter((f) => f.score != null);
  const allFactorsForCoverage = presentForCoverage;
  const presentWeightSum = presentForCoverageCases.reduce((s, f) => s + f.weight, 0);
  const missingWeightSum = totalWeight - presentWeightSum;
  const maxAbsorbShare = 0.4;
  const maxRedistributable = presentWeightSum * (maxAbsorbShare / (1 - maxAbsorbShare));
  const redistributed = Math.min(missingWeightSum, maxRedistributable);
  const effectiveWeightSum = presentWeightSum + redistributed;
  const coverageValue = effectiveWeightSum / totalWeight;

  // score: parking이 MISSING이면 P-D era neutral을 composition에 포함해 계산
  const presentForScore = factors.filter((f) => f.score != null);
  const usedFactors = presentForScore.map((f) => f.key);
  const missingFactors = allFactorsForCoverage
    .filter((f) => f.score == null)
    .map((f) => f.key);

  let domainScore: number | null = null;
  if (coverageValue === 0) {
    presentForScore.length = 0;
  }
  if (presentForScore.length > 0) {
    const presentWeightSumForScore = presentForScore.reduce((s, f) => s + f.weight, 0);
    domainScore = presentForScore.reduce(
      (acc, f) => acc + (f.weight / presentWeightSumForScore) * f.score!,
      0
    );
  }

  return {
    score: domainScore,
    coverage: coverageValue,
    usedFactors,
    missingFactors,
    evidence: {
      // raw input
      buildYear: input.buildYear,
      ageYears,
      totalHouseholds: input.totalHouseholds,
      parkingRawStatus: input.parkingRawStatus,
      // raw parking ratio — KNOWN이면 실제값, MISSING이면 null 그대로 기록
      parkingRatio: input.parkingRatio,
      // factor scores
      ageScore: ageSc,
      scaleScore: scaleSc,
      parkingScore: parkingSc, // KNOWN이면 curve 결과, MISSING이면 null
      // P-D treatment
      parkingModelTreatment: parkingKnown ? 'KNOWN_VALUE' : 'P-D_ERA_CONDITIONED',
      parkingEraBand: eraBand,
      parkingEraNeutralUsed: parkingKnown ? null : PARKING_ERA_NEUTRAL[eraBand],
    },
  };
}
