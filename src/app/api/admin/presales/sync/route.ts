import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { syncApplyhomeListings, SyncOptions } from '@/services/cheongyakService';

export const dynamic = 'force-dynamic';

// 관리자 전용 분양정보(청약홈) 수동 동기화. 일반 사용자는 requireAdmin()에서 차단된다.
//
// 이번 STEP(P2-C)에서는 자동 스케줄러(cron)를 구현하지 않는다 — 이 API는 관리자가 대시보드
// 버튼으로 직접 호출하는 수동 트리거만 제공한다. limit은 cheongyakService.ts의
// MAX_SYNC_LIMIT(200)으로 서버 측에서 강제 클램프되어, 요청 body에 아무리 큰 값을 넣어도
// 한 번의 호출로 전체(2,800여 건)를 무제한 수집할 수 없다.
export async function POST(request: Request) {
  const { error, status } = await requireAdmin();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const body = await request.json().catch(() => ({}));
    const options: SyncOptions = {
      mode: body.mode === 'initial' ? 'initial' : 'incremental',
      fromDate: typeof body.fromDate === 'string' && body.fromDate ? body.fromDate : undefined,
      toDate: typeof body.toDate === 'string' && body.toDate ? body.toDate : undefined,
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      dryRun: body.dryRun === true,
    };

    const result = await syncApplyhomeListings(options);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error('Presale 수동 동기화 실패:', error);
    return NextResponse.json({ success: false, error: '분양정보 동기화 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
