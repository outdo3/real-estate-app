import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { aptNamesMatch } from '@/lib/apt-name-match';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';
import { logServerError } from '@/lib/log-server-error';

export const dynamic = 'force-dynamic';

// STEP SCORE S2C — §41/§42. weights/raw percentiles/peer rules/raw feature cache/
// normalization formula를 절대 응답에 넣지 않는다(FinalScoreResult.categories는
// ExplainedCategory[]라 애초에 그 필드들을 가지고 있지 않음 — RegionalStrength는 내부
// raw percentile 필드를 하나 더 들고 있어 아래에서 type/level/label만 명시적으로 골라낸다).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const aptName = decodeURIComponent(name);
    const { searchParams } = new URL(request.url);

    let lawdCd = searchParams.get('lawdCd') || '';
    let dong = searchParams.get('dong') || '';

    // §41: lawdCd/dong 없이 이름만으로는 절대 다른 단지의 score를 반환하지 않는다.
    // 기존 route.ts와 같은 관례로 Apartment 캐시에서만 보강 시도(지오코딩 추정은 하지 않음
    // — score identity는 실거래 목록 조회보다 오매칭 허용 폭이 좁아야 한다, §52).
    if (!lawdCd || !dong) {
      try {
        const cached = await prisma.apartment.findFirst({
          where: lawdCd ? { name: aptName, lawdCd } : { name: aptName },
          select: { lawdCd: true, dong: true },
        });
        if (!lawdCd && cached?.lawdCd) lawdCd = cached.lawdCd;
        if (!dong && cached?.dong) dong = cached.dong;
      } catch {
        // DB 미설정 등 — 아래에서 lawdCd 없음으로 자연스럽게 AMBIGUOUS 처리됨
      }
    }

    if (!lawdCd) {
      return NextResponse.json(emptyResponse('AMBIGUOUS'));
    }

    const candidates = await prisma.apartmentMaster.findMany({
      where: {
        sggCd: lawdCd,
        aptSeq: { not: null },
        ...(dong ? { umdName: dong } : {}),
      },
      select: { aptSeq: true, name: true },
    });

    const matched = candidates.filter((c) => aptNamesMatch(c.name, aptName));

    if (matched.length === 0) {
      return NextResponse.json(emptyResponse('NOT_FOUND'));
    }
    if (matched.length > 1) {
      // §41/§52: dong 없이 같은 이름이 여러 동에 걸쳐 있는 경우 등 — 잘못된 단지의
      // score를 주느니 안전하게 미확정으로 응답한다.
      return NextResponse.json(emptyResponse('AMBIGUOUS'));
    }

    const result = await calculateApartmentScore(matched[0].aptSeq!);

    return NextResponse.json({
      status: result.status,
      score: result.score,
      scoreVersion: result.scoreVersion,
      coverage: result.coverage,
      confidence: result.confidence,
      categories: result.categories,
      regionalStrengths: result.regionalStrengths.map((r) => ({ type: r.type, level: r.level, label: r.label })),
      market: result.market,
      briefing: result.briefing,
    });
  } catch (error) {
    logServerError((error as Error)?.message || 'apt score route error', '/api/apt/[name]/score', (error as Error)?.stack).catch(() => {});
    // §43: 데이터 부족/오류를 사용자 오류(404/500)로 취급하지 않는다.
    return NextResponse.json(emptyResponse('INSUFFICIENT_DATA'));
  }
}

function emptyResponse(status: 'NOT_FOUND' | 'AMBIGUOUS' | 'INSUFFICIENT_DATA') {
  return {
    status,
    score: null,
    scoreVersion: null,
    coverage: null,
    confidence: null,
    categories: [],
    regionalStrengths: [],
    market: null,
    briefing: null,
  };
}
