import type { GeocodeStatus, LocationConfidence, LocationType } from './types';

// R3A 실증: 지오코딩 성공 11건 중 9건(82%)이 조합/추진위 사무실 주소로 의심됨(층/호/
// 상가명 텍스트로 확인). R3B "office 좌표 처리 전략"의 안전장치를 그대로 구현한다 —
// 목적은 오탐(office를 site로 오인)을 최소화하는 게 아니라 "PROJECT_SITE로 잘못
// 표시하지 않는 것"이므로, 아래 패턴 중 하나라도 걸리면 보수적으로 OFFICE로 본다
// (단어 하나만으로 site를 확정하지도 않는다 — 그 반대 방향으로도 보수적).
const OFFICE_SUSPECT_PATTERNS: RegExp[] = [
  /\d+층/, // "3층"
  /\d+호/, // "208호"
  /상가/,
  /빌딩/,
  /오피스/,
  /조합/, // "OO조합 사무실" 등
  /사무실/,
];

// "OO번지 일원", "OO동 OOO번지" 같은 명확한 지번/현장 표현.
const PROJECT_SITE_PATTERNS: RegExp[] = [/\d+(-\d+)?번지\s*일원/, /\d+(-\d+)?번지$/];

export interface LocationClassification {
  locationType: LocationType;
  locationConfidence: LocationConfidence;
  matchedOfficePattern: string | null;
}

// rawLocation 텍스트만으로 판정한다(지오코딩 성공 여부와 별개) — 지오코딩 자체의
// 성공/실패는 geocodeStatus로 별도 기록한다(아래 참고).
export function classifyLocationText(rawLocation: string | null): LocationClassification {
  if (!rawLocation || !rawLocation.trim()) {
    return { locationType: 'UNKNOWN', locationConfidence: 'UNKNOWN', matchedOfficePattern: null };
  }

  const text = rawLocation.trim();

  for (const pattern of OFFICE_SUSPECT_PATTERNS) {
    if (pattern.test(text)) {
      return { locationType: 'OFFICE', locationConfidence: 'LOW', matchedOfficePattern: pattern.source };
    }
  }

  for (const pattern of PROJECT_SITE_PATTERNS) {
    if (pattern.test(text)) {
      return { locationType: 'PROJECT_SITE', locationConfidence: 'HIGH', matchedOfficePattern: null };
    }
  }

  // 동 이름까지만 있고(예: "OO동") 구체 지번/일원 표현이 없는 경우 — 근사치로만 취급.
  if (/[가-힣0-9]+동$/.test(text) || /[가-힣0-9]+동\)/.test(text)) {
    return { locationType: 'APPROXIMATE', locationConfidence: 'MEDIUM', matchedOfficePattern: null };
  }

  return { locationType: 'UNKNOWN', locationConfidence: 'UNKNOWN', matchedOfficePattern: null };
}

// geocodeStatus는 지오코딩 API 호출 결과에서만 결정된다 — 이 모듈은 텍스트 분류만
// 담당하고, 실제 지오코딩 호출은 scripts/redevelopment 쪽 ingestion 코드 책임이다.
export function geocodeStatusFromResult(result: { success: boolean; ambiguous?: boolean }): GeocodeStatus {
  if (!result.success) return 'FAILED';
  return result.ambiguous ? 'AMBIGUOUS' : 'SUCCESS';
}
