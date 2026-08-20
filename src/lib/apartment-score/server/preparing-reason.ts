import type { CategoryResult, PreparingReasonCode } from './types';

// [SCORE V1.1 §18] "INSUFFICIENT_DATA"가 된 실제 이유를 운영자가 구분할 수 있게
// 분류한다. 순수 함수 — 이미 계산된 CategoryResult[]만 보고 판단하며 별도 DB
// 조회나 score 재계산을 하지 않는다(§43: audit/diagnostic 로직을 runtime과
// 분리하되 무겁게 만들지 않는다).
const LOCATION_DEPENDENT_KEYS = ['transport', 'living', 'schoolAccess'] as const;

export function classifyPreparingReason(categories: CategoryResult[]): PreparingReasonCode {
  const missing = new Set(categories.filter((c) => c.score == null).map((c) => c.key));
  if (missing.size === 0) return 'OTHER'; // coverage<threshold인데 missing이 없는 경우는 이론상 없음(방어적)

  // [실측 근거] busan-coverage-audit.ts: 부산 16개 구·군 중 14개가 ApartmentLocationFeature
  // 행 자체가 0건이라 transport/living/schoolAccess가 항상 통째로 NOT_SCORED로 나온다 —
  // 이게 현재 "준비 중"의 지배적 실제 원인이라 별도 코드로 구분해서 운영자가 "부분
  // 데이터 부족"과 "지역 자체 미수집"을 헷갈리지 않게 한다.
  if (LOCATION_DEPENDENT_KEYS.every((k) => missing.has(k))) return 'FEATURE_CACHE_MISSING';

  if (missing.size === 1) {
    const only = [...missing][0];
    if (only === 'transport') return 'MISSING_TRANSPORT';
    if (only === 'living') return 'MISSING_LIVING';
    if (only === 'parking') return 'MISSING_PARKING';
    if (only === 'complex') return 'MISSING_COMPLEX';
    if (only === 'schoolAccess') return 'MISSING_SCHOOL';
  }

  return 'INSUFFICIENT_TOTAL_COVERAGE';
}

// [§19] 운영자(admin/dev)만 보는 상세 문구 — 공개 API에는 절대 노출하지 않는다.
export const PREPARING_REASON_ADMIN_LABEL: Record<PreparingReasonCode, string> = {
  FEATURE_CACHE_MISSING: '위치 기반 feature(교통/생활/학교) 데이터가 이 지역에 아직 수집되지 않음',
  MISSING_TRANSPORT: '교통 feature 데이터 부족',
  MISSING_LIVING: '생활 feature 데이터 부족',
  MISSING_PARKING: '주차 데이터(ApartmentMaster.parkingCount/totalHouseholds) 부족',
  MISSING_COMPLEX: '단지 특성 데이터(ApartmentMaster) 부족',
  MISSING_SCHOOL: '학교 접근성 feature 데이터 부족',
  INSUFFICIENT_TOTAL_COVERAGE: '여러 카테고리가 부분적으로 부족해 최소 coverage 기준 미달',
  OTHER: '분류되지 않은 원인 — 직접 확인 필요',
};

// [§19] 사용자에게 보이는 문구 — 항상 "준비 중"일 뿐 내부 원인/coverage/weight를
// 암시하지 않는다. 어떤 reason이든 동일한 문구를 쓴다(원인별로 다른 문구를 주면
// 역으로 내부 구조를 추측할 수 있게 되므로).
export const PREPARING_REASON_PUBLIC_MESSAGE = {
  title: '이집점수 준비 중',
  body: '일부 단지 정보가 아직 충분하지 않습니다.',
} as const;
