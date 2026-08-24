/**
 * E-JIP SCORE V2 STEP 3 §5,8,10,13,16,18 — domain composition 후보 확장 +
 * missing-data 전략 3종 비교 + domain weight 후보. STEP2 `composition.ts`의
 * `WeightedFactor`/`CompositionResult` 타입과 `composeBoundedRedistribution`을
 * 그대로 재사용(M1 = 그 함수 자체)한다 — 중복 재구현 금지.
 */
import { type WeightedFactor, type CompositionResult, composeBoundedRedistribution, type LivingScores } from '../score-v2-step2/composition';

// ---------------------------------------------------------------------------
// §10 Missing-data 전략 3종
// ---------------------------------------------------------------------------

/** M1: bounded redistribution(STEP2 그대로) — present factor끼리 재정규화,
 * coverage만 흡수상한(40%)으로 제한. */
export function composeM1BoundedRedistribution(factors: WeightedFactor[]): CompositionResult {
  return composeBoundedRedistribution(factors, 0.4);
}

/** M2: partial weighted score + coverage — 분모(totalWeight)를 절대 줄이지
 * 않는다. 결측 factor는 그냥 0을 기여(재분배 없음), coverage만 별도 표시.
 * present factor가 아무리 좋아도 결측이 있으면 총점이 절대 100%를 채울 수
 * 없다 — 가장 보수적(결측에 대해 가장 엄격한) 전략. */
export function composeM2PartialFixedDenominator(factors: WeightedFactor[]): CompositionResult {
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const present = factors.filter((f) => f.score != null);
  const missing = factors.filter((f) => f.score == null);
  if (present.length === 0) return { score: null, coverage: 0, usedFactors: [], missingFactors: factors.map((f) => f.key) };
  const score = present.reduce((acc, f) => acc + (f.weight / totalWeight) * f.score!, 0);
  const presentWeightSum = present.reduce((s, f) => s + f.weight, 0);
  return { score, coverage: presentWeightSum / totalWeight, usedFactors: present.map((f) => f.key), missingFactors: missing.map((f) => f.key) };
}

/** M3: neutral prior + confidence reduction — 결측 factor에 "중립값"(50,
 * curve의 floor/ceil 중간)을 대입해 분모를 그대로 채우되, 결측 자체가
 * 점수를 올리지도 내리지도 않게 한다. 대신 coverage(=confidence 신호)만
 * 낮춘다 — 점수와 신뢰도를 분리하는 §11 철학을 missing-data 전략에도 그대로
 * 적용한 버전. */
export function composeM3NeutralPrior(factors: WeightedFactor[], neutralValue = 50): CompositionResult {
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const present = factors.filter((f) => f.score != null);
  const missing = factors.filter((f) => f.score == null);
  if (present.length === 0) return { score: null, coverage: 0, usedFactors: [], missingFactors: factors.map((f) => f.key) };
  const score = factors.reduce((acc, f) => acc + (f.weight / totalWeight) * (f.score ?? neutralValue), 0);
  const presentWeightSum = present.reduce((s, f) => s + f.weight, 0);
  return { score, coverage: presentWeightSum / totalWeight, usedFactors: present.map((f) => f.key), missingFactors: missing.map((f) => f.key) };
}

export type MissingDataStrategy = 'M1_BOUNDED_REDISTRIBUTION' | 'M2_PARTIAL_FIXED_DENOMINATOR' | 'M3_NEUTRAL_PRIOR';
export function composeWithStrategy(factors: WeightedFactor[], strategy: MissingDataStrategy): CompositionResult {
  switch (strategy) {
    case 'M1_BOUNDED_REDISTRIBUTION': return composeM1BoundedRedistribution(factors);
    case 'M2_PARTIAL_FIXED_DENOMINATOR': return composeM2PartialFixedDenominator(factors);
    case 'M3_NEUTRAL_PRIOR': return composeM3NeutralPrior(factors);
  }
}

// ---------------------------------------------------------------------------
// §5 TRANSPORT composition candidates — subway:bus 비율만 다른 3후보
// ---------------------------------------------------------------------------
export function transportComposeCandidate(subway: number | null, bus: number | null, subwayWeight: number, strategy: MissingDataStrategy): CompositionResult {
  return composeWithStrategy([{ key: 'subway', weight: subwayWeight, score: subway }, { key: 'bus', weight: 100 - subwayWeight, score: bus }], strategy);
}
export const T1_70_30 = (subway: number | null, bus: number | null, strategy: MissingDataStrategy) => transportComposeCandidate(subway, bus, 70, strategy);
export const T2_75_25 = (subway: number | null, bus: number | null, strategy: MissingDataStrategy) => transportComposeCandidate(subway, bus, 75, strategy);
export const T3_80_20 = (subway: number | null, bus: number | null, strategy: MissingDataStrategy) => transportComposeCandidate(subway, bus, 80, strategy);

// ---------------------------------------------------------------------------
// §8 COMPLEX composition candidates
// ---------------------------------------------------------------------------
export function complexComposeCA(age: number | null, scale: number | null, parking: number | null, strategy: MissingDataStrategy): CompositionResult {
  // C-A: Age dominant / Scale secondary / Parking conservative(가장 낮은 weight)
  return composeWithStrategy([{ key: 'age', weight: 55, score: age }, { key: 'scale', weight: 30, score: scale }, { key: 'parking', weight: 15, score: parking }], strategy);
}
export function complexComposeCB(age: number | null, scale: number | null, parking: number | null, strategy: MissingDataStrategy): CompositionResult {
  // C-B: Age + Scale 균형 / Parking conservative
  return composeWithStrategy([{ key: 'age', weight: 42, score: age }, { key: 'scale', weight: 42, score: scale }, { key: 'parking', weight: 16, score: parking }], strategy);
}
export function complexComposeCC(age: number | null, scale: number | null, parking: number | null, strategy: MissingDataStrategy): CompositionResult {
  // C-C: STEP2 C3 그대로(Age45/Scale40/Parking15)
  return composeWithStrategy([{ key: 'age', weight: 45, score: age }, { key: 'scale', weight: 40, score: scale }, { key: 'parking', weight: 15, score: parking }], strategy);
}

// ---------------------------------------------------------------------------
// §13 EDUCATION composition candidates(STEP2 E-A/B/C를 strategy-parametrized로 재구성)
// ---------------------------------------------------------------------------
export function educationComposeEA(elementary: number | null, kindergarten: number | null, strategy: MissingDataStrategy): CompositionResult {
  return composeWithStrategy([{ key: 'elementary', weight: 80, score: elementary }, { key: 'kindergarten', weight: 20, score: kindergarten }], strategy);
}
export function educationComposeEB(elementary: number | null, kindergarten: number | null, strategy: MissingDataStrategy): CompositionResult {
  // E-B: Elementary + Kindergarten 강화(§13 "kindergarten 강화") — kindergarten 비중을 EA보다 더 키움
  return composeWithStrategy([{ key: 'elementary', weight: 55, score: elementary }, { key: 'kindergarten', weight: 45, score: kindergarten }], strategy);
}
export function educationComposeEC(elementary: number | null, strategy: MissingDataStrategy): CompositionResult {
  return composeWithStrategy([{ key: 'elementary', weight: 100, score: elementary }], strategy);
}

// ---------------------------------------------------------------------------
// §16 LIVING composition candidates(spec 명명 L-A/L-B/L-C에 맞춰 재정의)
// ---------------------------------------------------------------------------
export function livingComposeLA(s: LivingScores, strategy: MissingDataStrategy): CompositionResult {
  // L-A: Daily + Medical 중심(STEP2 L1과 동일 철학)
  return composeWithStrategy([
    { key: 'convenience', weight: 30, score: s.convenience }, { key: 'mart', weight: 20, score: s.mart },
    { key: 'pharmacy', weight: 25, score: s.pharmacy }, { key: 'hospital', weight: 25, score: s.hospital },
  ], strategy);
}
export function livingComposeLB(s: LivingScores, strategy: MissingDataStrategy): CompositionResult {
  // L-B: Essential 중심(mart+convenience를 §17 상관 0.75 감안해 하나의 "일상편의"
  // 축으로 합쳐 40%만 배정 — 중복가중 완화), pharmacy/hospital은 별도 유지.
  const dailyConvenience = s.mart != null && s.convenience != null ? (s.mart + s.convenience) / 2 : (s.mart ?? s.convenience);
  return composeWithStrategy([
    { key: 'dailyConvenience', weight: 40, score: dailyConvenience }, { key: 'pharmacy', weight: 25, score: s.pharmacy }, { key: 'hospital', weight: 35, score: s.hospital },
  ], strategy);
}
export function livingComposeLC(s: LivingScores, strategy: MissingDataStrategy): CompositionResult {
  // L-C: Daily/Medical/Shopping 다축 — mart를 "쇼핑"으로 분리 유지한 균형형(STEP2 L2와 유사)
  return composeWithStrategy([
    { key: 'mart', weight: 20, score: s.mart }, { key: 'convenience', weight: 20, score: s.convenience },
    { key: 'pharmacy', weight: 15, score: s.pharmacy }, { key: 'hospital', weight: 20, score: s.hospital },
    { key: 'park', weight: 20, score: s.park }, { key: 'daycare', weight: 5, score: s.daycare },
  ], strategy);
}

// ---------------------------------------------------------------------------
// §18 Domain weight candidates(Total = w_T*Transport + w_L*Living + w_E*Education + w_C*Complex)
// ---------------------------------------------------------------------------
export interface DomainWeights { transport: number; living: number; education: number; complex: number }
export const DOMAIN_WEIGHT_CANDIDATES: Record<string, DomainWeights> = {
  'W-A_BALANCED': { transport: 25, living: 25, education: 25, complex: 25 },
  'W-B_LOCATION': { transport: 30, living: 25, education: 20, complex: 25 },
  'W-C_RESIDENTIAL': { transport: 25, living: 20, education: 20, complex: 35 },
  // W-D: factor reliability(coverage) 기반 — STEP2/STEP3 실측 coverage:
  // transport 83.3%(subway 실값 기준으로는 더 낮지만 sentinel 도입 후 거의 100%
  // 커버), living 83.3%(transport-eligible과 동일 모집단), education 82.8%,
  // complex는 age 100%+scale 74.8%+parking 25.3% 혼재라 도메인 내부 coverage가
  // 가장 불균질 — 가장 신뢰도 높은(=coverage 높고 sentinel로 안전화된) 도메인인
  // Transport에 근소 우위, 가장 불균질한 Complex는 근소 열위를 줘 "데이터가
  // 부족한 도메인에 과도한 확신을 주지 않는다"는 원칙을 weight에도 반영.
  'W-D_DATA_QUALITY_AWARE': { transport: 28, living: 26, education: 24, complex: 22 },
};

export function composeTotalFromDomains(domains: { transport: number | null; living: number | null; education: number | null; complex: number | null }, weights: DomainWeights, strategy: MissingDataStrategy): CompositionResult {
  return composeWithStrategy([
    { key: 'transport', weight: weights.transport, score: domains.transport },
    { key: 'living', weight: weights.living, score: domains.living },
    { key: 'education', weight: weights.education, score: domains.education },
    { key: 'complex', weight: weights.complex, score: domains.complex },
  ], strategy);
}

// ---------------------------------------------------------------------------
// §21 Score eligibility — identity/coordinate가 DISPLAY_ONLY 이하면(즉 peer로도
// 못 쓰는 수준) coverage와 무관하게 종합점수 자체를 만들지 않는다(STEP1.5 정책
// 그대로). identity/coord가 신뢰 가능한 나머지는 실제 factor coverage로 등급화.
// ---------------------------------------------------------------------------
export type ScoreEligibility = 'SCORE_AVAILABLE' | 'LIMITED' | 'NOT_ENOUGH_DATA';
export function eligibilityFromCoverage(identityEligible: boolean, coverage: number): ScoreEligibility {
  if (!identityEligible) return 'NOT_ENOUGH_DATA';
  if (coverage >= 0.75) return 'SCORE_AVAILABLE';
  if (coverage >= 0.4) return 'LIMITED';
  return 'NOT_ENOUGH_DATA';
}
