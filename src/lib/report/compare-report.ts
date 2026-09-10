// REPORT-4 — 단지 비교 리포트 envelope 조립(순수).
//
// Prisma를 import하지 않는다. Compare V2의 **계약과 로직을 그대로 재사용**하고,
// 리포트에만 필요한 것 하나를 위에 더한다: **SAFE가 아닌 지표는 우열을 만들지 않는다**(§6).
//
// 왜 더하는가: Compare V2의 buildDifference는 MISSING만 비교 불가로 접고 LIMITED는
// favors를 낼 수 있다. 비교 화면에서는 주의 문구와 함께 보여주는 게 맞지만, 리포트는
// 캡처되어 단독으로 돌아다니는 물건이라 주의 문구가 떨어져 나가기 쉽다. 그래서
// **리포트 쪽에서만 더 엄격하게** 잠근다 — Compare V2의 의미를 바꾸지 않는다(§0).

import { buildDifferences, buildTradeoffSummary } from '@/lib/compare-v2/difference';
import type {
  CompareApartment,
  CompareDifference,
  CompareMetric,
  TradeoffSummary,
} from '@/lib/compare-v2/types';
import type { MetricSource, ReportEnvelope, ReportMetric, ReportPeriod, ReportSection } from './types';
import { summarizeTrust } from './types';

export const COMPARE_REPORT_VERSION = 'report-4.0.0';

const SOURCE = 'compare-v2(apartment_trade_histories + EJIP_SCORE)';

export interface CompareSideInfo {
  aptSeq: string;
  name: string;
  regionLabel: string | null;
  buildYear: number | null;
  totalHouseholds: number | null;
  parkingCount: number | null;
  scoreState: string;
  overallScore: number | null;
  eligibility: string | null;
  domains: { key: string; label: string; score: number | null; coverage: number }[];
}

export interface CompareReportInput {
  /** 2개가 기본이지만 배열로 둔다 — 3개 확장이 계약 때문에 막히지 않게(§ 상단 지시). */
  sides: [CompareSideInfo, CompareSideInfo];
  a: CompareApartment;
  b: CompareApartment;
  period: ReportPeriod;
  generatedAt: string;
  dataAsOf: string | null;
  coverageComplete: boolean;
}

export interface ApartmentCompareReportData {
  aptSeqs: string[];
  sides: CompareSideInfo[];
  /** 리포트 기준(SAFE only)으로 다시 분류한 tradeoff. */
  tradeoff: {
    aStrengths: CompareDifference[];
    bStrengths: CompareDifference[];
    similar: CompareDifference[];
    needsReview: CompareDifference[];
  };
  /** 종합 승자를 만들지 않았음을 명시적으로 남긴다(§7). */
  overallWinner: null;
}

/**
 * §6 — 리포트에서 우열을 인정할 수 있는 차이인가.
 * 양쪽 지표가 **모두 SAFE**이고 Compare V2가 이미 comparable=true + favors를 낸 경우만.
 */
export function rankableInReport(d: CompareDifference): boolean {
  return d.comparable && d.favors != null && d.a.trust === 'SAFE' && d.b.trust === 'SAFE';
}

/**
 * Compare V2의 tradeoff를 리포트 기준으로 재분류한다.
 * SAFE가 아닌데 favors가 붙은 항목은 강점이 아니라 **판단 제한**으로 내린다.
 * (Compare V2 결과 자체는 변형하지 않고, 어느 바구니에 넣을지만 다시 정한다.)
 */
export function reclassifyForReport(differences: CompareDifference[]): TradeoffSummary {
  const base = buildTradeoffSummary(differences);
  const demoted: CompareDifference[] = [];

  const keep = (list: CompareDifference[]) =>
    list.filter((d) => {
      if (rankableInReport(d)) return true;
      demoted.push(d);
      return false;
    });

  const aStrengths = keep(base.aStrengths);
  const bStrengths = keep(base.bStrengths);
  return {
    aStrengths,
    bStrengths,
    similar: base.similar,
    // 원래 needsReview + SAFE가 아니라서 내려온 것. 중복 없이 합친다.
    needsReview: [...base.needsReview, ...demoted],
  };
}

function sideMetric(
  key: string,
  label: string,
  a: string,
  b: string,
  trust: ReportMetric['trust'],
  reason: string | null,
  source: MetricSource
): ReportMetric {
  // 비교 리포트의 metric은 "A값 vs B값"을 한 줄로 담는다.
  return {
    key,
    label,
    value: null,
    displayValue: `${a} vs ${b}`,
    unit: null,
    trust,
    reason,
    sampleSize: null,
    source,
  };
}

function fmtInt(n: number | null, suffix: string): string {
  return n == null ? '정보 없음' : `${n.toLocaleString('ko-KR')}${suffix}`;
}

function metricOf(apt: CompareApartment, key: string): CompareMetric | undefined {
  return apt.metrics.find((m) => m.key === key);
}

export function buildCompareReport(input: CompareReportInput): ReportEnvelope<ApartmentCompareReportData> {
  const [sa, sb] = input.sides;
  const src: MetricSource = { source: SOURCE, dataAsOf: input.dataAsOf };

  // Compare V2가 이미 만든 차이/트레이드오프를 그대로 쓰고, 리포트 기준으로만 재분류한다.
  const differences = buildDifferences(input.a.metrics, input.b.metrics);
  const tradeoff = reclassifyForReport(differences);

  // ── 핵심 비교 지표(§4) ──────────────────────────────────────────────────
  const priceA = metricOf(input.a, 'salePrice');
  const priceB = metricOf(input.b, 'salePrice');
  const priceDiff = differences.find((d) => d.metricKey === 'salePrice');

  const metrics: ReportMetric[] = [
    sideMetric('salePrice', '최근 실거래가',
      priceA?.displayValue ?? '정보 없음', priceB?.displayValue ?? '정보 없음',
      priceA?.trust === 'SAFE' && priceB?.trust === 'SAFE' ? 'SAFE' : priceA?.trust === 'MISSING' || priceB?.trust === 'MISSING' ? 'MISSING' : 'LIMITED',
      priceDiff && !priceDiff.comparable ? (priceDiff.reason ?? null) : null, src),
    sideMetric('ejipScore', '이집 점수',
      sa.overallScore == null ? '준비 중' : `${Math.round(sa.overallScore)}점`,
      sb.overallScore == null ? '준비 중' : `${Math.round(sb.overallScore)}점`,
      sa.overallScore == null || sb.overallScore == null
        ? 'MISSING'
        : sa.eligibility === 'LIMITED' || sb.eligibility === 'LIMITED'
          ? 'LIMITED'
          : 'SAFE',
      sa.overallScore == null || sb.overallScore == null ? '한쪽 이상은 점수를 계산할 데이터가 부족합니다.' : null, src),
    sideMetric('buildYear', '준공',
      fmtInt(sa.buildYear, '년'), fmtInt(sb.buildYear, '년'),
      sa.buildYear != null && sb.buildYear != null ? 'SAFE' : 'MISSING',
      sa.buildYear == null || sb.buildYear == null ? '준공연도 정보가 없는 단지가 있습니다.' : null, src),
    sideMetric('totalHouseholds', '세대수',
      fmtInt(sa.totalHouseholds, '세대'), fmtInt(sb.totalHouseholds, '세대'),
      sa.totalHouseholds != null && sb.totalHouseholds != null ? 'SAFE' : 'MISSING',
      sa.totalHouseholds == null || sb.totalHouseholds == null ? '세대수 정보가 없는 단지가 있습니다.' : null, src),
    // §10 — 주차는 추정하지 않는다(커버리지 70.7%).
    sideMetric('parking', '주차',
      fmtInt(sa.parkingCount, '대'), fmtInt(sb.parkingCount, '대'),
      sa.parkingCount != null && sb.parkingCount != null ? 'SAFE' : 'MISSING',
      sa.parkingCount == null || sb.parkingCount == null ? '주차 정보가 등록되지 않은 단지가 있습니다.' : null, src),
  ];

  // ── 섹션 ────────────────────────────────────────────────────────────────
  const sections: ReportSection[] = [];

  // 점수 도메인 side-by-side (§8) — 한쪽이라도 점수가 없으면 만들지 않는다.
  if (sa.overallScore != null && sb.overallScore != null) {
    const keys = ['transport', 'living', 'education', 'complex'];
    sections.push({
      key: 'scoreDomains',
      title: '항목별 점수',
      kind: 'ROWS',
      rows: keys.map((k) => {
        const da = sa.domains.find((d) => d.key === k);
        const db = sb.domains.find((d) => d.key === k);
        return {
          key: k,
          enriched: da?.score != null && db?.score != null,
          cells: {
            name: da?.label ?? db?.label ?? k,
            aValue: da?.score == null ? '정보 없음' : `${Math.round(da.score)}점`,
            bValue: db?.score == null ? '정보 없음' : `${Math.round(db.score)}점`,
          },
        };
      }),
      trust: sa.eligibility === 'LIMITED' || sb.eligibility === 'LIMITED' ? 'LIMITED' : 'SAFE',
      note: sa.eligibility === 'LIMITED' || sb.eligibility === 'LIMITED' ? '일부 항목의 데이터가 부족해 참고용입니다.' : null,
    });
  }

  // 위치/생활 비교 (§11) — Compare V2가 만든 지표를 그대로 나란히.
  const locKeys = ['subwayDistance', 'elementaryDistance', 'convenienceCount', 'busDistance'];
  const locRows = locKeys
    .map((k) => {
      const ma = metricOf(input.a, k);
      const mb = metricOf(input.b, k);
      if (!ma && !mb) return null;
      return {
        key: k,
        enriched: ma?.trust !== 'MISSING' && mb?.trust !== 'MISSING',
        cells: {
          name: ma?.label ?? mb?.label ?? k,
          aValue: ma?.displayValue ?? '정보 없음',
          bValue: mb?.displayValue ?? '정보 없음',
        },
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (locRows.length > 0) {
    sections.push({ key: 'locationCompare', title: '교통 · 생활', kind: 'ROWS', rows: locRows, trust: 'SAFE', note: null });
  }

  // §12 트레이드오프 — 네 바구니를 그대로 섹션으로.
  const toRows = (list: CompareDifference[]) =>
    list.map((d) => ({
      key: d.metricKey,
      enriched: true,
      cells: {
        name: d.label,
        aValue: d.a.displayValue,
        bValue: d.b.displayValue,
        note: d.differenceDisplay ?? d.reason ?? '',
      },
    }));

  sections.push(
    { key: 'aStrengths', title: `${sa.name}가 앞선 항목`, kind: 'ROWS', rows: toRows(tradeoff.aStrengths), trust: 'SAFE', note: null },
    { key: 'bStrengths', title: `${sb.name}가 앞선 항목`, kind: 'ROWS', rows: toRows(tradeoff.bStrengths), trust: 'SAFE', note: null },
    { key: 'similar', title: '비슷한 항목', kind: 'ROWS', rows: toRows(tradeoff.similar), trust: 'SAFE', note: null },
    {
      key: 'needsReview',
      title: '판단이 제한되는 항목',
      kind: 'ROWS',
      rows: toRows(tradeoff.needsReview),
      trust: 'LIMITED',
      note: '데이터가 없거나 조건이 달라 우열을 판단하지 않았습니다.',
    }
  );

  // ── 해석 (§7) — 종합 승자를 만들지 않는다. ───────────────────────────────
  const interpretation =
    tradeoff.aStrengths.length > 0 || tradeoff.bStrengths.length > 0
      ? {
          source: 'MEASURED_DELTA' as const,
          text:
            `${sa.name}는 ${tradeoff.aStrengths.length}개 항목에서, ` +
            `${sb.name}는 ${tradeoff.bStrengths.length}개 항목에서 앞섭니다. ` +
            `어느 쪽이 맞는지는 가격·교통·단지 규모 중 무엇을 우선순위에 두는지에 따라 달라집니다.`,
          ruleId: 'COMPARE_TRADEOFF_COUNT_V1',
        }
      : {
          source: 'NONE' as const,
          text: null,
          ruleId: null,
        };

  const { completeness, counts } = summarizeTrust(metrics);
  const notes: string[] = [];
  if (!input.coverageComplete) notes.push('해당 기간의 수집 완전성이 아직 검증되지 않았습니다.');
  if (tradeoff.needsReview.length > 0) notes.push(`${tradeoff.needsReview.length}개 항목은 데이터 한계로 우열을 판단하지 않았습니다.`);
  if (sa.parkingCount == null || sb.parkingCount == null) notes.push('주차 정보가 등록되지 않은 단지가 있습니다.');

  return {
    reportType: 'APARTMENT_COMPARE',
    reportVersion: COMPARE_REPORT_VERSION,
    scope: {
      level: 'COMPARE',
      lawdCd: null,
      dong: null,
      aptSeqs: [sa.aptSeq, sb.aptSeq],
      displayName: `${sa.name} vs ${sb.name}`,
    },
    period: input.period,
    generatedAt: input.generatedAt,
    dataAsOf: input.dataAsOf,
    trust: {
      completeness: input.coverageComplete ? completeness : 'UNVERIFIED',
      canceledExcluded: true,
      scopeLawdCds: [],
      metricTrustCounts: counts,
      notes,
    },
    title: `${sa.name} vs ${sb.name} 비교 리포트`,
    subtitle: [sa.regionLabel, sb.regionLabel].filter(Boolean).join(' · ') || null,
    metrics,
    sections,
    highlights: [],
    interpretation,
    sourceNotes: [{ source: SOURCE, dataAsOf: input.dataAsOf }],
    navigationTargets: [
      { label: `${sa.name} 자세히`, href: `/apt/${encodeURIComponent(sa.name)}?aptSeq=${encodeURIComponent(sa.aptSeq)}` },
      { label: `${sb.name} 자세히`, href: `/apt/${encodeURIComponent(sb.name)}?aptSeq=${encodeURIComponent(sb.aptSeq)}` },
    ],
    data: {
      aptSeqs: [sa.aptSeq, sb.aptSeq],
      sides: [sa, sb],
      tradeoff,
      // §7 — 종합 승자는 만들지 않는다. null임을 계약으로 남긴다.
      overallWinner: null,
    },
  };
}
