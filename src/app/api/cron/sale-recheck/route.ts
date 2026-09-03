import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { runSaleRecheckSweep } from '@/lib/sync/sale-recheck-core';
import { httpStatusForRun, type SyncMode } from '@/lib/sync/shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// SALE_CANCELLATION_COVERAGE_V1 §4/§6/§7 — late cancellation recheck sweep.
//
// daily sale-sync(/api/cron/sale-sync)의 3개월 overlap이 놓치는 4~12개월 구간을 별도
// 예산으로 훑는다. sale-sync는 **전혀 건드리지 않는다** — 최신 3개월 동기화가 이 sweep
// 때문에 느려지거나 잘릴 수 없다는 것이 이 분리의 목적이다.
//
// 안전 게이트(sale-sync와 동일):
//   1. CRON_SECRET fail-closed — 미설정이면 무조건 401.
//   2. mode 기본값 dry-run — apply는 `?mode=apply`를 명시해야만 한다.
//   3. write는 sale-sync-core.syncOneSaleCell을 그대로 재사용하므로 승인된 정책
//      (INSERT: aptSeq 있는 신규만 / UPDATE: cancellation false→true only / true→false 차단)
//      을 벗어날 수 없다.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!isAuthorizedCronRequest(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const mode: SyncMode = url.searchParams.get('mode') === 'apply' ? 'apply' : 'dry-run';
  const maxCellsRaw = url.searchParams.get('maxCells');
  const maxCells = maxCellsRaw ? Number(maxCellsRaw) : undefined;
  const budgetMsRaw = url.searchParams.get('budgetMs');
  const budgetMs = budgetMsRaw ? Number(budgetMsRaw) : undefined;

  const log = (line: string) => console.log(`[cron/sale-recheck] ${line}`);

  try {
    const summary = await runSaleRecheckSweep(
      {
        mode,
        maxCells: Number.isFinite(maxCells) && maxCells! > 0 ? maxCells : undefined,
        budgetMs: Number.isFinite(budgetMs) && budgetMs! > 0 ? budgetMs : undefined,
      },
      log
    );
    return NextResponse.json(
      {
        success: summary.status === 'SUCCESS',
        ...summary,
        // 셀별 상세는 로그에만 남긴다(응답 비대화 방지).
        reports: undefined,
        cellStatusCounts: summary.reports.reduce<Record<string, number>>((a, r) => {
          a[r.status] = (a[r.status] ?? 0) + 1;
          return a;
        }, {}),
      },
      { status: httpStatusForRun(summary.status) }
    );
  } catch (e) {
    console.error('[cron/sale-recheck] run failed', e);
    return NextResponse.json({ success: false, status: 'FAILED', error: e instanceof Error ? e.message : 'unknown error' }, { status: 500 });
  }
}
