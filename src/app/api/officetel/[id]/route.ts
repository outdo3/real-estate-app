// OFFICETEL_V1 STEP 4A §11 — 오피스텔 상세 master READ.
//
// 응답 형태와 에러 처리는 기존 id 기반 상세 라우트(/api/presales/[id]) 관례를 그대로 따른다:
// { success: true, data } / { success: false, error } + 400·404·500.
//
// identity는 **정확한 것만** 받는다(§2): 숫자 master id 또는 `OFFI:`로 시작하는 canonicalKey.
// 이름/부분일치/같은 동 첫 결과 같은 느슨한 해석 경로는 만들지 않는다 — 못 찾으면 404다.
import { NextResponse } from 'next/server';
import { logServerError, buildErrorLogMessage } from '@/lib/log-server-error';
import { parseOfficetelIdRef } from '@/lib/officetel/detail-contract';
import { getOfficetelDetail } from '@/lib/officetel/detail-read';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ref = parseOfficetelIdRef(decodeURIComponent(id));

  if (ref.kind === 'invalid') {
    return NextResponse.json(
      { success: false, error: '오피스텔 식별자는 master id 또는 canonicalKey(OFFI:...)여야 합니다.' },
      { status: 400 }
    );
  }

  try {
    const data = await getOfficetelDetail(ref);
    if (!data) {
      // 잘못된 데이터보다 NO DATA가 낫다 — 다른 오피스텔로 폴백하지 않는다(§2/§10).
      return NextResponse.json({ success: false, error: '오피스텔을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Failed to fetch officetel detail:', error);
    logServerError(buildErrorLogMessage('GET /api/officetel/[id]', error), '/api/officetel/[id]', (error as Error)?.stack).catch(() => {});
    return NextResponse.json({ success: false, error: '오피스텔 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
