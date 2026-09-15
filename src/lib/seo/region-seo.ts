// REGIONAL_SEO_KEYWORD_LANDING_V1 §6~§10 — 지역 SEO 메타데이터의 **결정론적 템플릿**(순수 모듈).
//
// 원칙
//  - 지역 × 검색의도 × 실제 데이터. 키워드마다 페이지를 만들지 않는다 — 한 지역 허브가
//    "시세/실거래가/매매/거래량"을 함께 충족한다(§5).
//  - 페이지가 실제로 보여주는 섹션(availableData)에서만 설명 문구를 만든다. 전세·월세처럼
//    지역 리포트에 없는 데이터는 제목/설명에 넣지 않는다(§7).
//  - 지역 이름은 호출부가 **검증한 값**만 받는다. 이 모듈은 이름을 지어내지 않고,
//    모르는 시도는 null을 돌려준다(§13).
//  - 부산 16개 구를 하드코딩하지 않는다. 광역시(시도+구)와 경기도(시도+시+구) 둘 다
//    같은 함수로 처리한다(§20).

import { SIDO_SHORT_LABELS } from '@/lib/redevelopment/labels';
import { TITLE_BRAND_SUFFIX } from './site-seo';

export type RegionSeoLevel = 'CITY' | 'DISTRICT' | 'DONG';

export interface RegionSeoName {
  /** 공식 시도명. 예: '부산광역시', '경기도'. */
  sido: string;
  /** 경기도 같은 2단계 체계의 시. 예: '성남시'. 광역시는 비운다. */
  city?: string | null;
  /** 자치구·군(또는 일반구). 예: '서구', '분당구'. */
  district?: string | null;
  /** 법정동·읍면리. 예: '암남동', '기장읍 교리'. */
  dong?: string | null;
}

/** 지역 페이지가 실제로 렌더하는 데이터 섹션. 설명 문구는 이 값에서만 나온다. */
export interface RegionAvailableData {
  recentTrades: boolean;
  medianPrice: boolean;
  tradeCount: boolean;
  tradeCountDelta: boolean;
  topComplexes: boolean;
  /** 하위 지역 거래 분포가 있으면 그 단계 이름. */
  subRegionDistribution: 'DISTRICT' | 'DONG' | null;
  twoYearHigh: boolean;
}

/**
 * 검색결과 제목이 잘리지 않게 두는 상한(글자 수). 네이버/구글 모두 공식 글자 수를 공개하지
 * 않으므로 "짧은 쪽을 우선"하는 보수적 기준이다. 넘으면 보조 키워드부터 뺀다.
 */
export const MAX_REGION_TITLE_CHARS = 32;

/** 이름 조각 검증 — 비었거나, 너무 길거나, 마크업 문자가 있으면 쓰지 않는다. */
function cleanPart(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  if (!t || t.length > 20 || /[<>"'&{}\\/]/.test(t)) return null;
  return t;
}

export function shortSidoName(sido: string | null | undefined): string | null {
  const s = cleanPart(sido);
  if (!s) return null;
  return Object.prototype.hasOwnProperty.call(SIDO_SHORT_LABELS, s) ? SIDO_SHORT_LABELS[s] : null;
}

/** 요청 단계에 필요한 조각이 모두 있는지 확인하고 이름 조각 배열을 돌려준다. */
export function regionNameParts(level: RegionSeoLevel, region: RegionSeoName): string[] | null {
  const sido = shortSidoName(region.sido);
  if (!sido) return null;
  const city = cleanPart(region.city);
  const district = cleanPart(region.district);
  const dong = cleanPart(region.dong);
  // 입력에 조각이 있었는데 검증에서 떨어졌다면 이름을 조용히 줄이지 않는다.
  if (region.city != null && region.city !== '' && !city) return null;
  if (region.district != null && region.district !== '' && !district) return null;
  if (region.dong != null && region.dong !== '' && !dong) return null;

  if (level === 'CITY') return [sido];
  if (!city && !district) return null;
  const mid = [city, district].filter((p): p is string => !!p);
  if (level === 'DISTRICT') return [sido, ...mid];
  if (!dong) return null;
  return [sido, ...mid, dong];
}

/** "부산 서구", "경기 성남시 분당구", "부산 서구 암남동". 알 수 없으면 null. */
export function buildRegionSeoName(level: RegionSeoLevel, region: RegionSeoName): string | null {
  const parts = regionNameParts(level, region);
  return parts ? parts.join(' ') : null;
}

/** 제목 후보(긴 것 → 짧은 것). 첫 번째로 상한 안에 드는 후보를 쓴다. */
const TITLE_KEYWORD_SETS: Record<RegionSeoLevel, readonly string[]> = {
  CITY: ['시세·실거래가·거래량', '시세·실거래가'],
  DISTRICT: ['시세·실거래가·거래량', '시세·실거래가'],
  // 동은 표본이 작아 "거래량" 허브라고 부르기 어렵다 — 처음부터 짧은 쪽.
  DONG: ['시세·실거래가'],
};

export function buildRegionSeoTitle(level: RegionSeoLevel, name: string): string {
  const sets = TITLE_KEYWORD_SETS[level];
  const candidates = sets.map((k) => `${name} 아파트 ${k}${TITLE_BRAND_SUFFIX}`);
  return candidates.find((c) => c.length <= MAX_REGION_TITLE_CHARS) ?? candidates[candidates.length - 1];
}

/** §10 — 페이지당 H1 하나. 키워드를 나열하지 않는다. */
export function buildRegionSeoHeading(name: string): string {
  return `${name} 아파트 시세·실거래가`;
}

const SUB_REGION_LABEL: Record<'DISTRICT' | 'DONG', string> = {
  DISTRICT: '구·군별 거래 분포',
  DONG: '동별 거래 분포',
};

/** §7 — 실제 섹션에서만 설명을 만든다. */
export function buildRegionSeoDescription(name: string, data: RegionAvailableData): string {
  const items: string[] = [];
  if (data.recentTrades) items.push('최근 실거래');
  if (data.medianPrice) items.push('중앙 거래가·㎡당 가격');
  if (data.tradeCountDelta) items.push('거래량 변화');
  else if (data.tradeCount) items.push('거래건수');
  if (data.topComplexes) items.push('거래가 많은 단지');
  if (data.subRegionDistribution) items.push(SUB_REGION_LABEL[data.subRegionDistribution]);
  if (data.twoYearHigh) items.push('최근 2년 최고 거래가');
  const lead = `${name} 아파트 매매 시세를 국토교통부 실거래가로 확인하세요.`;
  return items.length ? `${lead} ${items.join(', ')}를 한 장에 정리했습니다.` : lead;
}

export type RobotsDecision = { index: boolean; follow: boolean };

export interface RegionIndexInput {
  level: RegionSeoLevel;
  /** 호출부가 지역 식별을 검증했는가(예: 부산 lawdCd allowlist, 실제 거래 데이터의 동). */
  verified: boolean;
  /** 최근 1년 거래 수(취소 제외). 모르면 null — 모르면 색인하지 않는다. */
  trailingYearTrades?: number | null;
}

/**
 * §8/§14 — 동은 최근 1년 거래가 이 수 이상일 때만 색인한다.
 * 리포트의 표본 게이트(MIN_SAMPLE_FOR_INTERPRETATION = 10)와 같은 값이다 — "해석할 만한 표본"과
 * "검색 랜딩으로 내놓을 만한 내용"의 기준을 따로 만들지 않는다.
 */
export const DONG_INDEX_MIN_TRADES_1Y = 10;

export function decideRegionRobots(input: RegionIndexInput): RobotsDecision {
  if (!input.verified) return { index: false, follow: true };
  if (input.level !== 'DONG') return { index: true, follow: true };
  const n = input.trailingYearTrades;
  return { index: typeof n === 'number' && n >= DONG_INDEX_MIN_TRADES_1Y, follow: true };
}

export interface RegionSeoMetadata {
  name: string;
  title: string;
  description: string;
  heading: string;
}

/**
 * §9 — buildRegionSeoMetadata. 지역 이름과 데이터 가용성만 넣으면 제목·설명·H1이 나온다.
 * 이름을 만들 수 없으면 null — 호출부는 일반 제목 + noindex로 떨어져야 한다.
 */
export function buildRegionSeoMetadata(input: {
  level: RegionSeoLevel;
  region: RegionSeoName;
  availableData: RegionAvailableData;
}): RegionSeoMetadata | null {
  const name = buildRegionSeoName(input.level, input.region);
  if (!name) return null;
  return {
    name,
    title: buildRegionSeoTitle(input.level, name),
    description: buildRegionSeoDescription(name, input.availableData),
    heading: buildRegionSeoHeading(name),
  };
}
