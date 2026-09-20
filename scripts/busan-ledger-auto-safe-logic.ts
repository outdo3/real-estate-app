/**
 * BUSAN_BUILDING_LEDGER_AUTO_SAFE_CORRECTION_V1의 판정 규칙만 분리한 순수 모듈.
 * dotenv / prisma / fetch / __dirname 없음 — 테스트가 이 파일만 import하면 되고,
 * apply 스크립트 전체가 같이 실행되는 사고를 막는다(backfill-basic-data-logic.ts와 같은 이유).
 */


/** 주거 레코드 판정 — **공식 주용도 코드명**으로만. 이름 문자열 추정 금지(§3). */
export function isResidentialRecord(r: unknown): boolean {
  return String((r as Record<string, unknown>)?.mainPurpsCdNm ?? '').trim() === '공동주택';
}

export type FieldVerdict = 'AUTO_SAFE' | 'ALREADY_OK' | 'REVIEW_REQUIRED' | 'KEEP_NULL' | 'NOT_APPLICABLE';
export interface FieldDecision { verdict: FieldVerdict; newValue: number | string | null; reason: string }

/**
 * §3 세대수. AUTO_SAFE는 다음을 **전부** 만족할 때만:
 *   - 주거(공동주택) 레코드가 1건 이상
 *   - 포함되는 모든 주거 레코드의 hhldCnt > 0  ← 상가동(0세대 공동주택)이 섞이면 경계가
 *     불명확해지므로 자동 적용에서 뺀다
 *   - 저장값이 있고, 주거 합계와 다르다
 * 비주거(근린생활·노유자·판매·단독·창고 등)는 합계에 **절대** 포함하지 않는다.
 */
export function decideHouseholds(records: unknown[], stored: number | null): FieldDecision {
  const res = records.filter(isResidentialRecord);
  if (res.length === 0) return { verdict: 'NOT_APPLICABLE', newValue: null, reason: '주거(공동주택) 레코드 없음' };
  const counts = res.map((r) => Number((r as Record<string, unknown>).hhldCnt) || 0);
  const sum = counts.reduce((a, b) => a + b, 0);
  if (sum <= 0) return { verdict: 'NOT_APPLICABLE', newValue: null, reason: '주거 합계 0' };
  if (stored == null) return { verdict: 'KEEP_NULL', newValue: null, reason: '저장값 없음 — 이번 승인 범위 밖' };
  if (stored === sum) return { verdict: 'ALREADY_OK', newValue: null, reason: `저장값이 주거 합계(${sum})와 일치` };
  const zero = counts.filter((c) => c === 0).length;
  if (zero > 0) {
    return { verdict: 'REVIEW_REQUIRED', newValue: null, reason: `공동주택인데 0세대인 레코드 ${zero}건 — 주거 경계 불명확` };
  }
  return { verdict: 'AUTO_SAFE', newValue: sum, reason: `주거 ${res.length}건 전부 hhldCnt>0, 합계 ${sum} (저장 ${stored})` };
}

/** 도로명 정규화 — 공백만 정리한다(주소를 바꾸지 않는다). */
export function normalizeRoad(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * §4 도로명주소. AUTO_SAFE는 같은 필지의 official 레코드에서 도로명이 **단 하나**로
 * 합의될 때만. first row / 다수결 / 최근접 / geocoder 추론 전부 금지.
 */
export function decideRoadAddress(records: unknown[], stored: string | null): FieldDecision {
  const distinct = [...new Set(records.map((r) => normalizeRoad((r as Record<string, unknown>).newPlatPlc)).filter(Boolean))];
  if (distinct.length === 0) return { verdict: 'NOT_APPLICABLE', newValue: null, reason: '응답에 도로명 없음' };
  if (distinct.length > 1) return { verdict: 'REVIEW_REQUIRED', newValue: null, reason: `도로명 ${distinct.length}종` };
  const only = distinct[0];
  if (normalizeRoad(stored) === only) return { verdict: 'ALREADY_OK', newValue: null, reason: '저장값과 동일' };
  return { verdict: 'AUTO_SAFE', newValue: only, reason: `단일 도로명 (저장 ${stored == null ? 'null' : `"${stored}"`})` };
}


export function jibunToBunJi(jibun: string): { bun: string; ji: string } | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec((jibun ?? '').trim());
  if (!m) return null;
  return { bun: String(Number(m[1])).padStart(4, '0'), ji: String(m[2] ? Number(m[2]) : 0).padStart(4, '0') };
}
