// REPORT-5 — 일별 "새로 확인된 실거래" envelope 조립(순수).
//
// Prisma를 import하지 않는다. 관찰일/백필/발행 판정은 daily-observation.ts가 하고,
// 여기서는 그 결과와 행을 받아 envelope으로 만든다.
//
// 절대 규칙:
//   §1/§14 이 리포트의 날짜는 **관찰일**이다. 모든 거래 행에 **계약일**을 함께 싣는다.
//   §4     부산 현행 16개 코드만. 27110/11680은 분자·분모 어디에도 없다.
//   §5     취소 거래 제외.
//   §7     백필 의심이면 숫자를 만들지 않는다(부분 차감 금지).
//   §13    평 라벨 금지 — ㎡만.

import { NATIONAL_STANDARD_AREA_MIN, NATIONAL_STANDARD_AREA_MAX } from '@/lib/ai-search';
import { distribution, prepareRows, topPricedTrades, type TradeRow } from './region-aggregate';
import { districtName } from './region-scope';
import type { MetricSource, ReportEnvelope, ReportMetric, ReportPeriod, ReportSection } from './types';
import { summarizeTrust } from './types';
import {
  publicationMessage,
  type BackfillState,
  type CoverageState,
  type ObservationWindow,
  type PublicationState,
} from './daily-observation';

export const DAILY_REPORT_VERSION = 'report-5.0.0';
const SOURCE = 'apartment_trade_histories(created_at 기준 신규 관측)';

/** 관찰일 행 — 거래 정보 + 그 행을 처음 확인한 시각. */
export interface DailyTradeRow extends TradeRow {
  /** created_at(ISO). 관찰 시각이며 계약일이 아니다. */
  observedAt: string;
}

export interface DailyReportInput {
  window: ObservationWindow;
  /** 부산 스코프·취소 필터를 통과한 행(백필 보류 시에는 빈 배열로 넘겨도 된다). */
  rows: readonly DailyTradeRow[];
  masters: readonly { aptSeq: string; name: string | null }[];
  backfill: BackfillState;
  coverage: CoverageState;
  publicationState: PublicationState;
  /** 관측된 전체 행 수(스코프 밖 포함) — 투명성 위해 note에만 쓴다. */
  rawObservedRows: number;
  /** 스코프 밖(비부산) 행 수. */
  outOfScopeRows: number;
  generatedAt: string;
  dataAsOf: string | null;
}

export interface DailyTradeReportData {
  observationDate: string;
  observationWindowUtc: { start: string; end: string };
  publicationState: PublicationState;
  backfillState: BackfillState;
  coverageState: CoverageState;
  totalObserved: number;
  /** 숫자를 발행해도 되는 상태인가 — 화면이 다시 판단하지 않도록 계약으로 싣는다. */
  numbersPublished: boolean;
  message: string | null;
}

function money(manwon: number): string {
  const eok = Math.floor(manwon / 10000);
  const rest = Math.round(manwon % 10000);
  if (eok > 0) return rest > 0 ? `${eok}억 ${rest.toLocaleString('ko-KR')}만원` : `${eok}억원`;
  return `${manwon.toLocaleString('ko-KR')}만원`;
}

/** 2026-09-09 → 9월 9일 */
function korDay(ymd: string): string {
  return `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
}
/** 2026-08-28 → 2026.08.28 */
function dot(ymd: string): string {
  return ymd.replace(/-/g, '.');
}

/**
 * §15 — 대표 거래: 계약일 desc → 금액 desc → aptSeq asc.
 * 관찰일은 모두 같은 날이므로 정렬 기준에 넣지 않는다.
 */
function representative(rows: readonly DailyTradeRow[], limit: number): DailyTradeRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.dealDate.localeCompare(a.dealDate) ||
        b.dealAmount - a.dealAmount ||
        (a.aptSeq ?? '').localeCompare(b.aptSeq ?? '')
    )
    .slice(0, limit);
}

function tradeRows(rows: DailyTradeRow[], masterByAptSeq: Map<string, string | null>) {
  return rows.map((r, i) => ({
    key: `${r.aptSeq ?? r.aptName}|${r.dealDate}|${r.dealAmount}|${i}`,
    // §15 — master 보강이 없어도 행을 버리지 않는다(REPORT-1과 같은 LEFT JOIN 원칙).
    enriched: !!(r.aptSeq && masterByAptSeq.get(r.aptSeq)),
    cells: {
      aptSeq: r.aptSeq,
      aptName: (r.aptSeq ? masterByAptSeq.get(r.aptSeq) : null) ?? r.aptName,
      regionLabel: [districtName(r.lawdCd) ?? '', r.dong ?? ''].filter(Boolean).join(' '),
      exclusiveAreaM2: r.exclusiveArea, // 평 변환 금지
      dealAmount: r.dealAmount,
      dealAmountLabel: money(r.dealAmount),
      // §14 — 계약일은 반드시 행마다 보인다.
      dealDate: r.dealDate,
      dealDateLabel: `계약일 ${dot(r.dealDate)}`,
      floor: r.floor,
    },
  }));
}

export function buildDailyReport(input: DailyReportInput): ReportEnvelope<DailyTradeReportData> {
  const date = input.window.dateKst;
  const dayLabel = korDay(date);
  const publish = input.publicationState === 'READY' || input.publicationState === 'READY_ZERO';
  // §7 — 보류 상태에서는 행을 아예 쓰지 않는다(부분 집계 금지).
  const rows = publish ? prepareRows(input.rows) as DailyTradeRow[] : [];
  const src: MetricSource = { source: SOURCE, dataAsOf: input.dataAsOf };
  const masterByAptSeq = new Map(input.masters.map((m) => [m.aptSeq, m.name]));

  const metrics: ReportMetric[] = [
    {
      key: 'newlyObserved',
      label: '새로 확인된 거래',
      value: publish ? rows.length : null,
      displayValue: publish ? `${rows.length.toLocaleString('ko-KR')}건` : '확인 중',
      unit: '건',
      // 발행 가능할 때만 사실로 말한다. 아니면 MISSING — 0으로 채우지 않는다(§12).
      trust: publish ? 'SAFE' : 'MISSING',
      reason: publish ? null : publicationMessage(input.publicationState, dayLabel),
      sampleSize: publish ? rows.length : null,
      source: src,
    },
  ];

  if (publish && rows.length > 0) {
    const dates = rows.map((r) => r.dealDate).sort();
    metrics.push({
      key: 'contractDateRange',
      label: '계약일 범위',
      value: null,
      displayValue: dates[0] === dates[dates.length - 1] ? dot(dates[0]) : `${dot(dates[0])} ~ ${dot(dates[dates.length - 1])}`,
      unit: null,
      trust: 'SAFE',
      // 이 지표가 관찰일과 계약일이 다르다는 사실을 숫자로 보여준다.
      reason: null,
      sampleSize: rows.length,
      source: src,
    });
    metrics.push({
      key: 'districtsTouched',
      label: '거래가 확인된 구·군',
      value: new Set(rows.map((r) => r.lawdCd)).size,
      displayValue: `${new Set(rows.map((r) => r.lawdCd)).size}곳`,
      unit: '곳',
      trust: 'SAFE',
      reason: null,
      sampleSize: rows.length,
      source: src,
    });
  }

  const sections: ReportSection[] = [];
  if (publish && rows.length > 0) {
    const dist = distribution(rows, 'lawdCd', (k) => districtName(k) ?? k);
    sections.push({
      key: 'districtDistribution',
      title: '구·군별 신규 확인',
      kind: 'DISTRIBUTION',
      rows: dist.map((d) => ({
        key: d.key,
        enriched: true,
        cells: { lawdCd: d.key, name: d.label, count: d.count, share: Math.round(d.share * 1000) / 10 },
      })),
      trust: 'SAFE',
      note: null,
    });

    sections.push({
      key: 'representativeTrades',
      title: '새로 확인된 주요 거래',
      kind: 'ROWS',
      rows: tradeRows(representative(rows, 5), masterByAptSeq),
      trust: 'SAFE',
      note: null,
    });

    const high = topPricedTrades(rows, 3) as DailyTradeRow[];
    sections.push({
      key: 'highValueTrades',
      title: '고가 거래',
      kind: 'ROWS',
      rows: tradeRows(high, masterByAptSeq),
      trust: 'SAFE',
      note: null,
    });

    // §16 — 전용 84㎡대. 밴드 경계를 새로 만들지 않고 기존 검증된 정의를 그대로 쓴다.
    const band = rows.filter(
      (r) => r.exclusiveArea >= NATIONAL_STANDARD_AREA_MIN && r.exclusiveArea <= NATIONAL_STANDARD_AREA_MAX
    );
    if (band.length > 0) {
      sections.push({
        key: 'standardAreaTrades',
        title: `전용 ${NATIONAL_STANDARD_AREA_MIN}~${NATIONAL_STANDARD_AREA_MAX}㎡대 거래`,
        kind: 'ROWS',
        rows: tradeRows(representative(band, 3), masterByAptSeq),
        trust: 'SAFE',
        note: null,
      });
    }
  }

  const { completeness, counts } = summarizeTrust(metrics);
  const notes: string[] = [];
  // §14 — 관찰일/계약일 구분을 푸터에 항상 남긴다(스크린샷이 문맥 없이 돌아다녀도 읽히게).
  notes.push('이 리포트의 날짜는 이집이 거래를 새로 확인한 날짜입니다. 실제 계약일은 각 거래에 따로 표시됩니다.');
  if (input.outOfScopeRows > 0) {
    notes.push(`부산 외 지역 ${input.outOfScopeRows}건은 부산 집계에 포함하지 않았습니다.`);
  }
  if (input.backfill.suspected) notes.push(input.backfill.detail);
  if (!publish) {
    const msg = publicationMessage(input.publicationState, dayLabel);
    if (msg) notes.push(msg);
  }

  const period: ReportPeriod = { start: date, end: date, label: `${dayLabel} 관찰분` };

  return {
    reportType: 'DAILY_NEW_TRADES',
    reportVersion: DAILY_REPORT_VERSION,
    scope: { level: 'DAILY', lawdCd: null, dong: null, aptSeqs: null, displayName: '부산광역시' },
    period,
    generatedAt: input.generatedAt,
    dataAsOf: input.dataAsOf,
    trust: {
      // 발행 불가 상태는 완전성을 주장하지 않는다.
      completeness: publish && input.coverage === 'VERIFIED' ? completeness : 'UNVERIFIED',
      canceledExcluded: true,
      scopeLawdCds: [],
      metricTrustCounts: counts,
      notes,
    },
    // §1/§19 — 제목 자체가 "새로 확인된"을 담는다. 스크린샷만 봐도 오해가 없게.
    title: `${dayLabel} 새로 확인된 부산 실거래`,
    subtitle: '이집이 이 날짜에 새로 확인한 거래입니다 · 취소 거래 제외',
    metrics,
    sections,
    highlights: [],
    interpretation: { source: 'NONE', text: null, ruleId: null },
    sourceNotes: [{ source: SOURCE, dataAsOf: input.dataAsOf }],
    navigationTargets: [],
    data: {
      observationDate: date,
      observationWindowUtc: {
        start: input.window.startUtc.toISOString(),
        end: input.window.endUtcExclusive.toISOString(),
      },
      publicationState: input.publicationState,
      backfillState: input.backfill,
      coverageState: input.coverage,
      totalObserved: publish ? rows.length : 0,
      numbersPublished: publish,
      message: publicationMessage(input.publicationState, dayLabel),
    },
  };
}
