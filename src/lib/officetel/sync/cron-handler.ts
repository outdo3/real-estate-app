// OFFICETEL_INCREMENTAL_SYNC_V1 — 오피스텔 cron route 3개가 공유하는 요청 처리.
//
// 아파트 cron과 같은 계약을 따른다(새 규칙을 만들지 않는다):
//   - 인증: `Authorization: Bearer $CRON_SECRET` (isAuthorizedCronRequest, secret 미설정이면 무조건 거부)
//   - 기본 mode는 dry-run — 쓰려면 `?mode=apply`를 명시해야 한다.
//   - 성공이 아닌 결과를 200으로 감추지 않는다(httpStatusForRun).
//   - 응답에는 요약만 담는다(셀별 상세는 로그).
import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '../../cron-auth';
import { httpStatusForRun, newRunId } from '../../sync/shared';
import { createPrismaOfficetelDb } from './db';
import { fetchOfficetelCell } from './molit-fetch';
import {
  INCREMENTAL_LOOKBACK_MONTHS,
  OFFICETEL_BUSAN_LAWD_CDS,
  RECHECK_MAX_MONTHS_BACK,
  RECHECK_MIN_MONTHS_BACK,
  incrementalMonths,
  recheckMonths,
} from './months';
import { OFFICETEL_RECHECK_BUDGET_MS, OFFICETEL_SYNC_BUDGET_MS, runOfficetelSync } from './run';
import type { OfficetelSyncDataset, OfficetelSyncMode } from './types';

export type OfficetelCronKind = 'sale-sync' | 'rent-sync' | 'sale-recheck';

export interface OfficetelCronPlanEntry {
  kind: OfficetelCronKind;
  path: string;
  /** vercel.json cron 표기(UTC). */
  schedule: string;
  dataset: OfficetelSyncDataset;
}

/**
 * 등록 계획. vercel.json에는 아직 넣지 않았다 — 마이그레이션 적용과 1회성 catch-up이 끝난 뒤에 넣는다
 * (docs/development/OFFICETEL_INCREMENTAL_SYNC_V1.md §Production 적용 순서).
 *
 * 시각 선택: 기존 아파트 cron이 UTC 19:00–20:00 · 21:00 · 23:00–00:00에 몰려 있다. 오피스텔은 KST 10:00대
 * (UTC 01:00대)에 둬서 겹치지 않는다. MOLIT 일일 한도를 같은 키로 나누므로 아파트 sync가 끝난 뒤가 안전하다.
 * Hobby는 cron을 ±59분 window 안에서 실행하므로 15분 간격은 순서 보장이 아니라 "겹침 최소화"일 뿐이다.
 */
export const OFFICETEL_CRON_PLAN: readonly OfficetelCronPlanEntry[] = [
  { kind: 'sale-sync', path: '/api/cron/officetel-sale-sync?mode=apply', schedule: '0 1 * * *', dataset: 'OFFICETEL_SALE' },
  { kind: 'rent-sync', path: '/api/cron/officetel-rent-sync?mode=apply', schedule: '15 1 * * *', dataset: 'OFFICETEL_RENT' },
  { kind: 'sale-recheck', path: '/api/cron/officetel-sale-recheck?mode=apply', schedule: '30 1 * * 0', dataset: 'OFFICETEL_SALE' },
];

export type ParsedCronParams =
  | { ok: true; mode: OfficetelSyncMode; lawdCds: string[]; months: string[] }
  | { ok: false; error: string };

const intParam = (v: string | null): number | null => {
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};

/** 순수 함수 — 요청 파라미터 검증. 허용 구 목록 밖의 값은 거부한다(임의 lawdCd로 MOLIT를 부르지 않는다). */
export function parseOfficetelCronParams(url: URL, kind: OfficetelCronKind, now: Date): ParsedCronParams {
  const mode: OfficetelSyncMode = url.searchParams.get('mode') === 'apply' ? 'apply' : 'dry-run';

  const lawdRaw = url.searchParams.get('lawdCd');
  let lawdCds: string[] = [...OFFICETEL_BUSAN_LAWD_CDS];
  if (lawdRaw) {
    const list = lawdRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length === 0 || list.some((c) => !OFFICETEL_BUSAN_LAWD_CDS.includes(c))) return { ok: false, error: 'invalid lawdCd' };
    lawdCds = list;
  }

  if (kind === 'sale-recheck') {
    const minBack = intParam(url.searchParams.get('minBack')) ?? RECHECK_MIN_MONTHS_BACK;
    const maxBack = intParam(url.searchParams.get('maxBack')) ?? RECHECK_MAX_MONTHS_BACK;
    if (!Number.isInteger(minBack) || !Number.isInteger(maxBack) || minBack < 1 || maxBack > 24 || minBack > maxBack) return { ok: false, error: 'invalid recheck band' };
    return { ok: true, mode, lawdCds, months: recheckMonths(now, minBack, maxBack) };
  }

  const lookback = intParam(url.searchParams.get('lookback')) ?? INCREMENTAL_LOOKBACK_MONTHS;
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > 3) return { ok: false, error: 'invalid lookback' };
  return { ok: true, mode, lawdCds, months: incrementalMonths(now, lookback) };
}

export async function handleOfficetelCron(request: Request, kind: OfficetelCronKind): Promise<Response> {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }
  const params = parseOfficetelCronParams(new URL(request.url), kind, new Date());
  if (!params.ok) return NextResponse.json({ success: false, error: params.error }, { status: 400 });

  const entry = OFFICETEL_CRON_PLAN.find((e) => e.kind === kind)!;
  const tag = `[cron/officetel-${kind}]`;
  const log = (line: string) => console.log(`${tag} ${line}`);

  try {
    // prisma는 호출 시점에 불러온다 — 인증/파라미터 거부 경로에서 DB 클라이언트를 만들지 않는다.
    const { prisma } = await import('../../prisma');
    const budgetMs = kind === 'sale-recheck' ? OFFICETEL_RECHECK_BUDGET_MS : OFFICETEL_SYNC_BUDGET_MS;
    const budgetStart = Date.now();
    const summary = await runOfficetelSync(
      {
        dataset: entry.dataset,
        mode: params.mode,
        lawdCds: params.lawdCds,
        months: params.months,
        runId: newRunId(`officetel-${kind}`),
        budgetMs,
      },
      {
        db: createPrismaOfficetelDb(prisma),
        // 요청 단위 deadline: run이 만든 TimeBudget이 아니라 같은 시작 시각 기준의 남은 시간을 넘긴다.
        fetchCell: (dataset, lawdCd, dealYmd) =>
          fetchOfficetelCell(dataset, lawdCd, dealYmd, { deadline: { remainingMs: () => budgetMs - (Date.now() - budgetStart) } }),
        log,
      }
    );
    return NextResponse.json(
      { success: summary.status === 'SUCCESS', ...summary, reports: undefined },
      { status: httpStatusForRun(summary.status) }
    );
  } catch (e) {
    console.error(`${tag} run failed`, e);
    return NextResponse.json({ success: false, status: 'FAILED', error: e instanceof Error ? e.message : 'unknown error' }, { status: 500 });
  }
}
