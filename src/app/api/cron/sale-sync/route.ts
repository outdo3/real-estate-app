import { NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5 §21/§22/§23 — Cron route "준비"만 한다.
// 실제 Vercel Cron 등록(vercel.json의 crons 배열)은 이번 STEP에서 하지 않는다(§0 STOP
// 조건). CRON_SECRET도 이번 STEP에서 Vercel 환경에 추가하지 않는다(환경변수 mutation
// 금지) — 그 결과 아래 인증 게이트는 지금 이 순간 어떤 요청도 통과시킬 수 없다.
// 실수로 이 라우트가 프로덕션에서 호출돼도 절대 apply가 발생하지 않는, 설계상 안전한
// 상태다. 인증 게이트 로직 자체는 src/lib/cron-auth.ts의 순수 함수로 분리해 실제
// 단위 테스트로 검증했다(no secret/wrong secret/correct secret 전부).
//
// 실제 sync 엔진(scripts/incremental-sync-nationwide.ts) 호출 연결은 의도적으로
// 아직 하지 않는다 — 그 엔진은 dotenv 로드 + CLI argv 파싱 + process.exit를 전제로
// 짜인 스크립트 구조라, Next.js Function으로 안전하게 옮기는 작업 자체가 Phase 2
// activation의 실제 구현 범위다(가짜 성공 응답을 만드는 대신 정직하게 NOT_WIRED를
// 반환한다 — §2 절대 원칙: "실패한 sync를 성공으로 기록 금지").
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
      note: 'Cron auth gate is live and tested; the actual sale incremental sync engine invocation is Phase 2 activation scope and is not yet wired into this route.',
    },
    { status: 501 }
  );
}
