// REALTOR_PRO_MVP_V1 — 브리핑 생성·목록·회수 + 공개 뷰. 카카오 API·자동 발송 없음(링크 복사만).
//
// 공유 링크의 토큰 원문은 **생성 응답에서 한 번만** 돌려준다(DB에는 SHA-256 해시). 목록에서 다시 볼 수 없다.
// 만료: Free 7일 고정, Pro 1~30일. 중개사가 정지되면 공개 뷰는 즉시 비활성.

import { capabilitiesFor, checkLimit, LIMIT_MESSAGES } from './plan-limits';
import { kstDayStart } from './access';
import {
  BRIEFING_TOKEN_PATTERN,
  buildBriefingSnapshot,
  evaluateBriefingAccess,
  findForbiddenSnapshotKeys,
  generateBriefingToken,
  hashBriefingToken,
  type BriefingAccess,
} from './briefing';
import { evaluateMatch } from './matching';
import { toMatchListingInput, toMatchPreferenceInput } from './match-service';
import { audit, fail, INVALID, NOT_FOUND, ok, requireReader, requireWriter, type ProActor, type ProDeps, type ProResult } from './service-core';
import type { BriefingRow, BriefingSnapshot } from './types';

export interface BriefingListItem {
  id: string;
  customerId: string | null;
  listingId: string | null;
  title: string;
  expiresAt: Date;
  revokedAt: Date | null;
  viewCount: number;
  firstViewedAt: Date | null;
  createdAt: Date;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

function toListItem(b: BriefingRow, now: Date): BriefingListItem {
  return {
    id: b.id,
    customerId: b.customerId,
    listingId: b.listingId,
    title: b.snapshot ? `${b.snapshot.customerLabel} · ${b.snapshot.apartment?.name ?? '매물'}` : '만료된 브리핑',
    expiresAt: b.expiresAt,
    revokedAt: b.revokedAt,
    viewCount: b.viewCount,
    firstViewedAt: b.firstViewedAt,
    createdAt: b.createdAt,
    status: b.revokedAt ? 'REVOKED' : b.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'ACTIVE',
  };
}

export async function createBriefing(
  deps: ProDeps,
  actor: ProActor,
  body: unknown
): Promise<ProResult<{ briefing: BriefingListItem; token: string; snapshot: BriefingSnapshot }>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const customerId = typeof b.customerId === 'string' ? b.customerId : null;
  const listingId = typeof b.listingId === 'string' ? b.listingId : null;
  if (!listingId) return INVALID([{ field: 'listingId', code: 'REQUIRED' }]);
  const realtorId = ctx.data.profile.id;
  const caps = capabilitiesFor(ctx.data.plan);

  const now = deps.now();
  const limit = checkLimit(ctx.data.plan, 'briefingsPerDay', await deps.repo.countBriefingsSince(realtorId, kstDayStart(now)));
  if (!limit.allowed) return fail(403, 'PLAN_LIMIT', LIMIT_MESSAGES.briefingsPerDay(limit.limit));

  const expiresInDays = typeof b.expiresInDays === 'number' ? b.expiresInDays : caps.briefingExpiryDays.default;
  if (!Number.isInteger(expiresInDays) || expiresInDays < caps.briefingExpiryDays.min || expiresInDays > caps.briefingExpiryDays.max) {
    return INVALID([{ field: 'expiresInDays', code: 'INVALID' }]);
  }

  const listing = await deps.repo.getListing(realtorId, listingId);
  if (!listing) return NOT_FOUND();
  const customer = customerId ? await deps.repo.getCustomer(realtorId, customerId) : null;
  if (customerId && !customer) return NOT_FOUND();

  const publicInfo = listing.aptSeq ? await deps.publicData.lookup(listing.aptSeq) : null;
  let match = null;
  if (customer) {
    const prefs = await deps.repo.listPreferences(realtorId, customer.id);
    const li = toMatchListingInput(listing, publicInfo);
    // 여러 조건 세트면 가장 잘 맞는 세트로 설명
    for (const p of prefs) {
      const r = evaluateMatch(li, toMatchPreferenceInput(p), now);
      if (!match || (r.passedHard && (!match.passedHard || (r.score ?? -1) > (match.score ?? -1)))) match = r;
    }
  }
  const snapshot = buildBriefingSnapshot({ customerName: customer?.name ?? null, listing, publicInfo, match, realtor: ctx.data.profile, now });
  const leaked = findForbiddenSnapshotKeys(snapshot);
  if (leaked.length) return fail(500, 'SNAPSHOT_GUARD', '브리핑을 만들지 못했습니다.'); // 설계 위반 방어 — 저장하지 않는다

  const token = generateBriefingToken();
  const row = await deps.repo.createBriefing(realtorId, {
    customerId: customer?.id ?? null,
    listingId: listing.id,
    aptSeq: listing.aptSeq,
    tokenHash: hashBriefingToken(token),
    snapshot,
    dataAsOf: new Date(snapshot.dataAsOf),
    expiresAt: new Date(now.getTime() + expiresInDays * 86_400_000),
  });
  await audit(deps, actor, realtorId, 'BRIEFING_CREATED', 'realtor_briefing', row.id, { expiresInDays });
  return ok({ briefing: toListItem(row, now), token, snapshot });
}

export async function listBriefings(deps: ProDeps, actor: ProActor): Promise<ProResult<BriefingListItem[]>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const now = deps.now();
  return ok((await deps.repo.listBriefings(ctx.data.profile.id)).map((b) => toListItem(b, now)));
}

export async function getBriefingForOwner(deps: ProDeps, actor: ProActor, id: string): Promise<ProResult<{ item: BriefingListItem; snapshot: BriefingSnapshot | null }>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const row = await deps.repo.getBriefing(ctx.data.profile.id, id);
  if (!row) return NOT_FOUND();
  return ok({ item: toListItem(row, deps.now()), snapshot: row.snapshot });
}

export async function revokeBriefing(deps: ProDeps, actor: ProActor, id: string): Promise<ProResult<BriefingListItem>> {
  // 정지 계정도 회수는 허용(공유 중단은 보호 조치) — 읽기 권한으로 충분
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const now = deps.now();
  const row = await deps.repo.revokeBriefing(ctx.data.profile.id, id, now);
  if (!row) return NOT_FOUND();
  await audit(deps, actor, ctx.data.profile.id, 'BRIEFING_REVOKED', 'realtor_briefing', id);
  return ok(toListItem(row, now));
}

/** 공개 뷰(로그인 불필요). 형식이 틀린 토큰은 저장소를 조회하지 않고 NOT_FOUND. */
export async function viewBriefingByToken(
  deps: Pick<ProDeps, 'repo' | 'now'>,
  token: string,
  opts: { countView: boolean }
): Promise<{ access: BriefingAccess; snapshot: BriefingSnapshot | null }> {
  if (!BRIEFING_TOKEN_PATTERN.test(token)) return { access: 'NOT_FOUND', snapshot: null };
  const found = await deps.repo.findBriefingByTokenHash(hashBriefingToken(token));
  const now = deps.now();
  const access = evaluateBriefingAccess(found, now);
  if (access !== 'OK' || !found) return { access, snapshot: null };
  if (opts.countView) await deps.repo.recordBriefingView(found.briefing.id, now);
  return { access, snapshot: found.briefing.snapshot };
}
