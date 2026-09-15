import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { handleGetPreferences, handlePutPreferences } from '@/lib/preferences-handlers';
import { createPreferencesStore } from '@/lib/preferences-prisma-store';

// 사용자 선호 API — 관심 목적(purposes, MY-4) + 나에게 맞는 점수 중요도(fitImportance, PERSONALIZED_SCORE_V1 P2-A).
// userId는 항상 requireUser()가 반환한 세션 사용자에서만 가져온다.
// client body/query의 userId는 절대 신뢰하지 않는다. 판정은 src/lib/preferences-handlers.ts.
// 응답은 사용자별 데이터라 캐시하지 않는다.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const store = createPreferencesStore(prisma);

// 오류 원문(선호 값이 들어 있을 수 있음)은 로그에 남기지 않는다.
const log = (message: string, meta: { code: string }) => console.error(message, meta);

export async function GET() {
  const auth = await requireUser();
  const result = await handleGetPreferences(auth, store, log);
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}

export async function PUT(request: Request) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status, headers: NO_STORE });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400, headers: NO_STORE });
  }
  const result = await handlePutPreferences(auth, body, store, log);
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}
