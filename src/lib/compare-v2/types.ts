// COMPARE_V2_PHASE2 — shared data contract, per COMPARE_V2_ARCHITECTURE_AUDIT.md §20.
// Identity priority everywhere in this module: aptSeq > strong-verified composite >
// unavailable. name is a display label only, never a lookup/dedupe key.

export type ComparableIdentity =
  | { kind: 'aptSeq'; aptSeq: string; lawdCd: string; dong: string; name: string }
  | { kind: 'composite'; lawdCd: string; dong: string; name: string };

export function identityKey(identity: ComparableIdentity): string {
  return identity.kind === 'aptSeq' ? `seq:${identity.aptSeq}` : `cmp:${identity.lawdCd}:${identity.dong}:${identity.name}`;
}

export type MetricTrust = 'SAFE' | 'LIMITED' | 'UNSAFE' | 'MISSING';
export type MetricDirection = 'higher-better' | 'lower-better' | 'neutral' | 'context-only';

export interface CompareMetric {
  key: string;
  label: string;
  value: number | null;
  displayValue: string;
  unit: string | null;
  period: { from: string; to: string } | null;
  area: { exclusiveAreaM2: number; label: string } | null;
  trust: MetricTrust;
  direction: MetricDirection;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  // MOLIT_PARTIAL_TRUST_V2 §4/§6 — 이 지표의 원본(실거래 조회)이 일부 기간을 불러오지
  // 못한 상태에서 계산됐음을 나타낸다. trust만으로는 "면적이 달라서 LIMITED"인지
  // "원본이 불완전해서 LIMITED"인지 구분할 수 없어, 비교 문구를 정확히 고르기 위해
  // 별도 optional 플래그로 남긴다(값이 없으면 기존과 동일한 완전 데이터 경로).
  sourceIncomplete?: boolean;
}

export interface ScoreDomainView {
  key: 'transport' | 'living' | 'education' | 'complex';
  label: string;
  score: number | null;
  coverage: number;
}

export interface CompareScore {
  available: boolean;
  eligibility: 'SCORE_AVAILABLE' | 'LIMITED' | 'NOT_ENOUGH_DATA';
  overallScore: number | null;
  domains: ScoreDomainView[];
  peer: {
    available: boolean;
    percentile: number | null;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_AVAILABLE';
    peerCount: number | null;
  } | null;
}

export interface CompareApartment {
  identity: ComparableIdentity;
  displayName: string;
  regionLabel: string | null;
  metrics: CompareMetric[];
  score: CompareScore | null;
  loadError: boolean;
}

export interface CompareDifference {
  metricKey: string;
  label: string;
  a: CompareMetric;
  b: CompareMetric;
  direction: MetricDirection;
  comparable: boolean;
  reason?: string;
  differenceValue: number | null;
  differenceDisplay: string | null;
  favors: 'a' | 'b' | null;
  contextSentence: string | null;
  caution: string | null;
}

export interface TradeoffSummary {
  aStrengths: CompareDifference[];
  bStrengths: CompareDifference[];
  similar: CompareDifference[];
  needsReview: CompareDifference[];
}
