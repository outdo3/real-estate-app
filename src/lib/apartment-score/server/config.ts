import type { CategoryKey, Direction } from './types';

// STEP SCORE S2C — versioned weight/threshold config. §19: 데이터가 쌓이면
// 바뀔 수 있으므로 버전을 명시한다. client에는 이 값 자체를 절대 노출하지 않는다(§3, §42).
export const SCORE_VERSION = 'EJIP_SCORE_V1_BETA';

// 카테고리 weight. 합 100. Market은 §6/§18 사용자 승인에 따라 총점에서 제외
// (weight 0, informational-only) — "가격=좋음" 편향을 원천 차단.
// 근거(§18): coverage(교통/생활/학교 80~100% vs 주차/단지 15~34%), 중복도(교통 내부
// nearest+count 동시 과다가산 금지), 사용자 의사결정 가치(교통>생활>주차/단지/학교
// 순으로 실측 coverage와 변별력 반영), 지역 비교가능성(전부 sigungu peer로 정규화).
export const CATEGORY_WEIGHTS: Record<CategoryKey, number> = {
  transport: 30,
  living: 25,
  parking: 15,
  complex: 15,
  schoolAccess: 15,
};

// ---- 교통 내부 배분(§7): subway:bus ≈ 70:30, "거리"·"개수" 동시 과다가산 금지 ----
export const TRANSPORT_SUBWEIGHTS = {
  nearestSubwayDistanceM: 45,
  subwayCount1000m: 25,
  nearestBusStopDistanceM: 18,
  busStopCount300m: 12,
};

// ---- 생활편의 내부 배분(§10): hospitalCount1000m은 45-cap 도달률 71~75%로
// 변별력이 낮아 sub-weight 축소(사용자 확인, 2026-08-20) ----
export const LIVING_SUBWEIGHTS = {
  martCount1000m: 20,
  convenienceCount500m: 20,
  pharmacyCount500m: 15,
  hospitalCount1000m: 10,
  parkCount1000m: 20,
  daycareKindergartenCount500m: 15,
};

// ---- 단지 내부 배분(§12): buildYear는 실측상 100% coverage, 나머지는 15~34%라
// 없으면 buildYear가 재분배로 카테고리 weight 대부분/전부를 흡수한다 ----
export const COMPLEX_SUBWEIGHTS = {
  buildYear: 50,
  totalHouseholds: 30,
  mainBuildingCount: 20,
};

// ---- 학교 접근성 내부 배분(§13) ----
export const SCHOOL_ACCESS_SUBWEIGHTS = {
  nearestElementaryDistanceM: 60,
  elementaryCount1000m: 40,
};

// feature별 percentile 방향(§16) — 무조건 역순 금지, 명시적 config만 사용.
export const FEATURE_DIRECTIONS: Record<string, Direction> = {
  nearestSubwayDistanceM: 'lowerIsBetter',
  subwayCount1000m: 'higherIsBetter',
  nearestBusStopDistanceM: 'lowerIsBetter',
  busStopCount300m: 'higherIsBetter',
  martCount1000m: 'higherIsBetter',
  convenienceCount500m: 'higherIsBetter',
  pharmacyCount500m: 'higherIsBetter',
  hospitalCount1000m: 'higherIsBetter',
  parkCount1000m: 'higherIsBetter',
  daycareKindergartenCount500m: 'higherIsBetter',
  parkingPerHousehold: 'higherIsBetter',
  buildYear: 'higherIsBetter', // 최신일수록 높은 값 = 좋음. percentile 자체가 절벽식 아님(§17 score-scale 완화)
  totalHouseholds: 'higherIsBetter',
  mainBuildingCount: 'higherIsBetter',
  nearestElementaryDistanceM: 'lowerIsBetter',
  elementaryCount1000m: 'higherIsBetter',
  beachDistanceM: 'lowerIsBetter',
};

// diminishing-returns가 필요한(0→1~3개는 크게, 그 이상 완만) count류 feature(§10, §12).
// percentile 계산 전에 log1p(count) 값으로 순위를 매긴다.
export const LOG_TRANSFORM_FEATURES = new Set<string>([
  'martCount1000m',
  'convenienceCount500m',
  'pharmacyCount500m',
  'hospitalCount1000m',
  'parkCount1000m',
  'daycareKindergartenCount500m',
  'totalHouseholds',
  'mainBuildingCount',
]);

// Kakao pageable_count 상한(§9) — 45는 "정확한 개수"가 아니라 "45개 이상"으로 해석.
export const KAKAO_COUNT_CAP = 45;

// peer 표본 크기 등급(§15).
export const PEER_SAMPLE_HIGH = 10;
export const PEER_SAMPLE_MEDIUM = 5;

// score-scale 완화(§17): percentile 0→5점, 100→95점. 극단값 절벽 방지.
export const SCORE_FLOOR = 5;
export const SCORE_CEIL_SPAN = 90; // score = SCORE_FLOOR + percentile/100 * SCORE_CEIL_SPAN

// 최소 총점 표시 커버리지(§21). 실측 근거: parking(15)+complex(15) 둘 다 missing인
// 최악의 경우에도 transport(30)+living(25)+schoolAccess(15)=70%는 남아, 0.6 기준이면
// 거의 항상 계산되고 실제로 전 카테고리가 비어있는 예외적 경우만 걸러진다.
export const MIN_TOTAL_COVERAGE = 0.6;

// Market category 최소 거래표본(§30). 서구 33.8%/해운대 17.6%가 거래 1건 —
// 1건짜리 medianPrice는 표시하되 "활발도" 서술은 하지 않는다.
export const MIN_TRANSACTION_SAMPLE = 3;

// Regional Premium 임계치(§24): sigungu peer 내 상위 %.
export const REGIONAL_STRENGTH_STRONG_PERCENTILE = 90; // 상위 10%
export const REGIONAL_STRENGTH_NOTABLE_PERCENTILE = 80; // 상위 20%
// eligibility gate(§25): 이 정도 표본은 있어야 지역 내 순위가 의미 있음.
export const REGIONAL_STRENGTH_MIN_SAMPLE = 20;
