// REALTOR_PRO_MVP_V1 — 관리자: 신청 승인/반려/정지/재개(PATCH) + 베타 Pro 부여(POST). requireAdmin() 필수, 전부 감사로그.
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { adminGrantBetaPro, adminSetStatus } from '@/lib/pro/profile-service';
import { getProDeps, getProMode, jsonResult, readJsonBody, sameOriginOrReject } from '@/lib/pro/runtime';
import { ProStoreUnavailableError } from '@/lib/pro/repo';
import { summarizeErrorForLog } from '@/lib/pro/request-guards';

export const dynamic = 'force-dynamic';

async function guarded(request: Request, run: (deps: Awaited<ReturnType<typeof getProDeps>>, adminUserId: string, body: unknown) => Promise<NextResponse>) {
  const mode = getProMode();
  if (mode === 'OFF') return NextResponse.json({ success: false, code: 'PRO_DISABLED', error: '준비 중인 기능입니다.' }, { status: 404 });
  const blocked = sameOriginOrReject(request);
  if (blocked) return blocked;
  const admin = await requireAdmin();
  if (admin.error || !admin.user) return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  const adminUserId = (admin.user as { id?: string }).id;
  if (!adminUserId) return NextResponse.json({ success: false, error: '관리자 세션을 확인할 수 없습니다.' }, { status: 401 });
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  try {
    return await run(await getProDeps(mode), adminUserId, parsed.body);
  } catch (e) {
    if (e instanceof ProStoreUnavailableError) return NextResponse.json({ success: false, code: 'PRO_NOT_MIGRATED', error: '중개사 Pro 저장소가 아직 준비되지 않았습니다.' }, { status: 503 });
    console.error('[pro-admin] request failed:', summarizeErrorForLog(e));
    return NextResponse.json({ success: false, code: 'SERVER_ERROR', error: '처리하지 못했습니다.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded(request, async (deps, adminUserId, body) => jsonResult(await adminSetStatus(deps, { userId: adminUserId }, id, body)));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return guarded(request, async (deps, adminUserId, body) => {
    const days = body && typeof body === 'object' ? (body as Record<string, unknown>).betaDays : null;
    return jsonResult(await adminGrantBetaPro(deps, { userId: adminUserId }, id, typeof days === 'number' ? days : NaN));
  });
}
