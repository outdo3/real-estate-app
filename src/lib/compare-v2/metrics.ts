// COMPARE_V2_PHASE2 — builds CompareMetric[]/CompareScore from the exact same two API
// responses the canonical fetch layer already gets (/api/apt/[name] trades,
// /api/apt/[name]/score). No new fields invented, no estimation — a metric is MISSING
// (not 0, not omitted-silently) whenever the underlying source has no value.
import { NATIONAL_STANDARD_AREA_MIN, NATIONAL_STANDARD_AREA_MAX } from '../ai-search';
import type { CompareMetric, CompareScore, ScoreDomainView } from './types';

interface RawTrade {
  tradeDate: string;
  price: number;
  priceStr: string;
  area: string;
  buildYear?: string;
  dealCanceled?: boolean;
}

const DOMAIN_LABELS: Record<ScoreDomainView['key'], string> = {
  transport: '교통',
  living: '생활',
  education: '교육',
  complex: '단지',
};

// 가격 비교의 area fairness — Phase 1 §6 권고: 84㎡(국민평형) band가 양쪽에 있으면
// 그것을 우선 쓴다. 없으면 그 단지의 최신 거래를 쓰되 "동일 면적 비교 아님"을 명시한다.
// 임의 면적으로 대체하지 않는다(§9) — band 밖 거래를 쓸 때도 실제 거래된 면적 그대로.
export function selectPriceMetric(trades: RawTrade[]): CompareMetric {
  const valid = trades
    .filter((t) => !t.dealCanceled)
    .map((t) => ({ ...t, areaNum: parseFloat(t.area) }))
    .filter((t) => Number.isFinite(t.areaNum) && t.areaNum > 0);

  if (valid.length === 0) {
    return {
      key: 'salePrice', label: '최근 실거래가', value: null, displayValue: '최근 거래 없음',
      unit: null, period: null, area: null, trust: 'MISSING', direction: 'context-only',
    };
  }

  const band = valid.filter((t) => t.areaNum >= NATIONAL_STANDARD_AREA_MIN && t.areaNum <= NATIONAL_STANDARD_AREA_MAX);
  const pool = band.length > 0 ? band : valid;
  const areaMismatch = band.length === 0;

  const sorted = [...pool].sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime());
  const t = sorted[0];

  return {
    key: 'salePrice',
    label: '최근 실거래가',
    value: t.price,
    displayValue: t.priceStr,
    unit: '억원',
    period: { from: t.tradeDate, to: t.tradeDate },
    area: { exclusiveAreaM2: t.areaNum, label: areaMismatch ? `${t.areaNum}㎡ (84㎡ 기준 거래 없음)` : `${t.areaNum}㎡` },
    trust: areaMismatch ? 'LIMITED' : 'SAFE',
    direction: 'context-only',
  };
}

function metricFromEvidenceDistance(
  key: string,
  label: string,
  distanceM: unknown,
  confirmedAbsent: boolean,
  trust: 'SAFE' | 'LIMITED' = 'SAFE'
): CompareMetric {
  if (typeof distanceM === 'number') {
    return {
      key, label, value: distanceM, displayValue: `${Math.round(distanceM)}m`,
      unit: 'm', period: null, area: null, trust, direction: 'lower-better',
    };
  }
  if (confirmedAbsent) {
    // 모바일 고정폭 셀 truncation 대응으로 짧게 유지하되(§40 mobile QA에서 "반경 내
    // 없음(확인됨)"이 셀 폭을 넘어 잘리는 문제 발견·수정), MISSING(수집 실패)과는
    // 여전히 다른 문구를 쓴다 — "정보 없음"으로 합치면 difference.ts가 구분할 수
    // 없는 게 아니라(trust로 구분) 사용자에게 "역이 없다고 확인됨"이라는 정보 자체가
    // 사라진다.
    return {
      key, label, value: null, displayValue: '없음(확인)',
      unit: null, period: null, area: null, trust, direction: 'lower-better',
    };
  }
  return {
    key, label, value: null, displayValue: '정보 없음',
    unit: null, period: null, area: null, trust: 'MISSING', direction: 'lower-better',
  };
}

function metricFromCount(key: string, label: string, count: unknown, radiusLabel: string): CompareMetric {
  if (typeof count === 'number') {
    return {
      key, label: `${label}(${radiusLabel})`, value: count, displayValue: `${count}개`,
      unit: '개', period: null, area: null, trust: 'LIMITED', direction: 'context-only',
    };
  }
  return {
    key, label: `${label}(${radiusLabel})`, value: null, displayValue: '정보 없음',
    unit: null, period: null, area: null, trust: 'MISSING', direction: 'context-only',
  };
}

// buildYear/totalHouseholds/parkingRatio는 score-v2 complex domain의 evidence에서
// 뽑는다 — /api/apt/[name]/info의 포맷된 한글 문자열을 다시 파싱하지 않는다(별도 fetch도
// 필요 없음, score 응답 하나로 충분).
export function buildFactMetrics(complexEvidence: Record<string, unknown> | undefined): CompareMetric[] {
  const ev = complexEvidence || {};
  const buildYear = typeof ev.buildYear === 'number' ? ev.buildYear : null;
  const totalHouseholds = typeof ev.totalHouseholds === 'number' ? ev.totalHouseholds : null;
  const parkingKnown = ev.parkingRawStatus === 'KNOWN' && typeof ev.parkingRatio === 'number';

  return [
    {
      key: 'buildYear', label: '준공', value: buildYear, displayValue: buildYear ? `${buildYear}년` : '정보 없음',
      unit: '년', period: null, area: null, trust: buildYear ? 'SAFE' : 'MISSING', direction: 'context-only',
    },
    {
      key: 'totalHouseholds', label: '세대수', value: totalHouseholds, displayValue: totalHouseholds ? `${totalHouseholds.toLocaleString('ko-KR')}세대` : '정보 없음',
      unit: '세대', period: null, area: null, trust: totalHouseholds ? 'SAFE' : 'MISSING', direction: 'context-only',
    },
    {
      key: 'parkingPerHousehold', label: '세대당 주차',
      value: parkingKnown ? (ev.parkingRatio as number) : null,
      displayValue: parkingKnown ? `${(ev.parkingRatio as number).toFixed(2)}대` : '정보 없음',
      unit: '대', period: null, area: null, trust: parkingKnown ? 'LIMITED' : 'MISSING', direction: 'higher-better',
    },
  ];
}

export function buildLocationMetrics(
  transportEvidence: Record<string, unknown> | undefined,
  educationEvidence: Record<string, unknown> | undefined,
  livingEvidence: Record<string, unknown> | undefined
): CompareMetric[] {
  const tr = transportEvidence || {};
  const ed = educationEvidence || {};
  const lv = livingEvidence || {};
  return [
    metricFromEvidenceDistance('subwayDistance', '지하철 최근거리', tr.nearestSubwayDistanceM, tr.subwayStatus === 'CONFIRMED_ABSENT'),
    metricFromEvidenceDistance('busDistance', '버스정류장 최근거리', tr.nearestBusStopDistanceM, false),
    metricFromEvidenceDistance('elementaryDistance', '초등학교 최근거리', ed.nearestElementaryDistanceM, false, 'LIMITED'),
    metricFromCount('convenienceCount', '편의점', lv.convenienceCount500m, '500m'),
  ];
}

export function buildScore(scoreJson: any): CompareScore {
  const shadow = scoreJson?._shadowV2;
  if (!shadow || shadow.eligibility === 'NOT_ENOUGH_DATA') {
    return { available: false, eligibility: 'NOT_ENOUGH_DATA', overallScore: null, domains: [], peer: null };
  }
  const domains: ScoreDomainView[] = (['transport', 'living', 'education', 'complex'] as const).map((k) => ({
    key: k,
    label: DOMAIN_LABELS[k],
    score: shadow.domains?.[k]?.score ?? null,
    coverage: shadow.domains?.[k]?.coverage ?? 0,
  }));
  const peerContext = scoreJson?.peerContext;
  return {
    available: true,
    eligibility: shadow.eligibility,
    overallScore: shadow.overallScore ?? null,
    domains,
    peer: peerContext
      ? {
          available: !!peerContext.available,
          percentile: peerContext.percentile ?? null,
          confidence: peerContext.confidence ?? 'NOT_AVAILABLE',
          peerCount: peerContext.peerCount ?? null,
        }
      : null,
  };
}

export function domainEvidence(scoreJson: any, key: 'transport' | 'living' | 'education' | 'complex'): Record<string, unknown> | undefined {
  return scoreJson?._shadowV2?.domains?.[key]?.evidence;
}
