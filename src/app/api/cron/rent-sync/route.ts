import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5 — sale-sync/route.ts와 동일한 안전 설계.
// CRON_SECRET 미설정 상태(이번 STEP은 환경변수를 추가하지 않는다) → 어떤 요청도
// 인증을 통과할 수 없어, 실수로 호출돼도 apply가 절대 발생하지 않는다. 실제 sync
// 엔진(scripts/rent-trade-history/incremental-sync-completed-month.ts) 연결과
// coverage manifest 기록(shouldRecordCoverageCell, scripts/rent-trade-history/
// rent-coverage-writer-logic.ts — 이번 STEP에서 이미 순수 로직으로 구현·테스트됨)은
// Phase 2 activation에서 이 자리에 실제로 연결한다.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const expectedSecret = process.env.CRON_SECRET;

  if (!isAuthorizedCronRequest(authHeader, expectedSecret)) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json(
    {
      success: false,
      error: 'NOT_WIRED',
      note: 'Cron auth gate is live and tested; the actual rent incremental sync engine invocation and coverage-manifest write are Phase 2 activation scope and are not yet wired into this route.',
    },
    { status: 501 }
  );
}
