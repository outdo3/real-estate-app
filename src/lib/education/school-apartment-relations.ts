// SCHOOLINFO / SCHOOL V2.1 — attendance-zone artifact(부산 3,402건)를 "아파트 →
// 학교" 방향이 아니라 "학교 → 관련 아파트" 방향으로 뒤집어 조회하는 순수 판정
// 로직만 분리했다(부작용 없음 — src/lib/education/attendance-zone.ts가 실제 artifact를
// 읽어 이 함수에 넘긴다). 단순 거리 기반 결과를 "배정 아파트"라고 부르지 않기 위해
// relation을 ATTENDANCE_ZONE(공식 통학구역)/MIDDLE_GROUP(학교군)으로 명확히 분리한다
// (nearby/거리 기반 relation은 별도 — src/lib/nearby-apartments.ts 기반으로 API 레이어에서
// 조합한다).

export type ZoneRelation = 'ATTENDANCE_ZONE' | 'MIDDLE_GROUP';

export interface ArtifactSchoolRef {
  neisSchoolCode: string | null;
  schoolName: string;
}

export interface ArtifactApartmentLike {
  aptSeq: string;
  aptName: string;
  sigungu: string | null;
  dong: string | null;
  elementary: { schools: ArtifactSchoolRef[] };
  middle: { schools: ArtifactSchoolRef[] };
}

export interface ZoneRelatedApartment {
  aptSeq: string;
  aptName: string;
  sigungu: string | null;
  dong: string | null;
  relation: ZoneRelation;
}

export interface SchoolIdentityForLookup {
  neisSchoolCode: string | null;
  schoolName: string;
}

// canonical NEIS code가 있으면 코드로만 매칭한다(이름 매칭보다 우선 — 동명이교 위험 없음).
// 코드가 없는 경우에만(Kakao-only 학교) 이름 완전일치로 폴백한다 — 부분일치/유사도
// 매칭은 쓰지 않는다(다른 학교로의 오연결 방지, "이름만으로 재식별 금지" 원칙).
function schoolMatches(ref: ArtifactSchoolRef, identity: SchoolIdentityForLookup): boolean {
  if (identity.neisSchoolCode) return ref.neisSchoolCode === identity.neisSchoolCode;
  return ref.schoolName === identity.schoolName;
}

// 한 단지가 같은 학교를 초등 통학구역과 중학교 학교군 양쪽에 동시에 갖는 경우는
// 실제로 없지만(급이 다르므로), 방어적으로 ATTENDANCE_ZONE을 우선한다.
export function findZoneRelatedApartments(
  apartments: ArtifactApartmentLike[],
  identity: SchoolIdentityForLookup
): ZoneRelatedApartment[] {
  const results: ZoneRelatedApartment[] = [];
  for (const apt of apartments) {
    if (apt.elementary.schools.some((s) => schoolMatches(s, identity))) {
      results.push({ aptSeq: apt.aptSeq, aptName: apt.aptName, sigungu: apt.sigungu, dong: apt.dong, relation: 'ATTENDANCE_ZONE' });
    } else if (apt.middle.schools.some((s) => schoolMatches(s, identity))) {
      results.push({ aptSeq: apt.aptSeq, aptName: apt.aptName, sigungu: apt.sigungu, dong: apt.dong, relation: 'MIDDLE_GROUP' });
    }
  }
  return results;
}

/**
 * GYEONGGI_CRON_AND_PUBLIC_READINESS_AUDIT_V1 — 통학구역 artifact(부산 전용)를 이 학교에 써도 되는가.
 *
 * artifact는 부산 학교만 담고 있고, NEIS 코드가 없는 학교는 **이름 완전일치**로 찾는다. 경기 단지 상세에서
 * 넘어온 Kakao 학교(예: 의정부 "신곡초등학교")가 이름이 같은 부산 학교의 통학구역 단지를 "공식 통학구역"으로
 * 받는 일이 생긴다(신곡초 7곳·동신초 43곳 등 동명 학교가 실제로 있다). 그래서:
 *   · canonical NEIS 코드가 있으면(= 공식 학교 테이블에 있는 학교) → 코드로만 매칭하므로 사용
 *   · 코드가 없는데 요청 지역(lawdCd)이 부산이 아니면 → 사용하지 않는다(다른 지역으로 대체 금지)
 *   · lawdCd가 없으면 기존 동작 유지(부산 링크 호환)
 */
export function shouldUseAttendanceZoneArtifact(input: { canonicalNeisSchoolCode: string | null; queryLawdCd: string | null }): boolean {
  if (input.canonicalNeisSchoolCode) return true;
  const lawdCd = (input.queryLawdCd || '').trim();
  if (!lawdCd) return true;
  return /^26\d{3}$/.test(lawdCd);
}
