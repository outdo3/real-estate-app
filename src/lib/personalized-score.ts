// PERSONALIZED_SCORE_V1 P2-B — "나에게 맞는 점수" 순수 계산 엔진 + 설명 항목.
// docs/development/PERSONALIZED_SCORE_V1.md
//
// 입력: 기존 공통 점수 응답의 V2 결과(`_shadowV2`, engine ScoreV2Result 모양) + 사용자 중요도(fitImportance).
// 출력: 새 결과 객체. 공통 점수 객체는 읽기만 하고 절대 바꾸지 않는다. DB·네트워크·시간·난수·React 의존 없음
// → 상세·비교(서버/클라이언트) 어디서든 같은 결과.
//
// 규칙(PHASE 1 결정 + P2-B 승인):
//  - 축 점수는 공통 엔진이 이미 계산한 값만 쓴다(새 curve·추정 없음).
//  - 결측 축은 0점이 아니라 분모에서 제외하고 재정규화한다.
//  - 주차는 **실측(KNOWN) 요소 점수만** 쓴다. 공통 점수가 결측 시 쓰는 연식대 중립값은 절대 쓰지 않는다.
//  - coverage(포함된 중요도 / 전체 중요도) < 0.60 → LIMITED, 포함 축 0개 → 계산 불가.
//  - 설명은 중요도 4~5인 축만, 표시 정수 점수 기준 75 이상 GOOD / 45 이하 WEAK, 그 사이·결측은 설명하지 않는다.
//  - 교육 도메인은 "초등학교 접근성"(초등학교 직선거리 기반)으로만 부른다.
import { FIT_AXES, FIT_AXIS_LABELS, parseFitImportance, type FitAxis, type FitImportance, type FitImportanceLevel } from './fit-importance';

export const PERSONAL_FIT_LIMITED_BELOW_COVERAGE = 0.6;
export const PERSONAL_FIT_EXPLAIN_MIN_IMPORTANCE = 4;
export const PERSONAL_FIT_GOOD_MIN_SCORE = 75;
export const PERSONAL_FIT_WEAK_MAX_SCORE = 45;

/** 축별 기존 점수 출처(공통 점수 V2 결과 안의 위치). */
export const PERSONAL_AXIS_SOURCE: Record<FitAxis, string> = {
  transport: 'domains.transport.score',
  living: 'domains.living.score',
  newness: 'domains.complex.evidence.ageScore',
  parking: 'domains.complex.evidence.parkingScore (parkingRawStatus=KNOWN, parkingModelTreatment=KNOWN_VALUE only)',
  elementarySchoolAccess: 'domains.education.score',
};

export const PERSONAL_FIT_PHRASES: Record<FitAxis, { good: string; weak: string }> = {
  transport: { good: '교통 접근성이 선호에 잘 맞아요', weak: '교통 접근성은 선호보다 아쉬워요' },
  living: { good: '생활편의시설 접근성이 잘 맞아요', weak: '생활편의시설 접근성은 선호보다 아쉬워요' },
  newness: { good: '신축 선호에 잘 맞아요', weak: '건물 연식은 신축 선호보다 아쉬워요' },
  parking: { good: '주차 여건이 선호에 잘 맞아요', weak: '주차 여건은 선호보다 아쉬워요' },
  elementarySchoolAccess: { good: '초등학교 접근성이 선호에 잘 맞아요', weak: '초등학교 접근성은 선호보다 아쉬워요' },
};

/** 축이 계산에서 빠진 이유. */
export type PersonalAxisExclusion =
  | 'NO_DATA' // 공통 점수에 이 축 값이 없음
  | 'PARKING_NOT_MEASURED' // 주차 실측값 없음(공통 점수는 중립값을 썼을 수 있음)
  | 'INVALID_SCORE'; // 숫자가 아니거나 0~100 밖

export interface PersonalAxisResult {
  axis: FitAxis;
  label: string;
  importance: FitImportanceLevel;
  /** 공통 엔진의 축 점수(0~100, 반올림 전). 제외되면 null. */
  score: number | null;
  included: boolean;
  exclusion: PersonalAxisExclusion | null;
}

export interface PersonalFitExplanation {
  axis: FitAxis;
  label: string;
  importance: FitImportanceLevel;
  /** 표시 정수 점수(공통 점수와 같은 Math.round). 임계값 비교도 이 값으로 한다. */
  displayScore: number;
  text: string;
}

export type PersonalFitUnavailableReason = 'NO_PREFERENCE' | 'NO_COMMON_SCORE' | 'NO_INCLUDED_AXES';

export type PersonalFitResult =
  | { status: 'UNAVAILABLE'; reason: PersonalFitUnavailableReason }
  | {
      status: 'FULL' | 'LIMITED';
      /** 표시용 정수(0~100, Math.round). */
      score: number;
      /** 반올림 전 값. */
      rawScore: number;
      /** 포함된 중요도 합 / 전체 중요도 합(0~1). */
      coverage: number;
      includedAxes: FitAxis[];
      excludedAxes: FitAxis[];
      axisResults: PersonalAxisResult[];
      goodFit: PersonalFitExplanation[];
      weakFit: PersonalFitExplanation[];
    };

type AxisValue = { score: number | null; exclusion: PersonalAxisExclusion | null };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function validScore(v: unknown): AxisValue {
  if (v === null || v === undefined) return { score: null, exclusion: 'NO_DATA' };
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) return { score: null, exclusion: 'INVALID_SCORE' };
  return { score: v, exclusion: null };
}

/** 공통 점수 V2 결과가 "표시 가능한 점수"인지 — 비교 화면(buildScore)·peer universe와 같은 기준. */
export function isCommonScoreAvailable(shadowV2: unknown): boolean {
  if (!isRecord(shadowV2)) return false;
  if (shadowV2.eligibility === 'NOT_ENOUGH_DATA') return false;
  return typeof shadowV2.overallScore === 'number' && Number.isFinite(shadowV2.overallScore);
}

/** 공통 점수 V2 결과 → 5축 점수. 읽기만 한다. */
export function extractPersonalAxisScores(shadowV2: unknown): Record<FitAxis, AxisValue> {
  const domains = isRecord(shadowV2) && isRecord(shadowV2.domains) ? shadowV2.domains : {};
  const domain = (k: string) => (isRecord(domains[k]) ? (domains[k] as Record<string, unknown>) : {});
  const complexEvidence = isRecord(domain('complex').evidence) ? (domain('complex').evidence as Record<string, unknown>) : {};

  // 주차: 실측일 때만. parkingScore가 null이 아니더라도 상태 표식이 둘 다 실측을 가리켜야 한다.
  const parkingMeasured = complexEvidence.parkingRawStatus === 'KNOWN' && complexEvidence.parkingModelTreatment === 'KNOWN_VALUE';
  const parking: AxisValue = parkingMeasured ? validScore(complexEvidence.parkingScore) : { score: null, exclusion: 'PARKING_NOT_MEASURED' };

  return {
    transport: validScore(domain('transport').score),
    living: validScore(domain('living').score),
    newness: validScore(complexEvidence.ageScore),
    parking,
    elementarySchoolAccess: validScore(domain('education').score),
  };
}

function explanations(axisResults: PersonalAxisResult[], kind: 'good' | 'weak'): PersonalFitExplanation[] {
  const order = new Map(FIT_AXES.map((a, i) => [a, i]));
  return axisResults
    .filter((r) => r.included && r.score != null && r.importance >= PERSONAL_FIT_EXPLAIN_MIN_IMPORTANCE)
    .map((r) => ({ r, displayScore: Math.round(r.score as number) }))
    .filter(({ displayScore }) => (kind === 'good' ? displayScore >= PERSONAL_FIT_GOOD_MIN_SCORE : displayScore <= PERSONAL_FIT_WEAK_MAX_SCORE))
    .sort(
      (x, y) =>
        y.r.importance - x.r.importance ||
        (kind === 'good' ? y.displayScore - x.displayScore : x.displayScore - y.displayScore) ||
        (order.get(x.r.axis) as number) - (order.get(y.r.axis) as number)
    )
    .map(({ r, displayScore }) => ({
      axis: r.axis,
      label: r.label,
      importance: r.importance,
      displayScore,
      text: kind === 'good' ? PERSONAL_FIT_PHRASES[r.axis].good : PERSONAL_FIT_PHRASES[r.axis].weak,
    }));
}

/**
 * personalScore = Σ(axisScore × importance) / Σ(importance of included axes)
 * 계산하지 않는 경우: 중요도 없음/무효, 공통 점수 없음, 포함 축 0개.
 */
export function calculatePersonalFit(input: { shadowV2: unknown; fitImportance: unknown }): PersonalFitResult {
  if (input.fitImportance == null) return { status: 'UNAVAILABLE', reason: 'NO_PREFERENCE' };
  const parsed = parseFitImportance(input.fitImportance);
  if (!parsed.ok) return { status: 'UNAVAILABLE', reason: 'NO_PREFERENCE' };
  const importance: FitImportance = parsed.value;
  if (!isCommonScoreAvailable(input.shadowV2)) return { status: 'UNAVAILABLE', reason: 'NO_COMMON_SCORE' };

  const values = extractPersonalAxisScores(input.shadowV2);
  const axisResults: PersonalAxisResult[] = FIT_AXES.map((axis) => ({
    axis,
    label: FIT_AXIS_LABELS[axis],
    importance: importance[axis],
    score: values[axis].score,
    included: values[axis].score != null,
    exclusion: values[axis].exclusion,
  }));

  const totalImportance = axisResults.reduce((s, r) => s + r.importance, 0);
  const included = axisResults.filter((r) => r.included);
  const includedImportance = included.reduce((s, r) => s + r.importance, 0);
  if (includedImportance === 0) return { status: 'UNAVAILABLE', reason: 'NO_INCLUDED_AXES' };

  const rawScore = included.reduce((s, r) => s + (r.score as number) * r.importance, 0) / includedImportance;
  const coverage = includedImportance / totalImportance;

  return {
    status: coverage < PERSONAL_FIT_LIMITED_BELOW_COVERAGE ? 'LIMITED' : 'FULL',
    score: Math.round(rawScore),
    rawScore,
    coverage,
    includedAxes: included.map((r) => r.axis),
    excludedAxes: axisResults.filter((r) => !r.included).map((r) => r.axis),
    axisResults,
    goodFit: explanations(axisResults, 'good'),
    weakFit: explanations(axisResults, 'weak'),
  };
}
