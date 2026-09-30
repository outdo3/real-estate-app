// REALTOR_PRO_MVP_V1 — 고객 조건 ↔ 매물 결정적 매칭 엔진 V1(순수 함수: DB·네트워크·AI 없음).
// docs/pro/REALTOR_PRO_V1_ARCHITECTURE.md §8
//
// 원칙
//  · 같은 입력 → 같은 결과. 점수는 항목별 사유로 전부 분해된다.
//  · 한쪽이라도 값이 없어 비교할 수 없는 항목은 UNKNOWN("확인 필요") — **분모에서 뺀다**(없는 데이터를 불리/유리하게 가정하지 않음).
//  · 비교 가능한 가중치 합이 MIN_COMPARABLE_WEIGHT 미만이면 %를 내지 않는다(confidence INSUFFICIENT, "정보 부족").
//  · E-JIP Score V2·개인화 점수와 무관하다: 입력으로 쓰지도, 결과를 섞지도 않는다(이 파일은 그 모듈을 import하지 않는다).

import { createHash } from 'node:crypto';
import type { DealType, FloorBand, MatchConfidence, MustHaveKey } from './rules';
import { DEAL_TYPE_LABELS, FLOOR_BAND_LABELS, floorBandOf } from './rules';
import type { MatchReason } from './types';

export const MATCH_ENGINE_VERSION = 'v1.0';
export const MIN_COMPARABLE_WEIGHT = 50;

export const SOFT_WEIGHTS = {
  budget: 25,
  area: 20,
  moveIn: 15,
  commute: 10,
  school: 10,
  floor: 5,
  newBuild: 5,
  parking: 5,
  pet: 5,
} as const;
export type SoftKey = keyof typeof SOFT_WEIGHTS;

export interface MatchListingInput {
  id: string;
  dealType: DealType;
  askingPriceManwon: number | null;
  depositManwon: number | null;
  monthlyRentManwon: number | null;
  lawdCd: string | null;
  aptSeq: string | null;
  exclusiveAreaM2: number | null;
  moveInAvailableAt: Date | null;
  moveInNegotiable: boolean;
  floor: number | null;
  floorBand: FloorBand | null;
  parkingAvailable: boolean | null;
  petAllowed: boolean | null;
  isActive: boolean;
  closedAt: Date | null;
  deletedAt: Date | null;
  // 공공 데이터(있을 때만) — aptSeq로만 가져온 값
  buildYear: number | null;
  lat: number | null;
  lng: number | null;
}

export interface MatchPreferenceInput {
  id: string;
  dealTypes: DealType[];
  budgetMinManwon: number | null;
  budgetMaxManwon: number | null;
  budgetTolerancePct: number;
  monthlyRentMaxManwon: number | null;
  lawdCds: string[];
  aptSeqs: string[];
  areaMinM2: number | null;
  areaMaxM2: number | null;
  moveInTargetAt: Date | null;
  commuteLabel: string | null;
  commuteLat: number | null;
  commuteLng: number | null;
  schoolIds: number[];
  preferNewBuild: boolean | null;
  parkingRequired: boolean | null;
  floorPreference: FloorBand | null;
  petRequired: boolean | null;
  mustHaveKeys: MustHaveKey[];
}

export interface MatchResult {
  listingId: string;
  preferenceId: string;
  passedHard: boolean;
  exclusions: MatchReason[]; // hard filter 실패 사유(있으면 매칭 제외)
  score: number | null; // 0~100, 정보 부족·제외 시 null
  confidence: MatchConfidence;
  comparableWeight: number;
  reasons: MatchReason[]; // soft 항목(적용 대상만)
  engineVersion: string;
  inputHash: string;
}

const eok = (manwon: number) => {
  if (manwon >= 10000) {
    const e = manwon / 10000;
    return `${Number.isInteger(e) ? e : e.toFixed(1).replace(/\.0$/, '')}억`;
  }
  return `${manwon.toLocaleString('ko-KR')}만`;
};
const m2 = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}㎡`;
const dayMs = 86_400_000;

/** 거래유형별 예산 비교 가격(만원). 월세는 보증금 기준 + 월세 상한은 별도 hard filter. */
export function comparablePrice(l: Pick<MatchListingInput, 'dealType' | 'askingPriceManwon' | 'depositManwon'>): number | null {
  return l.dealType === 'SALE' ? l.askingPriceManwon : l.depositManwon;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function hardFilters(l: MatchListingInput, p: MatchPreferenceInput): MatchReason[] {
  const out: MatchReason[] = [];
  const miss = (key: string, label: string, detail: string): MatchReason => ({ key, label, verdict: 'MISS', weight: 0, score: 0, detail, hard: true });

  if (!l.isActive || l.closedAt || l.deletedAt) out.push(miss('active', '매물 상태', '거래 가능한 매물이 아닙니다(보관·계약완료)'));
  if (!p.dealTypes.includes(l.dealType)) out.push(miss('dealType', '거래유형', `고객은 ${p.dealTypes.map((d) => DEAL_TYPE_LABELS[d]).join('·')}을 찾고 있습니다(매물: ${DEAL_TYPE_LABELS[l.dealType]})`));

  const price = comparablePrice(l);
  if (p.budgetMaxManwon != null && price != null) {
    const cap = p.budgetMaxManwon * (1 + p.budgetTolerancePct / 100);
    if (price > cap) out.push(miss('budgetMax', '예산 상한', `가격 ${eok(price)}이 예산 상한 ${eok(p.budgetMaxManwon)}${p.budgetTolerancePct ? `(+${p.budgetTolerancePct}%)` : ''}을 넘습니다`));
  }
  if (l.dealType === 'MONTHLY' && p.monthlyRentMaxManwon != null && l.monthlyRentManwon != null && l.monthlyRentManwon > p.monthlyRentMaxManwon) {
    out.push(miss('monthlyRentMax', '월세 상한', `월세 ${l.monthlyRentManwon}만이 상한 ${p.monthlyRentMaxManwon}만을 넘습니다`));
  }

  const wantsRegion = p.lawdCds.length > 0 || p.aptSeqs.length > 0;
  if (wantsRegion) {
    const inApt = !!l.aptSeq && p.aptSeqs.includes(l.aptSeq);
    const inLawd = !!l.lawdCd && p.lawdCds.includes(l.lawdCd);
    if (!inApt && !inLawd) {
      out.push(miss('region', '희망 지역', !l.lawdCd && !l.aptSeq ? '매물의 단지·지역이 연결되지 않아 희망 지역을 확인할 수 없습니다' : '고객 희망 지역·단지 밖의 매물입니다'));
    }
  }

  // 고객이 "필수"로 지정한 항목: 값이 없거나 불일치면 제외(필수는 확인 전까지 추천하지 않는다)
  for (const k of p.mustHaveKeys) {
    if (k === 'parking' && p.parkingRequired && l.parkingAvailable !== true) out.push(miss('mustParking', '주차(필수)', l.parkingAvailable == null ? '주차 가능 여부가 매물에 없습니다(필수 조건)' : '주차가 되지 않는 매물입니다'));
    if (k === 'pet' && p.petRequired && l.petAllowed !== true) out.push(miss('mustPet', '반려동물(필수)', l.petAllowed == null ? '반려동물 가능 여부가 매물에 없습니다(필수 조건)' : '반려동물이 불가한 매물입니다'));
    if (k === 'area' && (p.areaMinM2 != null || p.areaMaxM2 != null)) {
      const a = l.exclusiveAreaM2;
      if (a == null || (p.areaMinM2 != null && a < p.areaMinM2) || (p.areaMaxM2 != null && a > p.areaMaxM2)) out.push(miss('mustArea', '면적(필수)', a == null ? '매물 면적 정보가 없습니다(필수 조건)' : `전용 ${m2(a)}이 요청 범위 밖입니다`));
    }
    if (k === 'moveIn' && p.moveInTargetAt) {
      const s = moveInScore(l, p.moveInTargetAt);
      if (s.score === 0 || s.score == null) out.push(miss('mustMoveIn', '입주 시기(필수)', s.score == null ? '입주 가능일이 매물에 없습니다(필수 조건)' : s.detail));
    }
  }
  return out;
}

function moveInScore(l: MatchListingInput, target: Date): { score: number | null; verdict: MatchReason['verdict']; detail: string } {
  if (!l.moveInAvailableAt) {
    return l.moveInNegotiable
      ? { score: 0.7, verdict: 'PARTIAL', detail: '입주일 협의 가능(날짜 미정)' }
      : { score: null, verdict: 'UNKNOWN', detail: '입주 가능일 확인 필요' };
  }
  const lateDays = Math.round((l.moveInAvailableAt.getTime() - target.getTime()) / dayMs);
  if (lateDays <= 7) return { score: 1, verdict: 'MATCH', detail: lateDays <= 0 ? '희망 입주일에 입주 가능' : `희망일과 ${lateDays}일 차이` };
  if (lateDays <= 30) {
    const s = 1 - (lateDays - 7) / 23;
    const base = { score: Math.max(0, Math.round(s * 100) / 100), verdict: 'PARTIAL' as const, detail: `입주 가능일이 희망일보다 ${lateDays >= 14 ? `${Math.round(lateDays / 7)}주` : `${lateDays}일`} 늦음` };
    return l.moveInNegotiable ? { ...base, score: Math.max(base.score, 0.7), detail: `${base.detail}(협의 가능)` } : base;
  }
  return l.moveInNegotiable
    ? { score: 0.5, verdict: 'PARTIAL', detail: `입주 가능일이 희망일보다 ${Math.round(lateDays / 30)}개월 이상 늦지만 협의 가능` }
    : { score: 0, verdict: 'MISS', detail: `입주 가능일이 희망일보다 ${lateDays}일 늦음` };
}

function softReasons(l: MatchListingInput, p: MatchPreferenceInput, now: Date): MatchReason[] {
  const out: MatchReason[] = [];
  const add = (key: SoftKey, label: string, score: number | null, verdict: MatchReason['verdict'], detail: string) =>
    out.push({ key, label, weight: SOFT_WEIGHTS[key], score, verdict, detail });

  // 예산 — 고객이 예산을 하나도 안 줬으면 적용 대상 아님
  if (p.budgetMinManwon != null || p.budgetMaxManwon != null) {
    const price = comparablePrice(l);
    const range = `${p.budgetMinManwon != null ? eok(p.budgetMinManwon) : ''}~${p.budgetMaxManwon != null ? eok(p.budgetMaxManwon) : ''}`;
    if (price == null) add('budget', '예산', null, 'UNKNOWN', '매물 가격 확인 필요');
    else if (p.budgetMaxManwon != null && price > p.budgetMaxManwon) {
      const tolAbs = p.budgetMaxManwon * (p.budgetTolerancePct / 100);
      const over = price - p.budgetMaxManwon;
      const s = tolAbs > 0 ? Math.max(0.5, 1 - 0.5 * (over / tolAbs)) : 0;
      add('budget', '예산', Math.round(s * 100) / 100, 'PARTIAL', `가격 ${eok(price)} — 예산 ${range}보다 ${eok(over)} 높음(허용 범위 안)`);
    } else if (p.budgetMinManwon != null && price < p.budgetMinManwon) add('budget', '예산', 0.8, 'PARTIAL', `가격 ${eok(price)} — 예산 ${range}보다 낮음`);
    else add('budget', '예산', 1, 'MATCH', `가격 ${eok(price)} — 예산 ${range} 안`);
  }

  // 면적(㎡ 범위) — 평형 환산 없음
  if (p.areaMinM2 != null || p.areaMaxM2 != null) {
    const a = l.exclusiveAreaM2;
    const lo = p.areaMinM2 ?? -Infinity;
    const hi = p.areaMaxM2 ?? Infinity;
    const range = `${p.areaMinM2 != null ? m2(p.areaMinM2) : ''}~${p.areaMaxM2 != null ? m2(p.areaMaxM2) : ''}`;
    if (a == null) add('area', '면적', null, 'UNKNOWN', '매물 전용면적 확인 필요');
    else if (a >= lo && a <= hi) add('area', '면적', 1, 'MATCH', `전용 ${m2(a)} — 요청 ${range}와 일치`);
    else if (a >= lo * 0.9 && a <= hi * 1.1) add('area', '면적', 0.5, 'PARTIAL', `전용 ${m2(a)} — 요청 ${range}와 10% 이내 차이`);
    else add('area', '면적', 0, 'MISS', `전용 ${m2(a)} — 요청 ${range} 밖`);
  }

  if (p.moveInTargetAt) {
    const r = moveInScore(l, p.moveInTargetAt);
    add('moveIn', '입주 시기', r.score, r.verdict, r.detail);
  }

  if (p.commuteLat != null && p.commuteLng != null) {
    const target = p.commuteLabel ? `통근지(${p.commuteLabel})` : '통근지';
    if (l.lat == null || l.lng == null) add('commute', '통근', null, 'UNKNOWN', `${target}까지 거리 확인 필요(단지 좌표 없음)`);
    else {
      const km = haversineKm(l.lat, l.lng, p.commuteLat, p.commuteLng);
      const s = km <= 5 ? 1 : km <= 10 ? 0.6 : 0.2;
      add('commute', '통근', s, s === 1 ? 'MATCH' : 'PARTIAL', `${target}까지 직선 ${km.toFixed(1)}km(직선거리 기준)`);
    }
  } else if (p.commuteLabel) {
    // 통근지 이름만 있고 좌표가 없으면(현재 입력 화면은 지오코딩 없음) 조용히 빼지 않고 '확인 필요'로 보인다 — 점수 분모에는 들어가지 않음
    add('commute', '통근', null, 'UNKNOWN', `통근지(${p.commuteLabel})까지 거리 확인 필요(통근지 좌표 없음)`);
  }

  // 학교: V1은 단지↔학교 배정·거리 데이터를 매칭에 연결하지 않는다 → 희망 학교가 있으면 확인 필요
  if (p.schoolIds.length > 0) add('school', '학교', null, 'UNKNOWN', '희망 학교 조건 확인 필요(학교 거리 데이터 미연결)');

  if (p.floorPreference) {
    const band = floorBandOf(l.floor, l.floorBand);
    if (!band) add('floor', '층', null, 'UNKNOWN', '층 정보 확인 필요');
    else if (band === p.floorPreference) add('floor', '층', 1, 'MATCH', `${FLOOR_BAND_LABELS[band]} — 선호와 일치`);
    else add('floor', '층', 0, 'MISS', `${FLOOR_BAND_LABELS[band]} — 선호는 ${FLOOR_BAND_LABELS[p.floorPreference]}`);
  }

  if (p.preferNewBuild) {
    if (l.buildYear == null) add('newBuild', '신축', null, 'UNKNOWN', '준공연도 확인 필요');
    else {
      const age = now.getUTCFullYear() - l.buildYear;
      const s = age <= 10 ? 1 : age <= 20 ? 0.5 : 0;
      add('newBuild', '신축', s, s === 1 ? 'MATCH' : s > 0 ? 'PARTIAL' : 'MISS', `${l.buildYear}년 준공(${age}년차)`);
    }
  }

  if (p.parkingRequired) {
    if (l.parkingAvailable == null) add('parking', '주차', null, 'UNKNOWN', '주차 가능 여부 확인 필요');
    else add('parking', '주차', l.parkingAvailable ? 1 : 0, l.parkingAvailable ? 'MATCH' : 'MISS', l.parkingAvailable ? '주차 가능' : '주차 불가');
  }

  if (p.petRequired) {
    if (l.petAllowed == null) add('pet', '반려동물', null, 'UNKNOWN', '반려동물 가능 여부 확인 필요');
    else add('pet', '반려동물', l.petAllowed ? 1 : 0, l.petAllowed ? 'MATCH' : 'MISS', l.petAllowed ? '반려동물 가능' : '반려동물 불가');
  }
  return out;
}

function stableInputHash(l: MatchListingInput, p: MatchPreferenceInput): string {
  const norm = (v: unknown): unknown => {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]));
    return v;
  };
  return createHash('sha256').update(JSON.stringify([MATCH_ENGINE_VERSION, norm(l), norm(p)])).digest('hex');
}

/** 한 조건 세트 × 한 매물. now는 준공 연차 계산용(테스트에서 고정). */
export function evaluateMatch(l: MatchListingInput, p: MatchPreferenceInput, now: Date): MatchResult {
  const exclusions = hardFilters(l, p);
  const reasons = softReasons(l, p, now);
  const comparable = reasons.filter((r) => r.score != null);
  const comparableWeight = comparable.reduce((s, r) => s + r.weight, 0);
  const passedHard = exclusions.length === 0;
  let score: number | null = null;
  let confidence: MatchConfidence = 'INSUFFICIENT';
  if (passedHard && comparableWeight >= MIN_COMPARABLE_WEIGHT) {
    score = Math.round((100 * comparable.reduce((s, r) => s + r.weight * (r.score as number), 0)) / comparableWeight);
    confidence = 'SUFFICIENT';
  }
  return {
    listingId: l.id,
    preferenceId: p.id,
    passedHard,
    exclusions,
    score,
    confidence,
    comparableWeight,
    reasons,
    engineVersion: MATCH_ENGINE_VERSION,
    inputHash: stableInputHash(l, p),
  };
}

/** 정렬: hard 통과 → 점수 있는 것(높은 순) → 정보 부족 → 제외. 동점은 listingId로 결정적. */
export function rankMatches(results: MatchResult[]): MatchResult[] {
  const bucket = (r: MatchResult) => (!r.passedHard ? 2 : r.score == null ? 1 : 0);
  return [...results].sort((a, b) => bucket(a) - bucket(b) || (b.score ?? -1) - (a.score ?? -1) || a.listingId.localeCompare(b.listingId));
}

/** 사람이 읽는 한 줄 요약. 정보 부족이면 %를 쓰지 않는다. */
export function summarizeMatch(customerLabel: string, r: MatchResult): string {
  if (!r.passedHard) return `${customerLabel} — 조건 밖(${r.exclusions.map((e) => e.label).join(', ')})`;
  if (r.score == null) return `${customerLabel} — 정보 부족(비교 가능한 조건이 적음)`;
  return `${customerLabel}과 ${r.score}% 일치`;
}
