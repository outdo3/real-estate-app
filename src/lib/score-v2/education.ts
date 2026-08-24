/**
 * E-JIP SCORE V2 — Education domain (E-A).
 *
 * Education = Accessibility / Environment 지표.
 * 학업성취도, 학교서열 아님.
 *
 * E-A = elementary 100% (kindergarten은 데이터 부족으로 제외)
 *
 * 중요 제약 (STEP 2 §22, STEP 3.7 확인):
 * - School.latitude/longitude coverage = 0% → 공식 통학구역 학교까지 거리 계산 불가.
 * - nearestElementaryDistanceM (Kakao POI 기준) 만 사용.
 * - attendanceZoneStatus는 evidence로만 기록, score에 반영하지 않는다.
 * - SchoolInfo 법적 승인 안 된 데이터 사용 금지.
 */

import type { AttendanceZoneStatus, DomainResult } from './types';
import { elementaryDistanceScore } from './curves';

export interface EducationInput {
  /** Kakao POI 기준 가장 가까운 초등학교 거리(m). null = 수집 없음. */
  nearestElementaryDistanceM: number | null;
  /** 공식 통학구역 categorical 상태 — evidence only, score 미반영. */
  attendanceZoneStatus: AttendanceZoneStatus;
}

/**
 * Education E-A domain score 계산.
 *
 * E-A: elementary 100% (단독 factor).
 * nearestElementaryDistanceM이 null이면 score=null(coverage=0).
 * attendanceZoneStatus는 score에 반영하지 않고 evidence에만 포함한다.
 */
export function educationDomain(input: EducationInput): DomainResult {
  const elemSc = elementaryDistanceScore(input.nearestElementaryDistanceM);

  return {
    score: elemSc,
    coverage: elemSc != null ? 1.0 : 0.0,
    usedFactors: elemSc != null ? ['nearestElementaryDistanceM'] : [],
    missingFactors: elemSc == null ? ['nearestElementaryDistanceM'] : [],
    evidence: {
      nearestElementaryDistanceM: input.nearestElementaryDistanceM,
      elementaryScore: elemSc,
      // attendance zone = evidence only, score 미반영
      attendanceZoneStatus: input.attendanceZoneStatus,
      attendanceZoneAffectsScore: false,
    },
  };
}
