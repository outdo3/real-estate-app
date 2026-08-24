/**
 * E-JIP SCORE V2 — Score eligibility.
 *
 * STEP 3 §21 eligibility 정책 그대로 승계.
 * composition-v3.ts eligibilityFromCoverage()와 동일 로직 — single source of truth.
 *
 * SCORE_AVAILABLE: identityEligible && coverage >= 0.75
 * LIMITED:         identityEligible && coverage >= 0.4
 * NOT_ENOUGH_DATA: !identityEligible || coverage < 0.4
 */

import type { ScoreEligibility } from './types';

export { ScoreEligibility };

/**
 * 종합점수 표시 가능 여부 판정.
 *
 * @param identityEligible - 좌표/identity가 신뢰 가능한지 (구덕금호 사례: false)
 * @param coverage - 종합점수 계산에 사용된 domain weight 합 / 100 (0~1)
 */
export function eligibilityFromCoverage(
  identityEligible: boolean,
  coverage: number
): ScoreEligibility {
  if (!identityEligible) return 'NOT_ENOUGH_DATA';
  if (coverage >= 0.75) return 'SCORE_AVAILABLE';
  if (coverage >= 0.4) return 'LIMITED';
  return 'NOT_ENOUGH_DATA';
}
