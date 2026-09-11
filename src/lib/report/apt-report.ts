// REPORT-3 — 단지 리포트 envelope 조립(순수).
//
// Prisma를 import하지 않는다. DB/Score 호출은 apt-read.ts가 하고 여기서는
// "이미 읽어온 값 → envelope"만 만든다.
//
// 지켜야 할 것:
//   §1  identity는 aptSeq. 이름으로 단지를 다시 찾지 않는다.
//   §6  Score를 새로 만들지 않는다 — 상세 화면과 **같은 표시 규칙**을 그대로 쓴다.
//   §7  취소 거래 제외, "역대 신고가" 금지 → "최근 2년 최고 거래가"만.
//   §10 예측 금지. 해석은 Score briefing(결정론적)만 쓴다.
//   평 라벨 금지(ApartmentUnitType 커버리지 2.9%) — ㎡만.

import { aggregate, median, prepareRows, recentTrades, topPricedTrades, type TradeRow } from './region-aggregate';
import { districtName } from './region-scope';
import type {
  MetricSource,
  MetricTrust,
  ReportEnvelope,
  ReportMetric,
  ReportPeriod,
  ReportSection,
} from './types';
import { summarizeTrust } from './types';

export const APT_REPORT_VERSION = 'report-3.0.0';

const TRADE_SOURCE = 'apartment_trade_histories(MOLIT_APT_TRADE)';
const MASTER_SOURCE = 'apartment_masters';
const SCORE_SOURCE = 'EJIP_SCORE(api/apt/[name]/score와 동일 엔진)';
const LOCATION_SOURCE = 'apartment_location_features';
const MARKET_SOURCE = 'apartment_market_features';

/** 12개월 거래가 이만큼 미만이면 가격 비교 해석을 붙이지 않는다(REPORT-1과 같은 경계). */
export const APT_MIN_TRADES_FOR_PRICE_INTERPRETATION = 5;

export interface AptMasterInfo {
  aptSeq: string;
  name: string;
  sigungu: string | null;
  umdName: string | null;
  roadAddress: string | null;
  jibunAddress: string | null;
  buildYear: number | null;
  totalHouseholds: number | null;
  parkingCount: number | null;
  parkingPerHousehold: number | null;
  sggCd: string | null;
}

/** score-card-presenter가 결정한 표시 상태를 그대로 받는다(여기서 다시 판단하지 않는다). */
export interface AptScoreView {
  /** deriveScoreCardState의 kind. 'ok'가 아니면 점수를 표시하지 않는다. */
  state: 'no-result' | 'v2-absent' | 'not-enough-data' | 'ok';
  overallScore: number | null;
  scoreVersion: string | null;
  eligibility: string | null;
  domains: { key: string; label: string; score: number | null; coverage: number }[];
  /** derivePeerVerdict 결과 — HIGH만 정확한 숫자를 쓴다. */
  peerVerdict: { kind: 'unavailable' } | { kind: 'exact'; topPercent: number } | { kind: 'directional' } | { kind: 'broad' };
  briefing: { summary: string; strengths: string[]; caution: string | null } | null;
}

export interface AptLocationInfo {
  nearestSubwayName: string | null;
  nearestSubwayDistanceM: number | null;
  nearestElementaryDistanceM: number | null;
  /**
   * §7 — NEIS School 원천에서 해석한 가장 가까운 초등학교. **이름과 거리가 같은 출처다.**
   * 확인할 수 없으면 null이며, 그때는 이름 없는 거리를 대신 보여주지 않는다.
   */
  nearestElementarySchool: { name: string; distanceM: number } | null;
  convenienceCount500m: number | null;
  martCount1000m: number | null;
  parkCount1000m: number | null;
  qualityFlag: string | null;
  fetchedAt: string | null;
}

export interface AptMarketInfo {
  medianPricePerM2_12m: number | null;
  transactionCount12m: number | null;
  priceChange12m: number | null;
  fetchedAt: string | null;
}

export interface AptReportInput {
  master: AptMasterInfo;
  /** 최근 12개월 거래(취소 포함 상태로 넘겨도 여기서 제외한다). */
  trades12m: readonly TradeRow[];
  /** 최근 2년 최고가 후보(금액 desc 상위 소수). */
  twoYearTopCandidates: readonly TradeRow[];
  /** 최근 거래 목록(계약일 desc). */
  recentTradeRows: readonly TradeRow[];
  score: AptScoreView;
  location: AptLocationInfo | null;
  market: AptMarketInfo | null;
  period: ReportPeriod;
  generatedAt: string;
  dataAsOf: string | null;
  coverageComplete: boolean;
}

export interface ApartmentReportData {
  aptSeq: string;
  scoreState: AptScoreView['state'];
  /** Score briefing이 만든 강점/확인할 점. **여기서 새 문장을 만들지 않는다**(§10). */
  strengths: string[];
  cautions: string[];
  /** peer 표시 정책 결과 — HIGH일 때만 정확한 숫자를 쓴다(상세 화면과 동일 규칙). */
  peerTopPercent: number | null;
}

function money(manwon: number | null): string {
  if (manwon == null) return '정보 없음';
  const eok = Math.floor(manwon / 10000);
  const rest = Math.round(manwon % 10000);
  if (eok > 0) return rest > 0 ? `${eok}억 ${rest.toLocaleString('ko-KR')}만원` : `${eok}억원`;
  return `${manwon.toLocaleString('ko-KR')}만원`;
}

function metric(
  key: string,
  label: string,
  value: number | string | null,
  displayValue: string,
  unit: string | null,
  trust: MetricTrust,
  reason: string | null,
  source: MetricSource,
  sampleSize: number | null = null
): ReportMetric {
  return { key, label, value, displayValue, unit, trust, reason, sampleSize, source };
}

export function buildApartmentReport(input: AptReportInput): ReportEnvelope<ApartmentReportData> {
  const m = input.master;
  const trades = prepareRows(input.trades12m);
  const agg = aggregate(trades);
  const recent = recentTrades(prepareRows(input.recentTradeRows), 5);
  const latest = recent[0] ?? null;
  const top2y = topPricedTrades(prepareRows(input.twoYearTopCandidates), 1)[0] ?? null;

  const tradeSrc: MetricSource = { source: TRADE_SOURCE, dataAsOf: input.dataAsOf };
  const masterSrc: MetricSource = { source: MASTER_SOURCE, dataAsOf: null };
  const scoreSrc: MetricSource = { source: SCORE_SOURCE, dataAsOf: null };
  const locSrc: MetricSource = { source: LOCATION_SOURCE, dataAsOf: input.location?.fetchedAt ?? null };
  const mktSrc: MetricSource = { source: MARKET_SOURCE, dataAsOf: input.market?.fetchedAt ?? null };

  const priceSampleOk = trades.length >= APT_MIN_TRADES_FOR_PRICE_INTERPRETATION;
  const thinReason = priceSampleOk
    ? null
    : `최근 12개월 거래 ${trades.length}건으로 표본이 ${APT_MIN_TRADES_FOR_PRICE_INTERPRETATION}건 미만입니다.`;

  // ── PRIMARY (§3) ────────────────────────────────────────────────────────
  const metrics: ReportMetric[] = [
    metric('buildYear', '준공', m.buildYear, m.buildYear ? `${m.buildYear}년` : '정보 없음', '년',
      m.buildYear ? 'SAFE' : 'MISSING', m.buildYear ? null : '준공연도 정보가 없습니다.', masterSrc),
    metric('totalHouseholds', '세대수', m.totalHouseholds,
      m.totalHouseholds ? `${m.totalHouseholds.toLocaleString('ko-KR')}세대` : '정보 없음', '세대',
      m.totalHouseholds ? 'SAFE' : 'MISSING', m.totalHouseholds ? null : '세대수 정보가 없습니다.', masterSrc),
    metric('latestDealAmount', '최근 실거래가', latest ? latest.dealAmount : null, money(latest?.dealAmount ?? null), '만원',
      latest ? 'SAFE' : 'MISSING', latest ? null : '최근 거래 기록이 없습니다.', tradeSrc, trades.length),
    metric('transactionCount12m', '12개월 거래량', trades.length, `${trades.length}건`, '건',
      'SAFE', null, tradeSrc, trades.length),
  ];

  // ── SECONDARY (§4) ──────────────────────────────────────────────────────
  metrics.push(
    metric('medianDealAmount12m', '12개월 중앙 거래가', agg.medianDealAmount, money(agg.medianDealAmount), '만원',
      agg.medianDealAmount == null ? 'MISSING' : priceSampleOk ? 'SAFE' : 'LIMITED',
      agg.medianDealAmount == null ? '12개월 내 거래가 없습니다.' : thinReason, tradeSrc, trades.length),
    metric('medianPricePerM2_12m', '12개월 ㎡당 중앙가',
      agg.medianPricePerM2 == null ? null : Math.round(agg.medianPricePerM2 * 10) / 10,
      agg.medianPricePerM2 == null ? '정보 없음' : `${(Math.round(agg.medianPricePerM2 * 10) / 10).toLocaleString('ko-KR')}만원/㎡`,
      '만원/㎡',
      agg.medianPricePerM2 == null ? 'MISSING' : priceSampleOk ? 'SAFE' : 'LIMITED',
      agg.medianPricePerM2 == null ? '면적이 유효한 거래가 없습니다.' : thinReason, tradeSrc, trades.length),
  );

  // §8 가격 변화 — market feature가 있고 표본이 충분할 때만. 없으면 만들지 않는다.
  const chg = input.market?.priceChange12m ?? null;
  metrics.push(
    metric('priceChange12m', '12개월 가격 변화',
      chg == null ? null : Math.round(chg * 1000) / 10,
      chg == null ? '정보 없음' : `${chg >= 0 ? '+' : ''}${Math.round(chg * 1000) / 10}%`, '%',
      chg == null ? 'MISSING' : priceSampleOk ? 'SAFE' : 'LIMITED',
      chg == null ? '시장 지표가 아직 계산되지 않았습니다.' : thinReason, mktSrc, trades.length),
  );

  // ── OPTIONAL (§5) — 주차는 커버리지 70.7%. 추정하지 않는다. ───────────────
  metrics.push(
    metric('parking', '주차',
      m.parkingCount,
      m.parkingCount == null
        ? '정보 없음'
        : m.parkingPerHousehold != null
          ? `${m.parkingCount.toLocaleString('ko-KR')}대 (세대당 ${m.parkingPerHousehold.toFixed(2)}대)`
          : `${m.parkingCount.toLocaleString('ko-KR')}대`,
      '대', m.parkingCount == null ? 'MISSING' : 'SAFE',
      m.parkingCount == null ? '주차 정보가 등록되지 않은 단지입니다.' : null, masterSrc),
  );

  // ── Score (§6) — 상세 화면과 같은 표시 규칙. 재계산 없음. ─────────────────
  const s = input.score;
  const scoreDisplayable = s.state === 'ok' && s.overallScore != null;
  metrics.push(
    metric('ejipScore', '이집 점수',
      scoreDisplayable ? Math.round(s.overallScore!) : null,
      scoreDisplayable ? `${Math.round(s.overallScore!)}점` : '준비 중',
      '점',
      scoreDisplayable ? (s.eligibility === 'LIMITED' ? 'LIMITED' : 'SAFE') : 'MISSING',
      scoreDisplayable
        ? s.eligibility === 'LIMITED'
          ? '일부 항목의 데이터가 부족해 참고용입니다.'
          : null
        : s.state === 'not-enough-data'
          ? '데이터가 부족해 점수를 계산하지 않았습니다.'
          : '점수를 아직 계산하지 못했습니다.',
      scoreSrc),
  );

  // ── 섹션 ────────────────────────────────────────────────────────────────
  const sections: ReportSection[] = [];

  if (scoreDisplayable && s.domains.length > 0) {
    sections.push({
      key: 'scoreDomains',
      title: '항목별 점수',
      kind: 'DISTRIBUTION',
      rows: s.domains.map((d) => ({
        key: d.key,
        enriched: d.score != null,
        cells: { name: d.label, count: d.score == null ? 0 : Math.round(d.score), share: Math.round(d.coverage * 100) },
      })),
      trust: s.eligibility === 'LIMITED' ? 'LIMITED' : 'SAFE',
      note: s.eligibility === 'LIMITED' ? '일부 항목의 데이터가 부족해 참고용입니다.' : null,
    });
  }

  // §7 거래 — 계약일/전용면적(㎡)/가격을 항상 함께.
  sections.push({
    key: 'recentTrades',
    title: '최근 실거래',
    kind: 'ROWS',
    rows: recent.map((r, i) => ({
      key: `${r.dealDate}|${r.dealAmount}|${i}`,
      enriched: true,
      cells: {
        aptName: m.name,
        aptSeq: m.aptSeq,
        dealAmount: r.dealAmount,
        dealDate: r.dealDate,
        exclusiveAreaM2: r.exclusiveArea, // 평 변환 금지
        floor: r.floor,
      },
    })),
    trust: recent.length > 0 ? 'SAFE' : 'MISSING',
    note: recent.length === 0 ? '최근 거래 기록이 없습니다.' : null,
  });

  // §9 위치/생활 — 한 페이지이므로 핵심만.
  const loc = input.location;
  if (loc) {
    const rows = [
      // SCHOOL_DISTANCE_SOURCE_RECONCILIATION_V1 §3 — 이 표의 거리는 전부 **직선거리**다
      // (지하철은 Kakao가 돌려준 직선 m, 초등학교는 NEIS 공식 좌표로 계산한 직선 m).
      // 라벨 없이 "342m"라고만 쓰면 도보 거리로 읽힐 수 있고, ApartmentScoreCard는 이미
      // "직선거리"라고 명시하고 있어 두 화면의 표현이 어긋났다. 같은 의미의 값에는 같은
      // 라벨을 붙인다. 값 자체는 바꾸지 않는다.
      loc.nearestSubwayDistanceM != null
        ? { label: '지하철', value: `${loc.nearestSubwayName ?? '역'} · 직선 ${loc.nearestSubwayDistanceM}m` }
        : { label: '지하철', value: '정보 없음' },
      // 이름을 확인한 경우에만 "OO초등학교 · 직선 249m"을 쓴다. 이름과 거리는 같은
      // 출처(NEIS School)에서 왔다. 확인하지 못했으면 이름 없는 거리를 마치 특정 학교인
      // 것처럼 보여주지 않고, 사실대로 확인 불가를 말한다.
      loc.nearestElementarySchool
        ? { label: '초등학교', value: `${loc.nearestElementarySchool.name} · 직선 ${loc.nearestElementarySchool.distanceM}m` }
        : { label: '초등학교', value: '학교 정보 확인 불가' },
      loc.convenienceCount500m != null
        ? { label: '편의점(500m)', value: `${loc.convenienceCount500m}개` }
        : { label: '편의점(500m)', value: '정보 없음' },
      loc.parkCount1000m != null
        ? { label: '공원(1km)', value: `${loc.parkCount1000m}개` }
        : { label: '공원(1km)', value: '정보 없음' },
    ];
    sections.push({
      key: 'locationSummary',
      title: '교통 · 생활',
      kind: 'ROWS',
      rows: rows.map((r) => ({ key: r.label, enriched: !r.value.includes('정보 없음'), cells: { name: r.label, value: r.value } })),
      trust: 'SAFE',
      note: null,
    });
  }

  // ── 하이라이트: 최근 2년 최고 거래가(기간 문구 필수) ─────────────────────
  const highlights = top2y
    ? [
        {
          key: 'twoYearHigh',
          label: '최근 2년 최고 거래가',
          displayValue: `${money(top2y.dealAmount)} · 전용 ${top2y.exclusiveArea}㎡ · ${top2y.dealDate}`,
          contextLabel: '최근 2년 · 취소 거래 제외',
          trust: 'SAFE' as const,
        },
      ]
    : [];

  // ── 해석 (§10) — Score briefing만 쓴다. 새 문장을 만들지 않는다. ─────────
  const interpretation = s.briefing
    ? {
        source: 'EJIP_SCORE_BRIEFING' as const,
        text: s.briefing.summary,
        ruleId: 'EJIP_SCORE_BRIEFING_V1',
      }
    : { source: 'NONE' as const, text: null, ruleId: null };

  const { completeness, counts } = summarizeTrust(metrics);
  const notes: string[] = [];
  if (!input.coverageComplete) notes.push('해당 기간의 수집 완전성이 아직 검증되지 않았습니다.');
  if (!priceSampleOk && trades.length > 0) notes.push(thinReason!);
  if (m.parkingCount == null) notes.push('이 단지는 주차 정보가 등록되어 있지 않습니다.');
  if (!scoreDisplayable) notes.push('이집 점수는 데이터가 충분해지면 표시됩니다.');

  const regionLabel = [districtName(m.sggCd) ?? m.sigungu, m.umdName].filter(Boolean).join(' ');

  return {
    reportType: 'APARTMENT_DETAIL',
    reportVersion: APT_REPORT_VERSION,
    scope: {
      level: 'APARTMENT',
      lawdCd: m.sggCd,
      dong: m.umdName,
      aptSeqs: [m.aptSeq],
      displayName: m.name,
    },
    period: input.period,
    generatedAt: input.generatedAt,
    dataAsOf: input.dataAsOf,
    trust: {
      completeness: input.coverageComplete ? completeness : 'UNVERIFIED',
      canceledExcluded: true,
      scopeLawdCds: m.sggCd ? [m.sggCd] : [],
      metricTrustCounts: counts,
      notes,
    },
    title: `${m.name} 단지 리포트`,
    subtitle: [regionLabel, m.roadAddress ?? m.jibunAddress].filter(Boolean).join(' · ') || null,
    metrics,
    sections,
    highlights,
    interpretation,
    sourceNotes: [
      { source: TRADE_SOURCE, dataAsOf: input.dataAsOf },
      { source: MASTER_SOURCE, dataAsOf: null },
      { source: SCORE_SOURCE, dataAsOf: null },
      ...(loc ? [locSrc] : []),
      ...(input.market ? [mktSrc] : []),
    ],
    navigationTargets: [
      // REPORT_BOTTOM_ACTION_BAR_COMPACT_FIX_V1 §1 — 라벨만 짧게 바꾼다.
      // href(돌아갈 단지 상세 경로)는 그대로다 — aptSeq를 들고 간다(§9).
      { label: '단지로 돌아가기', href: `/apt/${encodeURIComponent(m.name)}?aptSeq=${encodeURIComponent(m.aptSeq)}` },
    ],
    data: {
      aptSeq: m.aptSeq,
      scoreState: s.state,
      strengths: s.briefing?.strengths ?? [],
      cautions: s.briefing?.caution ? [s.briefing.caution] : [],
      peerTopPercent: s.peerVerdict.kind === 'exact' ? s.peerVerdict.topPercent : null,
    },
  };
}

/** 강점/확인할 점 — Score briefing이 이미 만든 것만 쓴다(새로 생성 금지). */
export function interpretationBlocks(score: AptScoreView): { strengths: string[]; cautions: string[] } {
  return {
    strengths: score.briefing?.strengths ?? [],
    cautions: score.briefing?.caution ? [score.briefing.caution] : [],
  };
}

export { median };
