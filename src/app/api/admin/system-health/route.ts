import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth-helpers';
import {
  isHealthWindow,
  summarizeSystemHealth,
  windowStart,
  type HealthWindow,
} from '@/lib/admin/system-health';

export const dynamic = 'force-dynamic';

// ADMIN_SYSTEM_HEALTH_V1 — 관리자 운영 상태 요약.
//
// 이 라우트는 **읽기 전용**이다. ErrorLog를 조회하고 순수 함수(system-health.ts)로
// 접어서 돌려줄 뿐, 아무것도 쓰지 않고 MOLIT을 다시 호출하지도 않는다 — 관리자가
// 대시보드를 연다고 해서 외부 API 쿼터를 쓰거나 production 경로를 느리게 만들면
// 안 된다(§14).
//
// 상한을 두는 이유: "최근 7일 전체"는 사고가 난 날 수만 건이 될 수 있다. 무제한
// 조회는 관리자 화면 하나가 DB와 메모리를 통째로 먹는 길이라, 창(window)과 건수
// 상한을 **둘 다** 건다. 잘렸으면 잘렸다고 응답에 말한다 — 조용히 자르면 운영자가
// "그게 전부"라고 오해한다.
const MAX_ROWS = 500;

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.error) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const windowParam = searchParams.get('window');
  const window: HealthWindow = isHealthWindow(windowParam) ? windowParam : '24h';

  try {
    const now = new Date();
    const since = windowStart(window, now);

    // createdAt에 인덱스가 있다(@@index([createdAt])) — 창 조회가 full scan이 되지 않는다.
    // MAX_ROWS + 1을 가져와 "더 있는지"를 한 번의 쿼리로 안다(count 쿼리를 따로 치지 않는다).
    const rows = await prisma.errorLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS + 1,
      select: { id: true, source: true, message: true, url: true, createdAt: true },
    });

    const truncated = rows.length > MAX_ROWS;
    const summary = summarizeSystemHealth(rows.slice(0, MAX_ROWS));

    return NextResponse.json({
      success: true,
      data: {
        window,
        since: since.toISOString(),
        generatedAt: now.toISOString(),
        truncated,
        maxRows: MAX_ROWS,
        ...summary,
      },
    });
  } catch (error) {
    // 조회 실패를 "오류 없음"으로 표시하면 안 된다(§13). 실패는 실패로 돌려주고
    // 화면이 그것을 error 상태로 그린다. 메시지는 고정 문구다 — 예외 원문에
    // connection string이 섞여 나갈 수 있다.
    console.warn('[admin/system-health] query failed', (error as Error)?.name);
    return NextResponse.json(
      { success: false, error: '운영 상태를 불러오지 못했습니다.' },
      { status: 500 }
    );
  }
}
