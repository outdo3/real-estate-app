import type { CategoryResult, PeerPoolResult, RawLocationFeature } from '../types';
import { TRANSPORT_SUBWEIGHTS, FEATURE_DIRECTIONS } from '../config';
import { computeCategoryFromSubMetrics, type SubMetricSpec } from '../category-helper';
import type { FeatureRow } from '../percentile';

// §7: subway:bus ≈ 70:30(45+25 vs 18+12), "거리"·"개수" 동시 과다가산 방지.
const SUB_METRICS: SubMetricSpec[] = [
  { key: 'nearestSubwayDistanceM', weight: TRANSPORT_SUBWEIGHTS.nearestSubwayDistanceM, direction: FEATURE_DIRECTIONS.nearestSubwayDistanceM, treatCompleteNullAsWorst: true },
  { key: 'subwayCount1000m', weight: TRANSPORT_SUBWEIGHTS.subwayCount1000m, direction: FEATURE_DIRECTIONS.subwayCount1000m, treatCompleteNullAsWorst: false },
  { key: 'nearestBusStopDistanceM', weight: TRANSPORT_SUBWEIGHTS.nearestBusStopDistanceM, direction: FEATURE_DIRECTIONS.nearestBusStopDistanceM, treatCompleteNullAsWorst: true },
  { key: 'busStopCount300m', weight: TRANSPORT_SUBWEIGHTS.busStopCount300m, direction: FEATURE_DIRECTIONS.busStopCount300m, treatCompleteNullAsWorst: false },
];

export function computeTransportCategory(
  targetAptSeq: string,
  peerPool: PeerPoolResult,
  locationByAptSeq: Map<string, RawLocationFeature>
): CategoryResult {
  const rowsByFeature: Record<string, FeatureRow[]> = {};
  for (const sub of SUB_METRICS) {
    rowsByFeature[sub.key] = peerPool.aptSeqs.map((aptSeq) => {
      const loc = locationByAptSeq.get(aptSeq);
      return {
        aptSeq,
        value: loc ? (loc[sub.key as keyof RawLocationFeature] as number | null) : null,
        isComplete: loc ? loc.qualityFlag === 'complete' : false,
      };
    });
  }

  return computeCategoryFromSubMetrics('transport', targetAptSeq, SUB_METRICS, peerPool, rowsByFeature);
}
