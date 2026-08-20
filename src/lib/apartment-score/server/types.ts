// STEP SCORE S2C — 서버 전용 모듈. weight/threshold/peer 로직을 client bundle에
// 노출하지 않기 위해 이 디렉토리(src/lib/apartment-score/server/)는 API route
// handler와 scripts/에서만 import한다 — 'use client' 컴포넌트에서 절대 import
// 금지(§3). 이 프로젝트에 'server-only' 패키지 의존성이 없어 새로 추가하지 않고
// (원칙 8) 이 관례로 대체한다.

export type Direction = 'lowerIsBetter' | 'higherIsBetter';

// n>=10 HIGH / 5~9 MEDIUM / <5 NOT_SCORED(§15)
export type PeerTier = 'HIGH' | 'MEDIUM' | 'NOT_SCORED';

// LOCAL = dong(생활/교통/단지/학교) 또는 sigungu+buildYear decade band(주차),
// SIGUNGU = 구·군 전체, REGION_WIDE = feature 테이블에 존재하는 전체 지역(§14)
export type PeerLevel = 'LOCAL' | 'SIGUNGU' | 'REGION_WIDE';

export interface PeerPoolResult {
  level: PeerLevel;
  tier: PeerTier;
  aptSeqs: string[];
}

export type CategoryKey = 'transport' | 'living' | 'parking' | 'complex' | 'schoolAccess';

export type CategoryStatus = 'SCORED' | 'PARTIAL' | 'NOT_SCORED';

export interface CategoryResult {
  key: CategoryKey;
  status: CategoryStatus;
  score: number | null; // 0~100
  baseWeight: number; // config상 원래 weight
  peerLevel: PeerLevel | null;
  peerTier: PeerTier | null;
  peerSampleSize: number;
  // 카테고리 내부 sub-metric 중 실제로 점수에 반영된 것들(explain.ts가 사용)
  usedSubMetrics: string[];
  missingSubMetrics: string[];
}

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type RegionalStrengthType =
  | 'BEACH_ACCESS'
  | 'SUBWAY_ACCESS'
  | 'MEDICAL_ACCESS'
  | 'PARK_ACCESS'
  | 'SCHOOL_ACCESS';

export type RegionalStrengthLevel = 'STRONG' | 'NOTABLE';

export interface RegionalStrength {
  type: RegionalStrengthType;
  level: RegionalStrengthLevel;
  label: string;
  percentileInSigungu: number;
}

export interface MarketInfo {
  status: 'AVAILABLE' | 'LOW_SAMPLE' | 'NO_DATA';
  transactionCount12m: number | null;
  medianPricePerM2_12m: number | null;
  activityLabel: string | null; // "거래가 활발한 편입니다" 류, 가격 자체 평가 아님
}

export interface ExplainedCategory {
  key: CategoryKey;
  label: string;
  score: number | null;
  explanation: string | null;
}

export interface Briefing {
  summary: string;
  strengths: string[]; // 최대 2개
  caution: string | null; // 최대 1개
}

export type ScoreStatus = 'OK' | 'INSUFFICIENT_DATA' | 'NOT_FOUND' | 'AMBIGUOUS';

export interface FinalScoreResult {
  status: ScoreStatus;
  score: number | null;
  scoreVersion: string;
  coverage: number | null; // 0~1
  confidence: Confidence | null;
  categories: ExplainedCategory[];
  regionalStrengths: RegionalStrength[];
  market: MarketInfo | null;
  briefing: Briefing | null;
}

// ---- Raw feature row shapes (S2B DB 컬럼, read-only) ----

export interface RawLocationFeature {
  aptSeq: string;
  nearestSubwayDistanceM: number | null;
  subwayCount1000m: number | null;
  nearestBusStopDistanceM: number | null;
  busStopCount300m: number | null;
  martCount1000m: number | null;
  convenienceCount500m: number | null;
  pharmacyCount500m: number | null;
  hospitalCount1000m: number | null;
  parkCount1000m: number | null;
  daycareKindergartenCount500m: number | null;
  nearestElementaryDistanceM: number | null;
  elementaryCount1000m: number | null;
  beachDistanceM: number | null;
  qualityFlag: string; // 'complete' | 'partial'
}

export interface RawMarketFeature {
  aptSeq: string;
  medianPricePerM2_12m: number | null;
  transactionCount12m: number | null;
  qualityFlag: string;
}

export interface RawMasterInfo {
  aptSeq: string;
  sggCd: string | null;
  sigungu: string | null; // 사람이 읽는 구·군 이름(예: "서구"), explain/briefing 텍스트용
  umdName: string | null;
  buildYear: number | null;
  totalHouseholds: number | null;
  parkingCount: number | null;
  mainBuildingCount: number | null;
}

export interface ApartmentRawBundle {
  master: RawMasterInfo;
  location: RawLocationFeature | null;
  market: RawMarketFeature | null;
}
