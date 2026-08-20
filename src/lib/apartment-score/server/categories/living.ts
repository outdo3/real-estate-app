import type { CategoryResult, PeerPoolResult, RawLocationFeature } from '../types';
import { LIVING_SUBWEIGHTS, FEATURE_DIRECTIONS } from '../config';
import { computeCategoryFromSubMetrics, type SubMetricSpec } from '../category-helper';
import type { FeatureRow } from '../percentile';

// §10: 전부 count류라 log1p 변환(config.LOG_TRANSFORM_FEATURES)으로 diminishing
// returns 적용. hospitalCount1000m은 45-cap 도달률 71~75%로 sub-weight 축소(사용자 확인).
const SUB_METRICS: SubMetricSpec[] = [
  { key: 'martCount1000m', weight: LIVING_SUBWEIGHTS.martCount1000m, direction: FEATURE_DIRECTIONS.martCount1000m, treatCompleteNullAsWorst: false },
  { key: 'convenienceCount500m', weight: LIVING_SUBWEIGHTS.convenienceCount500m, direction: FEATURE_DIRECTIONS.convenienceCount500m, treatCompleteNullAsWorst: false },
  { key: 'pharmacyCount500m', weight: LIVING_SUBWEIGHTS.pharmacyCount500m, direction: FEATURE_DIRECTIONS.pharmacyCount500m, treatCompleteNullAsWorst: false },
  { key: 'hospitalCount1000m', weight: LIVING_SUBWEIGHTS.hospitalCount1000m, direction: FEATURE_DIRECTIONS.hospitalCount1000m, treatCompleteNullAsWorst: false },
  { key: 'parkCount1000m', weight: LIVING_SUBWEIGHTS.parkCount1000m, direction: FEATURE_DIRECTIONS.parkCount1000m, treatCompleteNullAsWorst: false },
  { key: 'daycareKindergartenCount500m', weight: LIVING_SUBWEIGHTS.daycareKindergartenCount500m, direction: FEATURE_DIRECTIONS.daycareKindergartenCount500m, treatCompleteNullAsWorst: false },
];

export function computeLivingCategory(
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

  return computeCategoryFromSubMetrics('living', targetAptSeq, SUB_METRICS, peerPool, rowsByFeature);
}
