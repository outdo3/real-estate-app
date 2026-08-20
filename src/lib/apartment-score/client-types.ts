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
}
