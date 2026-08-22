// SCHOOL V2-C6-B — 내부 기술 상태(zone geometry match / school identity confidence)를
// 부모 대상 최종 user-facing status로 변환하는 순수 함수. C6-A의
// attendance-zone-matcher.ts(zone geometry 매칭)/zone-school-identity-resolver.ts(학교
// identity)는 수정하지 않고, 그 출력을 입력으로 받는 별도 레이어로 분리했다
// (§C6-B-5: "내부 기술상태와 사용자 표시상태를 분리").
//
// 핵심 판단(§C6-B-4 실측 근거): MEDIUM 확신도는 "이름+학교급 부산 전역 유일 매칭인데
// zone의 행정구역과 school의 sigunguCode가 다른" 경우에만 부여된다(resolver 코드 자체가
// 그렇게 설계됨 — kindMatches.length===1 조건 하에서만 MEDIUM). 즉 MEDIUM은 "어느
// 학교인지 확신 없음"이 아니라 "어느 학교인지는 유일하게 확정, 단 행정구역이 다르다"는
// 뜻이다. 따라서 MEDIUM은 REGION_CROSSING_BUT_IDENTITY_CONFIRMED로 취급하고
// REVIEW_REQUIRED로 내려보내지 않는다. 반대로 LOW(후보 2건 이상)/NO_MATCH(후보 0건)는
// identity 자체가 불확실하므로 REVIEW_REQUIRED로 분리한다.

export type UserAttendanceStatus = 'AVAILABLE' | 'SHARED' | 'REVIEW_REQUIRED' | 'NOT_AVAILABLE';

export type ZoneGeometryStatus = 'MATCHED_SINGLE' | 'MATCHED_SHARED' | 'OVERLAP' | 'NO_MATCH' | 'COORDINATE_MISSING';

export type SchoolIdentityConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_MATCH';

export interface ZoneSchoolIdentityInput {
  schoolName: string;
  identityConfidence: SchoolIdentityConfidence;
}

export interface ZoneMatchInput {
  geometryStatus: ZoneGeometryStatus;
  isShared: boolean;
  isAsymmetric: boolean;
  geometryInvalid: boolean;
  schools: ZoneSchoolIdentityInput[];
}

export type ReasonCode =
  | 'SINGLE_ZONE'
  | 'JOINT_ZONE_SYMMETRIC'
  | 'JOINT_ZONE_ASYMMETRIC'
  | 'INVALID_ZONE_GEOMETRY'
  | 'SCHOOL_IDENTITY_UNRESOLVED'
  | 'ZONE_BOUNDARY_GAP'
  | 'OVERLAPPING_ZONES'
  | 'COORDINATE_MISSING';

export interface FinalAttendanceResult {
  status: UserAttendanceStatus;
  uiMessage: string;
  reasonCode: ReasonCode;
}

// §C6-B-6 확정 문구. "오류"/"배정 확정" 등 과도한 표현 금지, "배정학교" 표현 금지(C6-A §18 유지).
export const UI_MESSAGES: Record<UserAttendanceStatus, string> = {
  AVAILABLE: '공식 통학구역 기준',
  SHARED: '통학구역 선택 가능 학교',
  REVIEW_REQUIRED: '통학구역 정보 확인 중',
  NOT_AVAILABLE: '공식 통학구역 정보를 확인할 수 없어요',
};

export function resolveFinalAttendanceStatus(input: ZoneMatchInput): FinalAttendanceResult {
  if (input.geometryStatus === 'COORDINATE_MISSING') {
    return { status: 'NOT_AVAILABLE', uiMessage: UI_MESSAGES.NOT_AVAILABLE, reasonCode: 'COORDINATE_MISSING' };
  }
  if (input.geometryStatus === 'NO_MATCH') {
    // 4건 실측(§C6-B-1): 전부 zone 경계 17~84m 이내 — "데이터 없음"이 아니라
    // "확인 중"으로 표현한다(가장 가까운 zone으로 강제 배정하지 않음).
    return { status: 'REVIEW_REQUIRED', uiMessage: UI_MESSAGES.REVIEW_REQUIRED, reasonCode: 'ZONE_BOUNDARY_GAP' };
  }
  if (input.geometryStatus === 'OVERLAP') {
    return { status: 'REVIEW_REQUIRED', uiMessage: UI_MESSAGES.REVIEW_REQUIRED, reasonCode: 'OVERLAPPING_ZONES' };
  }
  if (input.geometryInvalid) {
    // 자체교차(invalid) polygon에 매칭된 경우 — identity가 전부 HIGH여도 원본 geometry
    // 신뢰도가 낮으므로 확정 표기(AVAILABLE/SHARED)로 노출하지 않는다.
    return { status: 'REVIEW_REQUIRED', uiMessage: UI_MESSAGES.REVIEW_REQUIRED, reasonCode: 'INVALID_ZONE_GEOMETRY' };
  }
  const hasUnresolvedIdentity = input.schools.some((s) => s.identityConfidence === 'LOW' || s.identityConfidence === 'NO_MATCH');
  if (hasUnresolvedIdentity) {
    return { status: 'REVIEW_REQUIRED', uiMessage: UI_MESSAGES.REVIEW_REQUIRED, reasonCode: 'SCHOOL_IDENTITY_UNRESOLVED' };
  }
  // 여기 도달하면 모든 연결 학교가 HIGH 또는 MEDIUM(행정구역 교차, identity 자체는 확정).
  if (input.isShared) {
    return {
      status: 'SHARED',
      uiMessage: UI_MESSAGES.SHARED,
      reasonCode: input.isAsymmetric ? 'JOINT_ZONE_ASYMMETRIC' : 'JOINT_ZONE_SYMMETRIC',
    };
  }
  return { status: 'AVAILABLE', uiMessage: UI_MESSAGES.AVAILABLE, reasonCode: 'SINGLE_ZONE' };
}
