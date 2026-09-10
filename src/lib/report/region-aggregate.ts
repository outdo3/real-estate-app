// REPORT ENGINE REPORT-1 — 지역 집계의 **순수 로직**.
//
// Prisma를 import하지 않는다. 입력은 평범한 행 배열이고 출력은 결정론적이다 —
// 그래야 .test.mjs에서 DB 없이 규칙 자체를 고정할 수 있다(이 저장소의 기존 관례:
// map-marker-share.ts / map-property-focus.ts 등).
//
// 지켜야 할 규칙(전부 여기서 강제한다):
//   §7 취소건은 기본 제외 — 건수/중앙값/대표거래/2년 최고가 어디에도 쓰지 않는다.
//   §8 집계의 출발점은 **거래 행**이다. master 보강이 없다고 거래가 사라지면 안 된다.
//   §9 표본이 얇으면 수치는 보여주되 **강한 해석을 붙이지 않는다**.
//   §10 예측 금지 — 실측 차이값만.
//   평형(평) 라벨 금지 — ApartmentUnitType 커버리지가 2.9%라 ㎡만 쓴다.

import { isBusanCurrentLawdCd, normalizeDong } from './region-scope';
import type { MetricTrust, ReportRow, SampleGate } from './types';

/** 집계 입력 행 — apartment_trade_histories에서 필요한 것만 옮겨 담은 평평한 모양. */
export interface TradeRow {
  aptSeq: string | null;
  lawdCd: string;
  dong: string | null;
  aptName: string;
  /** 전용면적(㎡) raw. 평 변환 금지. */
  exclusiveArea: number;
  /** 만원 단위 정수. */
  dealAmount: number;
  /** YYYY-MM-DD */
  dealDate: string;
  dealCanceled: boolean;
  floor: number | null;
}

/** master 보강값. 없을 수 있다(부산 거래의 4.7%가 미매칭). */
export interface MasterEnrichment {
  aptSeq: string;
  name: string | null;
  roadAddress: string | null;
  totalHouseholds: number | null;
  buildYear: number | null;
}

/**
 * §9 표본 게이트 기준.
 * PRECHECK 실측에서 "최근 1년 거래 10건 미만"인 동이 52개였고, 그 아래에서는
 * 중앙값/전월대비 같은 비교 해석이 한두 건에 좌우된다. 그래서 10을 하한으로 쓴다 —
 * 임의의 숫자가 아니라 그 실측에서 나온 경계다.
 */
export const MIN_SAMPLE_FOR_INTERPRETATION = 10;

/** §7 — 취소건 제외. 집계 진입점 한 곳에서만 거른다. */
export function excludeCanceled(rows: readonly TradeRow[]): TradeRow[] {
  return rows.filter((r) => !r.dealCanceled);
}

/** §4 — 스코프 밖(27110/11680 등) 행을 제거한다. */
export function keepBusanCurrentScope(rows: readonly TradeRow[]): TradeRow[] {
  return rows.filter((r) => isBusanCurrentLawdCd(r.lawdCd));
}

/** 리포트 집계에 쓸 행으로 정리한다(스코프 → 취소 제외 순서). */
export function prepareRows(rows: readonly TradeRow[]): TradeRow[] {
  return excludeCanceled(keepBusanCurrentScope(rows));
}

/** 중앙값. 빈 배열이면 null(0으로 만들지 않는다). */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** ㎡당 만원. dealAmount(만원)/exclusiveArea(㎡) — 둘 다 raw라 파생 위험이 없다. */
export function pricePerM2(row: TradeRow): number | null {
  if (!(row.exclusiveArea > 0)) return null;
  return row.dealAmount / row.exclusiveArea;
}

export interface RegionAggregate {
  transactionCount: number;
  medianDealAmount: number | null;
  medianPricePerM2: number | null;
  /** 가장 최근 계약일(YYYY-MM-DD). 없으면 null. */
  latestDealDate: string | null;
}

export function aggregate(rows: readonly TradeRow[]): RegionAggregate {
  const amounts = rows.map((r) => r.dealAmount);
  const perM2 = rows.map(pricePerM2).filter((v): v is number => v != null);
  let latest: string | null = null;
  for (const r of rows) if (latest == null || r.dealDate > latest) latest = r.dealDate;
  return {
    transactionCount: rows.length,
    medianDealAmount: median(amounts),
    medianPricePerM2: median(perM2),
    latestDealDate: latest,
  };
}

/** §9 표본 게이트. 수치 표시는 허용하되 강한 해석은 막는다. */
export function sampleGate(sampleSize: number, sampleWindow: string): SampleGate {
  const ok = sampleSize >= MIN_SAMPLE_FOR_INTERPRETATION;
  return {
    sampleSize,
    sampleWindow,
    sampleSufficient: ok,
    reason: ok ? null : `${sampleWindow} 거래 ${sampleSize}건으로 표본이 ${MIN_SAMPLE_FOR_INTERPRETATION}건 미만입니다.`,
  };
}

/** 표본 크기에 따른 지표 신뢰 등급. 값이 없으면 MISSING. */
export function trustForSample(value: unknown, gate: SampleGate): MetricTrust {
  if (value == null) return 'MISSING';
  return gate.sampleSufficient ? 'SAFE' : 'LIMITED';
}

export interface DistributionEntry {
  key: string;
  label: string;
  count: number;
  share: number;
}

/**
 * 구/동 분포. **결정론적 정렬**: 건수 desc → key asc(동률에서 순서가 흔들리지 않게).
 */
export function distribution(
  rows: readonly TradeRow[],
  by: 'lawdCd' | 'dong',
  labelOf: (key: string) => string
): DistributionEntry[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const raw = by === 'lawdCd' ? r.lawdCd : normalizeDong(r.dong);
    if (!raw) continue; // dong이 비어 있으면 임의 버킷을 만들지 않는다.
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labelOf(key), count, share: total > 0 ? count / total : 0 }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
}

/**
 * §11 대표 최근 거래 — 계약일 desc, 동률은 금액 desc → aptSeq/이름 asc로 고정.
 * cherry-pick 금지: 규칙 하나로 결정되고 같은 입력이면 항상 같은 출력이다.
 */
export function recentTrades(rows: readonly TradeRow[], limit: number): TradeRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.dealDate.localeCompare(a.dealDate) ||
        b.dealAmount - a.dealAmount ||
        (a.aptSeq ?? '').localeCompare(b.aptSeq ?? '') ||
        a.aptName.localeCompare(b.aptName)
    )
    .slice(0, limit);
}

/** §11 고가 거래 — 금액 desc, 동률은 계약일 desc → aptSeq asc. 기간은 호출부가 정한다. */
export function topPricedTrades(rows: readonly TradeRow[], limit: number): TradeRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.dealAmount - a.dealAmount ||
        b.dealDate.localeCompare(a.dealDate) ||
        (a.aptSeq ?? '').localeCompare(b.aptSeq ?? '')
    )
    .slice(0, limit);
}

export interface ComplexActivity {
  aptSeq: string | null;
  aptName: string;
  dong: string | null;
  count: number;
  latestDealDate: string;
}

/** 대표 단지 — 거래건수 desc, 동률은 최근 계약일 desc → 이름 asc. */
export function representativeComplexes(rows: readonly TradeRow[], limit: number): ComplexActivity[] {
  const m = new Map<string, ComplexActivity>();
  for (const r of rows) {
    // identity는 aptSeq 우선. 없으면 이름+동으로만 묶고 **다른 단지와 합치지 않는다**.
    const key = r.aptSeq ? `id:${r.aptSeq}` : `nd:${r.aptName}|${normalizeDong(r.dong) ?? ''}`;
    const cur = m.get(key);
    if (!cur) {
      m.set(key, { aptSeq: r.aptSeq, aptName: r.aptName, dong: normalizeDong(r.dong), count: 1, latestDealDate: r.dealDate });
    } else {
      cur.count += 1;
      if (r.dealDate > cur.latestDealDate) cur.latestDealDate = r.dealDate;
    }
  }
  return [...m.values()]
    .sort((a, b) => (b.count - a.count) || b.latestDealDate.localeCompare(a.latestDealDate) || a.aptName.localeCompare(b.aptName))
    .slice(0, limit);
}

/**
 * §8 LEFT JOIN 안전 보강. **행 수를 절대 바꾸지 않는다.**
 * master가 없으면 enriched=false로 표시할 뿐 행을 버리지 않는다.
 */
export function enrichRows(
  rows: readonly TradeRow[],
  masters: readonly MasterEnrichment[]
): ReportRow[] {
  const byAptSeq = new Map(masters.map((m) => [m.aptSeq, m]));
  return rows.map((r, i) => {
    const m = r.aptSeq ? byAptSeq.get(r.aptSeq) : undefined;
    return {
      // 같은 단지·같은 날 복수 거래가 있으므로 index를 함께 넣어 key 충돌을 막는다.
      key: `${r.aptSeq ?? r.aptName}|${r.dealDate}|${r.dealAmount}|${i}`,
      enriched: !!m,
      cells: {
        aptSeq: r.aptSeq,
        aptName: m?.name ?? r.aptName, // master 이름이 있으면 우선, 없으면 거래 원본 이름.
        dong: normalizeDong(r.dong),
        lawdCd: r.lawdCd,
        // 평 변환 금지 — ㎡ 그대로.
        exclusiveAreaM2: r.exclusiveArea,
        dealAmount: r.dealAmount,
        dealDate: r.dealDate,
        floor: r.floor,
        roadAddress: m?.roadAddress ?? null,
        totalHouseholds: m?.totalHouseholds ?? null,
        buildYear: m?.buildYear ?? null,
      },
    };
  });
}

/**
 * §10 전월 대비 거래량 — **실측 차이값만**. 예측 문구를 만들지 않는다.
 * previous가 0이면 비율을 만들지 않는다(0으로 나누지 않고 null).
 */
export interface CountDelta {
  current: number;
  previous: number;
  diff: number;
  /** previous가 0이면 null. */
  ratio: number | null;
}

export function countDelta(current: number, previous: number): CountDelta {
  return {
    current,
    previous,
    diff: current - previous,
    ratio: previous > 0 ? (current - previous) / previous : null,
  };
}

/** 실측 차이값을 그대로 읽는 문장. 전망/추측 어휘를 쓰지 않는다(§10). */
export function describeCountDelta(delta: CountDelta, currentLabel: string, previousLabel: string): string {
  if (delta.ratio == null) {
    return `${previousLabel} 거래가 없어 ${currentLabel} 대비 증감률을 계산하지 않았습니다(${currentLabel} ${delta.current}건).`;
  }
  const pct = Math.round(delta.ratio * 1000) / 10;
  const dir = delta.diff > 0 ? '증가' : delta.diff < 0 ? '감소' : '동일';
  if (delta.diff === 0) return `${currentLabel} 거래량은 ${previousLabel}과 동일합니다(${delta.current}건).`;
  return `${currentLabel} 거래량은 ${delta.current}건으로 ${previousLabel}(${delta.previous}건) 대비 ${Math.abs(pct)}% ${dir}했습니다.`;
}
