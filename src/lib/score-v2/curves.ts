/**
 * E-JIP SCORE V2 — frozen absolute scoring curves.
 *
 * STEP 2/3/3.5/3.7 문서에서 확정한 curve anchor 그대로 구현한다.
 * anchor 변경 금지 — STEP 3.7에서 FINAL_CANDIDATE_FROZEN=YES 선언된 formula.
 *
 * 이 파일은 scripts/score-v2-step2/curves.ts (prototype)의
 * production-quality 버전이다. 동일한 formula를 사용하므로
 * 향후 분석 script가 이 파일을 import할 수 있다.
 *
 * 모든 함수는 순수 함수(side-effect 없음, DB 접근 없음).
 */

// ---------------------------------------------------------------------------
// 공용 헬퍼 (prototype curves.ts와 동일)
// ---------------------------------------------------------------------------

/**
 * floor/ceil로 극단값 절벽을 방지한다.
 * 내부 계산은 이 함수를 통해 항상 [5, 95] 범위로 clamping된다.
 * display rounding은 이 함수 밖 호출부에서 수행한다.
 */
export function clampScore(score: number, floor = 5, ceil = 95): number {
  return Math.min(ceil, Math.max(floor, score));
}

/**
 * 선형 보간 헬퍼 — piecewiseLinear 내부에서만 사용.
 * x1 === x0이면 y0 반환(division by zero 방지).
 */
function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

/**
 * 정렬된 (x,y) anchor 배열에서 piecewise-linear 보간.
 * x가 범위 밖이면 끝값 유지(clamp).
 */
function piecewiseLinear(x: number, anchors: readonly [number, number][]): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (x >= x0 && x <= x1) return lerp(x, x0, x1, y0, y1);
  }
  return anchors[anchors.length - 1][1];
}

/**
 * 거리류(낮을수록 좋음) 로지스틱 — 근거리/원거리 양쪽에서 자연스럽게 flat.
 */
function logisticDecreasing(
  x: number,
  midpoint: number,
  scale: number,
  floor: number,
  ceil: number
): number {
  return floor + (ceil - floor) / (1 + Math.exp((x - midpoint) / scale));
}

/**
 * 증가형(높을수록 좋음) 로지스틱 — parking/scale용.
 */
function logisticIncreasing(
  x: number,
  midpoint: number,
  scale: number,
  floor: number,
  ceil: number
): number {
  return floor + (ceil - floor) / (1 + Math.exp((midpoint - x) / scale));
}

// ---------------------------------------------------------------------------
// TRANSPORT — Subway distance curve (T1, A_PIECEWISE_LINEAR)
//
// Frozen anchor (STEP 2 §6 + STEP 2 최종보고 §9~15, STEP 3.7 확인):
//   0m→92, 100m→90, 150m→87, 300m→68, 500m→48, 700m→34, 800m→28,
//   1000m→20, 1500m→10, 2000m→5
//
// 근거: 부산 실측 p10=164m, p25=267m, median=397m, p75=569m, p90=758m.
// 근거리(0~150m) 구간은 역 대표점 좌표 한계로 의도적으로 평탄하게.
// ---------------------------------------------------------------------------

/** 지하철 거리 curve — VALUE 상태일 때만 호출한다. */
export function subwayDistanceRawScore(distanceM: number): number {
  const d = Math.max(0, distanceM);
  return clampScore(
    piecewiseLinear(d, [
      [0, 92], [100, 90], [150, 87], [300, 68], [500, 48],
      [700, 34], [800, 28], [1000, 20], [1500, 10], [2000, 5],
    ])
  );
}

/**
 * subway 4-state sentinel-aware score.
 *
 * - VALUE: subwayDistanceRawScore(distanceM) 그대로.
 * - CONFIRMED_ABSENT: SUBWAY_SENTINEL_FLOOR(5) = curve의 최저 등급.
 *   "없음이 확인됨"이므로 null이 아닌 명시적 worst score 반환.
 * - MISSING / INVALID_OR_UNRESOLVED: null 반환 (재분배/제외 대상).
 *   "모름"이므로 0점이나 최저값을 부여하지 않는다.
 */
export const SUBWAY_SENTINEL_FLOOR = 5 as const;

export type SubwayDataStatus =
  | 'VALUE'
  | 'CONFIRMED_ABSENT'
  | 'MISSING'
  | 'INVALID_OR_UNRESOLVED';

export function subwayScore(
  distanceM: number | null,
  status: SubwayDataStatus
): number | null {
  if (status === 'MISSING' || status === 'INVALID_OR_UNRESOLVED') return null;
  if (status === 'CONFIRMED_ABSENT') return SUBWAY_SENTINEL_FLOOR;
  // VALUE: distanceM이 있어야 함
  if (distanceM == null) return null; // 방어적 null 처리
  return subwayDistanceRawScore(distanceM);
}

// ---------------------------------------------------------------------------
// TRANSPORT — Bus (distance + count, 50:50)
//
// Frozen: bus_distance logistic(mid=110, scale=45, floor=10, ceil=95)
//         bus_count saturating(halfLife=6, ceil=95)
// ---------------------------------------------------------------------------

/** 버스 거리 score. null이면 null 반환(fake-zero 금지). */
export function busDistanceScore(distanceM: number | null): number | null {
  if (distanceM == null) return null;
  return clampScore(logisticDecreasing(Math.max(0, distanceM), 110, 45, 10, 95));
}

/** 버스 count score (saturating, halfLife=6). null이면 null 반환. */
export function busCountScore(count: number | null): number | null {
  if (count == null) return null;
  const ceil = 95;
  return clampScore(ceil * (1 - Math.pow(0.5, Math.max(0, count) / 6)), 0, ceil);
}

// ---------------------------------------------------------------------------
// COMPLEX — Age curve (A_PIECEWISE)
//
// Frozen anchor (STEP 2 §13, STEP 3.7 확인):
//   0y→95, 3y→92, 5y→88, 10y→76, 15y→65, 20y→55,
//   25y→46, 30y→37, 35y→28, 40y→20, 50y→12, 64y→8
//
// 재건축 기대 미반영 — 오직 "현재 상품성"만.
// ---------------------------------------------------------------------------

/**
 * 건축년도에서 연식(years)을 계산한다.
 * referenceYear를 외부에서 주입할 수 있어 determinism 보장.
 * 기본값은 2026 (분석 기준년도).
 */
export function buildYearToAge(buildYear: number, referenceYear = 2026): number {
  return Math.max(0, referenceYear - buildYear);
}

/** 연식(years) → age score. null이면 null 반환. */
export function ageScore(ageYears: number | null): number | null {
  if (ageYears == null) return null;
  const a = Math.max(0, ageYears);
  return clampScore(
    piecewiseLinear(a, [
      [0, 95], [3, 92], [5, 88], [10, 76], [15, 65], [20, 55],
      [25, 46], [30, 37], [35, 28], [40, 20], [50, 12], [64, 8],
    ])
  );
}

// ---------------------------------------------------------------------------
// COMPLEX — Scale/households curve (C_PIECEWISE)
//
// Frozen anchor (STEP 2 §15, STEP 3.7 확인):
//   0→15, 20→22, 50→32, 100→45, 200→58, 300→67,
//   500→78, 700→84, 1000→89, 1500→92, 2000→94, 3000→95
//
// saturating 설계: 100→500 gap > 1000→1500 gap.
// ---------------------------------------------------------------------------

/** 세대수 → scale score. null이면 null 반환. */
export function scaleScore(households: number | null): number | null {
  if (households == null) return null;
  const h = Math.max(0, households);
  return clampScore(
    piecewiseLinear(h, [
      [0, 15], [20, 22], [50, 32], [100, 45], [200, 58], [300, 67],
      [500, 78], [700, 84], [1000, 89], [1500, 92], [2000, 94], [3000, 95],
    ])
  );
}

// ---------------------------------------------------------------------------
// COMPLEX — Parking curve (C_PIECEWISE)
//
// Frozen anchor (STEP 2 §17, STEP 3.7 확인):
//   0→5, 0.5→15, 0.7→28, 0.9→42, 1.0→50, 1.1→58,
//   1.2→68, 1.4→80, 1.6→88, 1.8→91, 2.0→93, 2.5→95
//
// V1의 1.09→18 / 1.58→95 (77pt 격차) 재발 방지.
// 이 curve: 1.09→~57, 1.58→~88 (31pt 격차).
// ---------------------------------------------------------------------------

/**
 * parking ratio → parking factor score. null이면 null 반환.
 *
 * 중요: raw ratio가 null인 경우(parking MISSING)에 이 함수는 null을 반환한다.
 * P-D era-conditioned treatment는 complex.ts의 complexDomain()에서 적용한다.
 * 이 함수에서 era neutral을 주입하지 않는다.
 */
export function parkingScore(ratio: number | null): number | null {
  if (ratio == null) return null;
  const r = Math.max(0, ratio);
  return clampScore(
    piecewiseLinear(r, [
      [0, 5], [0.5, 15], [0.7, 28], [0.9, 42], [1.0, 50], [1.1, 58],
      [1.2, 68], [1.4, 80], [1.6, 88], [1.8, 91], [2.0, 93], [2.5, 95],
    ])
  );
}

// ---------------------------------------------------------------------------
// EDUCATION — Elementary distance curve (logistic)
//
// Frozen: logistic(mid=420, scale=180, floor=8, ceil=95)
//
// 근거: 실측 median=341m, p75=461m, p90=592m.
// subway보다 넓은 scale(180) — 초등 도보통학 체감 스케일이 다름.
// ---------------------------------------------------------------------------

/**
 * 초등학교 거리(m) → education 접근성 score.
 * null이면 null 반환.
 *
 * Education = Accessibility/Environment 지표이며 학업성취도·학교서열 아님.
 * Kakao POI 기준 nearestElementaryDistanceM 전용.
 * 공식 통학구역 distance는 School 좌표 0%로 계산 불가(STEP 2 §22).
 */
export function elementaryDistanceScore(distanceM: number | null): number | null {
  if (distanceM == null) return null;
  return clampScore(logisticDecreasing(Math.max(0, distanceM), 420, 180, 8, 95));
}

// ---------------------------------------------------------------------------
// LIVING — POI count saturation curves (L-A)
//
// Frozen spec (STEP 2 §31, STEP 3 §16, STEP 3.7 확인):
//   category별 halfLife:
//     mart(1000m): halfLife=2    편의점(500m): halfLife=8
//     약국(500m):  halfLife=5    병원(1000m): halfLife=20
//     공원(1000m): halfLife=6    어린이집(500m): halfLife=3
//
// L-A composition: convenience 30% / mart 20% / pharmacy 25% / hospital 25%
// (park과 daycare는 Evidence로만 기록, L-A score에는 미편입 — STEP 3.7 확인)
// ---------------------------------------------------------------------------

/**
 * POI count → saturation score (halfLife 포화 공식).
 * score = 95 * (1 - 0.5^(count/halfLife))
 * count=halfLife일 때 정확히 ceil의 절반.
 * null이면 null 반환.
 */
export function livingCountScore(count: number | null, halfLife: number): number | null {
  if (count == null) return null;
  const ceil = 95;
  return clampScore(ceil * (1 - Math.pow(0.5, Math.max(0, count) / halfLife)), 0, ceil);
}

/** L-A living category spec (halfLife). */
export interface LivingCategorySpec {
  // key는 LivingRawCounts의 속성명과 일치하나, 순환 import 방지를 위해 string으로 선언
  key: string;
  halfLife: number;
  label: string;
}

export const LIVING_CATEGORY_SPECS: readonly LivingCategorySpec[] = [
  { key: 'martCount1000m',           halfLife: 2,  label: '마트(1000m)' },
  { key: 'convenienceCount500m',     halfLife: 8,  label: '편의점(500m)' },
  { key: 'pharmacyCount500m',        halfLife: 5,  label: '약국(500m)' },
  { key: 'hospitalCount1000m',       halfLife: 20, label: '병원(1000m)' },
  { key: 'parkCount1000m',           halfLife: 6,  label: '공원(1000m)' },
  { key: 'daycareKindergartenCount500m', halfLife: 3, label: '어린이집/유치원(500m)' },
] as const;
