// REPORT-2 §3 — 리포트 기본 기간.
//
// 왜 "최근 30일"인가: 당월만 쓰면 sync_coverage_cells에 당월 셀이 아직 없어
// (PRECHECK 실측: 202609 셀 0개) 리포트가 항상 UNVERIFIED로 뜬다. 최근 30일은
// 대부분 검증이 끝난 직전 월을 함께 덮으므로 실제로 쓸 수 있는 기본값이다.
// 완전성이 부족하면 숨기지 않고 envelope의 trust로 그대로 드러낸다.
//
// 종료일은 "오늘"이 아니라 **어제**로 둔다. 오늘자 수집은 cron(19:00 UTC = 04:00 KST)
// 이후에야 들어오므로, 오늘을 포함하면 시간대에 따라 마지막 하루가 비어 보인다.

import { isSingleDayPeriod, isVolumePeriodPreset, resolveVolumePeriod, volumePeriodLabel, type VolumePeriodPreset } from '@/lib/stats/volume-period';

export const DEFAULT_PERIOD_DAYS = 30;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface ResolvedPeriod {
  start: string;
  end: string;
  label: string;
  days: number;
}

/** 허용 기간(일). 임의 값을 URL로 받지 않는다 — 캐시 키 파편화와 과도한 스캔을 막는다. */
export const ALLOWED_PERIOD_DAYS = [30, 90, 365] as const;
export type AllowedPeriodDays = (typeof ALLOWED_PERIOD_DAYS)[number];

export function isAllowedPeriodDays(n: number): n is AllowedPeriodDays {
  return (ALLOWED_PERIOD_DAYS as readonly number[]).includes(n);
}

const LABEL: Record<number, string> = { 30: '최근 30일', 90: '최근 90일', 365: '최근 1년' };

/** now 기준 기간을 만든다(테스트 결정론을 위해 now를 주입할 수 있다). */
export function resolvePeriod(days: number = DEFAULT_PERIOD_DAYS, now: Date = new Date()): ResolvedPeriod {
  const d = isAllowedPeriodDays(days) ? days : DEFAULT_PERIOD_DAYS;
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 1); // 어제까지
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (d - 1));
  return { start: ymd(start), end: ymd(end), label: LABEL[d] ?? `최근 ${d}일`, days: d };
}

/** ?period=90 같은 쿼리를 안전하게 해석한다. 이상한 값은 조용히 기본값으로. */
export function parsePeriodParam(raw: string | string[] | undefined): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return Number.isFinite(n) && isAllowedPeriodDays(n) ? n : DEFAULT_PERIOD_DAYS;
}

// ── STATS_PERIOD_IMAGE_PARITY_V2 ────────────────────────────────────────────
//
// 통계 화면(거래량 카드)에서 고른 기간이 한장 브리핑 → 이미지(PNG) → PDF까지 **그대로** 가야 한다.
// 예전에는 이 파일이 30/90/365만 받아, 통계의 7일·어제·오늘 링크는 전부 30일 리포트가 됐다
// (그리고 모르는 값은 조용히 30으로 바뀌었다).
//
// 두 종류의 키를 받는다. 서로 의미를 바꾸지 않는다:
//   - '30' | '90' | '365' : 기존 리포트 기간(어제까지 N일). 기본 진입·SEO 설명·기존 링크 그대로.
//   - 통계 기간 키 'today' | 'yesterday' | '7d' | '15d' | '30d' | '3m' :
//       통계 화면과 **같은 계산기**(resolveVolumePeriod — KST 계약일, 오늘 포함)로 같은 날짜 범위를 만든다.
//       그래서 '30d'(오늘까지 30일)와 '30'(어제까지 30일)은 다른 기간이다 — 통계에서 온 링크는 '30d'를 쓴다.
// 모르는 값만 기존 기본값('30')으로 간다. 알려진 통계 키를 다른 기간으로 바꾸지 않는다.

export type ReportPeriodKey = '30' | '90' | '365' | VolumePeriodPreset;

export const DEFAULT_REPORT_PERIOD_KEY: ReportPeriodKey = '30';

export interface ResolvedReportPeriod extends ResolvedPeriod {
  key: ReportPeriodKey;
  /** 하루짜리(오늘/어제) — 신고 시차 때문에 직전 기간 대비를 표시하지 않는다(통계 화면과 같은 정책). */
  singleDay: boolean;
  /** 기본 진입 기간인가 — 공유 링크에 ?period=를 붙일지 정한다. */
  isDefault: boolean;
}

export function parseReportPeriodKey(raw: string | string[] | undefined): ReportPeriodKey {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v == null || v === '') return DEFAULT_REPORT_PERIOD_KEY;
  if (isVolumePeriodPreset(v)) return v;
  const n = Number(v);
  if (Number.isFinite(n) && isAllowedPeriodDays(n)) return String(n) as ReportPeriodKey;
  return DEFAULT_REPORT_PERIOD_KEY;
}

/**
 * 직전 동일 기간(같은 일수, 시작일 바로 전날에 끝남). region-read.ts가 이 함수로 비교 기간을 만든다 —
 * 통계 화면의 previousPeriodRange(regional-feed.ts)와 같은 정의다(테스트로 고정).
 */
export function reportPreviousRange(start: string, end: string): { start: string; end: string } {
  const day = 86_400_000;
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  const span = Math.max(1, Math.round((e - s) / day) + 1);
  const prevEnd = s - day;
  const prevStart = prevEnd - (span - 1) * day;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { start: iso(prevStart), end: iso(prevEnd) };
}

export function resolveReportPeriod(key: ReportPeriodKey, now: Date = new Date()): ResolvedReportPeriod {
  if (isVolumePeriodPreset(key)) {
    const range = resolveVolumePeriod(key, now);
    const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1;
    return {
      start: range.from,
      end: range.to,
      label: volumePeriodLabel(key),
      days,
      key,
      singleDay: isSingleDayPeriod(key),
      isDefault: false,
    };
  }
  const legacy = resolvePeriod(Number(key), now);
  return { ...legacy, key, singleDay: false, isDefault: key === DEFAULT_REPORT_PERIOD_KEY };
}
