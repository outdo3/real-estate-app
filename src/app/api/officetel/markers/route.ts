// OFFICETEL_MAP_LAYER_V1 §4 — 메인 지도 오피스텔 마커 READ 라우트(읽기 전용).
//
// 정적 세그먼트라 형제 동적 라우트(`/api/officetel/[id]`)보다 우선한다 — Next.js가
// `markers`를 id로 해석하는 일은 없다(parseOfficetelIdRef도 'markers'를 invalid로 거절).
//
// 응답 관례는 기존 오피스텔 라우트와 동일: { success, data } / { success:false, error }.
// 실패를 빈 배열로 위장하지 않는다(§14 FAILED != ZERO) — 500을 그대로 돌려준다.
import { NextResponse } from 'next/server';
import { logServerError, buildErrorLogMessage } from '@/lib/log-server-error';
import { OfficetelMarkerQueryError, parseOfficetelMarkerLawdCd } from '@/lib/officetel/map-marker-contract';
import { getOfficetelMarkersByLawdCd } from '@/lib/officetel/map-marker-read';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  let lawdCd: string;
  try {
    lawdCd = parseOfficetelMarkerLawdCd(searchParams.get('lawdCd'));
  } catch (error) {
    if (error instanceof OfficetelMarkerQueryError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    const data = await getOfficetelMarkersByLawdCd(lawdCd);
    return NextResponse.json(
      { success: true, data },
      {
        headers: {
          // master(좌표/이름/규모)는 배치 적재로만 바뀌는 준정적 데이터다. 실거래처럼
          // 자주 변하지 않으므로 CDN에서 재사용해 반복 이동 시 왕복을 줄인다(§19).
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
        },
      }
    );
  } catch (error) {
    console.error('Failed to fetch officetel markers:', error);
    logServerError(
      buildErrorLogMessage('GET /api/officetel/markers', error),
      '/api/officetel/markers',
      (error as Error)?.stack
    ).catch(() => {});
    return NextResponse.json({ success: false, error: '오피스텔 정보를 불러오지 못했습니다.' }, { status: 500 });
  }
}
