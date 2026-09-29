// REALTOR_PRO_MVP_V1 — 저장소 계약. **모든 비공개 행 조회·쓰기는 realtorId를 인자로 받는다.**
//
// id 하나만으로 행을 찾는 메서드는 만들지 않는다(IDOR 차단). 구현체(repo-prisma / repo-memory)는 where 절에
// realtorId를 반드시 넣고, 소유자가 다르면 "없음"(null/false)을 돌려준다 — 서비스는 둘을 구분하지 않고 404.
// 예외: 공개 브리핑 뷰의 tokenHash 조회, 관리자 심사의 프로필 조회(requireAdmin 뒤에서만 호출).

import type {
  AuditRow,
  BriefingRow,
  CustomerRow,
  CustomerWrite,
  FollowupRow,
  ListingNoteRow,
  ListingRow,
  ListingWrite,
  MatchRow,
  PreferenceRow,
  PreferenceWrite,
  RealtorProfileRow,
  SubscriptionRow,
} from './types';
import type { FollowupStatus, MatchState, ProfileStatus } from './rules';

export type ProfileWrite = Omit<RealtorProfileRow, 'id' | 'createdAt' | 'updatedAt'>;

export interface ListingQuery {
  includeArchived?: boolean;
  search?: string | null; // 단지명 스냅샷·태그 부분일치(표시용 필터 — identity 아님)
}

export interface CustomerQuery {
  search?: string | null; // 이름 부분일치
  includeClosed?: boolean;
}

export interface FollowupQuery {
  customerId?: string;
  listingId?: string;
  status?: FollowupStatus;
  dueBefore?: Date;
}

export interface ProRepo {
  // 프로필(1:1 users)
  findProfileByUserId(userId: string): Promise<RealtorProfileRow | null>;
  createProfile(data: ProfileWrite): Promise<RealtorProfileRow>;
  updateProfile(realtorId: string, data: Partial<ProfileWrite>): Promise<RealtorProfileRow | null>;
  // 관리자 전용(requireAdmin 뒤)
  adminListProfiles(status: ProfileStatus | null): Promise<RealtorProfileRow[]>;
  adminGetProfile(realtorId: string): Promise<RealtorProfileRow | null>;
  adminSetProfileStatus(realtorId: string, data: Pick<RealtorProfileRow, 'status' | 'statusReason' | 'reviewedByUserId' | 'reviewedAt'>): Promise<RealtorProfileRow | null>;

  listSubscriptions(realtorId: string): Promise<SubscriptionRow[]>;
  createSubscription(realtorId: string, data: Omit<SubscriptionRow, 'id' | 'realtorId' | 'createdAt' | 'updatedAt'>): Promise<SubscriptionRow>;

  // 매물
  countActiveListings(realtorId: string): Promise<number>;
  listListings(realtorId: string, q?: ListingQuery): Promise<ListingRow[]>;
  getListing(realtorId: string, id: string): Promise<ListingRow | null>;
  createListing(realtorId: string, data: ListingWrite): Promise<ListingRow>;
  updateListing(realtorId: string, id: string, data: Partial<ListingWrite>): Promise<ListingRow | null>;
  addListingNote(realtorId: string, listingId: string, data: Omit<ListingNoteRow, 'id' | 'realtorId' | 'listingId' | 'createdAt'>): Promise<ListingNoteRow | null>;
  listListingNotes(realtorId: string, listingId: string, limit: number): Promise<ListingNoteRow[]>;

  // 고객
  countCustomers(realtorId: string): Promise<number>;
  listCustomers(realtorId: string, q?: CustomerQuery): Promise<CustomerRow[]>;
  getCustomer(realtorId: string, id: string): Promise<CustomerRow | null>;
  createCustomer(realtorId: string, data: CustomerWrite): Promise<CustomerRow>;
  updateCustomer(realtorId: string, id: string, data: Partial<CustomerWrite>): Promise<CustomerRow | null>;

  listPreferences(realtorId: string, customerId: string): Promise<PreferenceRow[]>;
  listAllPreferences(realtorId: string): Promise<PreferenceRow[]>;
  createPreference(realtorId: string, customerId: string, data: PreferenceWrite): Promise<PreferenceRow | null>;
  updatePreference(realtorId: string, id: string, data: PreferenceWrite): Promise<PreferenceRow | null>;

  // 팔로업
  listFollowups(realtorId: string, q?: FollowupQuery): Promise<FollowupRow[]>;
  countOpenFollowups(realtorId: string, customerId: string): Promise<number>;
  createFollowup(realtorId: string, data: Omit<FollowupRow, 'id' | 'realtorId' | 'createdAt' | 'updatedAt'>): Promise<FollowupRow>;
  updateFollowup(realtorId: string, id: string, data: Partial<Pick<FollowupRow, 'status' | 'doneAt' | 'note' | 'dueAt'>>): Promise<FollowupRow | null>;

  // 매칭
  upsertMatch(realtorId: string, data: Omit<MatchRow, 'id' | 'realtorId' | 'state'>): Promise<MatchRow>;
  listMatches(realtorId: string, q: { customerId?: string; listingId?: string }): Promise<MatchRow[]>;
  updateMatchState(realtorId: string, id: string, state: MatchState): Promise<MatchRow | null>;

  // 브리핑
  countBriefingsSince(realtorId: string, since: Date): Promise<number>;
  createBriefing(realtorId: string, data: Omit<BriefingRow, 'id' | 'realtorId' | 'createdAt' | 'viewCount' | 'firstViewedAt' | 'revokedAt'>): Promise<BriefingRow>;
  listBriefings(realtorId: string): Promise<BriefingRow[]>;
  getBriefing(realtorId: string, id: string): Promise<BriefingRow | null>;
  revokeBriefing(realtorId: string, id: string, at: Date): Promise<BriefingRow | null>;
  // 공개 뷰 전용: 토큰 해시로 1건 + 그 중개사 상태
  findBriefingByTokenHash(tokenHash: string): Promise<{ briefing: BriefingRow; realtorStatus: ProfileStatus } | null>;
  recordBriefingView(briefingId: string, at: Date): Promise<void>;

  appendAudit(entry: Omit<AuditRow, 'id' | 'createdAt'>): Promise<void>;
}

/** 테이블이 아직 없음(migration 미적용) 등 저장소 자체를 쓸 수 없는 상태. 서비스·페이지는 "준비 중"으로 보여준다. */
export class ProStoreUnavailableError extends Error {
  constructor(public readonly reason: 'NOT_MIGRATED' | 'DB_ERROR') {
    super(`pro store unavailable: ${reason}`);
    this.name = 'ProStoreUnavailableError';
  }
}
