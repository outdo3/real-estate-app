import type { CategoryResult, PeerPoolResult, RawMasterInfo } from '../types';
import { COMPLEX_SUBWEIGHTS, FEATURE_DIRECTIONS } from '../config';
import { computeCategoryFromSubMetrics, type SubMetricSpec } from '../category-helper';
import type { FeatureRow } from '../percentile';

// §12: buildYear coverage 100%, totalHouseholds/mainBuildingCount는 15.2~34.4%뿐이라
// (실측) 대부분 apt는 buildYear 단독으로 카테고리 점수가 결정된다(재분배). "신축=무조건
// 우수/대단지=무조건 우수" 단순모델 금지 — percentile+score-scale 완화(§17)로 절벽 방지.
const SUB_METRICS: SubMetricSpec[] = [
  { key: 'buildYear', weight: COMPLEX_SUBWEIGHTS.buildYear, direction: FEATURE_DIRECTIONS.buildYear, treatCompleteNullAsWorst: false },
  { key: 'totalHouseholds', weight: COMPLEX_SUBWEIGHTS.totalHouseholds, direction: FEATURE_DIRECTIONS.totalHouseholds, treatCompleteNullAsWorst: false },
  { key: 'mainBuildingCount', weight: COMPLEX_SUBWEIGHTS.mainBuildingCount, direction: FEATURE_DIRECTIONS.mainBuildingCount, treatCompleteNullAsWorst: false },
];

export function computeComplexCategory(
  targetAptSeq: string,
  peerPool: PeerPoolResult,
  masterByAptSeq: Map<string, RawMasterInfo>
): CategoryResult {
  const rowsByFeature: Record<string, FeatureRow[]> = {};
  for (const sub of SUB_METRICS) {
    rowsByFeature[sub.key] = peerPool.aptSeqs.map((aptSeq) => {
      const m = masterByAptSeq.get(aptSeq);
      return {
        aptSeq,
        value: m ? (m[sub.key as keyof RawMasterInfo] as number | null) : null,
        isComplete: false,
      };
    });
  }

  return computeCategoryFromSubMetrics('complex', targetAptSeq, SUB_METRICS, peerPool, rowsByFeature);
}
