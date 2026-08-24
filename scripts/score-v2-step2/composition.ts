/**
 * E-JIP SCORE V2 STEP 2 §10,18,28,32,35 — domain composition 후보(가중치는
 * 전부 "후보"이며 STEP2에서 최종 확정하지 않는다, §52). bounded redistribution
 * (§18 B, §26 STEP1 결정 계승) prototype도 여기 둔다 — production 미적용.
 */

export interface WeightedFactor { key: string; weight: number; score: number | null }

export interface CompositionResult {
  score: number | null;
  coverage: number; // 0~1, 사용된 weight 합 / 총 weight
  usedFactors: string[];
  missingFactors: string[];
}

/** §18-B bounded redistribution: 결측 factor의 weight를 나머지에 재분배하되,
 * 한 factor가 흡수할 수 있는 재분배량에 상한(maxAbsorbShare, 기본 40%)을 둔다 —
 * V1처럼 무제한 재분배해 소수 factor가 도메인 전체를 대표하는 왜곡을 방지. */
export function composeBoundedRedistribution(factors: WeightedFactor[], maxAbsorbShare = 0.4): CompositionResult {
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const present = factors.filter((f) => f.score != null);
  const missing = factors.filter((f) => f.score == null);
  if (present.length === 0) return { score: null, coverage: 0, usedFactors: [], missingFactors: factors.map((f) => f.key) };

  const presentWeightSum = present.reduce((s, f) => s + f.weight, 0);
  const missingWeightSum = totalWeight - presentWeightSum;
  // 각 present factor가 흡수 가능한 최대 추가 weight = 원 weight * maxAbsorbShare/(1-maxAbsorbShare) 근사.
  // 단순화: 재분배 총량을 min(missingWeightSum, presentWeightSum*maxAbsorbShare/(1-maxAbsorbShare))로 상한.
  const maxRedistributable = presentWeightSum * (maxAbsorbShare / (1 - maxAbsorbShare));
  const redistributed = Math.min(missingWeightSum, maxRedistributable);
  const effectiveWeightSum = presentWeightSum + redistributed;

  // score 자체는 present factor끼리 정규화한 가중평균(§18-A와 수학적으로 동일한
  // 최종 값) — bounded redistribution이 실제로 바꾸는 것은 "coverage"(재분배
  // 상한을 넘는 결측은 coverage에 반영돼 confidence를 낮추는 신호로 쓰인다,
  // §27과 연동 예정) 뿐이다. score 계산 자체를 왜곡하지 않는다.
  const normalizedScore = present.reduce((acc, f) => acc + (f.weight / presentWeightSum) * f.score!, 0);

  return {
    score: normalizedScore,
    coverage: effectiveWeightSum / totalWeight,
    usedFactors: present.map((f) => f.key),
    missingFactors: missing.map((f) => f.key),
  };
}

// ---------------------------------------------------------------------------
// TRANSPORT composition candidates(§10)
// ---------------------------------------------------------------------------
export function transportComposeT1(subway: number | null, bus: number | null): CompositionResult {
  // T1: Subway dominant(70) + Bus secondary(30) — V1과 동일 철학 유지(§7 원 설계 근거 계승)
  return composeBoundedRedistribution([{ key: 'subway', weight: 70, score: subway }, { key: 'bus', weight: 30, score: bus }]);
}
export function transportComposeT2(subway: number | null, bus: number | null): CompositionResult {
  // T2: 균형(55/45) — 버스 밀도가 높은 부산 특성상 지하철 편중을 완화하는 대안
  return composeBoundedRedistribution([{ key: 'subway', weight: 55, score: subway }, { key: 'bus', weight: 45, score: bus }]);
}
export function transportComposeT3(subway: number | null, bus: number | null): CompositionResult {
  // T3: Best-mode accessibility — "둘 중 더 나은 교통수단"이 주된 접근성이라는
  // 철학. 주 모드 80% + 보조 모드 20%로, 한쪽이 아주 안 좋아도 다른 쪽이 좋으면
  // 과도하게 깎이지 않는다(§11 "bus compensation maximum" 개념의 반대 방향 실험).
  if (subway == null && bus == null) return { score: null, coverage: 0, usedFactors: [], missingFactors: ['subway', 'bus'] };
  if (subway == null) return { score: bus, coverage: 0.3, usedFactors: ['bus'], missingFactors: ['subway'] };
  if (bus == null) return { score: subway, coverage: 0.7, usedFactors: ['subway'], missingFactors: ['bus'] };
  const best = Math.max(subway, bus); const worst = Math.min(subway, bus);
  return { score: best * 0.8 + worst * 0.2, coverage: 1, usedFactors: ['subway', 'bus'], missingFactors: [] };
}

// ---------------------------------------------------------------------------
// COMPLEX composition candidates(§34-35)
// ---------------------------------------------------------------------------
export function complexComposeC1(age: number | null, scale: number | null, parking: number | null): CompositionResult {
  return composeBoundedRedistribution([{ key: 'age', weight: 50, score: age }, { key: 'scale', weight: 25, score: scale }, { key: 'parking', weight: 25, score: parking }]);
}
export function complexComposeC2(age: number | null, scale: number | null, parking: number | null): CompositionResult {
  return composeBoundedRedistribution([{ key: 'age', weight: 34, score: age }, { key: 'scale', weight: 33, score: scale }, { key: 'parking', weight: 33, score: parking }]);
}
export function complexComposeC3(age: number | null, scale: number | null, parking: number | null): CompositionResult {
  // parking coverage가 25.3%로 낮아 weight를 작게(15) — 결측이 잦은 factor에
  // 과도하게 의존하지 않도록(§18 철학을 domain 설계 단계에서도 선반영).
  return composeBoundedRedistribution([{ key: 'age', weight: 45, score: age }, { key: 'scale', weight: 40, score: scale }, { key: 'parking', weight: 15, score: parking }]);
}

// ---------------------------------------------------------------------------
// EDUCATION composition candidates(§28)
// ---------------------------------------------------------------------------
export function educationComposeEA(elementary: number | null, kindergarten: number | null): CompositionResult {
  // E-A: Elementary dominant — middle/high는 categorical/display이지 score 미편입(§25,§27)
  return composeBoundedRedistribution([{ key: 'elementary', weight: 80, score: elementary }, { key: 'kindergarten', weight: 20, score: kindergarten }]);
}
export function educationComposeEB(elementary: number | null, kindergarten: number | null): CompositionResult {
  // E-B: elementary+kindergarten 균형(자녀 유무 무관하게 이해 가능해야 한다는
  // §28 요구사항을 반영 — kindergarten 비중을 조금 더 줌)
  return composeBoundedRedistribution([{ key: 'elementary', weight: 60, score: elementary }, { key: 'kindergarten', weight: 40, score: kindergarten }]);
}
export function educationComposeEC(elementary: number | null): CompositionResult {
  // E-C: accessibility-only 최소 모델 — elementary 하나만, 나머지는 전부
  // raw fact 표시로만(§28 "간단해야 한다" 요구에 가장 근접)
  return composeBoundedRedistribution([{ key: 'elementary', weight: 100, score: elementary }]);
}

// ---------------------------------------------------------------------------
// LIVING composition candidates(§32)
// ---------------------------------------------------------------------------
export interface LivingScores { mart: number | null; convenience: number | null; pharmacy: number | null; hospital: number | null; park: number | null; daycare: number | null }
export function livingComposeL1(s: LivingScores): CompositionResult {
  // L1: Daily+Medical 중심(essential 위주)
  return composeBoundedRedistribution([
    { key: 'convenience', weight: 30, score: s.convenience }, { key: 'mart', weight: 20, score: s.mart },
    { key: 'pharmacy', weight: 25, score: s.pharmacy }, { key: 'hospital', weight: 25, score: s.hospital },
  ]);
}
export function livingComposeL2(s: LivingScores): CompositionResult {
  // L2: 6개 균형(V1과 유사한 폭넓은 분배, 단 daycare는 Education과 중복 우려로 낮게)
  return composeBoundedRedistribution([
    { key: 'mart', weight: 20, score: s.mart }, { key: 'convenience', weight: 20, score: s.convenience },
    { key: 'pharmacy', weight: 15, score: s.pharmacy }, { key: 'hospital', weight: 20, score: s.hospital },
    { key: 'park', weight: 20, score: s.park }, { key: 'daycare', weight: 5, score: s.daycare },
  ]);
}
export function livingComposeL3(s: LivingScores): CompositionResult {
  // L3: essential(medical+daily) 75% / optional(park) 25% 2-layer — daycare는
  // Education 중복이라 Living composition에서 제외(§33 중복가중 회피).
  const essential = composeBoundedRedistribution([
    { key: 'convenience', weight: 35, score: s.convenience }, { key: 'mart', weight: 25, score: s.mart },
    { key: 'pharmacy', weight: 20, score: s.pharmacy }, { key: 'hospital', weight: 20, score: s.hospital },
  ]);
  const optional = s.park;
  if (essential.score == null) return essential;
  if (optional == null) return { ...essential, coverage: essential.coverage * 0.75 };
  return { score: essential.score * 0.75 + optional * 0.25, coverage: 1, usedFactors: [...essential.usedFactors, 'park'], missingFactors: essential.missingFactors };
}
