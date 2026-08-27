// SCHOOL DATA BACKFILL V1 §15/§16 — SchoolStat 후보값 검증 순수 로직. 학교알리미
// 원본을 그대로 저장하되, 명백히 불가능한 값(음수 등)이나 좌표가 부산 범위를
// 벗어나는 경우는 write 대상에서 제외(REVIEW)한다 — null을 0으로 바꾸지 않고,
// 0이 실제로 원본값일 때만 그대로 저장한다.

export interface SchoolStatCandidate {
  studentCount: number | null;
  classCount: number | null;
  teacherCount: number | null;
}

export interface ValidationResult {
  valid: boolean;
  reasons: string[];
}

export function validateSchoolStat(candidate: SchoolStatCandidate): ValidationResult {
  const reasons: string[] = [];
  if (candidate.studentCount != null && candidate.studentCount < 0) reasons.push(`studentCount 음수(${candidate.studentCount})`);
  if (candidate.classCount != null && candidate.classCount < 0) reasons.push(`classCount 음수(${candidate.classCount})`);
  if (candidate.teacherCount != null && candidate.teacherCount < 0) reasons.push(`teacherCount 음수(${candidate.teacherCount})`);
  // 학생이 있는데 학급이 0이면(또는 반대) 명백히 비정상 — 원본 자체의 이상치일
  // 수 있으므로 자동 write하지 않고 REVIEW로 남긴다(추정 보정 없음).
  if (candidate.studentCount != null && candidate.studentCount > 0 && candidate.classCount === 0) {
    reasons.push('학생수>0인데 classCount=0');
  }
  if (candidate.studentCount != null && candidate.studentCount > 0 && candidate.teacherCount === 0) {
    reasons.push('학생수>0인데 teacherCount=0');
  }
  return { valid: reasons.length === 0, reasons };
}

// 부산 School 좌표 범위(BUSAN_DATA_UX_AUTOMATED_QA_V1이 이미 실측/합의한 여유
// bounding box와 동일 기준 재사용 — scripts/busan-qa-logic.ts BUSAN_BBOX).
const BUSAN_BBOX = { minLat: 34.9, maxLat: 35.45, minLng: 128.6, maxLng: 129.35 };

export function isValidBusanCoordinate(lat: number | null, lng: number | null): boolean {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= BUSAN_BBOX.minLat && lat <= BUSAN_BBOX.maxLat && lng >= BUSAN_BBOX.minLng && lng <= BUSAN_BBOX.maxLng;
}

// 학급당 학생수/교원 1인당 학생수는 runtime derived — DB에 저장하지 않는다(§7
// 지시, 기존 schema가 raw field만 갖고 있으면 억지로 컬럼을 늘리지 않는다).
// 0으로 나누지 않는다.
export function studentsPerClass(studentCount: number | null, classCount: number | null): number | null {
  if (studentCount == null || classCount == null || classCount <= 0) return null;
  return Math.round((studentCount / classCount) * 10) / 10;
}

export function studentsPerTeacher(studentCount: number | null, teacherCount: number | null): number | null {
  if (studentCount == null || teacherCount == null || teacherCount <= 0) return null;
  return Math.round((studentCount / teacherCount) * 10) / 10;
}

// SchoolStat.gradeBreakdown(Json)에 저장할 학년별 원본 배열을 정규화한다. 학교급에
// 따라 응답 자체에 COL_S4~S8/COL_C4~C8 필드가 없는 경우가 실제로 있다(중/고교는
// 3개 학년만 사용) — Prisma Json 컬럼은 배열 원소로 undefined를 허용하지 않아
// (런타임 예외로 이어짐, 실제로 발생했던 버그) 명시적으로 null로 바꾼다. null=
// "이 학년 슬롯이 이 학교급에 없음", 0=원본값 그대로인 진짜 0 — 서로 다른 의미를
// 섞지 않는다.
export function normalizeGradeSlot(value: number | null | undefined): number | null {
  return value === undefined ? null : value;
}
