import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';
import { runSaleSync } from '@/lib/sync/sale-sync-core';
import { httpStatusForRun, type SyncMode } from '@/lib/sync/shared';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §3/§6/§18/§19 — 실제 sync core에 연결됐다.
//
// 안전 상태(현재):
//   1. CRON_SECRET이 Production에 아직 설정되지 않아 인증 게이트를 통과할 수 없다
//      (fail-closed — isAuthorizedCronRequest는 secret 미설정 시 무조건 거부).
//   2. vercel.json에 cron이 등록돼 있지 않다.
//   3. mode 기본값이 dry-run이다 — apply는 `?mode=apply`를 명시해야만 한다.
// 위 셋 중 하나만 있어도 우발적 Production write는 발생하지 않는다. "first production sale
// sync apply"와 "cron registration"은 아직 승인되지 않았으므로 이 STEP에서 실행하지 않는다.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (!isAuthorizedCronRequest(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  // §5 DRY-RUN/APPLY CONTRACT — 명시적으로 apply라고 하지 않으면 절대 쓰지 않는다.
  const mode: SyncMode = url.searchParams.get('mode') === 'apply' ? 'apply' : 'dry-run';
  const districtOffset = Number(url.searchParams.get('districtOffset') ?? '0') || 0;
  const districtLimitRaw = url.searchParams.get('districtLimit');
  const districtLimit = districtLimitRaw ? Number(districtLimitRaw) : undefined;

  // §20 OBSERVABILITY — Vercel logs에 남긴다. secret/개인정보는 절대 남기지 않는다.
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    console.log(`[cron/sale-sync] ${line}`);
  };

  try {
    const summary = await runSaleSync({ mode, districtOffset, districtLimit }, log);
    return NextResponse.json(
      {
        success: summary.status === 'SUCCESS',
        ...summary,
        // 셀별 상세는 로그에 남기고 응답에서는 요약만 반환한다(응답 비대화 방지).
        reports: undefined,
        cellStatusCounts: summary.reports.reduce<Record<string, number>>((a, r) => {
          a[r.status] = (a[r.status] ?? 0) + 1;
          return a;
        }, {}),
      },
      { status: httpStatusForRun(summary.status) }
    );
  } catch (e) {
    console.error('[cron/sale-sync] run failed', e);
    return NextResponse.json({ success: false, status: 'FAILED', error: e instanceof Error ? e.message : 'unknown error' }, { status: 500 });
  }
}
