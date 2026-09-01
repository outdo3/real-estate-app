import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { aptNamesMatch, normalizeAptName } from '@/lib/apt-name-match';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';
import { resolveDisplayedScoreVersion } from '@/lib/apartment-score/resolve-score-version';
import { getPeerContext } from '@/lib/apartment-score/peer-context';
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
        // BUSAN_DATA_UX_AUTOMATED_QA_V1 §L4/식별자 감사: lawdCd 없이 { name: aptName }만
        // 조회하면 위 §41 주석의 약속("이름만으로는 절대 다른 단지의 score를 반환하지
        // 않는다")과 달리 실제로는 타 지역 동명 단지를 집어올 수 있었다(실측: 대신롯데캐슬
        // 서울/부산 충돌). lawdCd가 이미 있을 때만 조회해 그 약속을 코드로 강제한다.
        const cached = lawdCd
          ? await prisma.apartment.findFirst({
              where: { name: aptName, lawdCd },
              select: { lawdCd: true, dong: true },
            })
          : null;
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

    // 실측 QA(서구 "구덕하이츠")에서 발견: aptNamesMatch는 부분포함도 매칭시켜(예:
    // "구덕" ⊂ "구덕하이츠") 짧은 이름의 다른 단지와 함께 걸려 정확한 이름이 있는데도
    // AMBIGUOUS로 떨어지는 문제가 있었다. 정확히 같은 이름(정규화 후 동일)이 하나라도
    // 있으면 그것만 채택하고, 없을 때만 aptNamesMatch의 느슨한 부분포함 규칙으로
    // 폴백한다 — 오매칭 허용폭을 넓히는 게 아니라 불필요한 AMBIGUOUS를 줄이는 방향이라
    // §41/§52 원칙(다른 단지 score 오반환 방지)과 상충하지 않는다.
    const exactMatches = candidates.filter((c) => normalizeAptName(c.name) === normalizeAptName(aptName));
    const matched = exactMatches.length > 0 ? exactMatches : candidates.filter((c) => aptNamesMatch(c.name, aptName));

    if (matched.length === 0) {
      return NextResponse.json(emptyResponse('NOT_FOUND'));
    }
    if (matched.length > 1) {
      // §41/§52: dong 없이 같은 이름이 여러 동에 걸쳐 있는 경우 등 — 잘못된 단지의
      // score를 주느니 안전하게 미확정으로 응답한다.
      return NextResponse.json(emptyResponse('AMBIGUOUS'));
    }

    const result = await calculateApartmentScore(matched[0].aptSeq!);
    const shadowV2 = (result as any)._shadowV2;

    // EJIP_SCORE_V2_PHASE2 — peer context는 V2가 실제로 표시 가능할 때만 계산한다
    // (identityEligible/coverage로 이미 NOT_ENOUGH_DATA면 절대점수 자체가 없어
    // 비교할 대상이 없음). 대상의 sigungu/buildYear/totalHouseholds는 score
    // 계산에 이미 쓰인 값과 동일한 것을 한 번만 추가 조회한다(peer마다 조회하는
    // 게 아니라 대상 1건뿐 — N+1 아님).
    let peerContext = null;
    if (shadowV2 && shadowV2.eligibility !== 'NOT_ENOUGH_DATA' && shadowV2.overallScore != null) {
      const targetMaster = await prisma.apartmentMaster.findUnique({
        where: { aptSeq: matched[0].aptSeq! },
        select: { sigungu: true, buildYear: true, totalHouseholds: true },
      });
      if (targetMaster) {
        peerContext = await getPeerContext({
          aptSeq: matched[0].aptSeq!,
          sigungu: targetMaster.sigungu,
          buildYear: targetMaster.buildYear,
          totalHouseholds: targetMaster.totalHouseholds,
          v2Score: Math.round(shadowV2.overallScore),
        });
      }
    }

    // LAUNCH_TRUST_BLOCKERS_V1 — ApartmentScoreCard는 _shadowV2가 있으면(거의 항상
    // 있음) V1의 score 대신 V2 엔진의 overallScore를 화면에 보여준다. scoreVersion을
    // 항상 V1의 SCORE_VERSION으로 응답하면 실제로 사용자에게 노출되는 엔진과 label이
    // 어긋난다 — 실제로 화면에 쓰이는 엔진의 버전을 그대로 보고한다(score formula 자체는
    // 변경하지 않음).
    return NextResponse.json({
      status: result.status,
      score: result.score,
      scoreVersion: resolveDisplayedScoreVersion(shadowV2?.scoreVersion, result.scoreVersion),
      coverage: result.coverage,
      confidence: result.confidence,
      categories: result.categories,
      regionalStrengths: result.regionalStrengths.map((r) => ({ type: r.type, level: r.level, label: r.label })),
      market: result.market,
      briefing: result.briefing,
      _shadowV2: shadowV2,
      peerContext,
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
    peerContext: null,
  };
}
