// SCHOOL V2-D1 — EducationPanel이 쓰는 순수 라벨/분기 로직만 분리한 모듈.
// DOM 렌더링 없이 node:test로 검증 가능(이 프로젝트의 기존 관례: 순수 함수 단위
// 테스트만 자동화, DB/DOM 의존 테스트는 만들지 않음).
export type AttendanceStatus = 'AVAILABLE' | 'SHARED' | 'REVIEW_REQUIRED' | 'NOT_AVAILABLE';

export const ZONE_LABEL: Record<AttendanceStatus, string> = {
  AVAILABLE: '공식 통학구역 기준',
  SHARED: '공동통학구역',
  REVIEW_REQUIRED: '통학구역 정보 확인 중',
  NOT_AVAILABLE: '공식 통학구역 정보를 확인할 수 없어요',
};

export const ZONE_SUMMARY_LABEL: Record<AttendanceStatus, string> = {
  AVAILABLE: '공식 통학구역 확인',
  SHARED: '공동통학구역',
  REVIEW_REQUIRED: '확인 중',
  NOT_AVAILABLE: '확인 불가',
};

export interface MiddleGroupLike {
  status: AttendanceStatus;
  groupName: string | null;
  schools: { schoolName: string }[];
}

// 요약칩("중학교")에 쓰는 값 — 학교군 데이터가 있으면 "OO학교군 · N개교", 없으면
// 상태 라벨. 단일 "배정 중학교"라는 표현은 여기서도 절대 만들지 않는다.
export function middleSummaryValue(middle: MiddleGroupLike | null): string {
  if (!middle) return '확인 불가';
  if (middle.status === 'AVAILABLE' && middle.groupName) {
    return `${middle.groupName} · ${middle.schools.length}개교`;
  }
  return ZONE_SUMMARY_LABEL[middle.status];
}

// 초등 통학구역 본문에서 학교 목록을 보여줄지(AVAILABLE/SHARED) 상태 텍스트만
// 보여줄지(REVIEW_REQUIRED/NOT_AVAILABLE) 결정 — "가장 가까운 학교로 대신 채우기"
// 분기 자체가 존재하지 않는다(그런 경로가 없다).
export function shouldRenderZoneSchoolList(status: AttendanceStatus): boolean {
  return status === 'AVAILABLE' || status === 'SHARED';
}

// 중학교 1개교짜리 학교군은 "OO중학교" 이름을 바로 노출해도 안전하다는 §10 규칙.
export function middleGroupIsSingleSchool(middle: MiddleGroupLike | null): boolean {
  return !!middle && middle.status === 'AVAILABLE' && middle.schools.length <= 1;
}

// coordinateUnavailable=true(아파트 좌표 자체가 없음, COORDINATE_MISSING)일 때는
// "반경 내 없음"(검색했는데 없었다)이 아니라 "확인 불가"(애초에 검색할 좌표가
// 없었다)로 구분한다 — 확인된 부재와 확인 불가를 섞지 않는다.
export function kindergartenSummaryValue(count: number, coordinateUnavailable = false): string {
  if (coordinateUnavailable) return '확인 불가';
  return count > 0 ? `주변 ${count}곳` : '2km 이내 없음';
}

export function highSchoolSummaryValue(count: number, coordinateUnavailable = false): string {
  if (coordinateUnavailable) return '확인 불가';
  return count > 0 ? `주변 ${count}곳` : '3km 이내 없음';
}
