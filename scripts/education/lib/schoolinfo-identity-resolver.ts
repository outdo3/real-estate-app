// SCHOOL V2-C2B-A — SchoolInfo(학교알리미) SCHUL_CODE ↔ canonical School(NEIS
// neisSchoolCode) identity resolver. 순수 함수만 — DB/네트워크 접근 없음, 그래서
// fixture로 바로 테스트 가능하다.
//
// 설계 원칙(지시사항 그대로):
// - 학교명 suffix 제거·부분 문자열·유사도 fuzzy matching 금지. normalizeName은
//   "동일 기관임이 명확한 문자 표현 차이"(공백/전각·반각)만 흡수한다.
// - 좌표는 identity를 단독으로 확정하지 않는다(보조 증거로만, 이번 모듈에서는
//   canonical School 쪽에 좌표가 아예 없어 실제로는 사용하지 않는다 — §9 참고).
// - 모호하면 LOW로 남기고 자동 merge하지 않는다.

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_MATCH';

export type SchoolLevelBucket = 'ELEMENTARY' | 'MIDDLE' | 'HIGH' | 'SPECIAL' | 'OTHER';

export interface CanonicalSchool {
  id: number;
  neisSchoolCode: string | null;
  schoolName: string;
  schoolLevel: string | null; // NEIS 원문(예: "초등학교", "각종학교(중)")
  sigunguCode: string | null;
  dongName: string | null;
  roadAddress: string | null;
}

export interface SchoolInfoRecord {
  schulCode: string;
  schulNm: string;
  schulKndScCode: string; // '02'/'03'/'04'/'05'/'08'/'09'/'10'/'11'/'25' 등 SchoolInfo 원문 코드
  sggCode: string;
  addrBrkdn: string; // ADRES_BRKDN
  bnhhYn: string;
}

export interface ResolverResult {
  canonical: CanonicalSchool;
  confidence: MatchConfidence;
  matched: SchoolInfoRecord | null;
  candidates: SchoolInfoRecord[]; // 최종 후보(모호하면 2개 이상)
  reasons: string[]; // 사람이 읽을 수 있는 판정 근거
}

// 전각/반각 통일 + 공백류 정리만 한다 — "초등학교" 제거나 부분 매칭은 절대 하지 않는다.
export function normalizeName(name: string): string {
  return (name || '').normalize('NFKC').replace(/\s+/g, '').trim();
}

// canonical School.schoolLevel(NEIS 원문, 매우 세분화됨)과 SchoolInfo.schulKndScCode
// (02/03/04/05/그외 세부코드)를 같은 4+1 버킷으로 정규화해야 서로 비교할 수 있다.
export function bucketNeisLevel(schoolLevel: string | null): SchoolLevelBucket {
  const s = schoolLevel || '';
  if (s.includes('특수')) return 'SPECIAL';
  if (s.startsWith('초등학교')) return 'ELEMENTARY';
  if (s.includes('중학교') || s.includes('(중)')) return 'MIDDLE';
  if (s.includes('고등학교') || s.includes('(고)')) return 'HIGH';
  return 'OTHER';
}

export function bucketSchoolInfoKind(schulKndScCode: string): SchoolLevelBucket {
  switch (schulKndScCode) {
    case '02':
      return 'ELEMENTARY';
    case '03':
      return 'MIDDLE';
    case '04':
      return 'HIGH';
    case '05':
      return 'SPECIAL';
    default:
      return 'OTHER'; // 06/07 및 그 하위 세부코드(08/09/10/11/25 등)
  }
}

// SchoolInfo ADRES_BRKDN(예: "부산광역시 강서구 신호동")에서 동(洞) 토큰을 뽑는다.
// 정확히 3번째 토큰(시도/시군구/동) 위치를 가정하지 않고, canonical dongName과
// "포함" 관계로만 비교한다(주소 표기 자유도가 있어 정확한 토큰 위치를 강제하지 않음).
function addressMentionsDong(addrBrkdn: string, dongName: string | null): boolean {
  if (!dongName) return false;
  const tokens = (addrBrkdn || '').trim().split(/\s+/);
  return tokens.includes(dongName);
}

// canonical School이 dongName/roadAddress를 갖고 있지 않으면(§6) 주소 비교 자체가
// "확인 불가"이지 "불일치"가 아니다 — 이 구분은 결과 reasons 문자열로 남긴다.
export function resolveOne(
  canonical: CanonicalSchool,
  schoolInfoBySigungu: Map<string, SchoolInfoRecord[]>
): ResolverResult {
  const reasons: string[] = [];
  if (!canonical.sigunguCode) {
    return { canonical, confidence: 'NO_MATCH', matched: null, candidates: [], reasons: ['canonical School에 sigunguCode 없음 — 매칭 불가'] };
  }

  const pool = schoolInfoBySigungu.get(canonical.sigunguCode) || [];
  const canonicalNameNorm = normalizeName(canonical.schoolName);
  const nameSigunguMatches = pool.filter((r) => normalizeName(r.schulNm) === canonicalNameNorm);

  if (nameSigunguMatches.length === 0) {
    return { canonical, confidence: 'NO_MATCH', matched: null, candidates: [], reasons: ['같은 시군구 내 동일 이름 SchoolInfo row 없음'] };
  }
  reasons.push(`이름+시군구 후보 ${nameSigunguMatches.length}건`);

  const canonicalBucket = bucketNeisLevel(canonical.schoolLevel);
  const kindMatches = nameSigunguMatches.filter((r) => bucketSchoolInfoKind(r.schulKndScCode) === canonicalBucket);

  // §8: 학교급이 최종 키에 반드시 포함돼야 한다 — 학교급이 안 맞는 후보는 후보군에서
  // 제외한다(초/중/고가 이름 일부를 공유해도 교차 매칭되지 않게).
  const poolAfterKind = kindMatches.length > 0 ? kindMatches : [];
  if (poolAfterKind.length === 0) {
    reasons.push(`학교급(${canonicalBucket}) 일치하는 후보 없음 — 이름만 겹치는 다른 급 학교로 판단, 매칭 보류`);
    return { canonical, confidence: 'NO_MATCH', matched: null, candidates: nameSigunguMatches, reasons };
  }
  reasons.push(`학교급 일치 후보 ${poolAfterKind.length}건`);

  if (poolAfterKind.length === 1) {
    // 이름+시군구+학교급까지 유일 — HIGH. 분교 표시가 있으면 그래도 한 단계 낮춘다
    // (§7 — 분교/본교가 같은 이름을 가질 수 있는 리스크에 대비한 보수적 처리).
    const only = poolAfterKind[0];
    if (only.bnhhYn === 'Y') {
      reasons.push('유일 후보이나 BNHH_YN=Y(분교 표시) — 자동 확정 대신 MEDIUM으로 보수적 처리');
      return { canonical, confidence: 'MEDIUM', matched: only, candidates: poolAfterKind, reasons };
    }
    reasons.push('이름+시군구+학교급 유일 매칭 — HIGH');
    return { canonical, confidence: 'HIGH', matched: only, candidates: poolAfterKind, reasons };
  }

  // 2건 이상 남음 — 주소(동) 기반 2차 disambiguation 시도(§6).
  if (!canonical.dongName) {
    reasons.push(`이름+시군구+학교급 후보 ${poolAfterKind.length}건, canonical School에 dongName 없어 주소 비교 불가 — LOW`);
    return { canonical, confidence: 'LOW', matched: null, candidates: poolAfterKind, reasons };
  }

  const dongMatches = poolAfterKind.filter((r) => addressMentionsDong(r.addrBrkdn, canonical.dongName));
  if (dongMatches.length === 1) {
    reasons.push(`동(${canonical.dongName}) 기준 disambiguation 성공 — HIGH`);
    return { canonical, confidence: 'HIGH', matched: dongMatches[0], candidates: poolAfterKind, reasons };
  }
  if (dongMatches.length > 1) {
    reasons.push(`동(${canonical.dongName}) 기준으로도 ${dongMatches.length}건 남음 — LOW`);
    return { canonical, confidence: 'LOW', matched: null, candidates: dongMatches, reasons };
  }
  reasons.push(`동(${canonical.dongName})과 정확히 일치하는 후보 없음(주소 표기 차이 가능) — LOW`);
  return { canonical, confidence: 'LOW', matched: null, candidates: poolAfterKind, reasons };
}

export function resolveAll(canonicalList: CanonicalSchool[], schoolInfoList: SchoolInfoRecord[]): ResolverResult[] {
  const bySigungu = new Map<string, SchoolInfoRecord[]>();
  for (const r of schoolInfoList) {
    bySigungu.set(r.sggCode, [...(bySigungu.get(r.sggCode) || []), r]);
  }
  return canonicalList.map((c) => resolveOne(c, bySigungu));
}
