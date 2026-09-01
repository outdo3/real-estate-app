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
import { deriveArea84PriceFields, isInArea84Band, DEFAULT_AREA84_BAND, type Area84Band } from './area84-pure';

export type { FeedTrade };
export { identityKey, areaKey, groupKey, dedupeTrades, filterVerifiedTrades };

// FIX_PRICE_RANKINGS_V2_1_1A — 감사 결과: MOLIT 실거래 API는 지역(lawdCd)+월
// 단위로만 조회 가능하고 단지/면적 단위 필터를 지원하지 않는다. 따라서 신고가
// 판정에 필요한 "역대 최고가"의 조회 범위(historical window)를 이 트레일링
// 개월 수보다 늘리려면 이미 거의 모든 구가 후보를 가진 시도 전체 집계(STEP 9
// QA 실측: 부산 12~14/16개 구, 서울 17~20/25개 구)에서 fetch 호출 수가 그대로
// 비례해 커진다 — "후보 identity만 좁혀서 조회"가 지역 단위로는 사실상 불가능
// (거의 모든 구가 후보를 가짐). 영구 저장된 실거래 이력 DB(스키마/마이그레이션
// 필요 — 이번 STEP 범위 밖)가 없는 한, 이 앱은 "역대 진짜 최고가"를 안전하게
// 보장할 수 없다. 따라서 이 트레일링 윈도우를 "역대 최고가"의 정직한 커버리지
// 상한으로 명시하고, 모든 신고가/하락 관련 문구는 이 라벨을 통해 범위를 밝힌다.
export const HISTORICAL_LOOKBACK_MONTHS = 24;

export function historicalCoverageLabel(months: number = HISTORICAL_LOOKBACK_MONTHS): string {
  if (months > 0 && months % 12 === 0) return `${months / 12}년`;
  return `${months}개월`;
}

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
// 84SQM_RANKING_V1 §10 — 84㎡ 순위는 기존 3개 화면(하락/신고가/상승)이 안 쓰던
// '1m'(최근 1개월)/'24m'(최근 24개월, HISTORICAL_LOOKBACK_MONTHS와 동일 상한) 두
// preset을 추가로 쓴다. 기존 5개 preset 값/동작은 전혀 바뀌지 않는다(additive).
export type PriceRankingPeriodPreset = '1m' | '7d' | '30d' | '3m' | '6m' | '12m' | '24m';

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
    case '1m':
      from.setMonth(now.getMonth() - 1);
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
    case '24m':
      from.setMonth(now.getMonth() - 24);
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

export const RISING_SUFFICIENT_SAMPLE = 3;

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

// FIX_PRICE_RANKINGS_V2_1_1A — "과거 최고가"/"이전 최고가"라는 무제한 표현은
// 실제로는 HISTORICAL_LOOKBACK_MONTHS로 제한된 조회 범위 안에서의 최고가일
// 뿐이다(§6 DATA CLAIM과 DATA COVERAGE 일치 원칙). coverageLabel을 항상
// 문구에 포함시켜, 그 범위 밖에 더 높은 실거래가 존재할 수 있다는 사실을
// 화면 문구 자체가 정직하게 반영하도록 강제한다.
export function buildDeclineInterpretation(row: Pick<DeclineRow, 'declinePct'>, coverageLabel: string = historicalCoverageLabel()): string {
  const pct = Math.abs(row.declinePct);
  if (pct >= 40) return `최근 ${coverageLabel} 최고가와 차이가 크게 벌어졌어요.`;
  if (pct >= 20) return `최근 ${coverageLabel} 최고가보다 가격이 내려와 있어요.`;
  return `최근 ${coverageLabel} 최고가 대비 소폭 낮은 가격이에요.`;
}

export function buildRecordHighInterpretation(row: Pick<RecordHighRow, 'trailing12moSampleCount'>, coverageLabel: string = historicalCoverageLabel()): string {
  if (row.trailing12moSampleCount >= RISING_SUFFICIENT_SAMPLE) {
    return '최근 12개월 동일 면적 거래 중 최고가예요.';
  }
  return `최근 ${coverageLabel} 내 이 면적 최고가를 넘어섰어요.`;
}

export function buildRisingInterpretation(row: Pick<RisingRow, 'hasSufficientSample'>): string {
  if (row.hasSufficientSample) {
    return '최근 거래가격이 이전보다 높은 수준에서 이어지고 있어요.';
  }
  return '직전 거래보다 올랐어요.';
}

// STATISTICS V2.1-3 — JEONSE RISK. rising과 구조는 동일(그룹별 "기간 내 가장
// 최근" 정상 거래를 시간순 "바로 직전" 거래와 비교, 역대 최고가 아님)이지만
// 방향이 반대(하락만 인정)이고 대상이 항상 jeonse dealType이다. allTrades는
// 호출부가 이미 순수 전세(monthlyRent=0)만 dealType='jeonse'로 넘긴 것이어야
// 한다 — buildHistory의 groupKey가 dealType을 포함하므로 wolse가 섞여 들어와도
// 자동으로 별도 그룹이 되어 오염되지는 않지만, 명확성을 위해 호출부 책임으로
// 명시한다.
export interface JeonseRiskRow {
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
  declineAmount: number; // 음수
  declinePct: number; // 음수
  trailing12moSampleCount: number;
}

export function buildJeonseRiskRows(allTrades: FeedTrade[], period: PeriodRange): JeonseRiskRow[] {
  const history = buildHistory(allTrades);
  const rows: JeonseRiskRow[] = [];
  for (const [key, points] of history) {
    const inPeriod = points.filter((p) => inRange(p.trade.dealDate, period));
    if (inPeriod.length === 0) continue;
    const latest = inPeriod.reduce((max, p) => (p.trade.dealDate > max.trade.dealDate ? p : max));
    if (!latest.immediatePrior) continue;
    if (latest.trade.dealAmount >= latest.immediatePrior.amount) continue; // 하락이 아니면 위험 row 아님
    const declineAmount = latest.trade.dealAmount - latest.immediatePrior.amount;
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
      declineAmount,
      declinePct: latest.immediatePrior.amount > 0 ? Math.round((declineAmount / latest.immediatePrior.amount) * 1000) / 10 : 0,
      trailing12moSampleCount: latest.trailing12moSampleCount,
    });
  }
  return rows;
}

// §19 — 금지 표현("역전세 확정", "보증금 미반환", "위험한 집주인", "보증금
// 사고 위험") 절대 사용 안 함. 근거 데이터(직전 거래 대비 하락)만 서술하고,
// 하락폭이 클 때만 "확인이 필요하다"는 중립적 권유로 그친다 — 위험을 확정하지
// 않는다.
export function buildJeonseRiskInterpretation(row: Pick<JeonseRiskRow, 'declinePct'>): string {
  const pct = Math.abs(row.declinePct);
  if (pct >= 15) {
    return '직전 전세 거래보다 가격이 많이 내려왔어요. 전세가격 하락으로 보증금 반환 부담이 커질 수 있어 확인이 필요해요.';
  }
  return '직전 전세 거래보다 가격이 내려왔어요.';
}

// ══════════════════════════════════════════════════════════════════════════
// 84SQM_RANKING_V1 — 84㎡ 국민평형 순위. docs/development/84SQM_RANKING_V1.md
// §5 AREA BAND AUDIT 참고: 실측(2026-08-29, 부산 서구/연제구/해운대구/동래구
// 12개월 매매 12,620건 raw excluUseArea 분포) 결과 83.9x대는 0건, 84.0~84.9999
// 구간에 4,980건이 밀집돼 있으며 85.0은 12건뿐이고 85.1~85.8은 0건이다(85.9/86.1은
// 명백히 다른 면적군). "84㎡ 국민평형" 실거래 군집은 정확히 이 경계와 일치해
// 추정 없이 그대로 채택한다. §7/§8 — inclusion은 이 raw band로만 판정하고, 각
// 거래의 exact raw area(예: 84.7855 vs 84.9950)는 절대 병합하지 않는다 — band는
// "후보를 넓게 모으는" 용도일 뿐 identity가 아니다. 정의는 area84-pure.ts에
// 있다(§PERFORMANCE_V1_1_B — zero-import 순수 모듈로 분리해 .test.mjs로
// 직접 테스트 가능하게 함), 여기서는 재노출만 한다.
export { AREA84_BAND_MIN, AREA84_BAND_MAX } from './area84-pure';
export { DEFAULT_AREA84_BAND, isInArea84Band, deriveArea84PriceFields };
export type { Area84Band, Area84DerivedFields } from './area84-pure';

export interface Area84RankingRow {
  /** identity-only 키(aptSeq 우선, 없으면 name+dong) — "단지별 대표 거래 1건"의
   * 단위. §8 — band 내에서는 서로 다른 raw area 후보도 같은 단지로 취급해 대표
   * 거래를 고르지만, 선택된 이후에는 그 거래의 exact raw area만 쓴다. */
  complexKey: string;
  /** 대표 거래의 identity+exact area+dealType 키 — §19 직전거래 비교에 쓰인다. */
  groupKey: string;
  aptSeq: string | null;
  name: string;
  dong: string;
  lawdCd: string;
  excluUseArea: number;
  floorRaw: string | number | null;
  currentAmount: number;
  currentDate: string;
  /** §19 — 같은 aptSeq + exact raw area 기준 "바로 직전" 거래만. 다른 면적과는
   * 절대 비교하지 않는다. 없으면 null(숨김). */
  previousAmount: number | null;
  previousDate: string | null;
  changeAmount: number | null;
  changePct: number | null;
  /** §20 — 같은 exact area 그룹의 트레일링 24개월(현재 거래 포함) 최고가. */
  recent2yHighAmount: number;
  isRecent2yHigh: boolean;
  /** 2년 최고가 대비 현재가 변동률(%). isRecent2yHigh가 true면 의미 없어 null. */
  recent2yHighDeltaPct: number | null;
  trailing12moSampleCount: number;
}

// §12 대표 거래 tie-break: dealDate DESC → dealAmount DESC → excluUseArea DESC →
// floor DESC → uid 오름차순(최종 결정론적 tiebreak, 입력 순서에 의존하지 않음).
function compareArea84Candidates(a: FeedTrade, b: FeedTrade): number {
  if (a.dealDate !== b.dealDate) return a.dealDate < b.dealDate ? 1 : -1;
  if (a.dealAmount !== b.dealAmount) return b.dealAmount - a.dealAmount;
  const areaA = a.excluUseArea ?? 0;
  const areaB = b.excluUseArea ?? 0;
  if (areaA !== areaB) return areaB - areaA;
  const floorA = typeof a.floorRaw === 'number' ? a.floorRaw : parseInt(String(a.floorRaw ?? ''), 10) || 0;
  const floorB = typeof b.floorRaw === 'number' ? b.floorRaw : parseInt(String(b.floorRaw ?? ''), 10) || 0;
  if (floorA !== floorB) return floorB - floorA;
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
}

/** §9/§11/§12/§13/§14 — 기간 내 band에 속하는 검증된(취소 제외) 거래만 후보로
 * 삼아, 단지(identity)별 대표 거래 1건을 뽑아 가격 내림차순으로 정렬 가능한
 * row를 만든다. 미래 거래는 period.to(오늘)를 넘지 않는 한 자연히 제외된다
 * (다른 3개 모드와 동일한 §13 관례 — 별도 필터를 추가하지 않는다). */
export function buildArea84RankingRows(allTrades: FeedTrade[], period: PeriodRange, band: Area84Band = DEFAULT_AREA84_BAND): Area84RankingRow[] {
  const history = buildHistory(allTrades);
  const verified = filterVerifiedTrades(allTrades);

  const candidatesByComplex = new Map<string, FeedTrade[]>();
  for (const t of verified) {
    if (!isInArea84Band(t.excluUseArea, band)) continue;
    if (!inRange(t.dealDate, period)) continue;
    const key = identityKey(t);
    if (!candidatesByComplex.has(key)) candidatesByComplex.set(key, []);
    candidatesByComplex.get(key)!.push(t);
  }

  const rows: Area84RankingRow[] = [];
  for (const [complexKey, candidates] of candidatesByComplex) {
    const rep = [...candidates].sort(compareArea84Candidates)[0];
    const repGroupKey = groupKey(rep);
    const points = history.get(repGroupKey) || [];
    const point = points.find((p) => p.trade.uid === rep.uid);
    const priorHigh = point?.priorHigh ?? null;
    const immediatePrior = point?.immediatePrior ?? null;
    const derived = deriveArea84PriceFields(rep.dealAmount, priorHigh?.amount ?? null, immediatePrior);

    rows.push({
      complexKey,
      groupKey: repGroupKey,
      aptSeq: rep.aptSeq,
      name: rep.name,
      dong: rep.dong,
      lawdCd: rep.lawdCd,
      excluUseArea: rep.excluUseArea as number,
      floorRaw: rep.floorRaw,
      currentAmount: rep.dealAmount,
      currentDate: rep.dealDate,
      ...derived,
      trailing12moSampleCount: point?.trailing12moSampleCount ?? 1,
    });
  }
  return rows;
}

// §35 — "역대"/"신고가" 등 무제한 표현 금지, 항상 트레일링 coverageLabel로 범위를
// 밝힌다(다른 3개 모드와 동일 원칙, historicalCoverageLabel 재사용).
export function buildArea84Interpretation(
  row: Pick<Area84RankingRow, 'isRecent2yHigh' | 'recent2yHighDeltaPct'>,
  coverageLabel: string = historicalCoverageLabel()
): string {
  if (row.isRecent2yHigh) return `최근 ${coverageLabel} 이 면적 거래 중 최고가예요.`;
  if (row.recent2yHighDeltaPct != null) return `최근 ${coverageLabel} 최고가 대비 ${formatSignedPct(row.recent2yHighDeltaPct)}예요.`;
  return '최근 84㎡ 거래 기준 순위예요.';
}

function formatSignedPct(pct: number): string {
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

// §27 REGION SUMMARY INTERPRETATION — 시도 전체 조회에서만 의미가 있다(특정
// 구를 이미 선택했으면 "어느 구에 몰려있는지"는 질문 자체가 성립하지 않음).
// 실제로 계산된 top row들의 구 분포에서만 문장을 만든다(과장/추정 금지) — 표본이
// 너무 적거나(5건 미만) 분포가 뚜렷하지 않으면(1위 구가 30% 미만) null(문구 숨김).
export function buildArea84RegionDistributionInterpretation(
  topRows: Array<Pick<Area84RankingRow, 'lawdCd'>>,
  sigunguNameByLawdCd: Map<string, string>,
  regionLabel: string
): string | null {
  if (topRows.length < 5) return null;
  const counts = new Map<string, number>();
  for (const r of topRows) {
    const name = sigunguNameByLawdCd.get(r.lawdCd);
    if (!name) return null;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return null;
  const [topGu, topCount] = sorted[0];
  if (topCount < 2 || topCount / topRows.length < 0.3) return null;
  return `현재 ${regionLabel} 84㎡ 거래 중 상위권은 ${topGu}에 많이 분포해 있어요.`;
}
