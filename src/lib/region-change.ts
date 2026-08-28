// REGION_PRICE_CHANGE_MAP_V2 — "지역 변동지도"의 순수 계산 로직만 모아둔 파일
// (DB/네트워크 호출 없음, 전부 테스트 가능). identity/area 식별 원칙은
// price-ranking.ts/regional-feed.ts가 이미 확립한 것을 그대로 재사용한다
// (aptSeq 우선, raw 전용면적 그대로 비교, 취소거래 제외, 새로 발명하지 않음).
//
// §3/§4/§5 — "지역 내 모든 거래를 단순 평균"하는 방식은 쓰지 않는다. 거래되는
// 단지/면적 mix가 기간마다 달라지면 가격 변화가 아니라 "구성 변화"가 상승률처럼
// 보일 수 있다(composition bias). 대신 "같은 단지 + 같은 raw 전용면적"identity를
// 유지한 pair(현재 window의 대표가 vs 직전 동일 길이 window의 대표가)만 만들고,
// 지역 단위 숫자는 그 pair들의 %변화율 median으로 집계한다 — 각 pair가 이미
// 동일 unit type이므로 median을 아무리 여러 pair에 걸쳐 모아도 mix 변화의 영향을
// 받지 않는다(단위 테스트로 검증).

import { identityKey, groupKey, filterVerifiedTrades, previousPeriodRange, monthsForRange, type FeedTrade, type PeriodRange } from './regional-feed';

export type { FeedTrade, PeriodRange };
export { identityKey, groupKey, filterVerifiedTrades };

// §6 — 정의: "현재 window vs 직전 동일 길이 window". 대안(현재가 vs N개월 전
// 대표가, 트레일링 baseline lookback)도 감사했으나(실측 데이터 기준 pair 수
// 서구 1개월 34→16, 3개월 93→65 정도로 다소 줄지만 여전히 충분), window-vs-window
// 쪽이 (a) fetch 범위가 항상 2×period개월로 명확히 bounded돼 nationwide
// 성능 예산을 지키기 쉽고, (b) "최근 N개월 vs 그 직전 N개월"이라는 설명이
// 사용자에게 더 직관적이라 최종 채택했다(문서 §9 참고).
export type RegionChangePeriodPreset = '1m' | '3m' | '6m' | '12m';

export const REGION_CHANGE_PERIOD_MONTHS: Record<RegionChangePeriodPreset, number> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '12m': 12,
};

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 현재 window(오늘 포함 최근 N개월)를 만든다. previousPeriodRange()로 바로
 * 직전 동일 길이 window를 이어 붙일 수 있다. */
export function resolveRegionChangeCurrentWindow(preset: RegionChangePeriodPreset, now: Date): PeriodRange {
  const months = REGION_CHANGE_PERIOD_MONTHS[preset];
  const from = new Date(now);
  from.setMonth(from.getMonth() - months);
  return { from: toDateStr(from), to: toDateStr(now) };
}

export interface RegionChangeWindows {
  current: PeriodRange;
  previous: PeriodRange;
}

export function resolveRegionChangeWindows(preset: RegionChangePeriodPreset, now: Date): RegionChangeWindows {
  const current = resolveRegionChangeCurrentWindow(preset, now);
  const previous = previousPeriodRange(current);
  return { current, previous };
}

/** upstream fetch가 커버해야 하는 YYYYMM 목록(중복 없음, 오름차순) — §34/§35
 * 성능 예산의 핵심: 항상 정확히 current+previous 두 window만큼만 fetch하고,
 * baseline을 무제한으로 더 과거까지 찾지 않는다(고정 상한 = 2×period개월). */
export function regionChangeFetchMonths(preset: RegionChangePeriodPreset, now: Date): string[] {
  const { current, previous } = resolveRegionChangeWindows(preset, now);
  return monthsForRange({ from: previous.from, to: current.to });
}

export interface ChangePair {
  complexKey: string; // identity만(면적 무관) — "몇 개 단지" 집계 단위
  groupKey: string; // identity+exact area+dealType — pair 계산 단위
  aptSeq: string | null;
  name: string;
  dong: string;
  lawdCd: string;
  excluUseArea: number;
  currentAmount: number;
  currentDate: string;
  baselineAmount: number;
  baselineDate: string;
  changePct: number;
}

function pickLatest(trades: FeedTrade[]): FeedTrade {
  // 날짜 DESC → 금액 DESC → uid 오름차순(결정론적).
  return [...trades].sort((a, b) => {
    if (a.dealDate !== b.dealDate) return a.dealDate < b.dealDate ? 1 : -1;
    if (a.dealAmount !== b.dealAmount) return b.dealAmount - a.dealAmount;
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  })[0];
}

/** §4/§45 — "같은 단지 + 같은 raw 전용면적"(groupKey) 단위로만 pair를 만든다.
 * current window의 대표 거래(가장 최근) vs previous window의 대표 거래(가장
 * 최근)를 비교한다. 두 window 모두에 검증된 거래가 있는 그룹만 pair가 된다
 * (한쪽이라도 없으면 그 그룹은 이번 기간 비교에서 제외 — 억지로 채우지 않음).
 * 취소거래는 filterVerifiedTrades로 항상 먼저 제거한다(§9). */
export function buildRegionChangePairs(allTrades: FeedTrade[], windows: RegionChangeWindows): ChangePair[] {
  const verified = filterVerifiedTrades(allTrades);
  const byGroup = new Map<string, FeedTrade[]>();
  for (const t of verified) {
    const key = groupKey(t);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(t);
  }

  const pairs: ChangePair[] = [];
  for (const [key, list] of byGroup) {
    const inCurrent = list.filter((t) => t.dealDate >= windows.current.from && t.dealDate <= windows.current.to);
    const inPrevious = list.filter((t) => t.dealDate >= windows.previous.from && t.dealDate <= windows.previous.to);
    if (inCurrent.length === 0 || inPrevious.length === 0) continue;
    if (list[0]?.excluUseArea == null) continue;

    const current = pickLatest(inCurrent);
    const baseline = pickLatest(inPrevious);
    if (baseline.dealAmount <= 0) continue;

    pairs.push({
      complexKey: identityKey(current),
      groupKey: key,
      aptSeq: current.aptSeq,
      name: current.name,
      dong: current.dong,
      lawdCd: current.lawdCd,
      excluUseArea: current.excluUseArea as number,
      currentAmount: current.dealAmount,
      currentDate: current.dealDate,
      baselineAmount: baseline.dealAmount,
      baselineDate: baseline.dealDate,
      changePct: ((current.dealAmount - baseline.dealAmount) / baseline.dealAmount) * 100,
    });
  }
  return pairs;
}

// §7/§39 — 최소표본 threshold. 실측(부산 4개 구 24개월 raw 데이터, window-vs-window
// 정의) 기준 시군구 단위는 1개월도 16~67쌍, 3개월 65~267쌍으로 충분했지만, 동
// 단위로 내려가면 활동이 적은 동은 5쌍 미만인 경우가 관측됐다(예: 서구 19개 동
// 중 12개가 3개월 기준 5쌍 미만). 5 미만은 "표본 부족"으로 정직하게 숨긴다.
export const MIN_SAMPLE_PAIRS = 5;
const CONFIDENCE_LOW_MAX = 9;
const CONFIDENCE_MEDIUM_MAX = 29;

export type RegionChangeConfidence = 'INSUFFICIENT' | 'LOW' | 'MEDIUM' | 'HIGH';

export function deriveConfidence(pairCount: number): RegionChangeConfidence {
  if (pairCount < MIN_SAMPLE_PAIRS) return 'INSUFFICIENT';
  if (pairCount <= CONFIDENCE_LOW_MAX) return 'LOW';
  if (pairCount <= CONFIDENCE_MEDIUM_MAX) return 'MEDIUM';
  return 'HIGH';
}

export const CONFIDENCE_LABEL: Record<RegionChangeConfidence, string> = {
  INSUFFICIENT: '거래 적음',
  LOW: '거래 적음',
  MEDIUM: '보통',
  HIGH: '거래 충분',
};

// §19 — 0에 가까운 변화는 보합. 실측 median 값들(서구 0.00%, 연제 0.19%,
// 해운대 -0.88%, 동래 0.13%, 3개월 기준)이 대부분 ±0.5% 안에 들어와, 그
// 범위를 "사실상 변화 없음"의 안전한 경계로 채택했다.
export const NEUTRAL_RANGE_PCT = 0.5;

export type ChangeDirection = 'up' | 'down' | 'neutral';

export function classifyDirection(medianPct: number): ChangeDirection {
  if (medianPct > NEUTRAL_RANGE_PCT) return 'up';
  if (medianPct < -NEUTRAL_RANGE_PCT) return 'down';
  return 'neutral';
}

// §18 — 변동폭 강도 단계(대칭). 실측 median 분포(구 단위 -0.88%~3.73%)와 pair
// 단위 분포(p10~p90 대략 ±14%)를 함께 고려해 지정 예시 그대로 채택했다.
export type ChangeIntensity = '0-1' | '1-3' | '3-5' | '5+';

export function classifyIntensity(medianPct: number): ChangeIntensity {
  const abs = Math.abs(medianPct);
  if (abs >= 5) return '5+';
  if (abs >= 3) return '3-5';
  if (abs >= 1) return '1-3';
  return '0-1';
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor((sorted.length - 1) / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid] + sorted[mid + 1]) / 2;
}

export interface RegionChangeAggregate {
  key: string;
  label: string;
  medianPct: number | null;
  pairCount: number;
  complexCount: number;
  minPct: number | null;
  maxPct: number | null;
  confidence: RegionChangeConfidence;
  direction: ChangeDirection | null;
  intensity: ChangeIntensity | null;
}

/** §8/§9/§45 — pair 목록을 임의의 bucket(예: lawdCd, dong)으로 나눠 median을
 * 집계한다. outlier 방어는 median 자체가 담당한다(평균이 아님 — 단위 테스트로
 * 극단값 주입 시 median이 거의 흔들리지 않음을 확인). */
export function aggregateChangeByBucket(pairs: ChangePair[], bucketKeyFn: (p: ChangePair) => string, labelFn: (key: string, samplePair: ChangePair) => string): RegionChangeAggregate[] {
  const byBucket = new Map<string, ChangePair[]>();
  for (const p of pairs) {
    const k = bucketKeyFn(p);
    if (!byBucket.has(k)) byBucket.set(k, []);
    byBucket.get(k)!.push(p);
  }

  const result: RegionChangeAggregate[] = [];
  for (const [key, list] of byBucket) {
    const pcts = list.map((p) => p.changePct);
    const median = medianOf(pcts);
    const pairCount = list.length;
    const complexCount = new Set(list.map((p) => p.complexKey)).size;
    const confidence = deriveConfidence(pairCount);
    result.push({
      key,
      label: labelFn(key, list[0]),
      medianPct: confidence === 'INSUFFICIENT' ? null : median,
      pairCount,
      complexCount,
      minPct: pcts.length ? Math.min(...pcts) : null,
      maxPct: pcts.length ? Math.max(...pcts) : null,
      confidence,
      direction: confidence === 'INSUFFICIENT' || median == null ? null : classifyDirection(median),
      intensity: confidence === 'INSUFFICIENT' || median == null ? null : classifyIntensity(median),
    });
  }
  return result;
}

// §29 — deterministic region interpretation. 실제 계산 결과에서만 만들고,
// 표본 부족 bucket은 후보에서 제외한다. 비교 대상이 2개 미만이면("가장 컸어요"라는
// 비교 자체가 성립 안 함) null.
export function buildRegionChangeInterpretation(buckets: RegionChangeAggregate[], regionLabel: string, periodLabel: string): string | null {
  const eligible = buckets.filter((b) => b.confidence !== 'INSUFFICIENT' && b.medianPct != null);
  if (eligible.length < 2) return null;
  const top = [...eligible].sort((a, b) => Math.abs(b.medianPct!) - Math.abs(a.medianPct!))[0];
  if (Math.abs(top.medianPct!) <= NEUTRAL_RANGE_PCT) return null;
  const verb = top.medianPct! > 0 ? '상승폭' : '하락폭';
  return `최근 ${periodLabel} ${regionLabel}에서는 ${top.label}의 ${verb}이 가장 컸어요.`;
}

export interface ComplexChangeRow {
  complexKey: string;
  name: string;
  dong: string;
  lawdCd: string;
  aptSeq: string | null;
  excluUseArea: number;
  currentAmount: number;
  currentDate: string;
  baselineAmount: number;
  baselineDate: string;
  changePct: number;
  sampleTradeCount: number; // 대표 면적 그룹의 window 내 총 거래 건수(표본 맥락)
  confidence: RegionChangeConfidence;
}

/** §14/§45 — 단지(LEVEL 4) 목록. 단지 안에 여러 raw 전용면적이 있을 수 있으므로,
 * "이 단지의 변동률"은 두 window 모두에서 거래가 가장 활발했던(대표) 면적 1개만
 * 골라 계산한다 — 서로 다른 면적을 섞어 하나의 변동률로 만들지 않는다. */
export function buildComplexChangeRows(allTrades: FeedTrade[], windows: RegionChangeWindows): ComplexChangeRow[] {
  const verified = filterVerifiedTrades(allTrades);
  const byComplex = new Map<string, FeedTrade[]>();
  for (const t of verified) {
    const key = identityKey(t);
    if (!byComplex.has(key)) byComplex.set(key, []);
    byComplex.get(key)!.push(t);
  }

  const rows: ComplexChangeRow[] = [];
  for (const [complexKey, complexTrades] of byComplex) {
    const byArea = new Map<string, FeedTrade[]>();
    for (const t of complexTrades) {
      if (t.excluUseArea == null) continue;
      const k = groupKey(t);
      if (!byArea.has(k)) byArea.set(k, []);
      byArea.get(k)!.push(t);
    }

    type Candidate = { areaGroupKey: string; current: FeedTrade[]; previous: FeedTrade[] };
    const candidates: Candidate[] = [];
    for (const [areaGroupKey, list] of byArea) {
      const inCurrent = list.filter((t) => t.dealDate >= windows.current.from && t.dealDate <= windows.current.to);
      const inPrevious = list.filter((t) => t.dealDate >= windows.previous.from && t.dealDate <= windows.previous.to);
      if (inCurrent.length === 0 || inPrevious.length === 0) continue;
      candidates.push({ areaGroupKey, current: inCurrent, previous: inPrevious });
    }
    if (candidates.length === 0) continue;

    // 대표 면적 선택: (current+previous) 거래 건수 DESC → 최근 거래일 DESC → areaGroupKey 오름차순.
    candidates.sort((a, b) => {
      const countDiff = b.current.length + b.previous.length - (a.current.length + a.previous.length);
      if (countDiff !== 0) return countDiff;
      const aLatest = pickLatest(a.current).dealDate;
      const bLatest = pickLatest(b.current).dealDate;
      if (aLatest !== bLatest) return aLatest < bLatest ? 1 : -1;
      return a.areaGroupKey < b.areaGroupKey ? -1 : 1;
    });
    const chosen = candidates[0];
    const current = pickLatest(chosen.current);
    const baseline = pickLatest(chosen.previous);
    if (baseline.dealAmount <= 0) continue;

    const sampleTradeCount = chosen.current.length + chosen.previous.length;
    rows.push({
      complexKey,
      name: current.name,
      dong: current.dong,
      lawdCd: current.lawdCd,
      aptSeq: current.aptSeq,
      excluUseArea: current.excluUseArea as number,
      currentAmount: current.dealAmount,
      currentDate: current.dealDate,
      baselineAmount: baseline.dealAmount,
      baselineDate: baseline.dealDate,
      changePct: ((current.dealAmount - baseline.dealAmount) / baseline.dealAmount) * 100,
      sampleTradeCount,
      confidence: deriveConfidence(sampleTradeCount),
    });
  }
  return rows;
}

export function periodLabelOf(preset: RegionChangePeriodPreset): string {
  const months = REGION_CHANGE_PERIOD_MONTHS[preset];
  if (months % 12 === 0) return `${months / 12}년`;
  return `${months}개월`;
}
