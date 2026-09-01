// EJIP_SCORE_V2_PHASE2 — pure presenter logic for ApartmentScoreCard, extracted
// so it's testable via plain `node --test` without a React render harness
// (this file has zero external imports, same convention as
// src/lib/apartment-score/peer-context-pure.ts). ApartmentScoreCard.tsx
// imports these functions instead of inlining the branching itself.

export type ScoreCardState =
  | { kind: 'no-result' } // 완전히 데이터가 없음(fetch 자체가 안 됨 등)
  | { kind: 'v2-absent' } // V2 계산 자체가 실패/누락(_shadowV2 없음)
  | { kind: 'not-enough-data' } // V2가 계산됐지만 eligibility=NOT_ENOUGH_DATA
  | { kind: 'ok'; v2: any }; // V2 eligibility=SCORE_AVAILABLE 또는 LIMITED

/**
 * 화면에 무엇을 보여줄지 결정한다. EJIP_SCORE_V2_PHASE2의 핵심 수정사항 —
 * V1의 status/coverage는 더 이상 이 판단에 관여하지 않는다(PHASE 1.5/1.6에서
 * 발견한 "V1 coverage가 V2 display를 가리는" 구조적 결함 수정). 오직
 * result._shadowV2의 존재/eligibility만 본다.
 */
export function deriveScoreCardState(result: { _shadowV2?: any } | null | undefined): ScoreCardState {
  if (!result) return { kind: 'no-result' };
  const v2 = result._shadowV2;
  if (!v2) return { kind: 'v2-absent' };
  if (v2.eligibility === 'NOT_ENOUGH_DATA') return { kind: 'not-enough-data' };
  return { kind: 'ok', v2 };
}

export type PeerVerdict =
  | { kind: 'unavailable' }
  | { kind: 'exact'; topPercent: number; direction: 'up' | 'down' | 'neutral' } // HIGH confidence
  | { kind: 'directional'; direction: 'up' | 'down' | 'neutral' } // MEDIUM confidence
  | { kind: 'broad' }; // LOW confidence

/**
 * confidence별 percentile 표시 정책(PHASE 2 §16): HIGH만 정확한 숫자를
 * 보여준다. MEDIUM은 방향성 wording만, LOW는 숫자를 아예 감추고 "넓은
 * 비교군 기준 참고 수준"이라는 문구만 보여준다 — 낮은 confidence에서
 * 잘못된 percentile을 보여줄 위험을 원천 차단한다.
 */
export function derivePeerVerdict(peer: { available: boolean; confidence: string; percentile: number | null } | null | undefined): PeerVerdict {
  if (!peer || !peer.available || peer.percentile == null) return { kind: 'unavailable' };

  if (peer.confidence === 'HIGH') {
    const topPercent = Math.max(1, Math.round(100 - peer.percentile));
    const direction = topPercent <= 30 ? 'up' : peer.percentile <= 30 ? 'down' : 'neutral';
    return { kind: 'exact', topPercent, direction };
  }
  if (peer.confidence === 'LOW') return { kind: 'broad' };
  // MEDIUM
  const direction = peer.percentile >= 60 ? 'up' : peer.percentile <= 40 ? 'down' : 'neutral';
  return { kind: 'directional', direction };
}
