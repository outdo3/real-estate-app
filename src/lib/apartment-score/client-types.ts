// STEP SCORE S3 — client에서 안전하게 import해도 되는 순수 타입만 모아둔 파일.
// src/lib/apartment-score/server/ 디렉토리는 절대 여기서 import하지 않는다(§11 —
// weight/peer-group/percentile/regional formula를 client bundle에 노출 금지).
// 이 인터페이스들은 GET /api/apt/[name]/score 응답 JSON 형태만 그대로 옮겨 적은 것이다.

export interface ApartmentScoreCategory {
  key: string;
  label: string;
  score: number | null;
  explanation: string | null;
}

export interface ApartmentScoreRegionalStrength {
  type: string;
  level: 'STRONG' | 'NOTABLE';
  label: string;
}

export interface ApartmentScoreMarketInfo {
  status: 'AVAILABLE' | 'LOW_SAMPLE' | 'NO_DATA';
  transactionCount12m: number | null;
  medianPricePerM2_12m: number | null;
  activityLabel: string | null;
}

export interface ApartmentScoreBriefing {
  summary: string;
  strengths: string[];
  caution: string | null;
}

export type ApartmentScoreStatus = 'OK' | 'INSUFFICIENT_DATA' | 'NOT_FOUND' | 'AMBIGUOUS';

// EJIP_SCORE_V2_PHASE2 — peer-relative context. Computed entirely outside the
// score-v2 engine (src/lib/apartment-score/peer-context.ts); see that file for
// the hierarchy/min-sample/confidence definitions (PHASE 1.5/1.6-validated,
// not redefined here). `peerCount` (self-excluded) is what the UI should show
// to users — `comparisonCount` (self-included) is the internal percentile
// denominator and generally should not be shown directly.
export interface ApartmentScorePeerContext {
  available: boolean;
  level: 'SIGUNGU_DECADE_SIZE' | 'SIGUNGU_DECADE' | 'DECADE_BUSAN' | 'BUSAN_ALL' | null;
  comparisonCount: number | null;
  peerCount: number | null;
  percentile: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_AVAILABLE';
  basis: {
    sigungu: string | null;
    buildDecade: string | null;
    sizeBand: 'small' | 'mid' | 'large' | 'UNKNOWN' | null;
  } | null;
}

export interface ApartmentScoreApiResponse {
  status: ApartmentScoreStatus;
  score: number | null;
  scoreVersion: string | null;
  coverage: number | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  categories: ApartmentScoreCategory[];
  regionalStrengths: ApartmentScoreRegionalStrength[];
  market: ApartmentScoreMarketInfo | null;
  briefing: ApartmentScoreBriefing | null;
  peerContext: ApartmentScorePeerContext | null;
  _shadowV2?: any;
}
