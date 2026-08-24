// AUTH/MY V1 — MY-4. User Preferences 공통 로직(입력 검증, canonical purpose enum).
// DB/세션 접근은 이 파일에 두지 않는다.

// canonical purpose values — DB에 저장되는 값.
// 순서는 UI 표시 순서와 동일하게 유지한다.
export const ALLOWED_PURPOSES = [
  'BUY',
  'SELL',
  'JEONSE',
  'MONTHLY_RENT',
  'LEASE_OUT',
  'INVEST',
  'REDEVELOPMENT',
  'BROWSE',
] as const;

export type Purpose = (typeof ALLOWED_PURPOSES)[number];

// UI에서 사용자에게 보여줄 한국어 라벨.
// DB 저장값(canonical)과 분리해 관리한다.
export const PURPOSE_LABELS: Record<Purpose, string> = {
  BUY: '매수',
  SELL: '매도',
  JEONSE: '전세',
  MONTHLY_RENT: '월세',
  LEASE_OUT: '임대',
  INVEST: '투자',
  REDEVELOPMENT: '재개발·재건축',
  BROWSE: '둘러보기',
};

const MAX_PURPOSES = ALLOWED_PURPOSES.length; // 8 — 전체 선택 가능

/** PUT body 검증. unknown purpose string 거부, 중복 제거, 빈 배열 허용. */
export function validatePurposes(body: unknown): { valid: true; purposes: Purpose[] } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: '요청 형식이 올바르지 않습니다.' };
  }
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.purposes)) {
    return { valid: false, error: 'purposes는 배열이어야 합니다.' };
  }

  if (b.purposes.length > MAX_PURPOSES) {
    return { valid: false, error: `관심 목적은 최대 ${MAX_PURPOSES}개까지 선택할 수 있습니다.` };
  }

  const allowed = new Set<string>(ALLOWED_PURPOSES);
  const seen = new Set<string>();
  const result: Purpose[] = [];

  for (const item of b.purposes) {
    if (typeof item !== 'string' || !allowed.has(item)) {
      return { valid: false, error: `유효하지 않은 목적 값: ${String(item)}` };
    }
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item as Purpose);
    }
    // 중복은 조용히 제거
  }

  return { valid: true, purposes: result };
}
