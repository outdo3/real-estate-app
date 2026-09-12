// COMPARE_V2_PHASE2 — the single fetch entry point per compared apartment. Exactly 2
// API calls, fired in parallel with zero dependency between them — see
// COMPARE_V2_ARCHITECTURE_AUDIT.md §21.
//
// SCORE_CANONICAL_APTSEQ_RESOLUTION_FIX_V1 — 점수 요청은 더 이상 "자기 aptSeq를 스스로
// 해소"하지 않는다. 이 자리에서 이미 확정된 canonical aptSeq를 그대로 넘긴다(아래 참고).
// 두 요청이 서로를 기다리지 않는 성질은 그대로다.
// No new API routes; both are the exact endpoints Detail already calls.
import { deriveCanonicalAptSeq } from '../apt-name-match';
import { resolveTradeReadState } from '../trade-read-state';
import type { CompareApartment, ComparableIdentity } from './types';
import { selectPriceMetric, buildFactMetrics, buildLocationMetrics, buildScore, domainEvidence } from './metrics';
import { isWellFormedAptSeq } from '@/lib/apartment-score/resolve-score-identity';

export interface CompareApartmentQuery {
  name: string;
  lawdCd: string;
  dong: string;
  incomingAptSeq?: string | null;
}

export async function fetchCompareApartment(query: CompareApartmentQuery): Promise<CompareApartment> {
  const { name, lawdCd, dong, incomingAptSeq } = query;

  const tradesParams = new URLSearchParams({ lawdCd, dong, type: 'apt', period: '36' });

  // SCORE_CANONICAL_APTSEQ_RESOLUTION_FIX_V1 §4/§9 — 점수도 canonical identity로 묻는다.
  //
  // 예전에는 점수만 (lawdCd + dong + 이름)으로 물었다. 비교 화면은 **이미 aptSeq로
  // 확정된 단지**를 보여주는데(공유 링크의 a/b를 resolveCompareSeeds가 ApartmentMaster
  // unique 키로 되살린다) 점수만 이름으로 되짚으면, 정규화 이름이 겹치는 단지에서
  // 화면의 단지와 점수의 단지가 갈라질 수 있다(실측 충돌: 26230-149 `대원아파트` vs
  // 26230-1810 `대원`). 상세 화면과 리포트는 이미 aptSeq로 묻는다 — 비교만 남아 있었다.
  //
  // 이 aptSeq를 신뢰하는 근거: 아래 trades 요청에 쓰는 name/lawdCd/dong이 바로 그
  // aptSeq의 master 행에서 나온 값이다(resolveCompareSeeds). 즉 같은 한 행에서 나온
  // 일관된 identity다. 해석되지 않는 aptSeq는 애초에 seed가 되지 않는다.
  //
  // trades에서 파생되는 canonicalAptSeq(deriveCanonicalAptSeq)를 쓰지 않는 이유:
  // 그 값은 trades 응답 이후에야 알 수 있어서, 쓰려면 두 요청을 직렬화해야 한다.
  // 비교 화면은 단지 두 곳을 동시에 부르므로 왕복이 두 배로 늘어난다(§12).
  const scoreParams = new URLSearchParams(
    incomingAptSeq && isWellFormedAptSeq(incomingAptSeq)
      ? { aptSeq: incomingAptSeq }
      : { lawdCd, dong }
  );

  const [tradesSettled, scoreSettled] = await Promise.allSettled([
    fetch(`/api/apt/${encodeURIComponent(name)}?${tradesParams.toString()}`).then((r) => r.json()),
    fetch(`/api/apt/${encodeURIComponent(name)}/score?${scoreParams.toString()}`).then((r) => r.json()),
  ]);

  const tradesJson = tradesSettled.status === 'fulfilled' ? tradesSettled.value : null;
  const scoreJson = scoreSettled.status === 'fulfilled' ? scoreSettled.value : null;
  // MOLIT_PARTIAL_TRUST_V2 §6 — 상세/차트/투자지표와 같은 공유 완전성 계약을 쓴다.
  // tradesSettled가 rejected면 responseOk=false로 들어가 apiError 상태가 된다.
  const tradeState = resolveTradeReadState<{ name: string; dong: string; aptSeq?: string | null; [k: string]: unknown }>(
    tradesSettled.status === 'fulfilled' && !!tradesJson,
    tradesJson
  );
  const trades = tradeState.trades;
  const tradesIncomplete = tradeState.partial || !!tradeState.apiError;

  const resolvedLawdCd: string = tradesJson?.lawdCd || lawdCd;
  const resolvedDong: string = trades[0]?.dong || tradesJson?.dong || dong;
  const displayName: string = trades[0]?.name || name;

  // 이미 name+dong 기준으로 검증된 trades에서만 canonical aptSeq를 뽑는다
  // (DECISION_JOURNEY_V1.1 deriveCanonicalAptSeq — 여기서 새로 만들지 않고 그대로 재사용).
  const canonicalAptSeq = deriveCanonicalAptSeq(trades as { aptSeq?: string | null }[], incomingAptSeq);
  const identity: ComparableIdentity = canonicalAptSeq
    ? { kind: 'aptSeq', aptSeq: canonicalAptSeq, lawdCd: resolvedLawdCd, dong: resolvedDong, name: displayName }
    : { kind: 'composite', lawdCd: resolvedLawdCd, dong: resolvedDong, name: displayName };

  const priceMetric = selectPriceMetric(trades as any, tradesIncomplete);
  const factMetrics = buildFactMetrics(domainEvidence(scoreJson, 'complex'));
  const locationMetrics = buildLocationMetrics(
    domainEvidence(scoreJson, 'transport'),
    domainEvidence(scoreJson, 'education'),
    domainEvidence(scoreJson, 'living')
  );
  const score = buildScore(scoreJson);

  return {
    identity,
    displayName,
    regionLabel: resolvedDong || null,
    metrics: [priceMetric, ...factMetrics, ...locationMetrics],
    score,
    loadError: !tradesJson && !scoreJson,
  };
}
