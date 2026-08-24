/**
 * E-JIP SCORE V2 STEP 3 §3-4 — STEP2 curve 후보를 그대로 재사용하되(피처
 * 파라미터는 변경하지 않음, STEP2에서 "특정 벤치마크에 맞춰 조정 금지" 원칙
 * 유지) subway distance factor에 sentinel-aware 4-state 처리를 추가한다.
 * PROTOTYPE ONLY, production 미import.
 */
import { subwayDistanceScore as subwayDistanceScoreV2, type SubwayCurveCandidate } from '../score-v2-step2/curves';
export * from '../score-v2-step2/curves';

/**
 * §3: 4개 state를 섞지 않는다.
 * VALUE: 실제 거리값 보유 — STEP2 curve 그대로.
 * CONFIRMED_ABSENT: qualityFlag='complete'인데 null — "검색했고 반경(1000m) 내
 *   지하철이 없음이 확인됨". 이건 "모름"이 아니라 "확인된 나쁜 상태"이므로
 *   curve의 floor(가장 나쁜 등급)로 명시적으로 채점한다 — 0점이나 999999m 같은
 *   misleading 값이 아니라, 이미 확립된 curve의 최저 등급(=관측 실측값들의
 *   최댓값 999m보다 나쁜 상태) 그 자체를 그대로 재사용한다.
 * MISSING / COORD_INSUFFICIENT: 진짜 "모름" — null 반환(재분배/제외 대상).
 *   MISSING과 COORD_INSUFFICIENT를 curve 레벨에서 굳이 구분하지 않는 이유:
 *   둘 다 "이 factor로 이 단지를 평가할 근거가 없다"는 동일한 실무적 결론으로
 *   이어지기 때문(§3 지시가 요구하는 것은 "섞지 않는다"이지 "5갈래로 다르게
 *   채점한다"가 아님 — 상위 호출부(step3-02)에서는 여전히 4-state를 그대로
 *   기록해 리포트에 남긴다).
 */
export type SubwayDataStatus = 'VALUE' | 'CONFIRMED_ABSENT' | 'MISSING' | 'COORD_INSUFFICIENT';

const SUBWAY_FLOOR = 5; // STEP2 curves.ts의 clampScore 기본 floor와 동일 — 별도 상수 재정의가 아니라 그 값을 그대로 인용

export function subwayDistanceScoreV3(
  distanceM: number | null,
  status: SubwayDataStatus,
  candidate: SubwayCurveCandidate
): number | null {
  if (status === 'MISSING' || status === 'COORD_INSUFFICIENT') return null;
  if (status === 'CONFIRMED_ABSENT') return SUBWAY_FLOOR;
  return subwayDistanceScoreV2(distanceM, candidate);
}
