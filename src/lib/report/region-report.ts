// REPORT ENGINE REPORT-1 — 지역 리포트 envelope 조립(순수).
//
// 여기도 Prisma를 import하지 않는다. DB 접근은 region-read.ts가 하고, 이 파일은
// "행 배열 → envelope"만 담당한다. 그래야 조립 규칙 자체를 DB 없이 테스트할 수 있다.

import {
  BUSAN_CURRENT_LAWD_CODES,
  districtName,
  normalizeDong,
} from './region-scope';
import {
  aggregate,
  countDelta,
  describeCountDelta,
  distribution,
  enrichRows,
  prepareRows,
  recentTrades,
  representativeComplexes,
  sampleGate,
  topPricedTrades,
  MIN_SAMPLE_FOR_INTERPRETATION,
  trustForSample,
  type MasterEnrichment,
  type TradeRow,
} from './region-aggregate';
import type {
  MetricSource,
  ReportEnvelope,
  ReportMetric,
  ReportPeriod,
  ReportScope,
  ReportSection,
  ReportType,
} from './types';
import { summarizeTrust } from './types';

export const REPORT_VERSION = 'report-1.0.0';

const TRADE_SOURCE = 'apartment_trade_histories(MOLIT_APT_TRADE)';
const MASTER_SOURCE = 'apartment_masters';

export type RegionLevel = 'CITY' | 'DISTRICT' | 'DONG';

export interface RegionReportInput {
  level: RegionLevel;
  lawdCd: string | null;
  dong: string | null;
  /** 기간 내 거래(취소 포함 상태로 넘겨도 된다 — 여기서 제외한다). */
  rows: readonly TradeRow[];
  /**
   * 직전 동일 길이 기간의 **거래 건수**(취소 제외).
   * 행 전체가 아니라 개수만 받는다 — 이 값은 증감률 계산에만 쓰이는데 부산 365일이면
   * 행을 다 읽느라 3초/166MB가 들었다(REPORT-2 §17 실측). count 한 번이면 충분하다.
   */
  previousCount: number;
  /** 표본 게이트 판정에 쓰는 최근 1년 거래 수. */
  trailingYearCount: number;
  /**
   * 최근 2년 **최고가 후보**(금액 desc 상위 소수). 2년 전체를 읽지 않는다 —
   * 하이라이트 1건을 뽑으려고 도시 단위 7만 행을 읽을 이유가 없다(§17).
   * 최댓값은 반드시 이 후보 안에 있으므로 결과는 동일하다.
   */
  twoYearRows: readonly TradeRow[];
  masters: readonly MasterEnrichment[];
  period: ReportPeriod;
  generatedAt: string;
  /** sync_coverage_cells 기준 마지막 검증 시각. 모르면 null. */
  dataAsOf: string | null;
  /** 기간에 해당하는 커버리지가 전부 COMPLETE인지. 모르면 false. */
  coverageComplete: boolean;
}

const REPORT_TYPE_BY_LEVEL: Record<RegionLevel, ReportType> = {
  CITY: 'REGION_CITY',
  DISTRICT: 'REGION_DISTRICT',
  DONG: 'REGION_DONG',
};

function money(manwon: number | null): string {
  if (manwon == null) return '정보 없음';
  // 만원 단위 정수를 억/만원으로 읽는다. 반올림 표기이며 원본값은 metric.value에 그대로 있다.
  const eok = Math.floor(manwon / 10000);
  const rest = Math.round(manwon % 10000);
  if (eok > 0) return rest > 0 ? `${eok}억 ${rest.toLocaleString('ko-KR')}만원` : `${eok}억원`;
  return `${manwon.toLocaleString('ko-KR')}만원`;
}

function scopeOf(input: RegionReportInput): ReportScope {
  if (input.level === 'CITY') {
    return { level: 'CITY', lawdCd: null, dong: null, aptSeqs: null, displayName: '부산광역시' };
  }
  const name = districtName(input.lawdCd) ?? input.lawdCd ?? '';
  if (input.level === 'DISTRICT') {
    return { level: 'DISTRICT', lawdCd: input.lawdCd, dong: null, aptSeqs: null, displayName: `부산 ${name}` };
  }
  const d = normalizeDong(input.dong) ?? '';
  return { level: 'DONG', lawdCd: input.lawdCd, dong: d, aptSeqs: null, displayName: `부산 ${name} ${d}`.trim() };
}

export function buildRegionReport(input: RegionReportInput): ReportEnvelope {
  const rows = prepareRows(input.rows);
  const twoYear = prepareRows(input.twoYearRows);

  const agg = aggregate(rows);
  const gate = sampleGate(input.trailingYearCount, '최근 1년');
  const src: MetricSource = { source: TRADE_SOURCE, dataAsOf: input.dataAsOf };

  const metrics: ReportMetric[] = [
    {
      key: 'transactionCount',
      label: '거래건수',
      value: agg.transactionCount,
      displayValue: `${agg.transactionCount.toLocaleString('ko-KR')}건`,
      unit: '건',
      // 건수는 표본이 얇아도 사실 그대로다 — 표본 게이트로 낮추지 않는다(§9: 수치는 보여도 된다).
      trust: 'SAFE',
      reason: null,
      sampleSize: agg.transactionCount,
      source: src,
    },
    {
      key: 'medianDealAmount',
      label: '중앙 거래가',
      value: agg.medianDealAmount,
      displayValue: money(agg.medianDealAmount),
      unit: '만원',
      trust: trustForSample(agg.medianDealAmount, gate),
      reason: agg.medianDealAmount == null ? '기간 내 거래가 없습니다.' : gate.reason,
      sampleSize: agg.transactionCount,
      source: src,
    },
    {
      key: 'medianPricePerM2',
      label: '㎡당 중앙가',
      value: agg.medianPricePerM2 == null ? null : Math.round(agg.medianPricePerM2 * 10) / 10,
      displayValue:
        agg.medianPricePerM2 == null ? '정보 없음' : `${(Math.round(agg.medianPricePerM2 * 10) / 10).toLocaleString('ko-KR')}만원/㎡`,
      unit: '만원/㎡',
      trust: trustForSample(agg.medianPricePerM2, gate),
      reason: agg.medianPricePerM2 == null ? '면적이 유효한 거래가 없습니다.' : gate.reason,
      sampleSize: agg.transactionCount,
      source: src,
    },
    {
      key: 'latestDealDate',
      label: '최근 계약일',
      value: agg.latestDealDate,
      displayValue: agg.latestDealDate ?? '정보 없음',
      unit: null,
      trust: agg.latestDealDate ? 'SAFE' : 'MISSING',
      reason: agg.latestDealDate ? null : '기간 내 거래가 없습니다.',
      sampleSize: agg.transactionCount,
      source: src,
    },
  ];

  const delta = countDelta(rows.length, input.previousCount);
  // 증감률을 '해석'으로 쓸 수 있으려면 최근 1년 표본과 직전 기간 표본이 **둘 다** 충분해야 한다.
  const deltaStable = gate.sampleSufficient && delta.previous >= MIN_SAMPLE_FOR_INTERPRETATION;
  metrics.push({
    key: 'transactionCountDelta',
    label: '직전 동일기간 대비 거래량',
    value: delta.ratio == null ? null : Math.round(delta.ratio * 1000) / 10,
    displayValue:
      delta.ratio == null
        ? '비교 불가'
        : `${delta.diff >= 0 ? '+' : ''}${Math.round(delta.ratio * 1000) / 10}% (${delta.previous}건 → ${delta.current}건)`,
    unit: '%',
    // 직전 기간이 0건이면 비율을 만들지 않는다.
    // 직전 기간 자체가 얇으면(예: 1건 → 0건 = "100% 감소") 수치는 참이지만 해석은
    // 한 건에 좌우된다. 그래서 **양쪽 표본**을 다 본다 — 표본 게이트를 둔 이유와 같다.
    trust: delta.ratio == null ? 'MISSING' : deltaStable ? 'SAFE' : 'LIMITED',
    reason: delta.ratio == null
      ? '직전 동일기간 거래가 없어 증감률을 계산하지 않았습니다.'
      : deltaStable
        ? null
        : `직전 동일기간 거래가 ${delta.previous}건으로 적어 증감률 해석이 제한됩니다.`,
    sampleSize: delta.previous,
    source: src,
  });

  // ── 섹션 ────────────────────────────────────────────────────────────────
  const sections: ReportSection[] = [];

  if (input.level === 'CITY') {
    const dist = distribution(rows, 'lawdCd', (k) => districtName(k) ?? k);
    sections.push({
      key: 'districtDistribution',
      title: '구·군별 거래 분포',
      kind: 'DISTRIBUTION',
      rows: dist.map((d) => ({
        key: d.key,
        enriched: true,
        cells: { lawdCd: d.key, name: d.label, count: d.count, share: Math.round(d.share * 1000) / 10 },
      })),
      trust: rows.length > 0 ? 'SAFE' : 'MISSING',
      note: null,
    });
  }

  if (input.level === 'DISTRICT') {
    const dist = distribution(rows, 'dong', (k) => k);
    sections.push({
      key: 'dongDistribution',
      title: '동별 거래 분포',
      kind: 'DISTRIBUTION',
      rows: dist.map((d) => ({
        key: d.key,
        enriched: true,
        cells: { dong: d.key, name: d.label, count: d.count, share: Math.round(d.share * 1000) / 10 },
      })),
      trust: rows.length > 0 ? 'SAFE' : 'MISSING',
      note: null,
    });
  }

  const complexes = representativeComplexes(rows, 5);
  sections.push({
    key: 'representativeComplexes',
    title: '거래가 많은 단지',
    kind: 'ROWS',
    rows: complexes.map((c) => ({
      key: c.aptSeq ? `id:${c.aptSeq}` : `nd:${c.aptName}|${c.dong ?? ''}`,
      enriched: !!c.aptSeq,
      cells: { aptSeq: c.aptSeq, aptName: c.aptName, dong: c.dong, count: c.count, latestDealDate: c.latestDealDate },
    })),
    trust: complexes.length > 0 ? (gate.sampleSufficient ? 'SAFE' : 'LIMITED') : 'MISSING',
    note: gate.sampleSufficient ? null : gate.reason,
  });

  // §8 — 대표 거래는 거래 행에서 출발하고 master는 보강만 한다(행 수 불변).
  sections.push({
    key: 'recentTrades',
    title: '최근 실거래',
    kind: 'ROWS',
    rows: enrichRows(recentTrades(rows, 8), input.masters),
    trust: rows.length > 0 ? 'SAFE' : 'MISSING',
    note: null,
  });

  // ── 하이라이트 ──────────────────────────────────────────────────────────
  // §6/§11 — "역대 신고가" 금지. 기간을 문구에 **반드시** 함께 싣는다.
  const top2y = topPricedTrades(twoYear, 1)[0] ?? null;
  const highlights = top2y
    ? [
        {
          key: 'twoYearHigh',
          label: '최근 2년 최고 거래가',
          displayValue: `${money(top2y.dealAmount)} · ${top2y.aptName} · 전용 ${top2y.exclusiveArea}㎡ · ${top2y.dealDate}`,
          contextLabel: '최근 2년 · 취소 거래 제외',
          trust: 'SAFE' as const,
        },
      ]
    : [];

  // ── 해석: 실측 차이값만 ─────────────────────────────────────────────────
  const interpretation = deltaStable && delta.ratio != null
    ? {
        source: 'MEASURED_DELTA' as const,
        text: describeCountDelta(delta, input.period.label, '직전 동일기간'),
        ruleId: 'REGION_COUNT_DELTA_V1',
      }
    : {
        source: 'NONE' as const,
        text: null,
        ruleId: null,
      };

  const { completeness, counts } = summarizeTrust(metrics);
  const scopeLawdCds = input.level === 'CITY' ? [...BUSAN_CURRENT_LAWD_CODES] : input.lawdCd ? [input.lawdCd] : [];

  const notes: string[] = [];
  if (!input.coverageComplete) notes.push('해당 기간의 수집 완전성이 아직 검증되지 않았습니다.');
  if (!gate.sampleSufficient) notes.push(gate.reason!);
  const unenriched = sections
    .flatMap((s) => s.rows)
    .filter((r) => !r.enriched).length;
  if (unenriched > 0) notes.push(`단지 기본정보가 연결되지 않은 행이 ${unenriched}건 있습니다(거래 자체는 유효합니다).`);

  const scope = scopeOf(input);
  return {
    reportType: REPORT_TYPE_BY_LEVEL[input.level],
    reportVersion: REPORT_VERSION,
    scope,
    period: input.period,
    generatedAt: input.generatedAt,
    dataAsOf: input.dataAsOf,
    trust: {
      // 커버리지가 미검증이면 지표가 아무리 SAFE여도 COMPLETE라고 말하지 않는다.
      completeness: input.coverageComplete ? completeness : 'UNVERIFIED',
      canceledExcluded: true,
      scopeLawdCds,
      metricTrustCounts: counts,
      notes,
    },
    title: `${scope.displayName} 실거래 리포트`,
    subtitle: `${input.period.label} · 취소 거래 제외`,
    metrics,
    sections,
    highlights,
    interpretation,
    sourceNotes: [
      { source: TRADE_SOURCE, dataAsOf: input.dataAsOf },
      { source: MASTER_SOURCE, dataAsOf: null },
    ],
    navigationTargets: [],
    data: null,
  };
}
