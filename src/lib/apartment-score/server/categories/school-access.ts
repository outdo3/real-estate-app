import type { CategoryResult, PeerPoolResult, RawLocationFeature } from '../types';
import { SCHOOL_ACCESS_SUBWEIGHTS, FEATURE_DIRECTIONS } from '../config';
import { computeCategoryFromSubMetrics, type SubMetricSpec } from '../category-helper';
import type { FeatureRow } from '../percentile';

// §13: "학교 접근성"만 — 학군/교육수준 아님. coverage 98.4~100% 실측 확인(S2B DEFER 취소).
const SUB_METRICS: SubMetricSpec[] = [
  { key: 'nearestElementaryDistanceM', weight: SCHOOL_ACCESS_SUBWEIGHTS.nearestElementaryDistanceM, direction: FEATURE_DIRECTIONS.nearestElementaryDistanceM, treatCompleteNullAsWorst: true },
  { key: 'elementaryCount1000m', weight: SCHOOL_ACCESS_SUBWEIGHTS.elementaryCount1000m, direction: FEATURE_DIRECTIONS.elementaryCount1000m, treatCompleteNullAsWorst: false },
];

export function computeSchoolAccessCategory(
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

  return computeCategoryFromSubMetrics('schoolAccess', targetAptSeq, SUB_METRICS, peerPool, rowsByFeature);
}
