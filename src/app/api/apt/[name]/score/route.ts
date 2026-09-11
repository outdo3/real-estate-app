import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveScoreIdentity } from '@/lib/apartment-score/resolve-score-identity';
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
    // SCORE_CANONICAL_APTSEQ_RESOLUTION_FIX_V1 — canonical identity. 있으면 이름/법정동을
    // 거치지 않고 바로 그 단지로 간다(resolveScoreIdentity 참고).
    const aptSeqParam = searchParams.get('aptSeq');

    // §41: lawdCd/dong 없이 이름만으로는 절대 다른 단지의 score를 반환하지 않는다.
    // 기존 route.ts와 같은 관례로 Apartment 캐시에서만 보강 시도(지오코딩 추정은 하지 않음
    // — score identity는 실거래 목록 조회보다 오매칭 허용 폭이 좁아야 한다, §52).
    // canonical aptSeq가 있으면 이 보강 자체가 불필요하다 — 지역을 좁히려는 조회인데
    // 대상이 이미 한 건으로 확정돼 있다.
    if (!aptSeqParam && (!lawdCd || !dong)) {
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

    // §41/§52 — 어느 단지인지 확정하는 규칙은 전부 resolveScoreIdentity 한 곳에 있다.
    // 확정하지 못하면 잘못된 단지의 score를 주느니 미확정으로 응답한다.
    const identity = await resolveScoreIdentity(prisma, { aptSeqParam, aptName, lawdCd, dong });
    if (identity.kind !== 'RESOLVED') {
      return NextResponse.json(emptyResponse(identity.kind));
    }
    const resolvedAptSeq = identity.aptSeq;

    const result = await calculateApartmentScore(resolvedAptSeq);
    const shadowV2 = (result as any)._shadowV2;

    // EJIP_SCORE_V2_PHASE2 — peer context는 V2가 실제로 표시 가능할 때만 계산한다
    // (identityEligible/coverage로 이미 NOT_ENOUGH_DATA면 절대점수 자체가 없어
    // 비교할 대상이 없음). 대상의 sigungu/buildYear/totalHouseholds는 score
    // 계산에 이미 쓰인 값과 동일한 것을 한 번만 추가 조회한다(peer마다 조회하는
    // 게 아니라 대상 1건뿐 — N+1 아님).
    let peerContext = null;
    if (shadowV2 && shadowV2.eligibility !== 'NOT_ENOUGH_DATA' && shadowV2.overallScore != null) {
      const targetMaster = await prisma.apartmentMaster.findUnique({
        where: { aptSeq: resolvedAptSeq },
        select: { sigungu: true, buildYear: true, totalHouseholds: true },
      });
      if (targetMaster) {
        peerContext = await getPeerContext({
          aptSeq: resolvedAptSeq,
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
