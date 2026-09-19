// REPORT ENGINE REPORT-1 — 지역 리포트 envelope 조립(순수).
//
// 여기도 Prisma를 import하지 않는다. DB 접근은 region-read.ts가 하고, 이 파일은
// "행 배열 → envelope"만 담당한다. 그래야 조립 규칙 자체를 DB 없이 테스트할 수 있다.

import {
  BUSAN_CURRENT_LAWD_CODES,
  BUSAN_DISTRICTS,
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
import { buildSalePriceKpi, type SalePriceKpi } from '../stats/sale-price-kpi';
import { priceBandLabel } from '../stats/price-band-label';
import {
  buildRegionPriceComparison,
  REGION_PRICE_LOW_SAMPLE_BELOW,
  type RegionPriceComparison,
} from '../stats/region-price-comparison';

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

export function buildRegionReport(input: RegionReportInput): ReportEnvelope<RegionReportData> {
  // ONE_PAGE_REPORT_REDESIGN_V1 — 기간 밖 거래는 어떤 섹션에도 들어가지 않는다. 조회(region-read)가 이미 기간으로
  // 자르지만, 건수·최근 실거래·가격대·지역 평균이 **같은 행 집합**을 쓰도록 여기서 한 번 더 고정한다(정상 입력에서는 무변화).
  const rows = prepareRows(input.rows).filter((r) => r.dealDate >= input.period.start && r.dealDate <= input.period.end);
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
      // STATS_PERIOD_IMAGE_PARITY_V2 §14 — '중앙 거래가'는 무엇의 중앙인지 읽히지 않았다(copy only, 계산 불변).
      label: '매매 중앙가격',
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
      label: '㎡당 매매 중앙가격',
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

  // ONE_PAGE_REPORT_REDESIGN_V1 — 통계 화면 상단 KPI와 **같은 함수·같은 행·같은 기간**(buildSalePriceKpi).
  // 신뢰 등급은 중앙가격과 같은 표본 게이트를 쓴다 — 새 지표 때문에 리포트 완전성 판정이 달라지지 않게.
  // "표본 적음"(5건 미만)은 통계 화면처럼 표시 태그일 뿐 값을 숨기지 않는다.
  const priceKpi = buildSalePriceKpi(
    rows.map((r) => ({ dealAmount: r.dealAmount, excluUseArea: r.exclusiveArea, dealDate: r.dealDate, dealCanceled: r.dealCanceled })),
    { from: input.period.start, to: input.period.end }
  );
  metrics.push(topPriceBandMetric(priceKpi, gate, src));

  const delta = countDelta(rows.length, input.previousCount);
  // STATS_PERIOD_IMAGE_PARITY_V2 — 하루짜리 기간(오늘/어제)은 직전 기간 대비를 만들지 않는다.
  // 통계 화면과 같은 정책이다(volume-period.ts hasComparablePreviousPeriod): 하루 단위는 신고 시차가 커서
  // 증감이 시장 변화가 아니라 수집 차이를 말하게 된다.
  const comparable = !input.period.singleDay;
  // 증감률을 '해석'으로 쓸 수 있으려면 최근 1년 표본과 직전 기간 표본이 **둘 다** 충분해야 한다.
  const deltaStable = comparable && gate.sampleSufficient && delta.previous >= MIN_SAMPLE_FOR_INTERPRETATION;
  if (comparable) metrics.push({
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
      cells: { aptSeq: c.aptSeq, aptName: c.aptName, dong: c.dong, lawdCd: c.lawdCd, count: c.count, latestDealDate: c.latestDealDate },
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

  // ONE_PAGE_REPORT_REDESIGN_V1 — 하위 지역 평균 매매가격(부산 → 구·군, 구 → 동). 통계 화면과 같은 함수·같은 행.
  // 거래가 있는 지역만 universe로 넣는다: 순위·평균·건수는 통계 화면(12개월 동 목록 universe)과 같고,
  // "거래 없음" 행은 한 장 리포트에 싣지 않는다. 동 리포트는 하위 지역이 없어 null.
  const range = { from: input.period.start, to: input.period.end };
  const priceRows = rows.map((r) => ({
    lawdCd: r.lawdCd,
    dong: normalizeDong(r.dong),
    dealAmount: r.dealAmount,
    excluUseArea: r.exclusiveArea,
    dealDate: r.dealDate,
    dealCanceled: r.dealCanceled,
  }));
  const regionPrice: RegionPriceComparison | null =
    input.level === 'CITY'
      ? buildRegionPriceComparison(priceRows, 'district', BUSAN_DISTRICTS.map((d) => ({ key: d.lawdCd, name: d.name })), range)
      : input.level === 'DISTRICT'
        ? buildRegionPriceComparison(
            priceRows,
            'dong',
            [...new Set(priceRows.map((r) => r.dong).filter((d): d is string => !!d))].map((d) => ({ key: d, name: d })),
            range
          )
        : null;
  if (regionPrice) regionPrice.rows = regionPrice.rows.filter((r) => r.count > 0);

  const data: RegionReportData = {
    priceKpi,
    regionPrice,
    summaryLine: buildSummaryLine({
      periodLabel: input.period.label,
      regionName: input.level === 'CITY' ? '부산' : scope.displayName,
      count: agg.transactionCount,
      priceKpi,
    }),
  };

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
    data,
  };
}

/**
 * ONE_PAGE_REPORT_REDESIGN_V1 — 지역 리포트 전용 payload(envelope.data).
 * 웹 시트·PNG·PDF·인스타 피드 이미지가 **이 한 벌**을 읽는다. 통계 계산을 화면마다 복제하지 않는다.
 */
export interface RegionReportData {
  /** 많이 거래된 가격대 · ㎡당 중앙가격 — 통계 화면 salePriceKpiByPeriod와 같은 함수. */
  priceKpi: SalePriceKpi;
  /** CITY: 구·군별 / DISTRICT: 동별 평균 매매가격(거래 있는 지역만). DONG은 null. */
  regionPrice: RegionPriceComparison | null;
  /** 상단 한 줄 요약 — 현재 데이터의 사실만(평가·전망 없음). */
  summaryLine: string;
}

/** envelope.data가 지역 리포트 payload인지. 없으면(예전 형태·다른 리포트) null — 화면은 그 블록만 뺀다. */
export function regionReportDataOf(envelope: Pick<ReportEnvelope<unknown>, 'data'>): RegionReportData | null {
  const d = envelope.data as Partial<RegionReportData> | null;
  return d && d.priceKpi && typeof d.summaryLine === 'string' ? (d as RegionReportData) : null;
}

/** 통계 화면 '많이 거래된 가격대' 카드와 같은 표기 규칙: 1~2개면 이름, 3개 이상이면 "한 가격대로 모이지 않음". */
export function topPriceBandText(kpi: SalePriceKpi): string {
  if (kpi.topBands.length === 0) return '거래 없음';
  if (kpi.topBands.length <= 2) return kpi.topBands.map((b) => priceBandLabel(b.lowerEok)).join(' · ');
  return '한 가격대로 모이지 않음';
}

/** 가격대 카드 아래 한 줄 — "12건 · 전체의 34%" / "각 7건 · 전체의 20%" / "3개 가격대가 각 2건". */
export function topPriceBandSub(kpi: SalePriceKpi): string | null {
  if (kpi.topBands.length === 0 || kpi.count === 0) return null;
  const n = kpi.topBands[0].count.toLocaleString('ko-KR');
  if (kpi.topBands.length > 2) return `${kpi.topBands.length}개 가격대가 각 ${n}건`;
  const share = Math.round((kpi.topBands[0].count / kpi.count) * 100);
  return `${kpi.topBands.length === 2 ? '각 ' : ''}${n}건 · 전체의 ${share}%`;
}

export interface RegionPriceTop {
  /** 거래 5건 이상 — 평균 매매가격 높은 순 최대 limit곳(순위 표시). */
  ranked: RegionPriceComparison['rows'];
  /** 표본 적음(1~4건) 참고 묶음 — ranked가 limit보다 적을 때만 남는 자리를 채운다(순위 없음). */
  reference: RegionPriceComparison['rows'];
  /** 자리가 없어 목록에서 생략된 표본 적음 지역 수. */
  omittedLowSample: number;
}

/**
 * 한 장 리포트·인스타 이미지 공용 TOP 선택. 통계 화면과 같은 정렬(표본 충분 → 표본 적음, 각 묶음 안에서 평균가 desc)을
 * 그대로 두고 앞에서 자른다 — 순위를 다시 매기지 않는다. 전체 행 수는 limit를 넘지 않는다(레이아웃 고정).
 */
export function regionPriceTop(comparison: RegionPriceComparison | null, limit = 5): RegionPriceTop {
  const rows = (comparison?.rows ?? []).filter((r) => r.count > 0 && r.avgAmount != null);
  const ranked = rows.filter((r) => !r.lowSample).slice(0, limit);
  const low = rows.filter((r) => r.lowSample);
  const reference = low.slice(0, Math.max(0, limit - ranked.length));
  return { ranked, reference, omittedLowSample: low.length - reference.length };
}

/** 통계 화면과 같은 "표본 적음" 기준(5건 미만). 값은 숨기지 않고 표시만 한다. */
export function isLowSampleCount(count: number): boolean {
  return count > 0 && count < REGION_PRICE_LOW_SAMPLE_BELOW;
}

function topPriceBandMetric(kpi: SalePriceKpi, gate: ReturnType<typeof sampleGate>, src: MetricSource): ReportMetric {
  const value = kpi.topBands.length ? kpi.topBands.map((b) => b.lowerEok).join(',') : null;
  return {
    key: 'topPriceBand',
    label: '많이 거래된 가격대',
    // 동률 구간은 모두 싣는다(하나를 임의로 고르지 않는다). 예: '3,4' = 3억원대·4억원대.
    value,
    displayValue: topPriceBandText(kpi),
    unit: '억원 구간',
    trust: trustForSample(value, gate),
    reason: value == null ? '기간 내 거래가 없습니다.' : gate.reason,
    sampleSize: kpi.count,
    source: src,
  };
}

/**
 * 한 줄 요약. **현재 데이터의 사실만** 쓴다 — 오름/내림 평가, 전망, 추정 없음.
 *   "최근 15일 부산 매매 792건, 2억원대 거래가 가장 많았습니다."
 * 5건 미만이면 가격대 문장을 붙이지 않는다(한두 건이 "가장 많음"처럼 읽히지 않게). 0건이면 거래 없음.
 */
export function buildSummaryLine(input: { periodLabel: string; regionName: string; count: number; priceKpi: SalePriceKpi }): string {
  const { periodLabel, regionName, count, priceKpi } = input;
  const head = `${periodLabel} ${regionName}`;
  if (count === 0) return `${head}에서 확인된 매매 거래가 없습니다.`;
  const total = `${head} 매매 ${count.toLocaleString('ko-KR')}건`;
  if (count < REGION_PRICE_LOW_SAMPLE_BELOW || priceKpi.topBands.length === 0) return `${total}이 확인됐습니다.`;
  if (priceKpi.topBands.length > 2) return `${total}, 거래가 한 가격대로 모이지 않았습니다.`;
  return `${total}, ${priceKpi.topBands.map((b) => priceBandLabel(b.lowerEok)).join('·')} 거래가 가장 많았습니다.`;
}
