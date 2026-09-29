// REALTOR_PRO_MVP_V1 — Prisma 저장소. **모든 비공개 쿼리의 where에 realtorId가 있다**(pro-security.test.ts가 소스로 고정).
//
// 단건 조회·수정도 findFirst/updateMany({ where: { id, realtorId } })로 한다 — id만으로 찾는 findUnique/update는 쓰지 않는다.
// migration 미적용(테이블 없음, P2021)은 ProStoreUnavailableError('NOT_MIGRATED')로 바꿔 화면이 "준비 중"을 보이게 한다.
// 커넥션 1개 환경: Promise.all 없이 순차 쿼리.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ProStoreUnavailableError, type ProRepo } from './repo';
import type {
  BriefingRow,
  BriefingSnapshot,
  CustomerRow,
  FollowupRow,
  ListingNoteRow,
  ListingRow,
  MatchReason,
  MatchRow,
  PreferenceRow,
  RealtorProfileRow,
  SubscriptionRow,
} from './types';

const dec = (v: Prisma.Decimal | null | undefined): number | null => (v == null ? null : Number(v));
const toDec = (v: number | null | undefined) => (v == null ? null : new Prisma.Decimal(v));

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2021' || e.code === 'P2022')) throw new ProStoreUnavailableError('NOT_MIGRATED');
    if (e instanceof Prisma.PrismaClientInitializationError) throw new ProStoreUnavailableError('DB_ERROR');
    throw e;
  }
}

const mapProfile = (r: any): RealtorProfileRow => ({ ...r });
const mapSub = (r: any): SubscriptionRow => ({ id: r.id, realtorId: r.realtorId, plan: r.plan, status: r.status, currentPeriodStart: r.currentPeriodStart, currentPeriodEnd: r.currentPeriodEnd, createdAt: r.createdAt, updatedAt: r.updatedAt });
const mapListing = (r: any): ListingRow => ({ ...r, exclusiveAreaM2: dec(r.exclusiveAreaM2) });
const mapCustomer = (r: any): CustomerRow => ({ ...r });
const mapPref = (r: any): PreferenceRow => ({ ...r, areaMinM2: dec(r.areaMinM2), areaMaxM2: dec(r.areaMaxM2) });
const mapMatch = (r: any): MatchRow => ({ ...r, reasons: (r.reasons ?? []) as MatchReason[] });
const mapBriefing = (r: any): BriefingRow => ({ ...r, snapshot: (r.snapshot ?? null) as BriefingSnapshot | null });
const mapNote = (r: any): ListingNoteRow => ({ ...r });
const mapFollowup = (r: any): FollowupRow => ({ ...r });

const listingData = (d: Partial<ListingRow>) => {
  const { exclusiveAreaM2, ...rest } = d;
  return exclusiveAreaM2 === undefined ? rest : { ...rest, exclusiveAreaM2: toDec(exclusiveAreaM2) };
};
const prefData = (d: Partial<PreferenceRow>) => {
  const { areaMinM2, areaMaxM2, ...rest } = d;
  return {
    ...rest,
    ...(areaMinM2 === undefined ? {} : { areaMinM2: toDec(areaMinM2) }),
    ...(areaMaxM2 === undefined ? {} : { areaMaxM2: toDec(areaMaxM2) }),
  };
};

export const prismaProRepo: ProRepo = {
  findProfileByUserId: (userId) => guard(async () => { const r = await prisma.realtorProfile.findUnique({ where: { userId } }); return r ? mapProfile(r) : null; }),
  createProfile: (data) => guard(async () => mapProfile(await prisma.realtorProfile.create({ data }))),
  updateProfile: (realtorId, data) =>
    guard(async () => {
      const { userId: _u, status: _s, ...rest } = data as Record<string, unknown>; // 이 경로로 소유자·상태를 바꾸지 않는다
      const n = await prisma.realtorProfile.updateMany({ where: { id: realtorId }, data: rest });
      if (n.count !== 1) return null;
      const r = await prisma.realtorProfile.findFirst({ where: { id: realtorId } });
      return r ? mapProfile(r) : null;
    }),
  adminListProfiles: (status) => guard(async () => (await prisma.realtorProfile.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 })).map(mapProfile)),
  adminGetProfile: (realtorId) => guard(async () => { const r = await prisma.realtorProfile.findFirst({ where: { id: realtorId } }); return r ? mapProfile(r) : null; }),
  adminSetProfileStatus: (realtorId, data) =>
    guard(async () => {
      const n = await prisma.realtorProfile.updateMany({ where: { id: realtorId }, data });
      if (n.count !== 1) return null;
      const r = await prisma.realtorProfile.findFirst({ where: { id: realtorId } });
      return r ? mapProfile(r) : null;
    }),

  listSubscriptions: (realtorId) => guard(async () => (await prisma.realtorSubscription.findMany({ where: { realtorId } })).map(mapSub)),
  createSubscription: (realtorId, data) => guard(async () => mapSub(await prisma.realtorSubscription.create({ data: { ...data, realtorId } }))),

  countActiveListings: (realtorId) => guard(() => prisma.realtorListing.count({ where: { realtorId, isActive: true, deletedAt: null } })),
  listListings: (realtorId, q = {}) =>
    guard(async () => {
      const s = q.search?.trim();
      const rows = await prisma.realtorListing.findMany({
        where: {
          realtorId,
          deletedAt: null,
          ...(q.includeArchived ? {} : { isActive: true }),
          ...(s ? { OR: [{ aptNameSnapshot: { contains: s, mode: 'insensitive' } }, { tags: { has: s } }] } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: 500,
      });
      return rows.map(mapListing);
    }),
  getListing: (realtorId, id) => guard(async () => { const r = await prisma.realtorListing.findFirst({ where: { id, realtorId, deletedAt: null } }); return r ? mapListing(r) : null; }),
  createListing: (realtorId, data) => guard(async () => mapListing(await prisma.realtorListing.create({ data: { ...(listingData(data) as Prisma.RealtorListingUncheckedCreateInput), realtorId } }))),
  updateListing: (realtorId, id, data) =>
    guard(async () => {
      const n = await prisma.realtorListing.updateMany({ where: { id, realtorId, deletedAt: null }, data: listingData(data) as Prisma.RealtorListingUpdateManyMutationInput });
      if (n.count !== 1) return null;
      const r = await prisma.realtorListing.findFirst({ where: { id, realtorId } });
      return r ? mapListing(r) : null;
    }),
  addListingNote: (realtorId, listingId, data) =>
    guard(async () => {
      const parent = await prisma.realtorListing.findFirst({ where: { id: listingId, realtorId, deletedAt: null }, select: { id: true } });
      if (!parent) return null;
      return mapNote(await prisma.realtorListingNote.create({ data: { ...data, realtorId, listingId } }));
    }),
  listListingNotes: (realtorId, listingId, limit) => guard(async () => (await prisma.realtorListingNote.findMany({ where: { realtorId, listingId }, orderBy: { createdAt: 'desc' }, take: limit })).map(mapNote)),

  countCustomers: (realtorId) => guard(() => prisma.realtorCustomer.count({ where: { realtorId, deletedAt: null } })),
  listCustomers: (realtorId, q = {}) =>
    guard(async () => {
      const s = q.search?.trim();
      const rows = await prisma.realtorCustomer.findMany({
        where: { realtorId, deletedAt: null, ...(q.includeClosed ? {} : { status: { not: 'CLOSED' } }), ...(s ? { name: { contains: s, mode: 'insensitive' } } : {}) },
        orderBy: [{ priority: 'asc' }, { nextFollowUpAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
        take: 1000,
      });
      return rows.map(mapCustomer);
    }),
  getCustomer: (realtorId, id) => guard(async () => { const r = await prisma.realtorCustomer.findFirst({ where: { id, realtorId, deletedAt: null } }); return r ? mapCustomer(r) : null; }),
  createCustomer: (realtorId, data) => guard(async () => mapCustomer(await prisma.realtorCustomer.create({ data: { ...data, realtorId } }))),
  updateCustomer: (realtorId, id, data) =>
    guard(async () => {
      const n = await prisma.realtorCustomer.updateMany({ where: { id, realtorId, deletedAt: null }, data });
      if (n.count !== 1) return null;
      const r = await prisma.realtorCustomer.findFirst({ where: { id, realtorId } });
      return r ? mapCustomer(r) : null;
    }),

  listPreferences: (realtorId, customerId) => guard(async () => (await prisma.realtorCustomerPreference.findMany({ where: { realtorId, customerId }, orderBy: { createdAt: 'asc' } })).map(mapPref)),
  listAllPreferences: (realtorId) =>
    guard(async () => (await prisma.realtorCustomerPreference.findMany({ where: { realtorId, customer: { realtorId, deletedAt: null } }, take: 2000 })).map(mapPref)),
  createPreference: (realtorId, customerId, data) =>
    guard(async () => {
      const parent = await prisma.realtorCustomer.findFirst({ where: { id: customerId, realtorId, deletedAt: null }, select: { id: true } });
      if (!parent) return null;
      return mapPref(await prisma.realtorCustomerPreference.create({ data: { ...(prefData(data) as Prisma.RealtorCustomerPreferenceUncheckedCreateInput), realtorId, customerId } }));
    }),
  updatePreference: (realtorId, id, data) =>
    guard(async () => {
      const n = await prisma.realtorCustomerPreference.updateMany({ where: { id, realtorId }, data: prefData(data) as Prisma.RealtorCustomerPreferenceUpdateManyMutationInput });
      if (n.count !== 1) return null;
      const r = await prisma.realtorCustomerPreference.findFirst({ where: { id, realtorId } });
      return r ? mapPref(r) : null;
    }),

  listFollowups: (realtorId, q = {}) =>
    guard(async () =>
      (
        await prisma.realtorFollowup.findMany({
          where: { realtorId, ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.listingId ? { listingId: q.listingId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.dueBefore ? { dueAt: { lt: q.dueBefore } } : {}) },
          orderBy: { dueAt: 'asc' },
          take: 1000,
        })
      ).map(mapFollowup)
    ),
  countOpenFollowups: (realtorId, customerId) => guard(() => prisma.realtorFollowup.count({ where: { realtorId, customerId, status: 'OPEN' } })),
  createFollowup: (realtorId, data) => guard(async () => mapFollowup(await prisma.realtorFollowup.create({ data: { ...data, realtorId } }))),
  updateFollowup: (realtorId, id, data) =>
    guard(async () => {
      const n = await prisma.realtorFollowup.updateMany({ where: { id, realtorId }, data });
      if (n.count !== 1) return null;
      const r = await prisma.realtorFollowup.findFirst({ where: { id, realtorId } });
      return r ? mapFollowup(r) : null;
    }),

  upsertMatch: (realtorId, data) =>
    guard(async () => {
      const existing = await prisma.realtorMatch.findFirst({ where: { realtorId, preferenceId: data.preferenceId, listingId: data.listingId } });
      const payload = { ...data, reasons: data.reasons as unknown as Prisma.InputJsonValue };
      if (existing) {
        await prisma.realtorMatch.updateMany({ where: { id: existing.id, realtorId }, data: { ...payload, ...(existing.inputHash !== data.inputHash ? { state: 'NEW' } : {}) } });
        const r = await prisma.realtorMatch.findFirst({ where: { id: existing.id, realtorId } });
        return mapMatch(r);
      }
      return mapMatch(await prisma.realtorMatch.create({ data: { ...payload, realtorId } }));
    }),
  listMatches: (realtorId, q) =>
    guard(async () => (await prisma.realtorMatch.findMany({ where: { realtorId, ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.listingId ? { listingId: q.listingId } : {}) }, take: 2000 })).map(mapMatch)),
  updateMatchState: (realtorId, id, state) =>
    guard(async () => {
      const n = await prisma.realtorMatch.updateMany({ where: { id, realtorId }, data: { state } });
      if (n.count !== 1) return null;
      return mapMatch(await prisma.realtorMatch.findFirst({ where: { id, realtorId } }));
    }),

  countBriefingsSince: (realtorId, since) => guard(() => prisma.realtorBriefing.count({ where: { realtorId, createdAt: { gte: since } } })),
  createBriefing: (realtorId, data) =>
    guard(async () => mapBriefing(await prisma.realtorBriefing.create({ data: { ...data, snapshot: (data.snapshot ?? Prisma.JsonNull) as unknown as Prisma.InputJsonValue, realtorId } }))),
  listBriefings: (realtorId) => guard(async () => (await prisma.realtorBriefing.findMany({ where: { realtorId }, orderBy: { createdAt: 'desc' }, take: 200 })).map(mapBriefing)),
  getBriefing: (realtorId, id) => guard(async () => { const r = await prisma.realtorBriefing.findFirst({ where: { id, realtorId } }); return r ? mapBriefing(r) : null; }),
  revokeBriefing: (realtorId, id, at) =>
    guard(async () => {
      await prisma.realtorBriefing.updateMany({ where: { id, realtorId, revokedAt: null }, data: { revokedAt: at } });
      const r = await prisma.realtorBriefing.findFirst({ where: { id, realtorId } });
      return r ? mapBriefing(r) : null;
    }),
  // 공개 뷰: 토큰 해시(unique)로 1건. 중개사 상태만 함께 읽는다(다른 프로필 필드는 읽지 않음).
  findBriefingByTokenHash: (tokenHash) =>
    guard(async () => {
      const r = await prisma.realtorBriefing.findUnique({ where: { tokenHash } });
      if (!r) return null;
      const p = await prisma.realtorProfile.findFirst({ where: { id: r.realtorId }, select: { status: true } });
      return p ? { briefing: mapBriefing(r), realtorStatus: p.status as RealtorProfileRow['status'] } : null;
    }),
  recordBriefingView: (briefingId, at) =>
    guard(async () => {
      await prisma.realtorBriefing.updateMany({ where: { id: briefingId }, data: { viewCount: { increment: 1 } } });
      await prisma.realtorBriefing.updateMany({ where: { id: briefingId, firstViewedAt: null }, data: { firstViewedAt: at } });
    }),

  appendAudit: (entry) => guard(async () => { await prisma.realtorAuditLog.create({ data: { ...entry, meta: (entry.meta ?? Prisma.JsonNull) as Prisma.InputJsonValue } }); }),
};
