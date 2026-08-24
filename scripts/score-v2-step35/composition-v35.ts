/**
 * E-JIP SCORE V2 STEP 3.5 §6-8 — parking missing 처리 5개 후보(P-A~E).
 * P-D/P-E는 "parking raw value를 추정"하지 않는다 — KNOWN 모집단에서 이미
 * 관측된 parking FACTOR SCORE(0~100, curve 통과값)의 조건부 평균/보수적
 * 백분위만 "결측 시 대입할 중립값"으로 쓴다. 이 값은 사용자에게 노출되는
 * raw fact가 아니라 total-score 계산 내부에서만 쓰이는 통계적 대체값이다
 * (§8 금지 원칙 — 가짜 raw parking ratio 생성 없음).
 */
import type { WeightedFactor, CompositionResult } from '../score-v2-step2/composition';

function composeConditional(factors: WeightedFactor[], neutralByKey: Record<string, number>, defaultNeutral = 50): CompositionResult {
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const present = factors.filter((f) => f.score != null);
  const missing = factors.filter((f) => f.score == null);
  if (present.length === 0) return { score: null, coverage: 0, usedFactors: [], missingFactors: factors.map((f) => f.key) };
  const score = factors.reduce((acc, f) => acc + (f.weight / totalWeight) * (f.score ?? (neutralByKey[f.key] ?? defaultNeutral)), 0);
  const presentWeightSum = present.reduce((s, f) => s + f.weight, 0);
  return { score, coverage: presentWeightSum / totalWeight, usedFactors: present.map((f) => f.key), missingFactors: missing.map((f) => f.key) };
}

export type ParkingModelId = 'P-A_M3_GLOBAL_NEUTRAL' | 'P-B_M1_BOUNDED_REDIST' | 'P-C_M2_PARTIAL_FIXED' | 'P-D_ERA_CONDITIONED' | 'P-E_SCALE_ERA_CONSERVATIVE';

export interface ParkingConditionalContext {
  eraNeutralByAgeBand: Record<string, number>; // P-D: age-band별 KNOWN 평균 parking factor score
  conservativeByAgeScaleBand: Record<string, number>; // P-E: age+scale band별 KNOWN 25th percentile parking factor score
}

/**
 * complex 3-factor(age/scale/parking) composition을 5개 parking-missing
 * 모델로 각각 계산. age/scale factor 자체의 처리(M1식 bounded redistribution
 * 골격)는 전부 동일 — parking 결측 시의 대입값만 다르다.
 */
export function complexWithParkingModel(
  age: number | null, scale: number | null, parking: number | null,
  model: ParkingModelId, ageBandKey: string, ageScaleBandKey: string,
  ctx: ParkingConditionalContext
): CompositionResult {
  const factors: WeightedFactor[] = [{ key: 'age', weight: 45, score: age }, { key: 'scale', weight: 40, score: scale }, { key: 'parking', weight: 15, score: parking }];
  switch (model) {
    case 'P-A_M3_GLOBAL_NEUTRAL':
      return composeConditional(factors, {}, 50);
    case 'P-B_M1_BOUNDED_REDIST': {
      // M1과 동일 수학(재사용) — 여기서는 별도 import 없이 동일 로직을 직접 재현하지 않고
      // score-v2-step3/composition-v3.ts의 M1을 그대로 쓰는 것이 원칙이나, 5개 모델을
      // 한 표에 나란히 두기 위해 이 파일 내부에서 동일 인터페이스로 호출한다.
      const present = factors.filter((f) => f.score != null);
      const missing = factors.filter((f) => f.score == null);
      if (present.length === 0) return { score: null, coverage: 0, usedFactors: [], missingFactors: factors.map((f) => f.key) };
      const presentWeightSum = present.reduce((s, f) => s + f.weight, 0);
      const totalWeight = 100;
      const missingWeightSum = totalWeight - presentWeightSum;
      const maxRedistributable = presentWeightSum * (0.4 / 0.6);
      const redistributed = Math.min(missingWeightSum, maxRedistributable);
      const effectiveWeightSum = presentWeightSum + redistributed;
      const normalizedScore = present.reduce((acc, f) => acc + (f.weight / presentWeightSum) * f.score!, 0);
      return { score: normalizedScore, coverage: effectiveWeightSum / totalWeight, usedFactors: present.map((f) => f.key), missingFactors: missing.map((f) => f.key) };
    }
    case 'P-C_M2_PARTIAL_FIXED': {
      const present = factors.filter((f) => f.score != null);
      const missing = factors.filter((f) => f.score == null);
      if (present.length === 0) return { score: null, coverage: 0, usedFactors: [], missingFactors: factors.map((f) => f.key) };
      const score = present.reduce((acc, f) => acc + (f.weight / 100) * f.score!, 0);
      const presentWeightSum = present.reduce((s, f) => s + f.weight, 0);
      return { score, coverage: presentWeightSum / 100, usedFactors: present.map((f) => f.key), missingFactors: missing.map((f) => f.key) };
    }
    case 'P-D_ERA_CONDITIONED':
      return composeConditional(factors, { parking: ctx.eraNeutralByAgeBand[ageBandKey] ?? 50 });
    case 'P-E_SCALE_ERA_CONSERVATIVE':
      return composeConditional(factors, { parking: ctx.conservativeByAgeScaleBand[ageScaleBandKey] ?? 40 });
  }
}
