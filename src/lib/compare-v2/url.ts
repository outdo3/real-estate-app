// COMPARE_V2_PHASE2 — URL state. `aptSeq=A,B` is the canonical, shareable identity marker
// (per task's explicit ask), but restoring a share link still needs name+lawdCd+dong to
// call the existing name-keyed API routes (no aptSeq-lookup route exists and building one
// is out of this phase's "no new API" scope) — so each slot's display identity travels
// alongside as companion params. The restored aptSeq is never trusted blindly: fetch.ts's
// deriveCanonicalAptSeq() only adopts it if the freshly-fetched trades independently confirm
// it, exactly like DECISION_JOURNEY_V1.1's Detail-page pattern.
export interface CompareSlotSeed {
  name: string;
  lawdCd: string;
  dong: string;
  aptSeq?: string;
}

export function buildCompareUrl(a: CompareSlotSeed, b?: CompareSlotSeed): string {
  const qs = new URLSearchParams();
  const seqs = [a.aptSeq, b?.aptSeq].filter(Boolean) as string[];
  if (seqs.length > 0) qs.set('aptSeq', seqs.join(','));
  qs.set('aName', a.name);
  qs.set('aLawdCd', a.lawdCd);
  qs.set('aDong', a.dong);
  if (b) {
    qs.set('bName', b.name);
    qs.set('bLawdCd', b.lawdCd);
    qs.set('bDong', b.dong);
  }
  return `/stats/compare?${qs.toString()}`;
}

export function parseCompareUrl(searchParams: URLSearchParams): { a?: CompareSlotSeed; b?: CompareSlotSeed } {
  const seqs = (searchParams.get('aptSeq') || '').split(',').filter(Boolean);
  const aName = searchParams.get('aName');
  const bName = searchParams.get('bName');

  const a: CompareSlotSeed | undefined = aName
    ? {
        name: aName,
        lawdCd: searchParams.get('aLawdCd') || '',
        dong: searchParams.get('aDong') || '',
        aptSeq: seqs[0] || undefined,
      }
    : undefined;

  const b: CompareSlotSeed | undefined = bName
    ? {
        name: bName,
        lawdCd: searchParams.get('bLawdCd') || '',
        dong: searchParams.get('bDong') || '',
        aptSeq: seqs[1] || undefined,
      }
    : undefined;

  return { a, b };
}
