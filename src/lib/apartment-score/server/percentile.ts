import type { Direction } from './types';
import { SCORE_FLOOR, SCORE_CEIL_SPAN, LOG_TRANSFORM_FEATURES } from './config';

export interface FeatureRow {
  aptSeq: string;
  value: number | null;
  // ApartmentLocationFeature/ApartmentMarketFeature.qualityFlag === 'complete'.
  // 이번 pilot 데이터는 402/402, 417/417 전부 'complete'로 실측 확인됨(2026-08-20
  // analyze-score-pilot.ts) — 즉 지금은 complete rows의 null은 전부 "확인된 부재"다.
  isComplete: boolean;
}

export interface RankedFeature {
  percentile: number | null; // 0~100, 항상 "클수록 좋음" 방향으로 정규화됨
  included: boolean; // false면 percentile 계산에서 완전히 제외(재분배 대상)
  isConfirmedAbsent: boolean; // qualityFlag=complete인데 null인 경우(§8)
}

/**
 * tie-aware 평균순위 percentile(§16 방향 명시, ties는 동일 percentile).
 * direction에 따라 "값이 작을수록 좋음"/"클수록 좋음"을 모두 0(나쁨)~100(좋음)으로 정규화한다.
 *
 * null 처리(§8):
 * - qualityFlag='complete' + value=null → "실제로 반경 내 대상이 없음"이 확인된
 *   데이터이므로, treatCompleteNullAsWorst=true인 feature(거리류)에서는 관측된
 *   최댓값보다 나쁜 sentinel 값으로 순위에 포함시킨다(방향 문제라 결측 재분배 대상 아님).
 * - qualityFlag='partial' + value=null → 수집 자체가 실패했을 가능성이 있어(§8, DB에
 *   feature 단위 실패 기록이 없어 구분 불가) 안전하게 순위 계산에서 제외한다(NOT_SCORED,
 *   가중치 재분배 대상).
 */
export function rankFeature(
  rows: FeatureRow[],
  featureKey: string,
  direction: Direction,
  treatCompleteNullAsWorst: boolean
): Map<string, RankedFeature> {
  const useLog = LOG_TRANSFORM_FEATURES.has(featureKey);
  const result = new Map<string, RankedFeature>();

  const present: { aptSeq: string; workingValue: number }[] = [];
  const sentinelAptSeqs: string[] = [];
  const excludedAptSeqs: string[] = [];

  for (const row of rows) {
    if (row.value != null) {
      const workingValue = useLog ? Math.log1p(row.value) : row.value;
      present.push({ aptSeq: row.aptSeq, workingValue });
    } else if (row.isComplete && treatCompleteNullAsWorst) {
      sentinelAptSeqs.push(row.aptSeq);
    } else {
      excludedAptSeqs.push(row.aptSeq);
    }
  }

  for (const aptSeq of excludedAptSeqs) {
    result.set(aptSeq, { percentile: null, included: false, isConfirmedAbsent: false });
  }

  if (present.length === 0 && sentinelAptSeqs.length === 0) {
    return result;
  }

  // sentinel: 관측된 최댓값보다 명확히 나쁜(=lowerIsBetter면 더 먼) 값 하나를 만들어
  // 순위에 포함시킨다. "45+"류 상한 캡과 달리 이건 실제 부재를 나타내는 값이라 값 자체를
  // 조작하지 않고 워킹 스케일에서만 최댓값 밖에 둔다.
  let sentinelWorkingValue = 1;
  if (present.length > 0) {
    const workingValues = present.map((p) => p.workingValue);
    const max = Math.max(...workingValues);
    const min = Math.min(...workingValues);
    const span = Math.max(max - min, 1);
    sentinelWorkingValue = direction === 'lowerIsBetter' ? max + span * 0.5 + 1 : min - span * 0.5 - 1;
  }

  const combined = [
    ...present.map((p) => ({ aptSeq: p.aptSeq, workingValue: p.workingValue, isSentinel: false })),
    ...sentinelAptSeqs.map((aptSeq) => ({ aptSeq, workingValue: sentinelWorkingValue, isSentinel: true })),
  ];

  const n = combined.length;
  if (n === 1) {
    const only = combined[0];
    result.set(only.aptSeq, { percentile: 50, included: true, isConfirmedAbsent: only.isSentinel });
    return result;
  }

  // 오름차순 정렬 후 평균순위(동점 처리) — scipy 'average' rank와 동일한 방식.
  const sorted = [...combined].sort((a, b) => a.workingValue - b.workingValue);
  const avgRankByValue = new Map<number, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].workingValue === sorted[i].workingValue) j++;
    const avgRank = (i + j) / 2; // 0-indexed
    avgRankByValue.set(sorted[i].workingValue, avgRank);
    i = j + 1;
  }

  for (const item of combined) {
    const rank0 = avgRankByValue.get(item.workingValue)!;
    // 오름차순 rank0=0이 workingValue 최솟값. lowerIsBetter면 최솟값이 좋음 → percentile 100,
    // higherIsBetter면 최솟값이 나쁨 → percentile 0. 두 경우 모두 "좋을수록 percentile 높음"으로 통일.
    const rawPercentile = (rank0 / (n - 1)) * 100;
    const percentile = direction === 'lowerIsBetter' ? 100 - rawPercentile : rawPercentile;
    result.set(item.aptSeq, { percentile, included: true, isConfirmedAbsent: item.isSentinel });
  }

  return result;
}

// score-scale 완화(§17): percentile 0→SCORE_FLOOR, 100→SCORE_FLOOR+SCORE_CEIL_SPAN.
export function scoreFromPercentile(percentile: number): number {
  return SCORE_FLOOR + (percentile / 100) * SCORE_CEIL_SPAN;
}
