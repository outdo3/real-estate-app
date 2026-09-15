// STATISTICS_PERIOD_TRADE_UX_V1 — 거래량 영역(요약·거래 많은 단지·실거래 목록)의 **단일 기간 규칙**.
//
// 왜 따로 두는가: 기존 기간 해석(resolvePriceRankingPeriod/resolvePeriodRange)은
// `now.toISOString()`(UTC)로 "오늘"을 정했다. 서버(Vercel)는 UTC라 한국 00:00~08:59에는
// 오늘이 **어제**로, 최근 7일도 하루 밀려 계산됐다. 여기서는 KST 달력 날짜를 먼저 정하고
// 그 뒤 계산은 전부 UTC 산술로만 한다 — 서버 TZ(UTC든 KST든)와 무관하게 같은 결과.
//
// 날짜는 모두 **계약일(deal_date)** 범위다. 수집일(created_at)과 섞지 않는다.

export type VolumePeriodPreset = 'today' | 'yesterday' | '7d' | '30d' | '3m';

export const VOLUME_PERIOD_OPTIONS: readonly { key: VolumePeriodPreset; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: 'yesterday', label: '어제' },
  { key: '7d', label: '최근 7일' },
  { key: '30d', label: '최근 30일' },
  { key: '3m', label: '최근 3개월' },
];

/** 기존 화면 기본값(최근 30일) 그대로. */
export const DEFAULT_VOLUME_PERIOD: VolumePeriodPreset = '30d';

export interface VolumePeriodRange {
  from: string;
  to: string;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function isVolumePeriodPreset(v: unknown): v is VolumePeriodPreset {
  return VOLUME_PERIOD_OPTIONS.some((o) => o.key === v);
}

export function volumePeriodLabel(preset: VolumePeriodPreset): string {
  return VOLUME_PERIOD_OPTIONS.find((o) => o.key === preset)?.label ?? preset;
}

/** 이 순간의 한국 달력 날짜(YYYY-MM-DD). 한국은 서머타임이 없어 +9h 고정이 안전하다. */
export function kstDateString(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function utcDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function shiftDays(ymd: string, days: number): string {
  const d = utcDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 기존 3개월 규칙(Date#setMonth(-3), 월말은 JS가 다음 달로 넘김)과 같은 결과를 UTC로. */
function shiftMonths(ymd: string, months: number): string {
  const d = utcDate(ymd);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** 선택 기간 → 계약일 범위(양끝 포함). 오늘은 KST 기준. */
export function resolveVolumePeriod(preset: VolumePeriodPreset, now: Date): VolumePeriodRange {
  const today = kstDateString(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = shiftDays(today, -1);
      return { from: y, to: y };
    }
    case '7d':
      return { from: shiftDays(today, -6), to: today };
    case '30d':
      return { from: shiftDays(today, -29), to: today };
    case '3m':
      return { from: shiftMonths(today, -3), to: today };
  }
}

/** 하루짜리 기간인가(시계열·이전 기간 대비 표시를 하지 않는다). */
export function isSingleDayPeriod(preset: VolumePeriodPreset): boolean {
  return preset === 'today' || preset === 'yesterday';
}

/**
 * 이전 동일 기간 대비 증감을 보여줄 수 있는가.
 * 하루 단위는 신고 시차가 커서(어제는 오늘보다 신고가 더 들어와 있다) 증감이 시장 변화가 아니라
 * 수집 차이를 말하게 된다 — 정확한 비교가 아니므로 표시하지 않는다.
 */
export function hasComparablePreviousPeriod(preset: VolumePeriodPreset): boolean {
  return !isSingleDayPeriod(preset);
}

/**
 * 신고 시차 안내를 붙일 기간 — 끝이 오늘이거나 하루 단위인 짧은 기간.
 * 실거래 신고 기한은 계약 후 30일이라 짧은 최근 기간일수록 이후 추가분 비중이 크다.
 */
export function needsReportingLagNotice(preset: VolumePeriodPreset): boolean {
  return preset === 'today' || preset === 'yesterday' || preset === '7d';
}

/**
 * 한장 브리핑(리포트)이 실제로 쓰는 기간. 리포트 엔진은 어제까지 30/90/365일만 지원한다.
 * 선택 기간과 같은 기간을 만들 수 없으면 조용히 바꾸지 않고 `matchesSelection=false`와
 * 실제 기준 라벨을 돌려준다 — 화면이 그 차이를 그대로 표시한다.
 */
export function briefingPeriodFor(preset: VolumePeriodPreset): { periodDays: 30 | 90; basisLabel: string; matchesSelection: boolean } {
  if (preset === '3m') return { periodDays: 90, basisLabel: '어제까지 최근 90일 기준', matchesSelection: false };
  return { periodDays: 30, basisLabel: '어제까지 최근 30일 기준', matchesSelection: false };
}

/** 실거래 피드(/stats/feed)가 같은 기간으로 열 수 있는가 — 피드에는 3개월 preset이 없다. */
export function feedPresetFor(preset: VolumePeriodPreset): 'today' | 'yesterday' | '7d' | '30d' | null {
  return preset === '3m' ? null : preset;
}
