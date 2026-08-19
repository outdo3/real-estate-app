import { stripTypeSuffixForComparison } from './normalize';
import type { CanonicalBusinessType, MatchConfidence } from './types';

// 후보 조회는 애플리케이션(scripts/redevelopment)이 sido+sigungu+normalizedName 인덱스로
// 수행한다 — 이 모듈은 후보가 주어졌을 때 confidence만 계산한다(R3B: DB에 공격적
// composite unique를 걸지 않고, 실제 병합 판단은 여기 로직이 한다).
export interface MatchCandidateInput {
  sido: string;
  sigungu: string;
  normalizedName: string;
  businessType: CanonicalBusinessType;
  householdCount: number | null;
}

// 편집거리(Levenshtein) — 외부 라이브러리 없이 표준 DP로 구현(짧은 이름 문자열이라
// 성능 문제 없음).
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function nameSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function householdWithinThreshold(a: number | null, b: number | null, thresholdRatio = 0.1): boolean {
  if (a === null || b === null) return false;
  if (a === 0 && b === 0) return true;
  const base = Math.max(a, b);
  if (base === 0) return false;
  return Math.abs(a - b) / base <= thresholdRatio;
}

// R3A "match confidence 설계" 그대로 구현(EXACT~UNMATCHED, docs/development/
// R3A-redevelopment-location-matching-pilot.md 참고). 자동 병합 정책(AUTO_MATCHED
// 등으로의 변환)은 이 함수의 책임이 아니다 — merge.ts가 이 결과를 받아 정책을 적용한다.
export function computeMatchConfidence(
  incoming: MatchCandidateInput,
  candidate: MatchCandidateInput
): MatchConfidence {
  if (incoming.sido !== candidate.sido) return 'UNMATCHED';

  const sigunguMatch = incoming.sigungu === candidate.sigungu;

  // 비교 전용: 저장된 normalizedName은 유형 접미사를 보존하지만(normalize.ts), 부산
  // areaName이 접미사를 포함하는 경우("서대신4 재개발")와 안 하는 경우(R3A 문서의
  // "서대신4")가 실제로 섞여 있어(R4.1 실물 데이터로 확인) 접미사를 뗀 버전으로
  // 비교해야 같은 사업을 같은 이름으로 인식할 수 있다. 오매칭 방지는 아래
  // businessType 비교가 계속 담당한다(접미사를 떼 이름이 같아져도 businessType이
  // 다르면 여전히 LOW).
  const incomingCompareName = stripTypeSuffixForComparison(incoming.normalizedName);
  const candidateCompareName = stripTypeSuffixForComparison(candidate.normalizedName);
  const nameExact = incomingCompareName === candidateCompareName;

  if (sigunguMatch && nameExact) {
    const bothKnownTypes = incoming.businessType !== 'UNKNOWN' && candidate.businessType !== 'UNKNOWN';
    if (bothKnownTypes) {
      return incoming.businessType === candidate.businessType ? 'EXACT' : 'LOW';
    }
    // 한쪽만 유형 정보가 없거나(국토부에만 코드 있음) 비교 불가 — HIGH.
    return 'HIGH';
  }

  const similarity = nameSimilarity(incomingCompareName, candidateCompareName);
  const nameIsSimilar = similarity >= 0.7 && incomingCompareName.length > 0 && candidateCompareName.length > 0;

  if (sigunguMatch && nameIsSimilar && householdWithinThreshold(incoming.householdCount, candidate.householdCount)) {
    return 'MEDIUM';
  }

  if (nameIsSimilar) {
    // 시군구 불일치 또는 세대수 근거 없음 — 자동 merge 절대 금지(R3A).
    return 'LOW';
  }

  return 'UNMATCHED';
}

// 여러 후보 중 가장 확신도 높은 것을 고른다. 동률이면 세대수가 더 가까운 쪽을 우선한다.
export function findBestCandidate<T extends MatchCandidateInput>(
  incoming: MatchCandidateInput,
  candidates: T[]
): { candidate: T; confidence: MatchConfidence } | null {
  const CONFIDENCE_RANK: Record<MatchConfidence, number> = {
    EXACT: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
    UNMATCHED: 0,
  };

  let best: { candidate: T; confidence: MatchConfidence } | null = null;
  for (const candidate of candidates) {
    const confidence = computeMatchConfidence(incoming, candidate);
    if (confidence === 'UNMATCHED') continue;
    if (!best || CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[best.confidence]) {
      best = { candidate, confidence };
    }
  }
  return best;
}
