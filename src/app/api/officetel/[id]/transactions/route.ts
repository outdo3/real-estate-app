// OFFICETEL_V1 STEP 4A §4/§5/§8/§11 — 오피스텔 매매/전월세 실거래 READ.
//
// 한 엔드포인트가 `?type=sale|rent`로 두 계열을 모두 제공한다(불필요한 API 분화를 만들지
// 않는다는 §11 요구). V1은 **원시 거래 포인트**를 그대로 돌려준다 — 평균/중앙값을 계산해
// 정본처럼 제시하지 않는다(동일내용 형제 다중성 때문, §8).
//
// query:
//   type            'sale' | 'rent'            (기본 sale)
//   area            정확한 전용면적 ㎡          (예: 24.65 — 근사/구간 매칭 없음)
//   limit           1..500                      (기본 50)
//   offset          0..                         (페이지네이션)
//   includeCanceled 'true'이면 취소 거래 포함    (SALE 전용, 감사/디버그용. 기본 제외)
import { NextResponse } from 'next/server';
import { logServerError, buildErrorLogMessage } from '@/lib/log-server-error';
import { OfficetelQueryError, parseOfficetelIdRef, parseOfficetelTxQuery } from '@/lib/officetel/detail-contract';
import { getOfficetelTransactions } from '@/lib/officetel/detail-read';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ref = parseOfficetelIdRef(decodeURIComponent(id));

  if (ref.kind === 'invalid') {
    return NextResponse.json(
      { success: false, error: '오피스텔 식별자는 master id 또는 canonicalKey(OFFI:...)여야 합니다.' },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(request.url);
  let query;
  try {
    query = parseOfficetelTxQuery((k) => searchParams.get(k));
  } catch (e) {
    if (e instanceof OfficetelQueryError) return NextResponse.json({ success: false, error: e.message }, { status: 400 });
    throw e;
  }

  try {
    const data = await getOfficetelTransactions(ref, query);
    if (!data) {
      return NextResponse.json({ success: false, error: '오피스텔을 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Failed to fetch officetel transactions:', error);
    logServerError(
      buildErrorLogMessage('GET /api/officetel/[id]/transactions', error),
      '/api/officetel/[id]/transactions',
      (error as Error)?.stack
    ).catch(() => {});
    return NextResponse.json({ success: false, error: '오피스텔 실거래를 불러오지 못했습니다.' }, { status: 500 });
  }
}
