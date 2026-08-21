// SCHOOL V2-C6-A — 학구도 linkage CSV(학교명+학구ID)를 canonical School(NEIS
// neisSchoolCode)에 안전하게 연결하는 resolver. C2B-A의
// schoolinfo-identity-resolver.ts와 동일한 원칙(이름 fuzzy matching 금지, 모호하면
// LOW/자동 merge 금지)을 그대로 따르되, 이번 소스(linkage CSV)에는 동(dong) 정보가
// 없어 2건 이상 후보가 남으면 더 이상 좁힐 방법이 없다 — 이 경우 항상 LOW로 남긴다.
//
// 부산 실제 데이터에서 확인된 사실(§실측): 공동(일방)통학구역의 "작은"(opt-in) 학교는
// zone을 관할하는 교육지원청의 lawdCd와 다른 구·군에 물리적으로 위치하는 경우가 있다
// (예: 금성초·공덕초는 canonical sigunguCode=26410(금정구)이지만, 이 학교들을 opt-in
// 대상으로 포함하는 zone은 26260/26320/26470 소속으로 등록돼 있음). 같은-lawdCd
// 검색에서 실패하면 부산 전역에서 2차 검색을 시도하되, 이름+학교급 기준 유일 매칭일 때만
// MEDIUM으로 채택한다(fuzzy matching 아님 — 지역 범위만 넓힌 정확 매칭).

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_MATCH';
export type SchoolLevelBucket = 'ELEMENTARY' | 'MIDDLE' | 'HIGH' | 'SPECIAL' | 'OTHER';

export interface CanonicalSchool {
  id: number;
  neisSchoolCode: string | null;
  schoolName: string;
  schoolLevel: string | null;
  sigunguCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ZoneSchoolLink {
  zoneId: string;
  schoolId: string; // "B"+9자리
  schoolName: string;
  schoolLevelRaw: string;
  lawdCd: string; // 해당 학구 polygon의 SD_CD+SGG_CD(=School.sigunguCode와 동일 포맷, 실측 검증됨)
}

export interface IdentityMatch {
  link: ZoneSchoolLink;
  confidence: MatchConfidence;
  matched: CanonicalSchool | null;
  candidates: CanonicalSchool[];
  reasons: string[];
}

export function normalizeName(name: string): string {
  return (name || '').normalize('NFKC').replace(/\s+/g, '').trim();
}

export function bucketLevel(levelRaw: string | null): SchoolLevelBucket {
  const s = levelRaw || '';
  if (s.includes('특수')) return 'SPECIAL';
  if (s.startsWith('초등학교')) return 'ELEMENTARY';
  if (s.includes('중학교') || s.includes('(중)')) return 'MIDDLE';
  if (s.includes('고등학교') || s.includes('(고)')) return 'HIGH';
  return 'OTHER';
}

export function resolveZoneSchool(
  link: ZoneSchoolLink,
  canonicalByLawdCd: Map<string, CanonicalSchool[]>,
  allCanonical: CanonicalSchool[] = []
): IdentityMatch {
  const reasons: string[] = [];
  const pool = canonicalByLawdCd.get(link.lawdCd) || [];
  const nameNorm = normalizeName(link.schoolName);
  let nameMatches = pool.filter((c) => normalizeName(c.schoolName) === nameNorm);
  let crossDistrict = false;

  if (nameMatches.length === 0) {
    // 2차: 부산 전역에서 동일 이름 재검색(공동학구의 opt-in 학교가 zone 관할 구·군과
    // 다른 구·군에 위치하는 실제 사례 대응). fuzzy matching 아님 — 정확 이름 일치만.
    const wideMatches = allCanonical.filter((c) => normalizeName(c.schoolName) === nameNorm);
    if (wideMatches.length === 0) {
      return { link, confidence: 'NO_MATCH', matched: null, candidates: [], reasons: ['같은 lawdCd 및 부산 전역에서 동일 이름 canonical School 없음'] };
    }
    nameMatches = wideMatches;
    crossDistrict = true;
    reasons.push(`같은 lawdCd(${link.lawdCd})에는 없음, 부산 전역 재검색 후보 ${wideMatches.length}건(공동학구 행정구역 교차 가능성)`);
  } else {
    reasons.push(`이름+lawdCd 후보 ${nameMatches.length}건`);
  }

  const linkBucket = bucketLevel(link.schoolLevelRaw);
  const kindMatches = nameMatches.filter((c) => bucketLevel(c.schoolLevel) === linkBucket);
  if (kindMatches.length === 0) {
    reasons.push(`학교급(${linkBucket}) 일치 후보 없음 — 매칭 보류`);
    return { link, confidence: 'NO_MATCH', matched: null, candidates: nameMatches, reasons };
  }
  reasons.push(`학교급 일치 후보 ${kindMatches.length}건`);

  if (kindMatches.length === 1) {
    if (crossDistrict) {
      reasons.push(`이름+학교급 부산 전역 유일 매칭이나 zone lawdCd(${link.lawdCd}) != school sigunguCode(${kindMatches[0].sigunguCode}) — 공동학구 행정구역 교차 사례로 확인, MEDIUM`);
      return { link, confidence: 'MEDIUM', matched: kindMatches[0], candidates: kindMatches, reasons };
    }
    reasons.push('이름+lawdCd+학교급 유일 매칭 — HIGH');
    return { link, confidence: 'HIGH', matched: kindMatches[0], candidates: kindMatches, reasons };
  }

  // linkage CSV에는 dong/address 정보가 없어 더 이상 좁힐 방법이 없다 — 항상 LOW.
  reasons.push(`이름+${crossDistrict ? '부산 전역' : 'lawdCd'}+학교급으로도 ${kindMatches.length}건 남음, linkage CSV에 동/주소 정보 없어 추가 disambiguation 불가 — LOW`);
  return { link, confidence: 'LOW', matched: null, candidates: kindMatches, reasons };
}

export function resolveAllZoneSchools(links: ZoneSchoolLink[], canonicalList: CanonicalSchool[]): IdentityMatch[] {
  const byLawdCd = new Map<string, CanonicalSchool[]>();
  for (const c of canonicalList) {
    if (!c.sigunguCode) continue;
    byLawdCd.set(c.sigunguCode, [...(byLawdCd.get(c.sigunguCode) || []), c]);
  }
  return links.map((l) => resolveZoneSchool(l, byLawdCd, canonicalList));
}
