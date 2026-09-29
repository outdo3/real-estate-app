// REALTOR_PRO_MVP_V1 — 매칭 실행·저장·조회. 엔진 자체는 matching.ts(순수).
//
// Free: 고객 화면에서 수동 계산, 상위 3건만 보여준다. Pro: 전체 목록(자동 재계산 트리거는 Phase 2 — 여기서는 구조만).
// 매물의 공공 데이터(준공·좌표)는 aptSeq로만 조회한다 — 이름 재식별 없음. 요청당 aptSeq별 1회(메모).

import { capabilitiesFor } from './plan-limits';
import { evaluateMatch, rankMatches, type MatchListingInput, type MatchPreferenceInput, type MatchResult } from './matching';
import { fail, NOT_FOUND, ok, requireReader, type ProActor, type ProDeps, type ProResult } from './service-core';
import { MATCH_STATES, type MatchState } from './rules';
import type { ListingRow, MatchRow, PreferenceRow, PublicAptInfo } from './types';

export function toMatchListingInput(l: ListingRow, pub: PublicAptInfo | null): MatchListingInput {
  return {
    id: l.id,
    dealType: l.dealType,
    askingPriceManwon: l.askingPriceManwon,
    depositManwon: l.depositManwon,
    monthlyRentManwon: l.monthlyRentManwon,
    lawdCd: l.lawdCd,
    aptSeq: l.aptSeq,
    exclusiveAreaM2: l.exclusiveAreaM2,
    moveInAvailableAt: l.moveInAvailableAt,
    moveInNegotiable: l.moveInNegotiable,
    floor: l.floor,
    floorBand: l.floorBand,
    parkingAvailable: l.parkingAvailable,
    petAllowed: l.petAllowed,
    isActive: l.isActive,
    closedAt: l.closedAt,
    deletedAt: l.deletedAt,
    buildYear: pub?.buildYear ?? null,
    lat: pub?.lat ?? null,
    lng: pub?.lng ?? null,
  };
}

export function toMatchPreferenceInput(p: PreferenceRow): MatchPreferenceInput {
  return {
    id: p.id,
    dealTypes: p.dealTypes,
    budgetMinManwon: p.budgetMinManwon,
    budgetMaxManwon: p.budgetMaxManwon,
    budgetTolerancePct: p.budgetTolerancePct,
    monthlyRentMaxManwon: p.monthlyRentMaxManwon,
    lawdCds: p.lawdCds,
    aptSeqs: p.aptSeqs,
    areaMinM2: p.areaMinM2,
    areaMaxM2: p.areaMaxM2,
    moveInTargetAt: p.moveInTargetAt,
    commuteLabel: p.commuteLabel,
    commuteLat: p.commuteLat,
    commuteLng: p.commuteLng,
    schoolIds: p.schoolIds,
    preferNewBuild: p.preferNewBuild,
    parkingRequired: p.parkingRequired,
    floorPreference: p.floorPreference,
    petRequired: p.petRequired,
    mustHaveKeys: p.mustHaveKeys,
  };
}

async function publicMemo(deps: ProDeps) {
  const cache = new Map<string, PublicAptInfo | null>();
  return async (aptSeq: string | null) => {
    if (!aptSeq) return null;
    if (!cache.has(aptSeq)) cache.set(aptSeq, await deps.publicData.lookup(aptSeq)); // 순차(커넥션 1개 환경)
    return cache.get(aptSeq) ?? null;
  };
}

export interface CustomerMatchView {
  preferenceId: string;
  preferenceLabel: string;
  results: (MatchResult & { listing: { id: string; aptNameSnapshot: string; dealType: string; askingPriceManwon: number | null; depositManwon: number | null; monthlyRentManwon: number | null; exclusiveAreaM2: number | null }; matchId: string; state: MatchState })[];
  totalCandidates: number;
  truncatedTo: number | null;
}

/** 고객의 조건 세트별로 활성 매물 전체를 평가·저장하고 순위대로 돌려준다. */
export async function computeMatchesForCustomer(deps: ProDeps, actor: ProActor, customerId: string): Promise<ProResult<CustomerMatchView[]>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  if (!(await deps.repo.getCustomer(realtorId, customerId))) return NOT_FOUND();
  const prefs = await deps.repo.listPreferences(realtorId, customerId);
  const listings = await deps.repo.listListings(realtorId, { includeArchived: false });
  const pub = await publicMemo(deps);
  const now = deps.now();
  const topN = capabilitiesFor(ctx.data.plan).manualMatchTopN;
  const out: CustomerMatchView[] = [];
  for (const pref of prefs) {
    const results: MatchResult[] = [];
    for (const l of listings) results.push(evaluateMatch(toMatchListingInput(l, await pub(l.aptSeq)), toMatchPreferenceInput(pref), now));
    const ranked = rankMatches(results);
    const shown = topN == null ? ranked : ranked.filter((r) => r.passedHard).slice(0, topN);
    const rows: CustomerMatchView['results'] = [];
    for (const r of shown) {
      const saved = await persist(deps, realtorId, customerId, r, now, ctx.data.state === 'VERIFIED');
      const l = listings.find((x) => x.id === r.listingId)!;
      rows.push({ ...r, matchId: saved?.id ?? '', state: saved?.state ?? 'NEW', listing: { id: l.id, aptNameSnapshot: l.aptNameSnapshot, dealType: l.dealType, askingPriceManwon: l.askingPriceManwon, depositManwon: l.depositManwon, monthlyRentManwon: l.monthlyRentManwon, exclusiveAreaM2: l.exclusiveAreaM2 } });
    }
    out.push({ preferenceId: pref.id, preferenceLabel: pref.label, results: rows, totalCandidates: ranked.filter((r) => r.passedHard).length, truncatedTo: topN });
  }
  return ok(out);
}

/** 정지 계정은 계산 결과를 보여주되 저장하지 않는다(쓰기 거부). */
async function persist(deps: ProDeps, realtorId: string, customerId: string, r: MatchResult, now: Date, canWrite: boolean): Promise<MatchRow | null> {
  if (!canWrite) return null;
  return deps.repo.upsertMatch(realtorId, {
    customerId,
    preferenceId: r.preferenceId,
    listingId: r.listingId,
    score: r.score,
    confidence: r.confidence,
    passedHard: r.passedHard,
    reasons: [...r.exclusions, ...r.reasons],
    engineVersion: r.engineVersion,
    inputHash: r.inputHash,
    computedAt: now,
  });
}

/** 매물 → 맞는 고객(각 고객의 조건 세트 중 최고). */
export async function computeMatchesForListing(deps: ProDeps, actor: ProActor, listingId: string): Promise<ProResult<{ customerId: string; customerName: string; preferenceLabel: string; result: MatchResult }[]>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const listing = await deps.repo.getListing(realtorId, listingId);
  if (!listing) return NOT_FOUND();
  const pub = await publicMemo(deps);
  const li = toMatchListingInput(listing, await pub(listing.aptSeq));
  const prefs = await deps.repo.listAllPreferences(realtorId);
  const customers = await deps.repo.listCustomers(realtorId, { includeClosed: false });
  const now = deps.now();
  const best = new Map<string, { preferenceLabel: string; result: MatchResult }>();
  for (const p of prefs) {
    if (!customers.some((c) => c.id === p.customerId)) continue;
    const r = evaluateMatch(li, toMatchPreferenceInput(p), now);
    const cur = best.get(p.customerId);
    if (!cur || rankMatches([r, cur.result])[0] === r) best.set(p.customerId, { preferenceLabel: p.label, result: r });
  }
  const rows = [...best.entries()].map(([customerId, v]) => ({ customerId, customerName: customers.find((c) => c.id === customerId)!.name, ...v }));
  rows.sort((a, b) => rankMatches([a.result, b.result])[0] === a.result ? -1 : 1);
  const topN = capabilitiesFor(ctx.data.plan).manualMatchTopN;
  return ok(topN == null ? rows : rows.filter((r) => r.result.passedHard).slice(0, topN));
}

export async function setMatchState(deps: ProDeps, actor: ProActor, matchId: string, body: unknown): Promise<ProResult<MatchRow>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  if (ctx.data.state !== 'VERIFIED') return fail(403, 'SUSPENDED', '이용이 정지된 계정입니다.');
  const s = body && typeof body === 'object' ? (body as Record<string, unknown>).state : null;
  if (typeof s !== 'string' || !(MATCH_STATES as readonly string[]).includes(s)) return fail(400, 'INVALID_INPUT', '상태값을 확인해 주세요.');
  const row = await deps.repo.updateMatchState(ctx.data.profile.id, matchId, s as MatchState);
  return row ? ok(row) : NOT_FOUND();
}

export async function listShortlist(deps: ProDeps, actor: ProActor): Promise<ProResult<MatchRow[]>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const rows = await deps.repo.listMatches(ctx.data.profile.id, {});
  return ok(rows.filter((m) => m.passedHard && m.state !== 'DISMISSED').sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 100));
}
