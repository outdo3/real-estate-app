// REPORT-5 — 일별 신규 관측 리포트의 **읽기 전용** 데이터 레이어.
//
// 이 파일만 Prisma를 만진다. SELECT만 한다.
//
// 중요한 두 가지:
//  1) 집계 기준은 **created_at**(append-only)이다. sync_coverage_cells의
//     insertedCount로 일별 수치를 재구성하지 않는다 — 그 테이블은
//     (dataset,lawdCd,dealYmd) upsert라 마지막 실행값만 남는다(PRECHECK §8).
//     커버리지 셀은 "지금 이 스코프가 검증됐는가"를 판단할 때만 쓴다.
//  2) 백필 판정은 **스코프 필터 이전의 원본 관측 전체**로 한다. 부산만 남기고 보면
//     8/29 같은 전국 백필의 모양(계약월 248개)이 흐려질 수 있다.

import { prisma } from '@/lib/prisma';
import { BUSAN_CURRENT_LAWD_CODES } from './region-scope';
import {
  detectBackfill,
  isValidYmd,
  observationWindowKst,
  resolvePublicationState,
  todayKst,
  ymdToYm,
  type CoverageState,
  type DayObservationSummary,
} from './daily-observation';
import { buildDailyReport, type DailyTradeReportData, type DailyTradeRow } from './daily-report';
import type { ReportEnvelope } from './types';

export class DailyReportInvalidDate extends Error {
  constructor(public readonly raw: string) {
    super(`DAILY_REPORT_INVALID_DATE: ${raw}`);
  }
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === 'function') return (v as { toNumber: () => number }).toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function ymd(d: Date | string): string {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

const SELECT = {
  aptSeq: true, lawdCd: true, dong: true, aptName: true,
  exclusiveArea: true, dealAmount: true, dealDate: true, dealCanceled: true,
  floor: true, createdAt: true,
} as const;

/** 관측창 1회 스캔으로 얻는 집계(§20). count는 bigint로 온다. */
interface RawDayAggregate {
  total: bigint;
  months: bigint;
  min_deal: Date | null;
  max_deal: Date | null;
  busan: bigint;
  valid: bigint;
  valid_min: Date | null;
  valid_max: Date | null;
  valid_months: string[] | null;
}

export interface DailyDiagnostics {
  rawObservedRows: number;
  busanScopedRows: number;
  validNonCanceledRows: number;
  outOfScopeRows: number;
  distinctDealYmd: number;
  minDealDate: string | null;
  maxDealDate: string | null;
}

/**
 * 관찰일 기준 일별 리포트를 읽는다. **읽기 전용.**
 * 날짜 형식이 잘못되면 조용히 오늘로 대체하지 않고 던진다.
 */
export async function readDailyReport(
  dateKst: string,
  now: Date = new Date()
): Promise<{ envelope: ReportEnvelope<DailyTradeReportData>; diagnostics: DailyDiagnostics }> {
  if (!isValidYmd(dateKst)) throw new DailyReportInvalidDate(dateKst);

  const window = observationWindowKst(dateKst);
  const today = todayKst(now);
  const codes = [...BUSAN_CURRENT_LAWD_CODES];

  // ── §20 성능: 관측창 질의는 **풀스캔이다** ────────────────────────────────
  // apartment_trade_histories에는 created_at 인덱스가 없다(855k행 / 472MB).
  // EXPLAIN ANALYZE 실측: 하루치를 고르려고 864,539행을 필터로 버린다.
  // 따라서 "관측창 질의 횟수"가 곧 비용이다. 풀스캔을 **정확히 한 번만** 한다.
  //
  // 예전 구현은 그날 관측된 행을 전부 materialize한 뒤 요약했다. 8/29(18만 행)에서
  // 7~15초가 걸렸고, 그 행들은 백필 보류로 전량 버려졌다. detectBackfill이 실제로
  // 보는 건 숫자 3개뿐이므로(§6), 그 3개를 집계로 얻고 행은 발행 가능한 날에만 읽는다.
  const [agg] = await prisma.$queryRaw<RawDayAggregate[]>`
    SELECT COUNT(*)::bigint AS total,
           COUNT(DISTINCT deal_ymd)::bigint AS months,
           MIN(deal_date) AS min_deal,
           MAX(deal_date) AS max_deal,
           COUNT(*) FILTER (WHERE lawd_cd = ANY(${codes}))::bigint AS busan,
           COUNT(*) FILTER (WHERE lawd_cd = ANY(${codes}) AND deal_canceled = false)::bigint AS valid,
           MIN(deal_date) FILTER (WHERE lawd_cd = ANY(${codes}) AND deal_canceled = false) AS valid_min,
           MAX(deal_date) FILTER (WHERE lawd_cd = ANY(${codes}) AND deal_canceled = false) AS valid_max,
           array_agg(DISTINCT deal_ymd) FILTER (WHERE lawd_cd = ANY(${codes}) AND deal_canceled = false) AS valid_months
    FROM apartment_trade_histories
    WHERE created_at >= ${window.startUtc.toISOString()}::timestamptz
      AND created_at <  ${window.endUtcExclusive.toISOString()}::timestamptz`;

  // §6 — 백필 판정 모집단은 **스코프 필터 이전 전체 관측**이다(부산만 보면 8/29 같은
  // 전국 백필의 모양이 흐려진다). 위 집계의 total/months/min_deal이 정확히 그것이다.
  const rawObservedRows = Number(agg?.total ?? 0);
  const busanScopedRows = Number(agg?.busan ?? 0);
  const validRowCount = Number(agg?.valid ?? 0);
  const minDealDate = agg?.min_deal ? ymd(agg.min_deal) : null;
  const summary: DayObservationSummary = {
    totalRows: rawObservedRows,
    distinctDealYmd: Number(agg?.months ?? 0),
    minDealDate,
  };
  const backfill = detectBackfill(summary, dateKst);

  // §9 — 커버리지는 "지금 검증된 상태인가"만 본다.
  // 그날 관측된 행들이 속한 계약월 + 관찰일이 속한 달을 모두 확인한다.
  const monthsToCheck = new Set<string>((agg?.valid_months ?? []).concat([ymdToYm(dateKst)]));
  const cells = await prisma.syncCoverageCell.findMany({
    where: {
      dataset: 'SALE',
      lawdCd: { in: codes },
      dealYmd: { in: [...monthsToCheck] },
    },
    select: { status: true, verifiedAt: true, dealYmd: true, lawdCd: true },
  });

  const expected = BUSAN_CURRENT_LAWD_CODES.length * monthsToCheck.size;
  const coverage: CoverageState =
    cells.length === expected && cells.every((c) => c.status === 'COMPLETE' || c.status === 'EMPTY_VALID')
      ? 'VERIFIED'
      : 'UNVERIFIED';
  const dataAsOf = cells.length
    ? new Date(Math.max(...cells.map((c) => c.verifiedAt.getTime()))).toISOString()
    : null;

  const publicationState = resolvePublicationState({
    dateKst,
    todayKst: today,
    backfill,
    coverage,
    validBusanRows: validRowCount,
  });

  // §7 — 보류된 날은 행을 아예 읽지 않는다. 부분 집계가 금지돼 있어(§7) 읽어도 전량
  // 버려지고, 8/29처럼 18만 행이면 그 낭비가 곧 7~15초다.
  const publish = publicationState === 'READY' || publicationState === 'READY_ZERO';
  const valid =
    publish && validRowCount > 0 && agg?.valid_min && agg?.valid_max
      ? await prisma.apartmentTradeHistory.findMany({
          where: {
            createdAt: { gte: window.startUtc, lt: window.endUtcExclusive },
            // §4 부산 현행 16개만 / §5 취소 제외 — 필터를 DB에서 그대로 건다.
            lawdCd: { in: codes },
            dealCanceled: false,
            // 결과를 바꾸지 않는 경계다(위 집계에서 얻은 이 집합의 실제 min/max).
            // 오직 (lawd_cd, deal_date) 인덱스를 타게 해 풀스캔을 피하기 위한 것.
            // 실측(9/10): 풀스캔 대신 191ms.
            dealDate: { gte: agg.valid_min, lte: agg.valid_max },
          },
          select: SELECT,
        })
      : [];

  const rows: DailyTradeRow[] = valid.map((r) => ({
    aptSeq: r.aptSeq,
    lawdCd: r.lawdCd,
    dong: r.dong,
    aptName: r.aptName,
    exclusiveArea: toNumber(r.exclusiveArea),
    dealAmount: r.dealAmount,
    dealDate: ymd(r.dealDate),
    dealCanceled: r.dealCanceled,
    floor: r.floor,
    observedAt: r.createdAt.toISOString(),
  }));

  // master는 보강 전용(LEFT JOIN 원칙) — 없어도 행을 버리지 않는다.
  const aptSeqs = [...new Set(rows.map((r) => r.aptSeq).filter((s): s is string => !!s))];
  const masters = aptSeqs.length
    ? await prisma.apartmentMaster.findMany({
        where: { aptSeq: { in: aptSeqs } },
        select: { aptSeq: true, name: true },
      })
    : [];

  const envelope = buildDailyReport({
    window,
    rows,
    masters: masters
      .filter((m): m is typeof m & { aptSeq: string } => !!m.aptSeq)
      .map((m) => ({ aptSeq: m.aptSeq, name: m.name })),
    backfill,
    coverage,
    publicationState,
    rawObservedRows,
    outOfScopeRows: rawObservedRows - busanScopedRows,
    generatedAt: now.toISOString(),
    dataAsOf,
  });

  return {
    envelope,
    diagnostics: {
      rawObservedRows,
      busanScopedRows,
      validNonCanceledRows: validRowCount,
      outOfScopeRows: rawObservedRows - busanScopedRows,
      distinctDealYmd: summary.distinctDealYmd,
      minDealDate,
      maxDealDate: agg?.max_deal ? ymd(agg.max_deal) : null,
    },
  };
}
