// STATISTICS V2.1-1 — DECLINE + RECORD HIGH + RISING. 순수 함수만 모아둔
// 파일(DB/네트워크 호출 없음, 전부 테스트 가능). identity/area 식별은
// regional-feed.ts가 이미 확립한 원칙(aptSeq 우선, raw 전용면적 그대로 비교,
// 취소거래 제외)을 그대로 재사용한다 — 새로 발명하지 않는다.
//
// 세 화면의 비교 기준이 서로 다르다는 것이 이번 STEP의 핵심 감사 결과다:
//   - 하락: 기간 내 "가장 최근" 정상 거래 vs 그 이전 "역대 최고가"(historical high)
//   - 신고가: 기간 내 각 거래 vs 그 거래 이전 "역대 최고가" — 최고가를 실제로
//     넘어선 거래만(이전 최고가가 존재해야 함 — 그룹의 첫 거래는 신고가가 아님)
//   - 상승: 기간 내 "가장 최근" 정상 거래 vs 시간순으로 "바로 직전" 거래(역대
//     최고가가 아니라 immediate previous trade)
// 이 세 정의를 하나의 "직전거래 대비 변화"로 뭉뚱그리면 하락/신고가가 왜곡된다
// (예: 직전 거래보다는 올랐지만 역대 최고가보다는 한참 낮은 "하락 후 소폭
// 반등"이 상승으로 잘못 표시됨) — 그래서 regional-feed.ts의 annotateTrades를
// 재사용하지 않고 이 파일에서 별도로 계산한다.

import { identityKey, areaKey, groupKey, dedupeTrades, filterVerifiedTrades, type FeedTrade } from './regional-feed';

export type { FeedTrade };
export { identityKey, areaKey, groupKey, dedupeTrades, filterVerifiedTrades };

interface HistoryPoint {
  trade: FeedTrade;
  /** 이 거래 이전(시간순 strictly earlier) 검증된 거래 중 최고가. 없으면 null
   * (그룹의 첫 거래 — "이전 최고가가 존재해야 한다"는 신고가 조건 §11을 여기서
   * 구조적으로 강제한다). */
  priorHigh: { amount: number; date: string } | null;
  /** 시간순으로 바로 직전(하나 앞) 검증된 거래. 없으면 null. */
  immediatePrior: { amount: number; date: string } | null;
  /** 같은 그룹의 트레일링 12개월(이 거래 기준) 검증된 거래 건수 — §15 표본
   * 규칙에 사용. 이 거래 자신도 포함한다. */
  trailing12moSampleCount: number;
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/** groupKey별로 시간순 정렬 후, 각 거래에 priorHigh/immediatePrior/표본수를
 * 부여한다. 미래 거래를 절대 끌어오지 않는다(priorHigh/immediatePrior는 항상
 * "이전"만 본다) — regional-feed.ts의 annotateTrades와 동일한 안전 원칙. */
function buildHistory(allTrades: FeedTrade[]): Map<string, HistoryPoint[]> {
  const verified = filterVerifiedTrades(allTrades);
  const byGroup = new Map<string, FeedTrade[]>();
  for (const t of verified) {
    const key = groupKey(t);
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(t);
  }

  const result = new Map<string, HistoryPoint[]>();
  for (const [key, list] of byGroup) {
    const sorted = [...list].sort((a, b) => a.dealDate.localeCompare(b.dealDate));
    const points: HistoryPoint[] = [];
    let runningHigh: { amount: number; date: string } | null = null;
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      let sampleCount = 1;
      for (let j = i - 1; j >= 0; j--) {
        if (monthsBetween(sorted[j].dealDate, t.dealDate) <= 12) sampleCount++;
        else break;
      }
      points.push({
        trade: t,
        priorHigh: runningHigh,
        immediatePrior: i > 0 ? { amount: sorted[i - 1].dealAmount, date: sorted[i - 1].dealDate } : null,
        trailing12moSampleCount: sampleCount,
      });
      if (!runningHigh || t.dealAmount > runningHigh.amount) runningHigh = { amount: t.dealAmount, date: t.dealDate };
    }
    result.set(key, points);
  }
  return result;
}

export interface PeriodRange {
  from: string;
  to: string;
}

function inRange(dateStr: string, range: PeriodRange): boolean {
  return dateStr >= range.from && dateStr <= range.to;
}

// §5 — 하락/신고가/상승 3개 화면이 공유하는 기간 preset. 기존
// regional-feed.ts의 preset(오늘/어제/이번주 등, 실거래 feed 전용)과는 다른
// 목적이라 별도로 둔다 — "최근 N일/개월" 형태만 필요하고 요일 단위(이번주/
// 지난주) 개념은 이 3개 화면에는 맞지 않는다(§5 최소 preset 지시).
export type PriceRankingPeriodPreset = '7d' | '30d' | '3m' | '6m' | '12m';

export function resolvePriceRankingPeriod(preset: PriceRankingPeriodPreset, now: Date): PeriodRange {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now);
  switch (preset) {
    case '7d':
      from.setDate(now.getDate() - 6);
      break;
    case '30d':
      from.setDate(now.getDate() - 29);
      break;
    case '3m':
      from.setMonth(now.getMonth() - 3);
      break;
    case '6m':
      from.setMonth(now.getMonth() - 6);
      break;
    case '12m':
      from.setMonth(now.getMonth() - 12);
      break;
  }
  return { from: from.toISOString().slice(0, 10), to };
}

export interface RecordHighRow {
  groupKey: string;
  aptSeq: string | null;
  name: string;
  dong: string;
  lawdCd: string;
  excluUseArea: number | null;
  floorRaw: string | number | null;
  currentAmount: number;
  currentDate: string;
  priorHighAmount: number;
  priorHighDate: string;
  deltaAmount: number;
  deltaPct: number;
  trailing12moSampleCount: number;
}

/** §11/§12 — 기간 내 거래 중 "그 거래 이전 역대 최고가"를 실제로 넘어선
 * 거래만 신고가로 인정한다. 이전 최고가가 없으면(그룹의 첫 거래) 신고가가
 * 아니다. 같은 그룹에서 기간 내 여러 건이 각각 신고가를 경신했다면 전부
 * 별도 row로 남긴다(각각 실제로 벌어진 사건이므로 임의로 하나만 고르지
 * 않는다). */
export function buildRecordHighRows(allTrades: FeedTrade[], period: PeriodRange): RecordHighRow[] {
  const history = buildHistory(allTrades);
  const rows: RecordHighRow[] = [];
  for (const [key, points] of history) {
    for (const p of points) {
      if (!inRange(p.trade.dealDate, period)) continue;
      if (!p.priorHigh) continue; // 이전 최고가 없음 — 신고가 판정 불가
      if (p.trade.dealAmount <= p.priorHigh.amount) continue;
      const deltaAmount = p.trade.dealAmount - p.priorHigh.amount;
      rows.push({
        groupKey: key,
        aptSeq: p.trade.aptSeq,
        name: p.trade.name,
        dong: p.trade.dong,
        lawdCd: p.trade.lawdCd,
        excluUseArea: p.trade.excluUseArea,
        floorRaw: p.trade.floorRaw,
        currentAmount: p.trade.dealAmount,
        currentDate: p.trade.dealDate,
        priorHighAmount: p.priorHigh.amount,
        priorHighDate: p.priorHigh.date,
        deltaAmount,
        deltaPct: p.priorHigh.amount > 0 ? Math.round((deltaAmount / p.priorHigh.amount) * 1000) / 10 : 0,
        trailing12moSampleCount: p.trailing12moSampleCount,
      });
    }
  }
  return rows;
}

export interface DeclineRow {
  groupKey: string;
  aptSeq: string | null;
  name: string;
  dong: string;
  lawdCd: string;
  excluUseArea: number | null;
  floorRaw: string | number | null;
  currentAmount: number;
  currentDate: string;
  priorHighAmount: number;
  priorHighDate: string;
  declineAmount: number; // 음수
  declinePct: number; // 음수
  trailing12moSampleCount: number;
}

/** §8/§9 — 그룹별로 "기간 내 가장 최근" 정상 거래 하나만 뽑아 그 거래 이전
 * 역대 최고가와 비교한다(직전 거래가 아니라 최고가 비교 — 하락 화면은
 * "얼마나 고점 대비 내려왔는가"가 핵심 질문이기 때문). 최고가가 없거나
 * 현재가가 최고가 이상이면 하락 row가 아니다. */
export function buildDeclineRows(allTrades: FeedTrade[], period: PeriodRange): DeclineRow[] {
  const history = buildHistory(allTrades);
  const rows: DeclineRow[] = [];
  for (const [key, points] of history) {
    const inPeriod = points.filter((p) => inRange(p.trade.dealDate, period));
    if (inPeriod.length === 0) continue;
    const latest = inPeriod.reduce((max, p) => (p.trade.dealDate > max.trade.dealDate ? p : max));
    if (!latest.priorHigh) continue;
    if (latest.trade.dealAmount >= latest.priorHigh.amount) continue;
    const declineAmount = latest.trade.dealAmount - latest.priorHigh.amount;
    rows.push({
      groupKey: key,
      aptSeq: latest.trade.aptSeq,
      name: latest.trade.name,
      dong: latest.trade.dong,
      lawdCd: latest.trade.lawdCd,
      excluUseArea: latest.trade.excluUseArea,
      floorRaw: latest.trade.floorRaw,
      currentAmount: latest.trade.dealAmount,
      currentDate: latest.trade.dealDate,
      priorHighAmount: latest.priorHigh.amount,
      priorHighDate: latest.priorHigh.date,
      declineAmount,
      declinePct: latest.priorHigh.amount > 0 ? Math.round((declineAmount / latest.priorHigh.amount) * 1000) / 10 : 0,
      trailing12moSampleCount: latest.trailing12moSampleCount,
    });
  }
  return rows;
}

export interface RisingRow {
  groupKey: string;
  aptSeq: string | null;
  name: string;
  dong: string;
  lawdCd: string;
  excluUseArea: number | null;
  floorRaw: string | number | null;
  currentAmount: number;
  currentDate: string;
  previousAmount: number;
  previousDate: string;
  riseAmount: number;
  risePct: number;
  trailing12moSampleCount: number;
  /** §15 — 표본 규칙(트레일링 12개월 동일 그룹 검증 거래 >= 3)을 만족하는지.
   * 호출부가 이 값으로 해석 문구 강도를 결정한다(1건 비교만으로 "상승세"라고
   * 말하지 않는다). */
  hasSufficientSample: boolean;
}

const RISING_SUFFICIENT_SAMPLE = 3;

/** §14/§15/§16 — 그룹별 "기간 내 가장 최근" 정상 거래를 시간순으로 "바로
 * 직전" 거래(역대 최고가가 아님)와 비교한다. 직전 거래가 없거나 현재가가
 * 그 이하이면 상승 row가 아니다. */
export function buildRisingRows(allTrades: FeedTrade[], period: PeriodRange): RisingRow[] {
  const history = buildHistory(allTrades);
  const rows: RisingRow[] = [];
  for (const [key, points] of history) {
    const inPeriod = points.filter((p) => inRange(p.trade.dealDate, period));
    if (inPeriod.length === 0) continue;
    const latest = inPeriod.reduce((max, p) => (p.trade.dealDate > max.trade.dealDate ? p : max));
    if (!latest.immediatePrior) continue;
    if (latest.trade.dealAmount <= latest.immediatePrior.amount) continue;
    const riseAmount = latest.trade.dealAmount - latest.immediatePrior.amount;
    rows.push({
      groupKey: key,
      aptSeq: latest.trade.aptSeq,
      name: latest.trade.name,
      dong: latest.trade.dong,
      lawdCd: latest.trade.lawdCd,
      excluUseArea: latest.trade.excluUseArea,
      floorRaw: latest.trade.floorRaw,
      currentAmount: latest.trade.dealAmount,
      currentDate: latest.trade.dealDate,
      previousAmount: latest.immediatePrior.amount,
      previousDate: latest.immediatePrior.date,
      riseAmount,
      risePct: latest.immediatePrior.amount > 0 ? Math.round((riseAmount / latest.immediatePrior.amount) * 1000) / 10 : 0,
      trailing12moSampleCount: latest.trailing12moSampleCount,
      hasSufficientSample: latest.trailing12moSampleCount >= RISING_SUFFICIENT_SAMPLE,
    });
  }
  return rows;
}

// ── deterministic interpretation(§10/§13/§17) — LLM 없음, 산술적으로 검증
// 가능한 사실만. "저평가"/"매수기회"/"반등 가능" 같은 투자 권유형 표현 금지. ──

export function buildDeclineInterpretation(row: Pick<DeclineRow, 'declinePct'>): string {
  const pct = Math.abs(row.declinePct);
  if (pct >= 40) return '과거 최고가와 차이가 크게 벌어졌어요.';
  if (pct >= 20) return '과거 최고가보다 가격이 내려와 있어요.';
  return '과거 최고가 대비 소폭 낮은 가격이에요.';
}

export function buildRecordHighInterpretation(row: Pick<RecordHighRow, 'trailing12moSampleCount'>): string {
  if (row.trailing12moSampleCount >= RISING_SUFFICIENT_SAMPLE) {
    return '최근 12개월 동일 면적 거래 중 최고가예요.';
  }
  return '이 면적의 이전 최고가를 넘어섰어요.';
}

export function buildRisingInterpretation(row: Pick<RisingRow, 'hasSufficientSample'>): string {
  if (row.hasSufficientSample) {
    return '최근 거래가격이 이전보다 높은 수준에서 이어지고 있어요.';
  }
  return '직전 거래보다 올랐어요.';
}
