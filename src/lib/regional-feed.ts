// STATISTICS V2 — REGIONAL TRANSACTION FEED. 순수 함수만 모아둔 파일(DB/네트워크
// 호출 없음, 전부 테스트 가능). 이 파일이 다루는 "실거래 feed"는 기존
// /api/stats/rankings·dashboard·yearly가 이미 확립한 원칙을 그대로 따른다:
//   - MOLIT 원본은 fetchMolitData가 이미 파싱해준 것만 쓴다(재파싱 없음).
//   - 전용면적은 원본 raw 값(excluUseArea)으로만 동일성 판정한다 — Unit Master
//     representativePyeong으로 임의 반올림/병합하지 않는다(exclusiveArea/3.3058
//     같은 가짜 평형 계산 금지, AGENTS.md Unit Master protection 원칙).
//   - 취소거래(dealCanceled)는 집계에서 항상 제외하지만, feed 목록 자체에서는
//     "취소" 표기와 함께 남겨둔다(원거래를 숨기지 않는다).
//   - canonical identity는 aptSeq 우선, 없으면 name+dong 조합으로만 폴백한다
//     (다른 단지로 fallback하지 않는다는 원칙 — 이름만으로 다른 지역/단지와
//     섞지 않기 위해 dong까지 포함).

export type PeriodPreset =
  | 'today'
  | 'yesterday'
  | '7d'
  | 'thisWeek'
  | 'lastWeek'
  | '30d'
  | '12m'
  | 'custom';

export interface PeriodRange {
  /** YYYY-MM-DD, inclusive */
  from: string;
  /** YYYY-MM-DD, inclusive */
  to: string;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date): Date {
  // 월요일 시작 기준(당근/국내 서비스 관례).
  const day = d.getDay(); // 0=일 ... 6=토
  const diff = day === 0 ? 6 : day - 1;
  const start = new Date(d);
  start.setDate(d.getDate() - diff);
  return start;
}

/**
 * period preset을 실제 날짜 범위로 변환한다. `now`를 인자로 받아 순수 함수로
 * 유지한다(테스트에서 고정 시각 주입 가능). custom preset은 from/to가 반드시
 * 필요하며, 없으면 12개월 기본값으로 안전하게 폴백한다(빈 범위로 크래시하지
 * 않음).
 */
export function resolvePeriodRange(preset: PeriodPreset, now: Date, custom?: { from: string; to: string }): PeriodRange {
  const today = toDateStr(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(now.getDate() - 1);
      const ys = toDateStr(y);
      return { from: ys, to: ys };
    }
    case '7d': {
      const from = new Date(now);
      from.setDate(now.getDate() - 6);
      return { from: toDateStr(from), to: today };
    }
    case 'thisWeek': {
      const start = startOfWeek(now);
      return { from: toDateStr(start), to: today };
    }
    case 'lastWeek': {
      const thisStart = startOfWeek(now);
      const lastStart = new Date(thisStart);
      lastStart.setDate(thisStart.getDate() - 7);
      const lastEnd = new Date(thisStart);
      lastEnd.setDate(thisStart.getDate() - 1);
      return { from: toDateStr(lastStart), to: toDateStr(lastEnd) };
    }
    case '30d': {
      const from = new Date(now);
      from.setDate(now.getDate() - 29);
      return { from: toDateStr(from), to: today };
    }
    case '12m': {
      const from = new Date(now);
      from.setMonth(now.getMonth() - 11);
      from.setDate(1);
      return { from: toDateStr(from), to: today };
    }
    case 'custom':
      if (custom && custom.from && custom.to && custom.from <= custom.to) return { from: custom.from, to: custom.to };
      return resolvePeriodRange('12m', now);
    default:
      return resolvePeriodRange('12m', now);
  }
}

/** 날짜 범위를 커버하는 YYYYMM 목록(오름차순, 중복 없음) — MOLIT 월 단위 배치
 * 호출에 사용한다. 거래 row 개수만큼이 아니라 "겹치는 달" 개수만큼만 호출하게
 * 하기 위한 함수(N+1 방지의 핵심). */
export function monthsForRange(range: PeriodRange): string[] {
  const [fy, fm] = range.from.split('-').map(Number);
  const [ty, tm] = range.to.split('-').map(Number);
  const months: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    months.push(`${y}${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

export function isDateInRange(dateStr: string, range: PeriodRange): boolean {
  return dateStr >= range.from && dateStr <= range.to;
}

export interface FeedTrade {
  /** 안정적인 원본 식별용(같은 거래 중복 방지) — 실제 API가 id를 안 주면
   * 호출부에서 조합해 채운다. */
  uid: string;
  aptSeq: string | null;
  name: string;
  dong: string;
  dealType: 'sale' | 'jeonse' | 'wolse';
  dealAmount: number; // 만원
  excluUseArea: number | null; // ㎡, raw(원본) — pyeong 변환 금지
  floorRaw: string | number | null;
  dealDate: string; // YYYY-MM-DD
  dealCanceled: boolean;
}

/** canonical identity 키 — aptSeq 있으면 그것만, 없으면 name+dong 조합(다른
 * 단지로 fallback 금지, 이름만으로 매칭 금지 원칙의 최소 구현). */
export function identityKey(t: Pick<FeedTrade, 'aptSeq' | 'name' | 'dong'>): string {
  return t.aptSeq ? `id:${t.aptSeq}` : `nd:${t.name}|${t.dong}`;
}

/** 전용면적 raw 식별 키 — 소수점 그대로 비교(84.7855 vs 84.9950을 하나로
 * 합치지 않는다, trade-area-selection.ts와 동일 원칙). */
export function areaKey(t: Pick<FeedTrade, 'excluUseArea'>): string {
  return t.excluUseArea != null ? t.excluUseArea.toString() : 'unknown';
}

/** 동일 (identity + area + dealType) 그룹 키 — 신고가/직전거래 비교 단위. */
export function groupKey(t: Pick<FeedTrade, 'aptSeq' | 'name' | 'dong' | 'excluUseArea' | 'dealType'>): string {
  return `${identityKey(t)}::${areaKey(t)}::${t.dealType}`;
}

/** 같은 거래가 중복 fetch(달 겹침 등)로 두 번 들어와도 하나만 남긴다. */
export function dedupeTrades(trades: FeedTrade[]): FeedTrade[] {
  const seen = new Map<string, FeedTrade>();
  for (const t of trades) {
    const key = `${groupKey(t)}|${t.dealAmount}|${t.dealDate}|${t.floorRaw}`;
    if (!seen.has(key)) seen.set(key, t);
  }
  return Array.from(seen.values());
}

/** 취소거래를 집계에서 제외(기존 gap-invest-calc.ts/school-trade-price.ts와
 * 동일 원칙 — 이 STEP에서 새로 만들지 않고 동일 컨벤션을 재사용). */
export function filterVerifiedTrades(trades: FeedTrade[]): FeedTrade[] {
  return trades.filter((t) => !t.dealCanceled);
}

export function groupTradesByDate(trades: FeedTrade[]): Array<{ date: string; trades: FeedTrade[] }> {
  const map = new Map<string, FeedTrade[]>();
  for (const t of trades) {
    if (!map.has(t.dealDate)) map.set(t.dealDate, []);
    map.get(t.dealDate)!.push(t);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({ date, trades: [...list].sort((a, b) => b.dealAmount - a.dealAmount) }));
}

export interface TradeAnnotation {
  isRecordHigh: boolean;
  previousTrade: { dealAmount: number; dealDate: string } | null;
  changeAmount: number | null; // +상승, -하락(만원)
  changePct: number | null;
}

/**
 * `allTrades`(조회 lookback 전체, period보다 넓은 범위여야 함)를 기준으로 각
 * 거래에 신고가 여부/직전거래 대비 변화를 부여한다. 반드시 동일
 * (identity+area+dealType) 그룹 안에서만 비교하며, 그룹의 "직전"은 같은
 * 그룹에서 자기보다 이전 날짜의 검증된(비취소) 거래 중 가장 최근 것이다.
 * 신고가는 "이 거래 시점까지" 그룹 내 최고가인지로 판정한다(미래 거래를
 * 끌어와 판단하지 않는다 — 그렇지 않으면 나중에 더 높은 거래가 나올 때마다
 * 과거 표시가 바뀌는 오류가 생긴다).
 *
 * 취소된 거래 자신은 이 함수가 annotate하지 않는다(호출부가 취소 거래는 이
 * 함수에 넣지 않거나, 넣더라도 무시해도 되도록 verified만 기준으로 계산).
 */
export function annotateTrades(allTrades: FeedTrade[]): Map<string, TradeAnnotation> {
  const verified = filterVerifiedTrades(allTrades);
  const byGroup = new Map<string, FeedTrade[]>();
  for (const t of verified) {
    const key = groupKey(t);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(t);
  }

  const result = new Map<string, TradeAnnotation>();
  for (const list of byGroup.values()) {
    // 날짜 오름차순 정렬(동일 날짜는 원본 순서 유지) — 시간순으로 "지금까지의 최고가"를 누적 계산.
    const sorted = [...list].sort((a, b) => a.dealDate.localeCompare(b.dealDate));
    let runningMax = -Infinity;
    let previous: { dealAmount: number; dealDate: string } | null = null;
    for (const t of sorted) {
      const isRecordHigh = t.dealAmount >= runningMax;
      const changeAmount = previous ? t.dealAmount - previous.dealAmount : null;
      const changePct = previous && previous.dealAmount > 0 ? Math.round((changeAmount! / previous.dealAmount) * 1000) / 10 : null;
      result.set(t.uid, {
        isRecordHigh,
        previousTrade: previous,
        changeAmount,
        changePct,
      });
      if (t.dealAmount > runningMax) runningMax = t.dealAmount;
      previous = { dealAmount: t.dealAmount, dealDate: t.dealDate };
    }
  }
  return result;
}

export interface RegionSummary {
  totalCount: number;
  verifiedCount: number;
  cancelledCount: number;
  recordHighCount: number;
  riseCount: number;
  fallCount: number;
  byDealType: Record<'sale' | 'jeonse' | 'wolse', number>;
}

/** period 범위 내 거래(전체, 취소 포함)와 그 annotate 결과로 지역 요약을
 * 만든다. 상승/하락은 "직전거래가 있는 거래" 중에서만 판정한다(비교 대상이
 * 없으면 상승도 하락도 아님 — 억지로 0으로 만들지 않는다). */
export function buildRegionSummary(periodTrades: FeedTrade[], annotations: Map<string, TradeAnnotation>): RegionSummary {
  const cancelledCount = periodTrades.filter((t) => t.dealCanceled).length;
  const verified = filterVerifiedTrades(periodTrades);
  let recordHighCount = 0;
  let riseCount = 0;
  let fallCount = 0;
  const byDealType: RegionSummary['byDealType'] = { sale: 0, jeonse: 0, wolse: 0 };
  for (const t of verified) {
    byDealType[t.dealType]++;
    const a = annotations.get(t.uid);
    if (a?.isRecordHigh) recordHighCount++;
    if (a?.changeAmount != null) {
      if (a.changeAmount > 0) riseCount++;
      else if (a.changeAmount < 0) fallCount++;
    }
  }
  return {
    totalCount: periodTrades.length,
    verifiedCount: verified.length,
    cancelledCount,
    recordHighCount,
    riseCount,
    fallCount,
    byDealType,
  };
}

export interface MarketInterpretationInput {
  periodLabel: string;
  periodDays: number;
  summary: RegionSummary;
  /** lookback 전체(12개월) 기준 일평균 거래량 비교용 — 취소 제외 이미 완료된 값. */
  lookbackVerifiedCount: number;
  lookbackDays: number;
  /** dong별 거래건수(취소 제외), 내림차순 정렬은 함수 내부에서 처리. */
  dongCounts: Record<string, number>;
  /** 10㎡ 단위 면적대별 거래건수(취소 제외) — 라벨은 "80~90"처럼 순수 구간, 특정
   * 평형을 단정하지 않는다. */
  areaBandCounts: Record<string, number>;
}

const MIN_SAMPLE_FOR_INSIGHT = 3;

/** deterministic 시장 해석 문장 생성 — LLM 없음, 사실 기반, 단정적 표현 금지
 * (§17). 표본이 너무 적으면 문장을 만들지 않는다(과잉해석 방지). */
export function buildMarketInterpretation(input: MarketInterpretationInput): string[] {
  const { summary, lookbackVerifiedCount, lookbackDays, periodDays, dongCounts, areaBandCounts } = input;
  const lines: string[] = [];

  if (summary.verifiedCount < MIN_SAMPLE_FOR_INSIGHT) return lines;

  // 1) 일평균 거래량 비교(기간 길이가 달라도 공정하게 비교하기 위해 일평균으로 정규화).
  if (lookbackDays > 0 && lookbackVerifiedCount > 0) {
    const periodDailyAvg = summary.verifiedCount / Math.max(periodDays, 1);
    const lookbackDailyAvg = lookbackVerifiedCount / lookbackDays;
    if (lookbackDailyAvg > 0) {
      const pct = Math.round(((periodDailyAvg - lookbackDailyAvg) / lookbackDailyAvg) * 100);
      if (Math.abs(pct) >= 10) {
        lines.push(`최근 12개월 일평균 거래량 대비 ${pct > 0 ? '거래량이 ' + pct + '% 높습니다' : '거래량이 ' + Math.abs(pct) + '% 낮습니다'}.`);
      }
    }
  }

  // 2) 신고가 비중.
  if (summary.recordHighCount > 0) {
    const pct = Math.round((summary.recordHighCount / summary.verifiedCount) * 100);
    lines.push(`${input.periodLabel} 신고가 거래가 ${summary.recordHighCount}건 확인됩니다(전체의 ${pct}%).`);
  }

  // 3) 특정 동 거래 집중.
  const dongEntries = Object.entries(dongCounts).sort((a, b) => b[1] - a[1]);
  if (dongEntries.length > 0) {
    const [topDong, topCount] = dongEntries[0];
    const share = topCount / summary.verifiedCount;
    if (share >= 0.3 && dongEntries.length > 1) {
      lines.push(`${topDong} 거래가 집중되고 있습니다(${topCount}건, 전체의 ${Math.round(share * 100)}%).`);
    }
  }

  // 4) 활발한 면적대.
  const areaEntries = Object.entries(areaBandCounts).sort((a, b) => b[1] - a[1]);
  if (areaEntries.length > 0 && areaEntries[0][1] >= MIN_SAMPLE_FOR_INSIGHT) {
    lines.push(`가장 거래가 많은 면적대는 ${areaEntries[0][0]}㎡입니다(${areaEntries[0][1]}건).`);
  }

  // 5) 상승/하락 비교(직전거래 있는 것만).
  if (summary.riseCount + summary.fallCount >= MIN_SAMPLE_FOR_INSIGHT) {
    lines.push(`직전 거래 대비 상승 거래 ${summary.riseCount}건, 하락 거래 ${summary.fallCount}건입니다.`);
  }

  return lines;
}

/** 면적(㎡) 원본값을 10㎡ 단위 구간 라벨로 묶는다 — 특정 공식 평형을 단정하지
 * 않는 순수 분포 집계용(예: "80~90"). null이면 집계에서 제외. */
export function areaBandLabel(excluUseArea: number | null): string | null {
  if (excluUseArea == null || !Number.isFinite(excluUseArea)) return null;
  const bandStart = Math.floor(excluUseArea / 10) * 10;
  return `${bandStart}~${bandStart + 10}`;
}
