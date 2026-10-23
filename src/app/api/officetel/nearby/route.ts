// OFFICETEL_NEARBY_V1 — GET /api/officetel/nearby?lat=&lng=&radiusKm=&limit=&months=&area=&areaTolerance=&kinds=
//
// 좌표 주변의 오피스텔과 그 실거래(매매/전월세)를 읽기 전용으로 돌려준다. 새 API이며 기존 공개 API는 바꾸지 않는다.
// 공개 API가 아니다: OFFICETEL_NEARBY_API_KEY가 있으면 `x-api-key`가 필요하고, 없으면 Production에서는 닫혀 있다(checkNearbyAccess).
// 응답 구조와 원칙은 src/lib/officetel/nearby-contract.ts 상단 주석을 본다.
import { NextResponse } from 'next/server';
import { logServerError, buildErrorLogMessage } from '@/lib/log-server-error';
import { OfficetelNearbyQueryError, checkNearbyAccess, parseOfficetelNearbyQuery } from '@/lib/officetel/nearby-contract';
import { getNearbyOfficetels } from '@/lib/officetel/nearby-read';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const access = checkNearbyAccess({
    configuredKey: process.env.OFFICETEL_NEARBY_API_KEY,
    providedKey: request.headers.get('x-api-key'),
    nodeEnv: process.env.NODE_ENV,
  });
  if (!access.allowed) {
    return NextResponse.json({ success: false, error: access.reason }, { status: access.status, headers: { 'Cache-Control': 'no-store' } });
  }

  const { searchParams } = new URL(request.url);
  let query;
  try {
    query = parseOfficetelNearbyQuery((k) => searchParams.get(k));
  } catch (e) {
    if (e instanceof OfficetelNearbyQueryError) return NextResponse.json({ success: false, error: e.message }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    throw e;
  }

  try {
    const data = await getNearbyOfficetels(query);
    // 성공 응답만 짧게 캐시한다. 실패를 캐시하면 FAILED가 "성공한 빈 결과"로 굳는다.
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    console.error('Failed to fetch nearby officetels:', error);
    logServerError(buildErrorLogMessage('GET /api/officetel/nearby', error), '/api/officetel/nearby', (error as Error)?.stack).catch(() => {});
    return NextResponse.json({ success: false, error: '주변 오피스텔 정보를 불러오지 못했습니다.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
