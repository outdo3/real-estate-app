/**
 * E-JIP SCORE V2 STEP 3.5 §29-30 — 향후 UI STEP에서 사용할 data contract
 * PROPOSAL. 이 파일은 타입 정의만 담은 제안서다 — production 코드에 연결되지
 * 않으며(어떤 src/ 파일도 이 파일을 import하지 않는다), 다음 UI STEP에서
 * production type과의 매핑을 별도로 설계해야 한다.
 */

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type ScoreEligibility = 'SCORE_AVAILABLE' | 'LIMITED' | 'NOT_ENOUGH_DATA';

/** §28 라벨 최종 점검 — 실제 계산 내용과 정확히 일치하는 이름만 사용 */
export type CoreDomainKey = 'transport' | 'living' | 'education' | 'complex';
export const CORE_DOMAIN_LABELS: Record<CoreDomainKey, string> = {
  transport: '교통 접근성',
  living: '생활 편의',
  education: '교육 환경',
  complex: '단지 상품성',
};

export interface DomainReport {
  score: number | null; // §18 정수 rounding 권고 — 표시 시점에 반올림, 내부 계산은 float 유지
  rawFacts: string[]; // 예: "지하철 약 140m(역 중심 기준)"
  strengths: string[];
  weaknesses: string[];
  coverage: number; // 0~1
  confidence: ConfidenceLevel;
  source: string;
  sourceDate: string;
}

export interface OverallScoreReport {
  overallScore: number | null; // §18 S1(raw) 유지, 임의 rescale 없음
  overallPercentileBusan: number | null; // §19 S3: 항상 병기 권고
  overallPercentileSigungu: number | null;
  eligibility: ScoreEligibility;
  confidence: ConfidenceLevel;
  scoreVersion: string; // 예: "EJIP_SCORE_V2_CANDIDATE_1(P-D+T1+W-A)" — production 확정 전까지 candidate 버전 명시

  domains: Record<CoreDomainKey, DomainReport>;

  /** §30 "왜 이런 점수인가요?" — 산출 근거. 단지브리핑과 절대 혼동하지 않는다. */
  scoreExplanation: {
    oneLine: string; // 예: "교통과 단지 상품성에서 강점, 교육 접근성은 아쉬움"
    dominantFactors: string[]; // 총점에 가장 크게 기여한 factor 2~3개
  };
}

/**
 * §30 단지브리핑 — "그래서 어떤 성격의 단지인가"는 점수 산출 근거와는
 * 다른 질문이다. 단순 텍스트 박스가 아니라 정보 위계가 있는 카드 구조로
 * 제안한다(이번 STEP에서 구현하지 않음, UI STEP 대상).
 */
export interface ApartmentBriefing {
  oneLineSummary: string;
  strengths: string[]; // 최대 3개
  concerns: string[]; // 최대 2개, "아쉬움"류 — 낙인 표현 지양(§18 grade 회피 원칙과 동일 정신)
  suitableFor: string[]; // 예: "대중교통 위주 출퇴근", "초등 자녀가 있는 가구"
  furtherCheckPoints: string[]; // 예: "관리비/커뮤니티 시설은 현장 확인 권장"(데이터 없는 영역 정직 고지)
}

/** §21 UI 표시 정책 — LOCAL(법정동) percentile은 표시하지 않거나 최소 노출 */
export interface RelativeContextDisplayPolicy {
  primary: 'BUSAN';
  secondary: 'SIGUNGU';
  localDongDisplay: 'HIDDEN' | 'MINIMAL_FOOTNOTE'; // 'PRIMARY_DISPLAY' 금지
}
