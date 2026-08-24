/**
 * E-JIP SCORE V2 — type definitions.
 *
 * 이 파일은 V2 engine의 input/output contract를 정의한다.
 * V1(`src/lib/apartment-score/server/`) 타입과 의도적으로 분리한다 —
 * V2는 raw-fact → absolute score 방식이며 V1의 peer-percentile 구조를 사용하지 않는다.
 *
 * 핵심 설계 원칙:
 * - raw input과 derived score를 타입 레벨에서 분리한다.
 * - missing data를 null로 전달하고, 0이나 추정값으로 채우지 않는다.
 * - parking raw status와 model treatment를 분리한다.
 *   (P-D era-conditioned neutral은 내부 treatment이며 raw ratio 필드를 생성하지 않는다)
 */

// ---------------------------------------------------------------------------
// Score version
// ---------------------------------------------------------------------------

/** V2 engine이 반환하는 scoreVersion 식별자. */
export const SCORE_V2_VERSION = 'EJIP_SCORE_V2_1';

// ---------------------------------------------------------------------------
// Subway data status — 4-state sentinel (STEP 3 §3 frozen)
// ---------------------------------------------------------------------------

/**
 * 지하철 데이터 상태 — STEP 3 §3의 4-state 구분.
 *
 * - VALUE: 실제 거리값 보유 (nearestSubwayDistanceM != null)
 * - CONFIRMED_ABSENT: qualityFlag='complete'이고 반경 내 역이 없음을 확인한 경우.
 *   "모름"이 아니라 "없음이 확인된" 상태 → curve floor(5)로 명시적 채점.
 * - MISSING: 수집 실패 또는 좌표 불충분 → null 반환, 재분배 대상.
 * - INVALID_OR_UNRESOLVED: 상태 판별 자체가 불가능한 경우 → MISSING과 동일 처리.
 *
 * CONFIRMED_ABSENT ≠ MISSING: 절대 동일 처리하지 않는다.
 */
export type SubwayDataStatus =
  | 'VALUE'
  | 'CONFIRMED_ABSENT'
  | 'MISSING'
  | 'INVALID_OR_UNRESOLVED';

// ---------------------------------------------------------------------------
// Parking raw status — raw 상태와 model treatment 분리
// ---------------------------------------------------------------------------

/**
 * Parking 데이터 원시 상태.
 * P-D model treatment는 engine 내부에서만 사용하며, 이 타입에 값을 생성하지 않는다.
 */
export type ParkingRawStatus =
  | 'KNOWN'    // parkingRatio가 실제 존재
  | 'MISSING'; // parkingRatio = null (registry 미연결 또는 미수집)

/**
 * P-D era-conditioned model에서 사용하는 연식 band 키.
 * STEP 3.5 §6-8 실측: KNOWN 단지의 parking factor score 조건부 평균.
 *
 * '0-10': 65.2 → 65 (반올림)
 * '11-20': 67.8 → 68
 * '21-30': 52.6 → 53
 * '31+': 21.7 → 22
 *
 * (출처: STEP35 step35.test.ts ctx 상수 — 실제 DB 조회 결과)
 */
export type ParkingEraBand = '0-10' | '11-20' | '21-30' | '31+';

/** parking era band → P-D neutral prior (factor score 단위, 0~100). */
export const PARKING_ERA_NEUTRAL: Record<ParkingEraBand, number> = {
  '0-10': 65,
  '11-20': 68,
  '21-30': 53,
  '31+': 22,
} as const;

// ---------------------------------------------------------------------------
// Attendance zone status (Education)
// ---------------------------------------------------------------------------

/**
 * 공식 통학구역 categorical 상태 — score에 반영하지 않고 evidence로만 기록한다.
 * (STEP 2 §24: 점수화 최소화 원칙)
 */
export type AttendanceZoneStatus =
  | 'AVAILABLE'
  | 'SHARED'
  | 'REVIEW_REQUIRED'
  | 'NOT_AVAILABLE';

// ---------------------------------------------------------------------------
// V2 Engine Input — raw facts only
// ---------------------------------------------------------------------------

/** Living POI raw counts (DB에서 직접 읽은 값). category=null이면 수집 자체 없음. */
export interface LivingRawCounts {
  /** 마트 1000m 이내 (Kakao pageableCount 기준, 최대 45). null = 수집 없음. */
  martCount1000m: number | null;
  /** 편의점 500m 이내. null = 수집 없음. */
  convenienceCount500m: number | null;
  /** 약국 500m 이내. null = 수집 없음. */
  pharmacyCount500m: number | null;
  /** 병원 1000m 이내 (pageableCount, 최대 45 → 변별력 낮음). null = 수집 없음. */
  hospitalCount1000m: number | null;
  /** 공원 1000m 이내 (단일 페이지 length, 최대 15). null = 수집 없음. */
  parkCount1000m: number | null;
  /** 어린이집/유치원 500m 이내 (Kakao POI). null = 수집 없음. */
  daycareKindergartenCount500m: number | null;
}

/** V2 engine에 전달하는 단지 raw input. */
export interface ScoreV2Input {
  /** 식별자 — engine이 DB를 조회하지 않으므로 호출부가 공급한다. */
  aptSeq: string;

  // ---- Complex domain: age / scale / parking ----
  /** 건축년도 (예: 2020). null이면 age 계산 불가(coverage 하락). */
  buildYear: number | null;
  /** 총 세대수. null이면 scale 계산 불가. */
  totalHouseholds: number | null;
  /**
   * 세대당 주차 비율 (parkingCount / totalHouseholds).
   * KNOWN → 실제 비율값. MISSING → null.
   * P-D era-neutral treatment는 engine 내부에서만 적용.
   */
  parkingRatio: number | null;
  /** parking raw 상태 — type-level로 raw status와 model treatment를 분리한다. */
  parkingRawStatus: ParkingRawStatus;

  // ---- Transport domain: subway + bus ----
  /** 지하철 데이터 상태 (4-state sentinel). */
  subwayStatus: SubwayDataStatus;
  /** 지하철 거리(m). subwayStatus=VALUE인 경우에만 유효. */
  nearestSubwayDistanceM: number | null;
  /** 버스 정류장 거리(m). null = 수집 없음. */
  nearestBusStopDistanceM: number | null;
  /** 300m 이내 버스 정류장 수. null = 수집 없음. */
  busStopCount300m: number | null;

  // ---- Education domain ----
  /** Kakao POI 기준 가장 가까운 초등학교 거리(m). null = 수집 없음. */
  nearestElementaryDistanceM: number | null;
  /**
   * 공식 통학구역 categorical 상태.
   * score에는 반영하지 않고, evidence 출력에만 사용.
   */
  attendanceZoneStatus: AttendanceZoneStatus;

  // ---- Living domain ----
  living: LivingRawCounts;

  // ---- Identity/coordinate eligibility ----
  /**
   * identity와 좌표가 충분히 신뢰 가능한지.
   * false이면 engine은 전체 score를 NOT_ENOUGH_DATA로 반환한다.
   * (STEP 1.5 정책 그대로 승계 — 구덕금호 사례 등)
   */
  identityEligible: boolean;
}

// ---------------------------------------------------------------------------
// Domain result shapes
// ---------------------------------------------------------------------------

/** 단일 domain의 채점 결과. */
export interface DomainResult {
  /** 최종 domain score (0~100). null이면 채점 불가. */
  score: number | null;
  /**
   * domain 내 사용된 factor의 weight 합 / 총 weight.
   * 0~1 범위. score가 null이어도 coverage는 반환한다.
   */
  coverage: number;
  /** 채점에 사용된 factor 키 목록. */
  usedFactors: string[];
  /** 결측으로 채점 제외된 factor 키 목록. */
  missingFactors: string[];
  /** explainability raw evidence — UI 문장이 아니라 structured data. */
  evidence: Record<string, number | string | boolean | null>;
}

// ---------------------------------------------------------------------------
// Score eligibility & status
// ---------------------------------------------------------------------------

/**
 * 종합점수 표시 가능 여부 — STEP 3 §21 eligibility 정책 그대로.
 * - SCORE_AVAILABLE: coverage >= 0.75, identityEligible=true
 * - LIMITED: coverage >= 0.4, identityEligible=true
 * - NOT_ENOUGH_DATA: identityEligible=false 또는 coverage < 0.4
 */
export type ScoreEligibility = 'SCORE_AVAILABLE' | 'LIMITED' | 'NOT_ENOUGH_DATA';

// ---------------------------------------------------------------------------
// Relative context (이번 STEP에서는 type만 — 실제 계산은 STEP 4B에서)
// ---------------------------------------------------------------------------

/**
 * 부산/구 단위 percentile context.
 * engine은 이 값을 계산하지 않는다 — 호출부가 외부에서 공급하는 구조.
 * LOCAL/DONG percentile은 Core input 금지(STEP 3.7 §12 확인).
 */
export interface RelativeContext {
  /** 부산 전체 percentile (0~100). */
  busanPercentile: number | null;
  /** 구·군 내 percentile (0~100). */
  sigunguPercentile: number | null;
  /** 부산 전체 rank (1 = 최고). */
  busanRank: number | null;
  /** 부산 전체 대상 단지 수. */
  busanTotal: number | null;
}

// ---------------------------------------------------------------------------
// V2 Engine Output
// ---------------------------------------------------------------------------

/** V2 engine이 반환하는 최종 결과. */
export interface ScoreV2Result {
  /** 항상 'v2'. display layer가 버전을 구분할 수 있도록. */
  scoreVersion: typeof SCORE_V2_VERSION;

  /** 종합점수 표시 가능 여부. */
  eligibility: ScoreEligibility;

  /**
   * 종합점수 (0~100). null이면 eligibility='NOT_ENOUGH_DATA'임을 의미.
   * 내부 정밀도는 float; display rounding은 호출부에서 수행.
   */
  overallScore: number | null;

  /**
   * domain별 결과. 4개 domain 모두 항상 포함 (score가 null일 수 있음).
   * W-A: transport 25% / living 25% / education 25% / complex 25%
   */
  domains: {
    transport: DomainResult;
    living: DomainResult;
    education: DomainResult;
    complex: DomainResult;
  };

  /**
   * 전체 coverage (0~1).
   * 종합점수 계산에 실제 사용된 domain weight 합 / 100.
   */
  overallCoverage: number;

  /**
   * relative context — engine이 직접 계산하지 않는다.
   * 호출부가 별도로 공급하거나, null로 두면 display layer에서 '계산 중'으로 처리.
   */
  relativeContext: RelativeContext | null;

  /**
   * 결측 이유 목록 — UI "왜 점수가 제한되나요?" 레이어용.
   * engine이 structued evidence를 내보내고 UI가 문장으로 변환한다.
   */
  missingReasons: string[];
}
