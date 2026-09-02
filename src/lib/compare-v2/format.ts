// COMPARE_V2_PHASE2 — resident-safe copy helpers. Every string here is a deterministic
// template; no LLM text anywhere in Compare. Banned/preferred vocabulary matches Score's
// own existing style guide (COMPARE_V2_ARCHITECTURE_AUDIT.md §26) — one shared standard.
import type { CompareDifference } from './types';

export function formatHeadlineBullet(diff: CompareDifference, aName: string, bName: string): string {
  if (diff.direction === 'context-only') {
    const winner = diff.favors === 'a' ? aName : diff.favors === 'b' ? bName : null;
    if (winner && diff.a.key === 'salePrice') {
      const lowerName = diff.a.value != null && diff.b.value != null && diff.a.value < diff.b.value ? aName : bName;
      return `${lowerName}: 최근 실거래가가 상대적으로 낮음 (차이 ${diff.differenceDisplay})`;
    }
    return `${diff.label} 차이가 있습니다 (${diff.differenceDisplay})`;
  }
  const favoredName = diff.favors === 'a' ? aName : diff.favors === 'b' ? bName : null;
  if (!favoredName) return `${diff.label}: 비슷한 수준`;
  return `${favoredName}: ${diff.label} 상대적으로 유리 (차이 ${diff.differenceDisplay})`;
}

export function scoreDomainSummary(percentile: number | null, confidence: string): string {
  if (confidence === 'HIGH' && percentile != null) return `비슷한 단지 중 상위 ${percentile.toFixed(0)}% 수준`;
  if (confidence === 'MEDIUM') return '비슷한 단지 대비 참고 수준';
  return '비교군 정보 부족';
}
