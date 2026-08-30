// BUSAN_APARTMENT_SEARCH_COVERAGE_PERFORMANCE_V1 §11 SEARCH RANKING RULE — 순수 함수.
// exact normalized match > startsWith > contains 순으로 tier를 매기고, 같은 tier
// 안에서만 totalHouseholds desc로 정렬한다. household 수만으로 정렬하면 정확히
// 일치하는 작은 단지가 이름이 겹치는 더 큰 단지들에 밀려 result limit 밖으로 잘려
// 나가는 문제(§7 감사에서 실측: "경동"/"현대" 등)를 막는다.
export interface RankableApartment {
  name: string;
  normalizedName: string;
  totalHouseholds: number | null;
}

export function matchTier(a: RankableApartment, normalizedKeyword: string): 0 | 1 | 2 {
  if (a.normalizedName === normalizedKeyword || a.name === normalizedKeyword) return 0;
  if (a.normalizedName.startsWith(normalizedKeyword) || a.name.startsWith(normalizedKeyword)) return 1;
  return 2;
}

export function rankApartmentMatches<T extends RankableApartment>(
  rows: T[],
  normalizedKeyword: string,
  limit: number
): T[] {
  const sorted = [...rows].sort((a, b) => {
    const tierDiff = matchTier(a, normalizedKeyword) - matchTier(b, normalizedKeyword);
    if (tierDiff !== 0) return tierDiff;
    return (b.totalHouseholds || 0) - (a.totalHouseholds || 0);
  });
  return sorted.slice(0, limit);
}

// §10 NAME NORMALIZATION — ApartmentMaster.normalizedName을 채운
// scripts/apartment_master_seed.ts의 normalizeName()과 동일 규칙(공백 제거 + 끝
// "아파트" 접미사 제거)을 검색 키워드에도 적용한다. 접미사 제거로 빈 문자열이 되면
// (예: "아파트"만 입력) 원래 공백만 제거한 키워드로 되돌린다.
export function normalizeSearchKeyword(raw: string): string {
  const whitespaceStripped = raw.replace(/\s+/g, '');
  const suffixStripped = whitespaceStripped.replace(/아파트$/, '');
  return suffixStripped.length > 0 ? suffixStripped : whitespaceStripped;
}
