// REALTOR_PRO_MVP_V1 — 관리자: 중개사 신청 목록(수동 심사). requireAdmin() 필수.
// 관리자 화면은 신청 정보(표시 이름·사무소·상태)만 본다 — 매물·고객 데이터를 여는 경로는 없다(break-glass 미구현).
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { adminListApplications } from '@/lib/pro/profile-service';
import { getProDeps, getProMode, jsonResult } from '@/lib/pro/runtime';
import { ProStoreUnavailableError } from '@/lib/pro/repo';
import { PROFILE_STATUSES, type ProfileStatus } from '@/lib/pro/rules';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const mode = getProMode();
  if (mode === 'OFF') return NextResponse.json({ success: false, code: 'PRO_DISABLED', error: '준비 중인 기능입니다.' }, { status: 404 });
  const admin = await requireAdmin();
  if (admin.error) return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  const s = new URL(request.url).searchParams.get('status');
  const status = s && (PROFILE_STATUSES as readonly string[]).includes(s) ? (s as ProfileStatus) : null;
  try {
    return jsonResult(await adminListApplications(await getProDeps(mode), status));
  } catch (e) {
    if (e instanceof ProStoreUnavailableError) return NextResponse.json({ success: false, code: 'PRO_NOT_MIGRATED', error: '중개사 Pro 저장소가 아직 준비되지 않았습니다.' }, { status: 503 });
    throw e;
  }
}
