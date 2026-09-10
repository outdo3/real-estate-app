// REPORT-5 — "새로 확인된 실거래"의 순수 규칙.
//
// 이 파일이 세 가지를 혼자 책임진다(흩어지면 곧 어긋난다):
//   §2  KST 관찰일 ↔ UTC 질의 경계
//   §6  백필 의심 판정
//   §9  발행 가능 상태 판정
//
// Prisma를 import하지 않는다.
//
// ── 용어를 먼저 못박는다 ─────────────────────────────────────────────────
//   관찰일(observation date) = E-JIP이 그 거래를 **처음 확인한 날**(created_at)
//   계약일(contract date)    = 실제 거래가 체결된 날(deal_date)
// 둘은 다르다. 실측(9/9): 그날 새로 확인된 89건의 계약일이 2026-02-10까지 거슬러
// 올라간다. 이 리포트의 날짜는 **관찰일**이며, 계약일은 행마다 따로 보여준다.

import {
  SALE_DEFAULT_OVERLAP_MONTHS,
  SALE_RECHECK_MAX_MONTHS_BACK,
} from '@/lib/sync/shared';

/** 한국은 현재 서머타임이 없다. 고정 +09:00으로 안전하게 계산할 수 있다(§2). */
export const KST_OFFSET_MINUTES = 9 * 60;

/**
 * 증분 관찰이 실제로 존재하는 첫 날(KST).
 * 그 이전은 초기 백필 구간이라 "그날 새로 확인했다"고 말할 수 없다(PRECHECK §3.3-4).
 */
export const DAILY_SUPPORTED_FROM_KST = '2026-08-30';

/**
 * §6 — 정기 실행이 **건드릴 수 있는 최대 계약월 수**.
 * sale sync는 최근 3개월(overlap), recheck는 3~12개월 전을 본다. 둘의 합집합은
 * "0개월 전 ~ 12개월 전"이므로 최대 13개의 서로 다른 deal_ymd다.
 * 임의의 숫자가 아니라 shipped 상수에서 유도한 값이다.
 */
export const MAX_LEGITIMATE_DISTINCT_MONTHS = SALE_RECHECK_MAX_MONTHS_BACK + 1;

/** 정기 실행이 넣을 수 있는 가장 오래된 계약월(관찰일 기준 N개월 전). */
export const MAX_LEGITIMATE_MONTHS_BACK = SALE_RECHECK_MAX_MONTHS_BACK;

/** 상수를 실제로 참조하고 있음을 드러내기 위한 재노출(문서/테스트용). */
export const SYNC_BOUNDS = {
  overlapMonths: SALE_DEFAULT_OVERLAP_MONTHS,
  recheckMaxMonthsBack: SALE_RECHECK_MAX_MONTHS_BACK,
} as const;

export interface ObservationWindow {
  /** 요청된 KST 관찰일 YYYY-MM-DD */
  dateKst: string;
  /** 질의에 쓸 UTC 시작(포함) */
  startUtc: Date;
  /** 질의에 쓸 UTC 끝(제외) */
  endUtcExclusive: Date;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(s: string): boolean {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * §2 — KST 하루를 UTC 경계로 바꾸는 **단일 지점**.
 * KST 00:00 = 같은 날 UTC 15:00 전날. 즉 UTC 기준 [D-1 15:00, D 15:00).
 * 컴포넌트/쿼리 어디에서도 타임존 산술을 다시 하지 않는다.
 */
export function observationWindowKst(dateKst: string): ObservationWindow {
  const startUtcMs = Date.parse(`${dateKst}T00:00:00.000Z`) - KST_OFFSET_MINUTES * 60_000;
  return {
    dateKst,
    startUtc: new Date(startUtcMs),
    endUtcExclusive: new Date(startUtcMs + 24 * 60 * 60_000),
  };
}

/** KST 기준 오늘 날짜(YYYY-MM-DD). */
export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 'YYYYMM' */
export function ymdToYm(ymd: string): string {
  return ymd.slice(0, 4) + ymd.slice(5, 7);
}

/** 관찰일 기준 N개월 전의 'YYYY-MM-01'. */
export function monthsBefore(dateKst: string, months: number): string {
  const d = new Date(`${dateKst}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return `${d.toISOString().slice(0, 8)}01`;
}

/** 백필 판정에 필요한 최소 요약(행 전체를 넘길 필요가 없다). */
export interface DayObservationSummary {
  totalRows: number;
  /** 그날 새로 관측된 행들의 서로 다른 deal_ymd 개수 */
  distinctDealYmd: number;
  /** 가장 오래된 계약일 YYYY-MM-DD. 행이 없으면 null. */
  minDealDate: string | null;
}

export type BackfillState =
  | { suspected: false }
  | { suspected: true; reason: 'TOO_MANY_MONTHS' | 'CONTRACT_TOO_OLD'; detail: string };

/**
 * §6 — 이 날의 관측이 정기 실행만으로 설명되는가.
 *
 * 정기 실행(sale overlap 3개월 + recheck 3~12개월)이 만들 수 없는 모양이면 백필로 본다.
 * 실측 대조: 정상일 distinct deal_ymd 1~7, 백필일 24/248.
 * 행 수는 판별자로 쓰지 않는다 — 정상일(206건)이 비정상일(132건)보다 많았다.
 */
export function detectBackfill(summary: DayObservationSummary, dateKst: string): BackfillState {
  if (summary.totalRows === 0) return { suspected: false };

  if (summary.distinctDealYmd > MAX_LEGITIMATE_DISTINCT_MONTHS) {
    return {
      suspected: true,
      reason: 'TOO_MANY_MONTHS',
      detail: `하루에 관측된 계약월이 ${summary.distinctDealYmd}개로, 정기 수집이 다루는 최대 ${MAX_LEGITIMATE_DISTINCT_MONTHS}개월을 넘습니다.`,
    };
  }
  if (summary.minDealDate) {
    const oldestAllowed = monthsBefore(dateKst, MAX_LEGITIMATE_MONTHS_BACK);
    if (summary.minDealDate < oldestAllowed) {
      return {
        suspected: true,
        reason: 'CONTRACT_TOO_OLD',
        detail: `관측된 계약일 중 가장 오래된 것이 ${summary.minDealDate}로, 정기 수집이 다루는 범위(${oldestAllowed} 이후)를 벗어납니다.`,
      };
    }
  }
  return { suspected: false };
}

export type CoverageState = 'VERIFIED' | 'UNVERIFIED';

export type PublicationState =
  | 'READY'
  | 'READY_ZERO'
  | 'PREPARING'
  | 'WITHHELD_BACKFILL'
  | 'OUTSIDE_SUPPORTED_RANGE';

export interface PublicationInput {
  dateKst: string;
  /** 오늘(KST) — 미래 날짜 요청을 막는 데 쓴다. */
  todayKst: string;
  backfill: BackfillState;
  coverage: CoverageState;
  /** 스코프·취소 필터를 모두 통과한 부산 행 수. */
  validBusanRows: number;
}

/**
 * §9/§12 — 무엇을 보여줘도 되는가.
 *
 * 순서가 중요하다: 백필 → 지원 범위 → 커버리지 → 0건.
 * "검증되지 않은 0건"을 절대 0건이라고 말하지 않는다.
 */
export function resolvePublicationState(input: PublicationInput): PublicationState {
  // §7/§8 — 백필이 실제로 탐지되면 그것이 가장 정확한 이유다. 지원 범위보다 먼저 본다.
  // (2026-08-29처럼 지원 시작일 이전이면서 동시에 백필인 날을 "그냥 범위 밖"이라고만
  //  말하면, 그날 무슨 일이 있었는지에 대한 정보를 잃는다.)
  if (input.backfill.suspected) return 'WITHHELD_BACKFILL';
  if (input.dateKst < DAILY_SUPPORTED_FROM_KST || input.dateKst > input.todayKst) {
    return 'OUTSIDE_SUPPORTED_RANGE';
  }
  // §10 — 검증되지 않았으면 숫자를 내지 않는다(0도 내지 않는다).
  if (input.coverage !== 'VERIFIED') return 'PREPARING';
  return input.validBusanRows > 0 ? 'READY' : 'READY_ZERO';
}

/** 상태별 사용자 문구. 화면이 문구를 새로 지어내지 않도록 여기서 정한다. */
export function publicationMessage(state: PublicationState, dateLabel: string): string | null {
  switch (state) {
    case 'READY':
    case 'READY_ZERO':
      return null;
    case 'WITHHELD_BACKFILL':
      return `${dateLabel}의 실거래 업데이트는 데이터 정리 작업이 포함되어 집계를 제공하지 않습니다.`;
    case 'PREPARING':
      return `${dateLabel}의 수집 결과를 확인하는 중입니다. 확인이 끝나면 집계를 제공합니다.`;
    case 'OUTSIDE_SUPPORTED_RANGE':
      return `${dateLabel}은 일별 신규 확인 집계를 제공하지 않는 기간입니다(${DAILY_SUPPORTED_FROM_KST}부터 제공).`;
  }
}
