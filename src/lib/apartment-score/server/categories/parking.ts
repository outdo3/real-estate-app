import type { CategoryResult, PeerPoolResult, RawMasterInfo } from '../types';
import { FEATURE_DIRECTIONS } from '../config';
import { computeCategoryFromSubMetrics, type SubMetricSpec } from '../category-helper';
import type { FeatureRow } from '../percentile';

// §11: parkingPerHousehold = parkingCount / totalHouseholds, 단일 sub-metric(weight 100).
// ApartmentMaster에는 qualityFlag가 없어(건축물대장 registry 원본) null은 항상 "미확보"로만
// 취급한다(treatCompleteNullAsWorst 사용 안 함) — "실제로 주차장이 0대"라고 단정할 근거가 없다.
const SUB_METRICS: SubMetricSpec[] = [
  { key: 'parkingPerHousehold', weight: 100, direction: FEATURE_DIRECTIONS.parkingPerHousehold, treatCompleteNullAsWorst: false },
];

export function computeParkingCategory(
  targetAptSeq: string,
  peerPool: PeerPoolResult,
  masterByAptSeq: Map<string, RawMasterInfo>
): CategoryResult {
  const rows: FeatureRow[] = peerPool.aptSeqs.map((aptSeq) => {
    const m = masterByAptSeq.get(aptSeq);
    const ratio =
      m && m.parkingCount != null && m.totalHouseholds != null && m.totalHouseholds > 0
        ? m.parkingCount / m.totalHouseholds
        : null;
    return { aptSeq, value: ratio, isComplete: false };
  });

  return computeCategoryFromSubMetrics(
    'parking',
    targetAptSeq,
    SUB_METRICS,
    peerPool,
    { parkingPerHousehold: rows }
  );
}
