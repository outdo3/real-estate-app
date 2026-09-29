import assert from 'node:assert/strict';
import test from 'node:test';
import { adminGrantBetaPro, adminSetStatus, applyForPro, getMyStatus, updateMyProfile } from './profile-service';
import { createListing, getApartmentPrefill, getListing, setListingActive, updateListing } from './listing-service';
import { createCustomer, getCustomer, savePreference } from './customer-service';
import { createFollowup, updateFollowup } from './followup-service';
import { computeMatchesForCustomer, computeMatchesForListing } from './match-service';
import { createBriefing, listBriefings, viewBriefingByToken } from './briefing-service';
import { getDashboard } from './dashboard-service';
import { kstDayStart, resolvePlan } from './access';
import { checkLimit, PLAN_CAPABILITIES, DASHBOARD_SECTIONS } from './plan-limits';
import { FIXED_NOW, makeDeps, publicInfo } from './pro-test-helpers';

// REALTOR_PRO_MVP_V1 — 신청 → 승인 → 매물 → 고객 → 매칭 → 팔로업 → 브리핑 → 대시보드 흐름(합성 데이터).

const U = { userId: 'flow-user' };

test('전체 흐름', async () => {
  const deps = makeDeps({ publicData: { lookup: async (seq) => (seq === '26350-100' ? publicInfo() : null) } });

  // 신청 전: 매물 불가
  assert.equal((await createListing(deps, U, { aptNameSnapshot: 'x', dealType: 'SALE', askingPriceManwon: 1 })).ok, false);
  // 약관 동의 없으면 신청 불가
  assert.equal((await applyForPro(deps, U, { displayName: '김중개' })).ok, false);
  const applied = await applyForPro(deps, U, { displayName: '김중개', officeName: '이집공인', licenseNumber: '2026-부산-0001', agreeTerms: true });
  assert.ok(applied.ok);
  if (!applied.ok) return;
  assert.equal(applied.data.status, 'PENDING_REVIEW');
  assert.equal(applied.data.hasLicenseNumber, true);
  assert.ok(!JSON.stringify(deps.state.profiles).includes('2026-부산-0001'));
  // 심사 중: 여전히 매물 불가, 중복 신청 불가
  assert.equal((await createListing(deps, U, { aptNameSnapshot: 'x', dealType: 'SALE', askingPriceManwon: 1 })).ok, false);
  assert.equal((await applyForPro(deps, U, { displayName: '김중개', agreeTerms: true })).ok, false);

  assert.ok((await adminSetStatus(deps, { userId: 'admin' }, applied.data.id, { status: 'VERIFIED' })).ok);
  const me = await getMyStatus(deps, U);
  assert.ok(me.ok && me.data.state === 'VERIFIED' && me.data.plan === 'FREE');
  assert.ok((await updateMyProfile(deps, U, { displayName: '김중개(수정)', officePhone: '051-123-4567' })).ok);

  // 단지 prefill은 aptSeq로만
  const pre = await getApartmentPrefill(deps, U, '26350-100');
  assert.ok(pre.ok && pre.data?.name === '테스트단지');
  assert.equal((await getApartmentPrefill(deps, U, '테스트단지')).ok, false);

  const listing = await createListing(deps, U, {
    aptSeq: '26350-100', lawdCd: '26350', umdName: '우동', aptNameSnapshot: '테스트단지', dealType: 'SALE', askingPriceManwon: 89000,
    exclusiveAreaM2: 84.97, floor: 15, parkingAvailable: true, moveInAvailableAt: '2026-11-01', tenantStatus: 'TENANTED', tenantLeaseEndsAt: '2026-10-20', tags: ['남향'],
  });
  assert.ok(listing.ok);
  if (!listing.ok) return;
  // 가격 변경 → 이력 노트 + priceChangedAt
  const upd = await updateListing(deps, U, listing.data.id, { askingPriceManwon: 87000 });
  assert.ok(upd.ok && upd.data.priceChangedAt);
  const detail = await getListing(deps, U, listing.data.id);
  assert.ok(detail.ok && detail.data.notes[0].kind === 'PRICE_CHANGE' && detail.data.notes[0].prevPriceManwon === 89000);
  assert.ok(detail.ok && detail.data.publicInfo?.tradeState === 'OK');
  // 거래유형 바꾸며 가격 누락 → 거부(병합 후 재검증)
  assert.equal((await updateListing(deps, U, listing.data.id, { dealType: 'JEONSE' })).ok, false);

  const customer = await createCustomer(deps, U, { name: '박고객', phone: '010-5555-6666', priority: 1, consentStatus: 'VERBAL' });
  assert.ok(customer.ok);
  if (!customer.ok) return;
  assert.ok(customer.data.consentRecordedAt);
  const pref = await savePreference(deps, U, customer.data.id, null, {
    dealTypes: ['SALE'], budgetMinManwon: 80000, budgetMaxManwon: 95000, areaMinM2: 80, areaMaxM2: 90, moveInTargetAt: '2026-10-28',
    commuteLabel: '센텀시티역', commuteLat: 35.1692, commuteLng: 129.1318, parkingRequired: true, memo: 'ignored',
  });
  assert.ok(pref.ok);
  // Free: 조건 세트 1개
  assert.equal((await savePreference(deps, U, customer.data.id, null, { dealTypes: ['JEONSE'] })).ok, false);

  const matches = await computeMatchesForCustomer(deps, U, customer.data.id);
  assert.ok(matches.ok);
  if (!matches.ok) return;
  const top = matches.data[0].results[0];
  assert.equal(top.listing.id, listing.data.id);
  assert.equal(top.passedHard, true);
  assert.ok(top.score! >= 90);
  assert.equal(matches.data[0].truncatedTo, PLAN_CAPABILITIES.FREE.manualMatchTopN);
  assert.equal(deps.state.matches.length, 1);
  const byListing = await computeMatchesForListing(deps, U, listing.data.id);
  assert.ok(byListing.ok && byListing.data[0].customerId === customer.data.id);

  // 팔로업 + 고객 nextFollowUpAt 동기화 + 완료
  const fu = await createFollowup(deps, U, { customerId: customer.data.id, kind: 'CALL', dueAt: FIXED_NOW.toISOString(), note: '매물 안내' });
  assert.ok(fu.ok);
  let c = await getCustomer(deps, U, customer.data.id);
  assert.ok(c.ok && c.data.customer.nextFollowUpAt?.getTime() === FIXED_NOW.getTime());

  const dash = await getDashboard(deps, U);
  assert.ok(dash.ok);
  if (!dash.ok) return;
  assert.deepEqual(dash.data.sections, [...PLAN_CAPABILITIES.FREE.dashboardSections]);
  assert.equal(dash.data.followupsToday.length, 1);
  assert.equal(dash.data.followupsToday[0].customerName, '박고객');
  assert.equal(dash.data.leaseEnding.length, 1);
  assert.equal(dash.data.matchedListings.length, 0); // Free에는 섹션 없음

  assert.ok(fu.ok && (await updateFollowup(deps, U, fu.data.id, { action: 'done' })).ok);
  c = await getCustomer(deps, U, customer.data.id);
  assert.ok(c.ok && c.data.customer.nextFollowUpAt === null);

  // 브리핑 + 공개 뷰
  const b = await createBriefing(deps, U, { listingId: listing.data.id, customerId: customer.data.id });
  assert.ok(b.ok);
  if (!b.ok) return;
  assert.equal(b.data.snapshot.fit?.score != null, true);
  assert.ok(b.data.snapshot.fit!.matched.includes('예산 범위 안'));
  assert.equal(b.data.snapshot.publicData.state, 'OK');
  assert.equal(b.data.snapshot.realtor.displayName, '김중개(수정)');
  assert.equal(b.data.snapshot.listing?.floorBand, 'HIGH');
  // Free 만료 7일 고정 — 다른 값 거부
  assert.equal((await createBriefing(deps, U, { listingId: listing.data.id, expiresInDays: 30 })).ok, false);
  const view = await viewBriefingByToken(deps, b.data.token, { countView: true });
  assert.equal(view.access, 'OK');
  const list = await listBriefings(deps, U);
  assert.ok(list.ok && list.data[0].viewCount === 1 && list.data[0].status === 'ACTIVE');
  // Free 하루 3건
  assert.ok((await createBriefing(deps, U, { listingId: listing.data.id })).ok);
  assert.ok((await createBriefing(deps, U, { listingId: listing.data.id })).ok);
  const fourth = await createBriefing(deps, U, { listingId: listing.data.id });
  assert.equal(fourth.ok, false);

  // 베타 Pro 부여 → 섹션 전체·반복 팔로업·브리핑 만료 선택
  assert.ok((await adminGrantBetaPro(deps, { userId: 'admin' }, applied.data.id, 30)).ok);
  const dashPro = await getDashboard(deps, U);
  assert.ok(dashPro.ok && dashPro.data.sections.length === DASHBOARD_SECTIONS.length);
  const rep = await createFollowup(deps, U, { customerId: customer.data.id, kind: 'CALL', dueAt: FIXED_NOW.toISOString(), repeatRule: 'WEEKLY' });
  assert.ok(rep.ok);
  if (rep.ok) assert.ok((await updateFollowup(deps, U, rep.data.id, { action: 'done' })).ok);
  assert.equal(deps.state.followups.filter((f) => f.status === 'OPEN').length, 1); // 다음 주 1건 생성

  // 계약완료 → 매칭 제외
  assert.ok((await setListingActive(deps, U, listing.data.id, { active: false, closed: true })).ok);
  const after = await computeMatchesForCustomer(deps, U, customer.data.id);
  assert.ok(after.ok && after.data[0].results.length === 0);
});

test('플랜 판정: 기간 밖·취소된 Pro는 Free', () => {
  const base = { id: 's', realtorId: 'r', createdAt: FIXED_NOW, updatedAt: FIXED_NOW };
  const day = 86_400_000;
  assert.equal(resolvePlan([], FIXED_NOW), 'FREE');
  assert.equal(resolvePlan([{ ...base, plan: 'PRO', status: 'ACTIVE', currentPeriodStart: new Date(FIXED_NOW.getTime() - day), currentPeriodEnd: null }], FIXED_NOW), 'PRO');
  assert.equal(resolvePlan([{ ...base, plan: 'PRO', status: 'EXPIRED', currentPeriodStart: new Date(FIXED_NOW.getTime() - day), currentPeriodEnd: null }], FIXED_NOW), 'FREE');
  assert.equal(resolvePlan([{ ...base, plan: 'PRO', status: 'ACTIVE', currentPeriodStart: new Date(FIXED_NOW.getTime() - 2 * day), currentPeriodEnd: new Date(FIXED_NOW.getTime() - day) }], FIXED_NOW), 'FREE');
  assert.equal(resolvePlan([{ ...base, plan: 'PRO', status: 'CANCELED', currentPeriodStart: new Date(FIXED_NOW.getTime() - day), currentPeriodEnd: null }], FIXED_NOW), 'FREE');
});

test('한도 판정·KST 날짜 경계', () => {
  assert.deepEqual(checkLimit('FREE', 'activeListings', 9), { allowed: true, limit: 10, used: 9 });
  assert.deepEqual(checkLimit('FREE', 'activeListings', 10), { allowed: false, limit: 10, used: 10 });
  assert.equal(checkLimit('PRO', 'customers', 499).allowed, true);
  // 2026-09-30 00:30 KST = 09-29 15:30Z → 그날 KST 00:00 = 09-29 15:00Z
  assert.equal(kstDayStart(new Date('2026-09-29T15:30:00Z')).toISOString(), '2026-09-29T15:00:00.000Z');
  assert.equal(kstDayStart(new Date('2026-09-29T14:59:00Z')).toISOString(), '2026-09-28T15:00:00.000Z');
});
