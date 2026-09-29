// REALTOR_PRO_MVP_V1 — "오늘 해야 할 일" 대시보드. 숫자 자랑(vanity metric) 대신 **행동할 목록**만.
// 섹션 가시성은 플랜(plan-limits.dashboardSections)이 정한다. 쿼리는 순차(커넥션 1개 환경).

import { kstDayStart } from './access';
import { capabilitiesFor, type DashboardSection } from './plan-limits';
import { ok, requireReader, toCustomerDto, toListingDto, type CustomerDto, type ListingDto, type ProActor, type ProDeps, type ProResult } from './service-core';
import type { FollowupRow, MatchRow } from './types';

export interface DashboardData {
  plan: 'FREE' | 'PRO';
  suspended: boolean;
  sections: DashboardSection[];
  followupsToday: (FollowupRow & { customerName: string | null; overdue: boolean })[];
  leaseEnding: ListingDto[]; // 60일 안에 임대 만기
  matchedListings: (MatchRow & { customerName: string; listingName: string })[];
  newListings: ListingDto[]; // 최근 7일 등록
  priceChanged: ListingDto[]; // 최근 14일 가격 변경
  schedule: (FollowupRow & { customerName: string | null })[]; // 앞으로 14일의 방문·계약·입주
  recentBriefings: { id: string; title: string; viewCount: number; createdAt: Date }[];
  unhandledCustomers: CustomerDto[]; // NEW 상태 + 팔로업 없음
  counts: { activeListings: number; customers: number };
}

const DAY = 86_400_000;

export async function getDashboard(deps: ProDeps, actor: ProActor): Promise<ProResult<DashboardData>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const caps = capabilitiesFor(ctx.data.plan);
  const has = (s: DashboardSection) => caps.dashboardSections.includes(s);
  const now = deps.now();
  const endOfToday = new Date(kstDayStart(now).getTime() + DAY);

  const customers = await deps.repo.listCustomers(realtorId, { includeClosed: false });
  const nameOf = (id: string | null) => (id ? customers.find((c) => c.id === id)?.name ?? null : null);
  const listings = await deps.repo.listListings(realtorId, { includeArchived: false });
  const openFollowups = await deps.repo.listFollowups(realtorId, { status: 'OPEN' });

  const data: DashboardData = {
    plan: ctx.data.plan,
    suspended: ctx.data.state === 'SUSPENDED',
    sections: [...caps.dashboardSections],
    followupsToday: [],
    leaseEnding: [],
    matchedListings: [],
    newListings: [],
    priceChanged: [],
    schedule: [],
    recentBriefings: [],
    unhandledCustomers: [],
    counts: { activeListings: listings.length, customers: customers.length },
  };

  if (has('FOLLOWUPS_TODAY')) {
    data.followupsToday = openFollowups
      .filter((f) => f.dueAt.getTime() < endOfToday.getTime())
      .map((f) => ({ ...f, customerName: nameOf(f.customerId), overdue: f.dueAt.getTime() < kstDayStart(now).getTime() }));
  }
  if (has('LEASE_ENDING')) {
    data.leaseEnding = listings
      .filter((l) => l.tenantLeaseEndsAt && l.tenantLeaseEndsAt.getTime() >= now.getTime() - DAY && l.tenantLeaseEndsAt.getTime() <= now.getTime() + 60 * DAY)
      .sort((a, b) => a.tenantLeaseEndsAt!.getTime() - b.tenantLeaseEndsAt!.getTime())
      .map(toListingDto);
  }
  if (has('MATCHED_LISTINGS')) {
    const matches = await deps.repo.listMatches(realtorId, {});
    data.matchedListings = matches
      .filter((m) => m.passedHard && m.state === 'NEW' && (m.score ?? 0) >= 70)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 10)
      .map((m) => ({ ...m, customerName: nameOf(m.customerId) ?? '고객', listingName: listings.find((l) => l.id === m.listingId)?.aptNameSnapshot ?? '매물' }))
      .filter((m) => customers.some((c) => c.id === m.customerId) && listings.some((l) => l.id === m.listingId));
  }
  if (has('NEW_LISTINGS')) data.newListings = listings.filter((l) => l.createdAt.getTime() >= now.getTime() - 7 * DAY).slice(0, 10).map(toListingDto);
  if (has('PRICE_CHANGED')) data.priceChanged = listings.filter((l) => l.priceChangedAt && l.priceChangedAt.getTime() >= now.getTime() - 14 * DAY).slice(0, 10).map(toListingDto);
  if (has('SCHEDULE')) {
    data.schedule = openFollowups
      .filter((f) => f.kind !== 'CALL' && f.dueAt.getTime() >= endOfToday.getTime() && f.dueAt.getTime() <= now.getTime() + 14 * DAY)
      .map((f) => ({ ...f, customerName: nameOf(f.customerId) }));
  }
  if (has('RECENT_BRIEFINGS')) {
    data.recentBriefings = (await deps.repo.listBriefings(realtorId)).slice(0, 5).map((b) => ({
      id: b.id,
      title: b.snapshot ? `${b.snapshot.customerLabel} · ${b.snapshot.apartment?.name ?? '매물'}` : '브리핑',
      viewCount: b.viewCount,
      createdAt: b.createdAt,
    }));
  }
  if (has('UNHANDLED_CUSTOMERS')) {
    const withFollowup = new Set(openFollowups.map((f) => f.customerId).filter(Boolean));
    data.unhandledCustomers = customers.filter((c) => c.status === 'NEW' && !withFollowup.has(c.id)).slice(0, 10).map(toCustomerDto);
  }
  return ok(data);
}
