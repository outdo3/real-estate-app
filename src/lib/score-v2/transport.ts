/**
 * E-JIP SCORE V2 — Transport domain (T1).
 *
 * T1 = Subway 70% + Bus 30%.
 * Subway component는 4-state sentinel-aware (STEP 3 §3).
 * Bus component = distanceScore 50% + countScore 50%.
 *
 * Frozen (STEP 3.7): T1(70/30), subway curve A_PIECEWISE_LINEAR.
 */

import type { DomainResult } from './types';
import { subwayScore, busDistanceScore, busCountScore, SUBWAY_SENTINEL_FLOOR } from './curves';
import type { SubwayDataStatus } from './curves';

// ---------------------------------------------------------------------------
// Bounded redistribution helper
// ---------------------------------------------------------------------------

interface WeightedScore {
  key: string;
  weight: number;
  score: number | null;
}

interface BoundedResult {
  score: number | null;
  coverage: number;
  usedFactors: string[];
  missingFactors: string[];
}

/**
 * Bounded redistribution (STEP 2 §18-B).
 * 결측 factor의 weight를 present factor들이 재분배하되,
 * 흡수 상한(maxAbsorbShare=40%)을 초과하는 결측은 coverage 손실로만 표시한다.
 */
function composeBounded(factors: WeightedScore[], maxAbsorbShare = 0.4): BoundedResult {
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const present = factors.filter((f) => f.score != null);
  const missing = factors.filter((f) => f.score == null);

  if (present.length === 0) {
    return { score: null, coverage: 0, usedFactors: [], missingFactors: factors.map((f) => f.key) };
  }

  const presentWeightSum = present.reduce((s, f) => s + f.weight, 0);
  const missingWeightSum = totalWeight - presentWeightSum;
  const maxRedistributable = presentWeightSum * (maxAbsorbShare / (1 - maxAbsorbShare));
  const redistributed = Math.min(missingWeightSum, maxRedistributable);
  const effectiveWeightSum = presentWeightSum + redistributed;

  // score = present factor끼리 정규화한 가중평균
  const normalizedScore = present.reduce((acc, f) => acc + (f.weight / presentWeightSum) * f.score!, 0);

  return {
    score: normalizedScore,
    coverage: effectiveWeightSum / totalWeight,
    usedFactors: present.map((f) => f.key),
    missingFactors: missing.map((f) => f.key),
  };
}

// ---------------------------------------------------------------------------
// Transport domain
// ---------------------------------------------------------------------------

export interface TransportInput {
  subwayStatus: SubwayDataStatus;
  nearestSubwayDistanceM: number | null;
  nearestBusStopDistanceM: number | null;
  busStopCount300m: number | null;
}

/**
 * Transport T1 domain score 계산.
 *
 * Subway component (weight=70):
 *   - VALUE: piecewise-linear curve(distanceM)
 *   - CONFIRMED_ABSENT: floor(5) — "없음 확인"
 *   - MISSING/INVALID: null → bounded redistribution 대상
 *
 * Bus component (weight=30):
 *   - busDistanceScore(50%) + busCountScore(50%) 평균
 *   - 어느 한쪽만 null이면 나머지로 단독 대표 (bounded redistribution)
 *   - 둘 다 null이면 bus 전체 null
 */
export function transportDomain(input: TransportInput): DomainResult {
  const subwaySc = subwayScore(input.nearestSubwayDistanceM, input.subwayStatus);
  const busDistSc = busDistanceScore(input.nearestBusStopDistanceM);
  const busCountSc = busCountScore(input.busStopCount300m);

  // Bus component: distance+count 50:50 bounded redistribution
  const busResult = composeBounded([
    { key: 'busDistance', weight: 50, score: busDistSc },
    { key: 'busCount', weight: 50, score: busCountSc },
  ]);
  const busSc = busResult.score;

  // Transport T1: subway 70 / bus 30
  const transportResult = composeBounded([
    { key: 'subway', weight: 70, score: subwaySc },
    { key: 'bus', weight: 30, score: busSc },
  ]);

  return {
    score: transportResult.score,
    coverage: transportResult.coverage,
    usedFactors: transportResult.usedFactors,
    missingFactors: transportResult.missingFactors,
    evidence: {
      subwayStatus: input.subwayStatus,
      nearestSubwayDistanceM: input.nearestSubwayDistanceM,
      subwayScore: subwaySc,
      subwayIsSentinel: input.subwayStatus === 'CONFIRMED_ABSENT',
      subwaySentinelFloor: input.subwayStatus === 'CONFIRMED_ABSENT' ? SUBWAY_SENTINEL_FLOOR : null,
      nearestBusStopDistanceM: input.nearestBusStopDistanceM,
      busStopCount300m: input.busStopCount300m,
      busDistanceScore: busDistSc,
      busCountScore: busCountSc,
      busComponentScore: busSc,
    },
  };
}
