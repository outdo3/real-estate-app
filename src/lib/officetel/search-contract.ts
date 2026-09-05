// OFFICETEL_V1 STEP 4B §2 — 오피스텔 검색의 **순수 랭킹/정규화 로직**(DB 없음).
// zero-import 유지(strip-types 테스트 러너 제약).
//
// 검색은 퍼지해도 되지만 **최종 이동 identity는 언제나 정확해야 한다**(§2). 그래서 이
// 파일은 후보를 만들고 줄 세우기만 하고, 어떤 경우에도 "첫 결과로 대충 보낸다" 같은
// 결정을 하지 않는다 — 결과 각각이 자기 master id / canonicalKey를 그대로 들고 간다.

/** 아파트 검색(search-ranking.ts)과 같은 관례: 공백 제거 + 소문자화. */
export function normalizeOfficetelSearchKeyword(raw: string): string {
  return (raw ?? '').replace(/\s+/g, '').toLowerCase();
}

/** 표시명 정규화와 같은 규칙(공백 제거 + 후행 "오피스텔" 제거)을 검색어에도 적용한다. */
export function normalizeOfficetelSearchName(raw: string): string {
  return normalizeOfficetelSearchKeyword(raw).replace(/오피스텔$/, '');
}

export interface OfficetelRankable {
  officetelName: string;
  normalizedName: string;
  normalizedUmdNm: string;
  normalizedJibun: string | null;
  roadAddress: string | null;
}

/**
 * 티어 랭킹 — 아파트 `rankApartmentMatches`와 같은 사고방식이다. 이름 완전일치가
 * 부분일치보다 항상 위에 오게 해서, 흔한 단어(예: "센트럴")로 검색했을 때 정확히
 * 그 이름인 건물이 목록 밖으로 잘려나가지 않게 한다.
 *
 * tier 0: 이름 완전일치
 * tier 1: 이름 접두 일치
 * tier 2: 이름 부분일치
 * tier 3: 주소(법정동/지번/도로명) 일치
 *
 * 동률은 결정적으로 깬다(이름 길이 → 이름 사전순) — 같은 검색어에 매번 같은 순서가
 * 나와야 사용자가 목록 위치를 기억할 수 있다.
 */
export function rankOfficetelMatches<T extends OfficetelRankable>(rows: T[], rawKeyword: string, limit: number): T[] {
  const kw = normalizeOfficetelSearchKeyword(rawKeyword);
  const kwName = normalizeOfficetelSearchName(rawKeyword);
  if (kw === '') return [];

  const tierOf = (r: T): number => {
    const n = r.normalizedName ?? '';
    if (n !== '' && (n === kw || n === kwName)) return 0;
    if (n !== '' && (n.startsWith(kw) || n.startsWith(kwName))) return 1;
    if (n !== '' && (n.includes(kw) || n.includes(kwName))) return 2;
    return 3;
  };

  return [...rows]
    .map((r, i) => ({ r, i, tier: tierOf(r) }))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      const an = a.r.normalizedName ?? '';
      const bn = b.r.normalizedName ?? '';
      if (an.length !== bn.length) return an.length - bn.length;
      if (an !== bn) return an < bn ? -1 : 1;
      return a.i - b.i;
    })
    .slice(0, limit)
    .map((x) => x.r);
}
