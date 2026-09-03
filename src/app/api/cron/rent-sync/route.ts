import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { runRentSync } from '@/lib/sync/rent-sync-core';
import { httpStatusForRun, type SyncMode } from '@/lib/sync/shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §4/§6/§13/§18/§19 — 실제 sync core에 연결됐다.
// sale-sync/route.ts와 동일한 3중 안전 상태(CRON_SECRET 미설정 / cron 미등록 / mode 기본
// dry-run)이며, "first production rent sync apply"는 아직 승인되지 않았다.
//
// §13 RENT FIRST MUTATION GUARD — 기존 rent row의 내용 변경 후보가 발견되면 core가 자동으로
// UPDATE하지 않고 needsReview로 보고하며, run status는 NEEDS_REVIEW가 된다(§19에 따라 2xx
// 성공으로 보이지 않는다). 해당 셀은 coverage에 기록되지 않아 검증범위도 전진하지 않는다.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!isAuthorizedCronRequest(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const mode: SyncMode = url.searchParams.get('mode') === 'apply' ? 'apply' : 'dry-run';
  const overlapRaw = url.searchParams.get('overlapMonths');
  const overlapMonths = overlapRaw ? Number(overlapRaw) : undefined;

  const log = (line: string) => console.log(`[cron/rent-sync] ${line}`);

  try {
    const summary = await runRentSync({ mode, overlapMonths }, log);
    return NextResponse.json(
      {
        success: summary.status === 'SUCCESS',
        ...summary,
        reports: undefined,
        cellStatusCounts: summary.reports.reduce<Record<string, number>>((a, r) => {
          a[r.status] = (a[r.status] ?? 0) + 1;
          return a;
        }, {}),
      },
      { status: httpStatusForRun(summary.status) }
    );
  } catch (e) {
    console.error('[cron/rent-sync] run failed', e);
    return NextResponse.json({ success: false, status: 'FAILED', error: e instanceof Error ? e.message : 'unknown error' }, { status: 500 });
  }
}
