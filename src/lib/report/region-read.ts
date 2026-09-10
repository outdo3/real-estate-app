// REPORT ENGINE REPORT-1 — 지역 리포트의 **읽기 전용** 데이터 레이어.
//
// 이 파일만 Prisma를 만진다. 템플릿/컴포넌트는 절대 raw 테이블을 직접 조회하지 않는다(§5).
// 여기서 하는 일은 딱 두 가지다: (1) 스코프·취소 규칙을 쿼리에도 걸고, (2) 평평한 행을
// region-report.ts에 넘긴다. 집계 규칙 자체는 순수 모듈이 갖는다.
//
// 쓰기는 없다. SELECT만 한다.

import { prisma } from '@/lib/prisma';
import {
  BUSAN_CURRENT_LAWD_CODES,
  isBusanCurrentLawdCd,
  normalizeDong,
  resolveScopeLawdCds,
} from './region-scope';
import type { MasterEnrichment, TradeRow } from './region-aggregate';
import { buildRegionReport, type RegionLevel, type RegionReportInput } from './region-report';
import type { ReportEnvelope, ReportPeriod } from './types';

export interface RegionReadOptions {
  level: RegionLevel;
  lawdCd?: string | null;
  dong?: string | null;
  /** 포함 시작일 YYYY-MM-DD */
  start: string;
  /** 포함 종료일 YYYY-MM-DD */
  end: string;
  periodLabel?: string;
  /** 테스트 결정론을 위해 주입 가능. 기본은 현재 시각. */
  now?: Date;
}

function toDate(ymd: string): Date {
  // YYYY-MM-DD를 UTC 자정으로 고정한다(로컬 타임존에 따라 하루가 밀리지 않게).
  return new Date(`${ymd}T00:00:00.000Z`);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDays(ymdStr: string, days: number): string {
  const d = toDate(ymdStr);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

/** dealDate(@db.Date)를 YYYY-MM-DD 문자열로. Date/문자열 양쪽을 받아준다. */
function dealDateToYmd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** Decimal | number | string 어느 쪽으로 와도 숫자로. 실패하면 0(면적 무효로 취급). */
function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === 'function') {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface RawTrade {
  aptSeq: string | null;
  lawdCd: string;
  dong: string;
  aptName: string;
  exclusiveArea: unknown;
  dealAmount: number;
  dealDate: Date | string;
  dealCanceled: boolean;
  floor: number | null;
}

function mapRows(rows: RawTrade[]): TradeRow[] {
  return rows.map((r) => ({
    aptSeq: r.aptSeq,
    lawdCd: r.lawdCd,
    dong: r.dong,
    aptName: r.aptName,
    exclusiveArea: toNumber(r.exclusiveArea),
    dealAmount: r.dealAmount,
    dealDate: dealDateToYmd(r.dealDate),
    dealCanceled: r.dealCanceled,
    floor: r.floor,
  }));
}

/** 스코프에 맞는 where 절. 취소 제외는 여기서도 건다(순수 레이어와 이중 방어). */
function whereFor(level: RegionLevel, lawdCd: string | null, dong: string | null, start: string, end: string) {
  const lawdCdFilter =
    level === 'CITY'
      ? { in: [...BUSAN_CURRENT_LAWD_CODES] }
      : { equals: lawdCd! };
  return {
    // §4 — 27110/11680은 구조적으로 들어올 수 없다.
    lawdCd: lawdCdFilter,
    ...(level === 'DONG' && dong ? { dong } : {}),
    dealDate: { gte: toDate(start), lte: toDate(end) },
    // §7 — 취소건 제외.
    dealCanceled: false,
  };
}

const TRADE_SELECT = {
  aptSeq: true,
  lawdCd: true,
  dong: true,
  aptName: true,
  exclusiveArea: true,
  dealAmount: true,
  dealDate: true,
  dealCanceled: true,
  floor: true,
} as const;

/**
 * 지역 리포트를 읽어 envelope로 돌려준다. **읽기 전용.**
 * 스코프가 유효하지 않으면 조용히 걸러내지 않고 throw한다 — 분모가 말없이 달라지는 것을 막는다.
 */
export async function readRegionReport(opts: RegionReadOptions): Promise<ReportEnvelope> {
  const { level, start, end } = opts;
  const lawdCd = opts.lawdCd ?? null;
  const dong = normalizeDong(opts.dong);

  if (level !== 'CITY') {
    if (!lawdCd || !isBusanCurrentLawdCd(lawdCd)) {
      throw new Error(`REPORT_SCOPE_INVALID: ${lawdCd ?? '(none)'} 은 부산 현행 16개 자치구·군이 아닙니다.`);
    }
  }
  if (level === 'DONG' && !dong) {
    throw new Error('REPORT_SCOPE_INVALID: 동 리포트에는 dong이 필요합니다.');
  }
  const scope = resolveScopeLawdCds(level === 'CITY' ? null : [lawdCd!]);
  if (!scope.ok) throw new Error(`REPORT_SCOPE_INVALID: ${scope.reason} (${scope.rejected.join(',')})`);

  const now = opts.now ?? new Date();
  const spanDays = Math.max(1, Math.round((toDate(end).getTime() - toDate(start).getTime()) / 86400000) + 1);
  const prevEnd = shiftDays(start, -1);
  const prevStart = shiftDays(prevEnd, -(spanDays - 1));
  const yearStart = shiftDays(end, -364);
  const twoYearStart = shiftDays(end, -729);

  const [rows, previousRows, twoYearRows, trailingYearCount] = await Promise.all([
    prisma.apartmentTradeHistory.findMany({ where: whereFor(level, lawdCd, dong, start, end), select: TRADE_SELECT }),
    prisma.apartmentTradeHistory.findMany({ where: whereFor(level, lawdCd, dong, prevStart, prevEnd), select: TRADE_SELECT }),
    prisma.apartmentTradeHistory.findMany({ where: whereFor(level, lawdCd, dong, twoYearStart, end), select: TRADE_SELECT }),
    prisma.apartmentTradeHistory.count({ where: whereFor(level, lawdCd, dong, yearStart, end) }),
  ]);

  const mapped = mapRows(rows as RawTrade[]);

  // §8 — master는 **보강 전용**이다. 여기서 따로 조회해 aptSeq로 붙이고, 없으면 없는 대로 둔다.
  // (INNER JOIN을 쓰면 부산 거래의 약 4.7%가 조용히 사라진다 — PRECHECK 실측 40,292건.)
  const aptSeqs = [...new Set(mapped.map((r) => r.aptSeq).filter((s): s is string => !!s))];
  const masterRows = aptSeqs.length
    ? await prisma.apartmentMaster.findMany({
        where: { aptSeq: { in: aptSeqs } },
        select: { aptSeq: true, name: true, roadAddress: true, totalHouseholds: true, buildYear: true },
      })
    : [];
  const masters: MasterEnrichment[] = masterRows
    .filter((m): m is typeof m & { aptSeq: string } => !!m.aptSeq)
    .map((m) => ({
      aptSeq: m.aptSeq,
      name: m.name ?? null,
      roadAddress: m.roadAddress ?? null,
      totalHouseholds: m.totalHouseholds ?? null,
      buildYear: m.buildYear ?? null,
    }));

  // §12 — 커버리지/신선도. sync_coverage_cells는 (dataset,lawdCd,dealYmd) upsert라
  // "그날 검증됐는가"를 사후 재구성할 수 없다. 그래서 **지금 이 스코프가 검증된 상태인가**만 본다.
  const months = monthsBetween(start, end);
  const scopeCodes = level === 'CITY' ? [...BUSAN_CURRENT_LAWD_CODES] : [lawdCd!];
  const cells = await prisma.syncCoverageCell.findMany({
    where: { dataset: 'SALE', lawdCd: { in: scopeCodes }, dealYmd: { in: months } },
    select: { status: true, verifiedAt: true },
  });
  const expected = scopeCodes.length * months.length;
  const complete = cells.length === expected && cells.every((c) => c.status === 'COMPLETE' || c.status === 'EMPTY_VALID');
  const dataAsOf = cells.length
    ? new Date(Math.max(...cells.map((c) => c.verifiedAt.getTime()))).toISOString()
    : null;

  const period: ReportPeriod = { start, end, label: opts.periodLabel ?? `${start} ~ ${end}` };
  const input: RegionReportInput = {
    level,
    lawdCd,
    dong,
    rows: mapped,
    previousRows: mapRows(previousRows as RawTrade[]),
    twoYearRows: mapRows(twoYearRows as RawTrade[]),
    trailingYearCount,
    masters,
    period,
    generatedAt: now.toISOString(),
    dataAsOf,
    coverageComplete: complete,
  };
  return buildRegionReport(input);
}

/** start~end 사이의 YYYYMM 목록(양끝 포함). */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const s = toDate(start);
  const e = toDate(end);
  const cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1));
  while (cur <= e) {
    out.push(`${cur.getUTCFullYear()}${String(cur.getUTCMonth() + 1).padStart(2, '0')}`);
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}
