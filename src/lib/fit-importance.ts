// PERSONALIZED_SCORE_V1 P2-A — "나에게 맞는 점수" 중요도(사용자 선호) 저장값의 단일 정의.
// docs/development/PERSONALIZED_SCORE_V1.md
//
// DB/세션/네트워크를 만지지 않는 순수 모듈(서버 검증·클라이언트 표시 공용).
// 저장 형태: user_preferences.fit_importance = 아래 5개 key가 **모두** 있는 객체, 각 값은 정수 1~5. 미설정은 NULL.
// "학군"은 쓰지 않는다 — 공통 점수의 교육 축은 초등학교 직선거리뿐이라 elementarySchoolAccess(초등학교 접근성)다.

export const FIT_AXES = ['transport', 'living', 'newness', 'parking', 'elementarySchoolAccess'] as const;

export type FitAxis = (typeof FIT_AXES)[number];

export const FIT_AXIS_LABELS: Record<FitAxis, string> = {
  transport: '교통',
  living: '생활편의',
  newness: '신축',
  parking: '주차',
  elementarySchoolAccess: '초등학교 접근성',
};

export const FIT_IMPORTANCE_MIN = 1;
export const FIT_IMPORTANCE_MAX = 5;

export type FitImportanceLevel = 1 | 2 | 3 | 4 | 5;
export type FitImportance = Record<FitAxis, FitImportanceLevel>;

export type FitImportanceParseError = 'NOT_OBJECT' | 'MISSING_KEY' | 'UNKNOWN_KEY' | 'INVALID_VALUE';

export const FIT_IMPORTANCE_ERROR_MESSAGE = '중요도는 교통·생활편의·신축·주차·초등학교 접근성 5개 항목 모두 1~5 정수로 보내야 합니다.';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 완전한 5축 중요도 객체만 통과시킨다.
 * plain object / 정확히 5개 key(추가·누락 금지) / 각 값은 number 타입 정수 1~5(문자열 숫자·소수·null·중첩 금지).
 * 입력 객체를 그대로 돌려주지 않고 허용 key만 새로 복사한다(프로토타입 오염·여분 속성 차단).
 */
export function parseFitImportance(input: unknown): { ok: true; value: FitImportance } | { ok: false; error: FitImportanceParseError } {
  if (!isPlainObject(input)) return { ok: false, error: 'NOT_OBJECT' };
  const keys = Object.keys(input);
  const allowed = new Set<string>(FIT_AXES);
  for (const k of keys) if (!allowed.has(k)) return { ok: false, error: 'UNKNOWN_KEY' };
  for (const axis of FIT_AXES) if (!Object.prototype.hasOwnProperty.call(input, axis)) return { ok: false, error: 'MISSING_KEY' };

  const value = {} as FitImportance;
  for (const axis of FIT_AXES) {
    const v = input[axis];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < FIT_IMPORTANCE_MIN || v > FIT_IMPORTANCE_MAX) {
      return { ok: false, error: 'INVALID_VALUE' };
    }
    value[axis] = v as FitImportanceLevel;
  }
  return { ok: true, value };
}

/** DB에서 읽은 값 → 설정됨(검증된 객체) 또는 미설정(null). 저장값이 규칙에 어긋나면 미설정으로 본다. */
export function readStoredFitImportance(stored: unknown): FitImportance | null {
  if (stored == null) return null;
  const parsed = parseFitImportance(stored);
  return parsed.ok ? parsed.value : null;
}
