import type { AbsoluteDistanceBand } from './types';

// [SCORE V1.1 §6] 부산 실제 nearestElementaryDistanceM 분포(location feature 보유
// 402건 중 non-null 398건, 2026-08-20 busan-coverage-audit.ts 실측)를 근거로 정한
// threshold다. 임의 하드코딩이 아니라 실측 percentile에 앵커링했다:
//   min=45, p10=138, p25=214, median=329, p75=472, p90=647, max=933
// VERY_CLOSE(<=200)는 p10~p25 사이, CLOSE(<=400)는 median 근방, NORMAL(<=650)은
// p90 근방, FAR(<=933)은 실측 최댓값까지를 포괄한다 — 반경 1000m 검색이라 933m를
// 넘는 값은 이론상만 존재하고 실측 표본에는 없었다(VERY_FAR는 그 이론적 잔여 구간).
export const ABSOLUTE_DISTANCE_THRESHOLDS_M = {
  VERY_CLOSE: 200,
  CLOSE: 400,
  NORMAL: 650,
  FAR: 933,
} as const;

export function absoluteSchoolDistanceBand(distanceM: number | null | undefined): AbsoluteDistanceBand {
  if (distanceM == null) return 'UNKNOWN';
  if (distanceM <= ABSOLUTE_DISTANCE_THRESHOLDS_M.VERY_CLOSE) return 'VERY_CLOSE';
  if (distanceM <= ABSOLUTE_DISTANCE_THRESHOLDS_M.CLOSE) return 'CLOSE';
  if (distanceM <= ABSOLUTE_DISTANCE_THRESHOLDS_M.NORMAL) return 'NORMAL';
  if (distanceM <= ABSOLUTE_DISTANCE_THRESHOLDS_M.FAR) return 'FAR';
  return 'VERY_FAR';
}
