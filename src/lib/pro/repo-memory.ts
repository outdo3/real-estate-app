// REALTOR_PRO_MVP_V1 — 메모리 저장소(테스트 · 로컬 데모 전용). DB·네트워크 없음.
// 소유권 규칙은 Prisma 구현과 **같다**: realtorId가 다르면 없음으로 취급한다. 반환값은 복사본(호출자가 저장 상태를 못 바꿈).

import { randomBytes } from 'node:crypto';
import type { FollowupQuery, CustomerQuery, ListingQuery, ProfileWrite, ProRepo } from './repo';
import type {
  AuditRow,
  BriefingRow,
  CustomerRow,
  FollowupRow,
  ListingNoteRow,
  ListingRow,
  MatchRow,
  PreferenceRow,
  RealtorProfileRow,
  SubscriptionRow,
} from './types';

const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString('base64url')}`;
const clone = <T>(v: T): T => structuredClone(v);

export interface MemoryState {
  profiles: RealtorProfileRow[];
  subscriptions: SubscriptionRow[];
  listings: ListingRow[];
  notes: ListingNoteRow[];
  customers: CustomerRow[];
  preferences: PreferenceRow[];
  followups: FollowupRow[];
  matches: MatchRow[];
  briefings: BriefingRow[];
  audits: AuditRow[];
}

export function emptyMemoryState(): MemoryState {
  return { profiles: [], subscriptions: [], listings: [], notes: [], customers: [], preferences: [], followups: [], matches: [], briefings: [], audits: [] };
}

export function createMemoryProRepo(state: MemoryState = emptyMemoryState(), clock: () => Date = () => new Date()): ProRepo & { state: MemoryState } {
  const own = <T extends { realtorId: string }>(rows: T[], realtorId: string) => rows.filter((r) => r.realtorId === realtorId);

  const repo: ProRepo & { state: MemoryState } = {
    state,

    async findProfileByUserId(userId) {
      const p = state.profiles.find((x) => x.userId === userId);
      return p ? clone(p) : null;
    },
    async createProfile(data: ProfileWrite) {
      if (state.profiles.some((x) => x.userId === data.userId)) throw new Error('UNIQUE_USER_ID');
      const now = clock();
      const row: RealtorProfileRow = { ...clone(data), id: newId('rp'), createdAt: now, updatedAt: now };
      state.profiles.push(row);
      return clone(row);
    },
    async updateProfile(realtorId, data) {
      const p = state.profiles.find((x) => x.id === realtorId);
      if (!p) return null;
      // userId·status는 이 경로로 바꾸지 않는다(서비스도 넘기지 않지만 저장소에서 한 번 더 막는다)
      const { userId: _u, status: _s, ...rest } = data as Partial<ProfileWrite>;
      Object.assign(p, clone(rest), { updatedAt: clock() });
      return clone(p);
    },
    async adminListProfiles(status) {
      return clone(state.profiles.filter((p) => !status || p.status === status).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    },
    async adminGetProfile(realtorId) {
      const p = state.profiles.find((x) => x.id === realtorId);
      return p ? clone(p) : null;
    },
    async adminSetProfileStatus(realtorId, data) {
      const p = state.profiles.find((x) => x.id === realtorId);
      if (!p) return null;
      Object.assign(p, clone(data), { updatedAt: clock() });
      return clone(p);
    },

    async listSubscriptions(realtorId) {
      return clone(own(state.subscriptions, realtorId));
    },
    async createSubscription(realtorId, data) {
      const now = clock();
      const row: SubscriptionRow = { ...clone(data), id: newId('rs'), realtorId, createdAt: now, updatedAt: now };
      state.subscriptions.push(row);
      return clone(row);
    },

    async countActiveListings(realtorId) {
      return own(state.listings, realtorId).filter((l) => l.isActive && !l.deletedAt).length;
    },
    async listListings(realtorId, q: ListingQuery = {}) {
      const s = q.search?.trim().toLowerCase();
      return clone(
        own(state.listings, realtorId)
          .filter((l) => !l.deletedAt && (q.includeArchived || l.isActive))
          .filter((l) => !s || l.aptNameSnapshot.toLowerCase().includes(s) || l.tags.some((t) => t.toLowerCase().includes(s)))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      );
    },
    async getListing(realtorId, id) {
      const l = state.listings.find((x) => x.id === id && x.realtorId === realtorId && !x.deletedAt);
      return l ? clone(l) : null;
    },
    async createListing(realtorId, data) {
      const now = clock();
      const row: ListingRow = { ...clone(data), id: newId('rl'), realtorId, createdAt: now, updatedAt: now };
      state.listings.push(row);
      return clone(row);
    },
    async updateListing(realtorId, id, data) {
      const l = state.listings.find((x) => x.id === id && x.realtorId === realtorId && !x.deletedAt);
      if (!l) return null;
      Object.assign(l, clone(data), { updatedAt: clock() });
      return clone(l);
    },
    async addListingNote(realtorId, listingId, data) {
      const l = state.listings.find((x) => x.id === listingId && x.realtorId === realtorId && !x.deletedAt);
      if (!l) return null;
      const row: ListingNoteRow = { ...clone(data), id: newId('rn'), realtorId, listingId, createdAt: clock() };
      state.notes.push(row);
      return clone(row);
    },
    async listListingNotes(realtorId, listingId, limit) {
      return clone(own(state.notes, realtorId).filter((n) => n.listingId === listingId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit));
    },

    async countCustomers(realtorId) {
      return own(state.customers, realtorId).filter((c) => !c.deletedAt).length;
    },
    async listCustomers(realtorId, q: CustomerQuery = {}) {
      const s = q.search?.trim().toLowerCase();
      return clone(
        own(state.customers, realtorId)
          .filter((c) => !c.deletedAt && (q.includeClosed || c.status !== 'CLOSED'))
          .filter((c) => !s || c.name.toLowerCase().includes(s))
          .sort((a, b) => a.priority - b.priority || (a.nextFollowUpAt?.getTime() ?? Infinity) - (b.nextFollowUpAt?.getTime() ?? Infinity) || b.updatedAt.getTime() - a.updatedAt.getTime())
      );
    },
    async getCustomer(realtorId, id) {
      const c = state.customers.find((x) => x.id === id && x.realtorId === realtorId && !x.deletedAt);
      return c ? clone(c) : null;
    },
    async createCustomer(realtorId, data) {
      const now = clock();
      const row: CustomerRow = { ...clone(data), id: newId('rc'), realtorId, createdAt: now, updatedAt: now };
      state.customers.push(row);
      return clone(row);
    },
    async updateCustomer(realtorId, id, data) {
      const c = state.customers.find((x) => x.id === id && x.realtorId === realtorId && !x.deletedAt);
      if (!c) return null;
      Object.assign(c, clone(data), { updatedAt: clock() });
      return clone(c);
    },

    async listPreferences(realtorId, customerId) {
      return clone(own(state.preferences, realtorId).filter((p) => p.customerId === customerId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()));
    },
    async listAllPreferences(realtorId) {
      const live = new Set(own(state.customers, realtorId).filter((c) => !c.deletedAt).map((c) => c.id));
      return clone(own(state.preferences, realtorId).filter((p) => live.has(p.customerId)));
    },
    async createPreference(realtorId, customerId, data) {
      const c = state.customers.find((x) => x.id === customerId && x.realtorId === realtorId && !x.deletedAt);
      if (!c) return null;
      const now = clock();
      const row: PreferenceRow = { ...clone(data), id: newId('rpf'), realtorId, customerId, createdAt: now, updatedAt: now };
      state.preferences.push(row);
      return clone(row);
    },
    async updatePreference(realtorId, id, data) {
      const p = state.preferences.find((x) => x.id === id && x.realtorId === realtorId);
      if (!p) return null;
      Object.assign(p, clone(data), { updatedAt: clock() });
      return clone(p);
    },

    async listFollowups(realtorId, q: FollowupQuery = {}) {
      return clone(
        own(state.followups, realtorId)
          .filter((f) => (!q.customerId || f.customerId === q.customerId) && (!q.listingId || f.listingId === q.listingId) && (!q.status || f.status === q.status) && (!q.dueBefore || f.dueAt.getTime() < q.dueBefore.getTime()))
          .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      );
    },
    async countOpenFollowups(realtorId, customerId) {
      return own(state.followups, realtorId).filter((f) => f.customerId === customerId && f.status === 'OPEN').length;
    },
    async createFollowup(realtorId, data) {
      const now = clock();
      const row: FollowupRow = { ...clone(data), id: newId('rf'), realtorId, createdAt: now, updatedAt: now };
      state.followups.push(row);
      return clone(row);
    },
    async updateFollowup(realtorId, id, data) {
      const f = state.followups.find((x) => x.id === id && x.realtorId === realtorId);
      if (!f) return null;
      Object.assign(f, clone(data), { updatedAt: clock() });
      return clone(f);
    },

    async upsertMatch(realtorId, data) {
      const existing = state.matches.find((m) => m.realtorId === realtorId && m.preferenceId === data.preferenceId && m.listingId === data.listingId);
      if (existing) {
        const changed = existing.inputHash !== data.inputHash;
        Object.assign(existing, clone(data), changed ? { state: 'NEW' } : {});
        return clone(existing);
      }
      const row: MatchRow = { ...clone(data), id: newId('rm'), realtorId, state: 'NEW' };
      state.matches.push(row);
      return clone(row);
    },
    async listMatches(realtorId, q) {
      return clone(own(state.matches, realtorId).filter((m) => (!q.customerId || m.customerId === q.customerId) && (!q.listingId || m.listingId === q.listingId)));
    },
    async updateMatchState(realtorId, id, s) {
      const m = state.matches.find((x) => x.id === id && x.realtorId === realtorId);
      if (!m) return null;
      m.state = s;
      return clone(m);
    },

    async countBriefingsSince(realtorId, since) {
      return own(state.briefings, realtorId).filter((b) => b.createdAt.getTime() >= since.getTime()).length;
    },
    async createBriefing(realtorId, data) {
      const row: BriefingRow = { ...clone(data), id: newId('rb'), realtorId, createdAt: clock(), viewCount: 0, firstViewedAt: null, revokedAt: null };
      state.briefings.push(row);
      return clone(row);
    },
    async listBriefings(realtorId) {
      return clone(own(state.briefings, realtorId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    },
    async getBriefing(realtorId, id) {
      const b = state.briefings.find((x) => x.id === id && x.realtorId === realtorId);
      return b ? clone(b) : null;
    },
    async revokeBriefing(realtorId, id, at) {
      const b = state.briefings.find((x) => x.id === id && x.realtorId === realtorId);
      if (!b) return null;
      if (!b.revokedAt) b.revokedAt = at;
      return clone(b);
    },
    async findBriefingByTokenHash(tokenHash) {
      const b = state.briefings.find((x) => x.tokenHash === tokenHash);
      if (!b) return null;
      const p = state.profiles.find((x) => x.id === b.realtorId);
      return p ? { briefing: clone(b), realtorStatus: p.status } : null;
    },
    async recordBriefingView(briefingId, at) {
      const b = state.briefings.find((x) => x.id === briefingId);
      if (!b) return;
      b.viewCount += 1;
      if (!b.firstViewedAt) b.firstViewedAt = at;
    },

    async appendAudit(entry) {
      state.audits.push({ ...clone(entry), id: newId('ra'), createdAt: clock() });
    },
  };
  return repo;
}
