// COMPARE_V2_PHASE2 — the single fetch entry point per compared apartment. Exactly 2
// API calls, fired in parallel with zero dependency between them (score resolves its own
// aptSeq independently of the trades call) — see COMPARE_V2_ARCHITECTURE_AUDIT.md §21.
// No new API routes; both are the exact endpoints Detail already calls.
import { deriveCanonicalAptSeq } from '../apt-name-match';
import type { CompareApartment, ComparableIdentity } from './types';
import { selectPriceMetric, buildFactMetrics, buildLocationMetrics, buildScore, domainEvidence } from './metrics';

export interface CompareApartmentQuery {
  name: string;
  lawdCd: string;
  dong: string;
  incomingAptSeq?: string | null;
}

export async function fetchCompareApartment(query: CompareApartmentQuery): Promise<CompareApartment> {
  const { name, lawdCd, dong, incomingAptSeq } = query;

  const tradesParams = new URLSearchParams({ lawdCd, dong, type: 'apt', period: '36' });
  const scoreParams = new URLSearchParams({ lawdCd, dong });

  const [tradesSettled, scoreSettled] = await Promise.allSettled([
    fetch(`/api/apt/${encodeURIComponent(name)}?${tradesParams.toString()}`).then((r) => r.json()),
    fetch(`/api/apt/${encodeURIComponent(name)}/score?${scoreParams.toString()}`).then((r) => r.json()),
  ]);

  const tradesJson = tradesSettled.status === 'fulfilled' ? tradesSettled.value : null;
  const scoreJson = scoreSettled.status === 'fulfilled' ? scoreSettled.value : null;
  const trades: Array<{ name: string; dong: string; aptSeq?: string | null; [k: string]: unknown }> =
    Array.isArray(tradesJson?.trades) ? tradesJson.trades : [];

  const resolvedLawdCd: string = tradesJson?.lawdCd || lawdCd;
  const resolvedDong: string = trades[0]?.dong || tradesJson?.dong || dong;
  const displayName: string = trades[0]?.name || name;

  // 이미 name+dong 기준으로 검증된 trades에서만 canonical aptSeq를 뽑는다
  // (DECISION_JOURNEY_V1.1 deriveCanonicalAptSeq — 여기서 새로 만들지 않고 그대로 재사용).
  const canonicalAptSeq = deriveCanonicalAptSeq(trades as { aptSeq?: string | null }[], incomingAptSeq);
  const identity: ComparableIdentity = canonicalAptSeq
    ? { kind: 'aptSeq', aptSeq: canonicalAptSeq, lawdCd: resolvedLawdCd, dong: resolvedDong, name: displayName }
    : { kind: 'composite', lawdCd: resolvedLawdCd, dong: resolvedDong, name: displayName };

  const priceMetric = selectPriceMetric(trades as any);
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
