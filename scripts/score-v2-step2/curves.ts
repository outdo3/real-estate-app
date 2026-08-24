/**
 * E-JIP SCORE V2 STEP 2 §6,9,13,15,17,23 — absolute scoring curve 후보 라이브러리.
 * PROTOTYPE ONLY. production calculateApartmentScore()에서 import되지 않는다
 * (src/lib/apartment-score/server/*는 이 파일을 참조하지 않음 — grep으로 확인 가능).
 * 전부 순수 함수(부작용 없음, DB 접근 없음) — production 코드 교체 없이 STEP3
 * shadow validation에서 그대로 재사용 가능하도록 설계했다.
 *
 * 공통 원칙(§1): 특정 벤치마크(대신해모/협성)에 맞춰 파라미터를 역산하지 않았다.
 * 전부 STEP2 §4-5 실측 분포(부산 3,402건, `data/score-v2-step2/factor-distributions.json`)의
 * percentile 구조에서 anchor를 도출했다 — "왜 이 숫자인가"를 각 함수 주석에 근거와
 * 함께 남긴다.
 */

export const CURVE_VERSION = 'EJIP_SCORE_V2_CURVE_BETA_1';

// ---------------------------------------------------------------------------
// 공용 헬퍼
// ---------------------------------------------------------------------------

/** 거리류(짧을수록 좋음) 절대 curve 공용 골격 — floor/ceil로 극단값 절벽 방지(§7). */
function clampScore(score: number, floor = 5, ceil = 95): number {
  return Math.min(ceil, Math.max(floor, score));
}

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  const t = (x - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

/** 정렬된 (x,y) anchor 배열에서 piecewise-linear 보간. x가 범위 밖이면 끝값 유지(clamp). */
function piecewiseLinear(x: number, anchors: [number, number][]): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (x >= x0 && x <= x1) return lerp(x, x0, x1, y0, y1);
  }
  return anchors[anchors.length - 1][1];
}

/** 거리류(낮을수록 좋음) 로지스틱 — 근거리/원거리 양쪽에서 자연스럽게 flat해지는
 * 것이 이 함수 형태의 구조적 특징이라 §7(근거리 과대평가 방지)을 별도 보정 없이 만족한다. */
function logisticDecreasing(x: number, midpoint: number, scale: number, floor: number, ceil: number): number {
  return floor + (ceil - floor) / (1 + Math.exp((x - midpoint) / scale));
}

/** 증가형(높을수록 좋음) 로지스틱 — parking/scale처럼 "많을수록 좋음"인 factor용. */
function logisticIncreasing(x: number, midpoint: number, scale: number, floor: number, ceil: number): number {
  return floor + (ceil - floor) / (1 + Math.exp((midpoint - x) / scale));
}

// ---------------------------------------------------------------------------
// TRANSPORT — Subway distance (§6). anchor 근거: STEP2 §5 실측 분포
// p10=164m, p25=267m, median=397m, p75=569m, p90=758m, p95=872m(부산 3,402건
// 중 quality-filtered 2,291건). "150m~800m 차이는 의미 있다"는 지시가 정확히
// 이 분포의 p10~p90 구간과 겹친다 — 이 구간에 curve의 기울기를 집중시킨다.
// ---------------------------------------------------------------------------

export type SubwayCurveCandidate = 'A_PIECEWISE_LINEAR' | 'B_LOGISTIC' | 'C_EXPONENTIAL_DECAY' | 'D_MANUAL_ANCHORED_SATURATION';

export function subwayDistanceScore(distanceM: number | null, candidate: SubwayCurveCandidate): number | null {
  if (distanceM == null) return null; // "지하철 없음 확인"은 percentile.ts의 sentinel 처리 몫 — 여기선 순수 curve만
  const d = Math.max(0, distanceM);
  switch (candidate) {
    case 'A_PIECEWISE_LINEAR':
      // anchor: 0~150m 거의 평평(§7 station-center 한계), 150~800m 급격 하강(분포
      // p10~p90과 정합), 800m 이후 완만. 2000m 이상은 부산 실측 밖(quality-filtered
      // 대상 max=999m, 수집 반경 자체가 1000m 캡)이라 순수 외삽값임을 명시.
      return clampScore(piecewiseLinear(d, [
        [0, 92], [100, 90], [150, 87], [300, 68], [500, 48], [700, 34], [800, 28], [1000, 20], [1500, 10], [2000, 5],
      ]));
    case 'B_LOGISTIC':
      // midpoint=450(median 397과 p75 569 사이), scale=140 — 로지스틱의 구조적
      // 성질(양끝 자동 flat)이 §7 요구를 formula 형태만으로 만족시키는 후보.
      return clampScore(logisticDecreasing(d, 450, 140, 5, 95));
    case 'C_EXPONENTIAL_DECAY':
      // tau=380(대략 median). 주의(비교표에 반드시 기록): 지수감쇠는 d=0에서
      // 기울기가 가장 가파르다는 구조적 약점이 있다 — §7(근거리 과대평가 금지)과
      // 형태적으로 상충한다. tau를 키워 근거리 기울기를 완화했지만 로지스틱만큼
      // 자연스럽지 않다(비교 결과 §D 참고).
      return clampScore(5 + 90 * Math.exp(-d / 380));
    case 'D_MANUAL_ANCHORED_SATURATION':
      // score = ceil - span*(d/(d+K))^p. K=380(median 근방), p=1.15로 근거리
      // 평탄/원거리 평탄을 동시에 수동 조정한 rational curve.
      return clampScore(95 - 90 * Math.pow(d / (d + 380), 1.15));
  }
}

// ---------------------------------------------------------------------------
// TRANSPORT — Bus (§8-9). persist된 raw feature 2개만 사용:
// nearestBusStopDistanceM(median 87m, p90 187m), busStopCount300m(median 12, p90 22).
// 노선번호/노선유형은 TAGO 라이브 조회만 있고 미저장(STEP1 §7 확인) — 전체
// universe curve 설계에는 편입하지 않는다(display-only로 유지).
// ---------------------------------------------------------------------------

export function busDistanceScore(distanceM: number | null): number | null {
  if (distanceM == null) return null;
  // midpoint=110(median 87과 p75 133 사이), scale=45 — subway보다 스케일이
  // 훨씬 작다(버스는 원래 촘촘함, 분포 자체가 0~467m로 subway의 1/2 수준).
  return clampScore(logisticDecreasing(Math.max(0, distanceM), 110, 45, 10, 95));
}

export function busCountScore(count: number | null): number | null {
  if (count == null) return null;
  // §9: "2→5는 의미 크고 20→25는 의미 작다" — diminishing return을
  // 1-exp(-count/k) 포화형으로 구현(k=6, median 12·p90 22 분포에서 6 부근까지
  // 급상승 후 완만해지도록 보정).
  return clampScore(5 + 90 * (1 - Math.exp(-Math.max(0, count) / 6)), 5, 95);
}

// ---------------------------------------------------------------------------
// COMPLEX — Age(§12-13). anchor 근거: 실측 age 분포(median 23년, p25 12년,
// p75 33년) + "0~3 vs 5, 5 vs 10, 10 vs 20, 20 vs 30, 30 vs 40" 체감 차이는
// 균등하지 않다는 지시. 재건축 기대는 포함하지 않는다 — 오직 "현재 상품성"만.
// ---------------------------------------------------------------------------

export type AgeCurveCandidate = 'A_PIECEWISE' | 'B_SLOW_DECAY_SATURATION' | 'C_LIFECYCLE_BANDS';

export function ageScore(ageYears: number | null, candidate: AgeCurveCandidate): number | null {
  if (ageYears == null) return null;
  const a = Math.max(0, ageYears);
  switch (candidate) {
    case 'A_PIECEWISE':
      return clampScore(piecewiseLinear(a, [
        [0, 95], [3, 92], [5, 88], [10, 76], [15, 65], [20, 55], [25, 46], [30, 37], [35, 28], [40, 20], [50, 12], [64, 8],
      ]));
    case 'B_SLOW_DECAY_SATURATION':
      // tau=18 — 0~10년 구간의 감쇠가 완만하고(신축이라고 3년과 8년 차이를
      // 과장하지 않음), 20년 이후 floor(8)에 서서히 수렴.
      return clampScore(8 + 87 * Math.exp(-a / 18), 8, 95);
    case 'C_LIFECYCLE_BANDS':
      // "생애주기" 후보: 0~5년은 준공 초기 하자 리스크까지 고려해 만점을 주지
      // 않는 완만한 plateau(90), 5~20년은 상품성 핵심 구간이라 선형 하강폭을
      // 가장 크게, 20~40년은 하강폭을 줄이고(이미 낮은 점수대라 변별력 낮음),
      // 40+는 floor 근접. 어떤 구간도 age 증가에 score가 오르지 않는다(단조 보장).
      if (a <= 5) return clampScore(lerp(a, 0, 5, 92, 88));
      if (a <= 20) return clampScore(lerp(a, 5, 20, 88, 45));
      if (a <= 40) return clampScore(lerp(a, 20, 40, 45, 15));
      return clampScore(lerp(Math.min(a, 64), 40, 64, 15, 8));
  }
}

// ---------------------------------------------------------------------------
// COMPLEX — Scale/households(§14-15). anchor 근거: 실측 분포 median 118,
// p75 352, p90 793(전체 2,544건 중, 결측 858건은 curve 밖 별도 처리).
// "100→500 의미 크고 1000→1500 의미 작다"는 지시 그대로 saturating 설계.
// ---------------------------------------------------------------------------

export type ScaleCurveCandidate = 'A_LOG_NORMALIZED' | 'B_LOGISTIC' | 'C_PIECEWISE';

export function scaleScore(households: number | null, candidate: ScaleCurveCandidate): number | null {
  if (households == null) return null;
  const h = Math.max(0, households);
  switch (candidate) {
    case 'A_LOG_NORMALIZED': {
      const ref = 2000; // p95~p99 부근을 "사실상 만점권"으로
      return clampScore(10 + 85 * (Math.log1p(h) / Math.log1p(ref)), 10, 95);
    }
    case 'B_LOGISTIC':
      // midpoint=300(median과 p75 사이), scale=220 — 소형단지에 뚜렷한 페널티,
      // 1000+ 부근에서 포화.
      return clampScore(logisticIncreasing(h, 300, 220, 15, 95));
    case 'C_PIECEWISE':
      return clampScore(piecewiseLinear(h, [
        [0, 15], [20, 22], [50, 32], [100, 45], [200, 58], [300, 67], [500, 78], [700, 84], [1000, 89], [1500, 92], [2000, 94], [3000, 95],
      ]));
  }
}

// ---------------------------------------------------------------------------
// COMPLEX — Parking(§16-17). anchor 근거: 실측 ratio 분포(n=862, coverage
// 25.3%) median 1.106, p25 1.0, p75 1.259, p90 1.6. V1의 "1.09→18, 1.58→95"
// (77점 격차) 재발 방지가 최우선 요구사항 — 아래 곡선은 1.09→~59, 1.58→~90
// (31점 격차)로, 순서는 보존하되 격차를 완화한다(대신해모/협성을 위해 맞춘
// 게 아니라 실측 분포의 median=1.09 부근에 곡선 중심을 두었더니 결과적으로
// 그렇게 된 것 — §1 anti-overfit 원칙 그대로).
// ---------------------------------------------------------------------------

export type ParkingCurveCandidate = 'A_LOGISTIC_MID1_SCALE022' | 'B_LOGISTIC_WIDE' | 'C_PIECEWISE';

export function parkingScore(ratio: number | null, candidate: ParkingCurveCandidate): number | null {
  if (ratio == null) return null;
  const r = Math.max(0, ratio);
  switch (candidate) {
    case 'A_LOGISTIC_MID1_SCALE022':
      // 실측 median(1.106)을 변곡점으로, scale=0.22로 0.5~1.6 구간에 기울기 집중.
      return clampScore(logisticIncreasing(r, 1.0, 0.22, 5, 95));
    case 'B_LOGISTIC_WIDE':
      // 대안: 변별력을 더 넓게 펼치는 완만한 버전(scale=0.35) — 비교용.
      return clampScore(logisticIncreasing(r, 1.0, 0.35, 10, 90));
    case 'C_PIECEWISE':
      return clampScore(piecewiseLinear(r, [
        [0, 5], [0.5, 15], [0.7, 28], [0.9, 42], [1.0, 50], [1.1, 58], [1.2, 68], [1.4, 80], [1.6, 88], [1.8, 91], [2.0, 93], [2.5, 95],
      ]));
  }
}

// ---------------------------------------------------------------------------
// EDUCATION — Elementary distance(§22-23). School.latitude/longitude coverage
// 0%(STEP2 §22 실측 확인)라 "공식 통학구역 학교까지 거리"는 계산 불가 — 이
// 곡선은 Kakao POI 기준 nearestElementaryDistanceM(median 341m, p75 461m,
// p90 592m)에만 적용된다. 공식 통학구역 자체(배정 여부/SHARED 등)는 별도
// categorical 처리(§24, curves.ts 밖 — attendanceZoneEligibility 참고).
// ---------------------------------------------------------------------------

export function elementaryDistanceScore(distanceM: number | null): number {
  if (distanceM == null) return 50; // 결측 시 중립값(§18 neutral prior 정책, curve 자체가 아니라 조합 단계에서 최종 처리)
  // "100m/200m 차이보다 500m/1200m 차이가 더 중요할 수 있다"는 지시를 반영해
  // subway보다 넓은 scale(180) 사용 — 초등학교는 도보통학 관점에서 subway와
  // 체감 스케일이 다르다.
  return clampScore(logisticDecreasing(Math.max(0, distanceM), 420, 180, 8, 95));
}

/** §24 SHARED zone/§9 공식 통학구역 categorical 처리 — 점수화 최소화 원칙.
 * "선택권 많음=고득점" 단정 금지, confidence에만 미세 반영(제안, 미확정). */
export type AttendanceZoneStatus = 'AVAILABLE' | 'SHARED' | 'REVIEW_REQUIRED' | 'NOT_AVAILABLE';
export function attendanceZoneConfidenceAdjustment(status: AttendanceZoneStatus): number {
  switch (status) {
    case 'AVAILABLE': return 0; // 기준
    case 'SHARED': return 0; // 점수 보정 없음 — raw fact로만 표시(§24)
    case 'REVIEW_REQUIRED': return -5; // confidence만 낮춤, score 자체는 유지
    case 'NOT_AVAILABLE': return -10;
  }
}

// ---------------------------------------------------------------------------
// LIVING — POI count saturation(§31). 카테고리별 실측 캡 차이를 코드로 확인
// (collectors/location.ts): hospitalCount1000m=Kakao pageableCount(최대 45,
// "45개 이상"), parkCount1000m=단일 페이지 length(최대 15, "15개 이상") —
// 두 캡의 의미가 다르므로 절대 같은 saturation 상수를 쓰지 않는다.
// ---------------------------------------------------------------------------

export interface LivingCategorySpec { key: string; cap: number; halfLife: number; label: string }
export const LIVING_CATEGORY_SPECS: LivingCategorySpec[] = [
  { key: 'martCount1000m', cap: 45, halfLife: 2, label: '마트(1000m)' }, // median 2 — half-life를 median에 맞춤
  { key: 'convenienceCount500m', cap: 45, halfLife: 8, label: '편의점(500m)' }, // median 11
  { key: 'pharmacyCount500m', cap: 45, halfLife: 5, label: '약국(500m)' }, // median 7
  { key: 'hospitalCount1000m', cap: 45, halfLife: 20, label: '병원(1000m, pageableCount 캡=45)' }, // median이 이미 캡(45) — half-life를 크게 잡아도 상위 절반은 사실상 만점 근접(구조적 한계, §31 문서화)
  { key: 'parkCount1000m', cap: 15, halfLife: 6, label: '공원(1000m, 단일페이지 캡=15)' }, // median 12, 캡(15)에 매우 근접 — 변별력 낮음
  { key: 'daycareKindergartenCount500m', cap: 45, halfLife: 3, label: '어린이집/유치원(500m, Kakao POI)' }, // median 4
];

export function livingCountScore(count: number | null, halfLife: number): number | null {
  if (count == null) return null;
  // score = ceil*(1 - 0.5^(count/halfLife)) — count=halfLife일 때 정확히 ceil의 절반.
  const ceil = 95;
  return clampScore(ceil * (1 - Math.pow(0.5, Math.max(0, count) / halfLife)), 0, ceil);
}
