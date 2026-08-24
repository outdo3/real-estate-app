// STEP SCORE S2C — 서버 전용 모듈. weight/threshold/peer 로직을 client bundle에
// 노출하지 않기 위해 이 디렉토리(src/lib/apartment-score/server/)는 API route
// handler와 scripts/에서만 import한다 — 'use client' 컴포넌트에서 절대 import
// 금지(§3). 이 프로젝트에 'server-only' 패키지 의존성이 없어 새로 추가하지 않고
// (원칙 8) 이 관례로 대체한다.

export type Direction = 'lowerIsBetter' | 'higherIsBetter';

// n>=10 HIGH / 5~9 MEDIUM / <5 NOT_SCORED(§15)
export type PeerTier = 'HIGH' | 'MEDIUM' | 'NOT_SCORED';

// LOCAL = dong(생활/교통/단지/학교) 또는 sigungu+buildYear decade band(주차),
// SIGUNGU = 구·군 전체, REGION_WIDE = feature 테이블에 존재하는 전체 지역(§14).
// [PEER FALLBACK HOTFIX 확인] calculate.ts가 resolvePeerPoolLevels()의
// cohortOtherRegions를 항상 생략(빈 배열)하기 때문에, 실제 구현상 REGION_WIDE는
// 이름과 달리 "부산 전체/타 지역"이 아니라 SIGUNGU와 완전히 동일한 후보 집합이다
// (peer-groups.ts의 resolvePeerPool()/resolvePeerPoolLevels() 주석 참고). 진짜
// 타 지역 조회가 필요하면 cohortOtherRegions를 채워 넣는 별도 STEP이 필요하다.
export type PeerLevel = 'LOCAL' | 'SIGUNGU' | 'REGION_WIDE';

export interface PeerPoolResult {
  level: PeerLevel;
  tier: PeerTier;
  aptSeqs: string[];
}

export type CategoryKey = 'transport' | 'living' | 'parking' | 'complex' | 'schoolAccess';

// [SCORE V1.1 §5~§9] "학교 접근성" 설명 전용 — 실제 생활 체감 거리(절대값)를 나타낸다.
// 상대(percentile) 점수와 개념적으로 완전히 분리한다: 이 값은 nearestElementaryDistanceM
// 원본에서만 결정되고, 다른 단지와의 비교와는 무관하다. UNKNOWN = 반경 1000m 내
// 초등학교가 확인되지 않음(수집 자체가 1000m 반경 검색이라 "없다"를 단정하지 않고
// "확인되지 않음"으로만 표현한다).
export type AbsoluteDistanceBand = 'VERY_CLOSE' | 'CLOSE' | 'NORMAL' | 'FAR' | 'VERY_FAR' | 'UNKNOWN';

// explain.ts의 상대(percentile) 밴드. school-access-sentence.ts가 explain.ts와
// briefing.ts 양쪽에서 공용으로 참조해야 해서(순환 import 방지) 여기 둔다.
export type Band = 'EXCELLENT' | 'GOOD' | 'AVERAGE' | 'BELOW_AVERAGE';

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

// [SCORE V1.1 §18~§21] "이집점수 준비 중" 원인 진단 코드 — INTERNAL/ADMIN 전용이다.
// 절대 공개 API 응답에 넣지 않는다(route.ts가 필드를 하나씩 whitelist로 골라 응답을
// 만들기 때문에, 이 필드를 FinalScoreResult에 추가해도 자동으로 노출되지 않는다 —
// 새 공개 API를 추가할 때 이 필드를 절대 포함하지 말 것).
// FEATURE_CACHE_MISSING = ApartmentLocationFeature 행 자체가 없음(실측상 부산 14/16
// 구·군의 지배적 원인). MISSING_* = 해당 카테고리 1개만 단독으로 빠짐. INSUFFICIENT_
// TOTAL_COVERAGE = 여러 카테고리가 부분적으로 빠져 threshold 미달. OTHER = 방어적 폴백.
export type PreparingReasonCode =
  | 'FEATURE_CACHE_MISSING'
  | 'MISSING_TRANSPORT'
  | 'MISSING_LIVING'
  | 'MISSING_PARKING'
  | 'MISSING_COMPLEX'
  | 'MISSING_SCHOOL'
  | 'INSUFFICIENT_TOTAL_COVERAGE'
  | 'OTHER';

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
  // status가 'OK'면 항상 null. INTERNAL/ADMIN 전용(위 PreparingReasonCode 주석 참고) —
  // 공개 API route는 이 필드를 절대 응답에 포함하지 않는다.
  preparingReason: PreparingReasonCode | null;
  _shadowV2?: any;
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
  geocodeQuality: string | null;
}

export interface ApartmentRawBundle {
  master: RawMasterInfo;
  location: RawLocationFeature | null;
  market: RawMarketFeature | null;
}
