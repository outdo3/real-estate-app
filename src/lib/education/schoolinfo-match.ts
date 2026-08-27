// SCHOOL DATA BACKFILL V1 — 학교알리미 응답(SCHUL_CODE, schoolinfo 자체 식별자)을
// canonical School row(neisSchoolCode)와 안전하게 crosswalk하는 순수 판정 로직.
// 실측 확인(scripts/education/c2b-verify-schoolinfo-api.ts): schoolinfo의
// SCHUL_CODE는 NEIS SD_SCHUL_CODE와 다른 별도 체계라 코드 자체로는 crosswalk할 수
// 없다 — 이름 + 같은 구/군(이미 School 테이블에 있는 sigunguCode로 스코프를 좁힘)
// 조합으로만 매칭한다. 이름+구/군으로도 후보가 2개 이상이면(실측: 강서구
// 송정초등학교/대저중앙초등학교) School.dongName이 schoolinfo 주소에 포함되는지로만
// 안전하게 좁히고, 그래도 모호하면 REVIEW로 남긴다 — 절대 첫 번째 결과를 쓰지
// 않는다(§0 원칙).

export interface SchoolInfoCandidate {
  schulCode: string;
  // 일부 학교알리미 레코드(이전/개편 이력)에는 이 필드 자체가 없을 수 있다(실측
  // 확인) — 호출부가 이미 유효(ABSCH_YN!='Y') 레코드만 넘기는 것을 기대하지만,
  // 방어적으로 undefined도 허용한다.
  addressBrkdn?: string;
}

export type MatchStatus = 'MATCHED' | 'REVIEW_IDENTITY' | 'NOT_FOUND';

export interface MatchResult {
  status: MatchStatus;
  matched: SchoolInfoCandidate | null;
  reason: string;
}

export function matchSchoolInfoCandidate(dongName: string | null, candidates: SchoolInfoCandidate[]): MatchResult {
  if (candidates.length === 0) {
    return { status: 'NOT_FOUND', matched: null, reason: '같은 이름+구/군 조합의 학교알리미 레코드 없음' };
  }
  if (candidates.length === 1) {
    return { status: 'MATCHED', matched: candidates[0], reason: '이름+구/군 유일 매칭' };
  }
  // 후보 2개 이상(동명이교 그 이상 — 실측: 같은 구/군 안에 같은 이름의 학교가
  // 2곳) — 이미 확보된 공식 dongName(NEIS 출처)이 schoolinfo 주소 문자열에
  // 포함되는 후보로만 좁힌다.
  if (!dongName) {
    return { status: 'REVIEW_IDENTITY', matched: null, reason: `이름+구/군 중복(${candidates.length}건), dongName 없어 구분 불가` };
  }
  const dongMatches = candidates.filter((c) => (c.addressBrkdn || '').includes(dongName));
  if (dongMatches.length === 1) {
    return { status: 'MATCHED', matched: dongMatches[0], reason: `동명이교 ${candidates.length}건 중 dongName(${dongName})으로 1건 확정` };
  }
  return {
    status: 'REVIEW_IDENTITY',
    matched: null,
    reason: `동명이교 ${candidates.length}건, dongName(${dongName}) 기준으로도 ${dongMatches.length}건 — 자동 확정 불가`,
  };
}
