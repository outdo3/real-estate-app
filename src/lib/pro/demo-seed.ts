// REALTOR_PRO_MVP_V1 — 로컬 데모 전용 합성 데이터(REALTOR_PRO_DEMO=1, 개발 환경만). 실제 사람·연락처·단지 아님.
//
// · 이름은 "[데모]"가 붙은 가공 값, 전화번호는 실제 배정되지 않는 010-0000-xxxx 대역.
// · aptSeq는 만들지 않는다(가짜 식별자 금지) — 데모 매물은 "단지 정보 미연결" 상태로 보인다.
// · Production 데이터와 섞이지 않는다: 메모리에만 있고 프로세스가 끝나면 사라진다.

import { protectPhone, type PiiKeyring } from './crypto';
import type { MemoryState } from './repo-memory';

export const DEMO_USER_ID = 'demo-realtor-user';
const DEMO_REALTOR_ID = 'rp_demo';

export function seedDemoState(state: MemoryState, ring: PiiKeyring, now: Date): void {
  const day = 86_400_000;
  const at = (d: number) => new Date(now.getTime() + d * day);
  state.profiles.push({
    id: DEMO_REALTOR_ID,
    userId: DEMO_USER_ID,
    displayName: '[데모] 김중개',
    officeName: '[데모] 이집공인중개사사무소',
    officePhone: '051-000-0000',
    officeAddress: null,
    logoUrl: null,
    licenseNumberEnc: null,
    officeRegNoEnc: null,
    businessRegNoEnc: null,
    status: 'VERIFIED',
    statusReason: null,
    reviewedByUserId: 'demo-admin',
    reviewedAt: at(-30),
    termsAgreedAt: at(-31),
    termsVersion: 'pro-beta-2026-09',
    createdAt: at(-31),
    updatedAt: at(-30),
  });
  const base = { realtorId: DEMO_REALTOR_ID, aptSeq: null, lawdCd: null, umdName: null, buildingDong: null, unitHo: null, unitTypeRef: null, ownerName: null, ownerPhoneEnc: null, ownerPhoneHash: null, repairNote: null, parkingNote: null, viewingNote: null, source: 'OWNER_DIRECT' as const, memo: null, tags: [] as string[], isActive: true, closedAt: null, priceChangedAt: null, deletedAt: null, moveInNegotiable: false, viewingMethod: 'CONTACT_REALTOR' as const };
  const owner = protectPhone('010-0000-1001', ring);
  state.listings.push(
    { ...base, id: 'rl_demo1', aptNameSnapshot: '[데모] 예시아파트 101', floor: 12, floorBand: null, exclusiveAreaM2: 84.97, dealType: 'SALE', askingPriceManwon: 89000, depositManwon: null, monthlyRentManwon: null, ownerName: '[데모] 집주인A', ownerPhoneEnc: owner.enc, ownerPhoneHash: owner.hash, tenantStatus: 'TENANTED', tenantLeaseEndsAt: at(45), moveInAvailableAt: at(60), repairStatus: 'PARTIAL', parkingAvailable: true, petAllowed: null, tags: ['남향', '역세권'], createdAt: at(-2), updatedAt: at(-2) },
    { ...base, id: 'rl_demo2', aptNameSnapshot: '[데모] 예시타운 2단지', floor: 3, floorBand: null, exclusiveAreaM2: 59.98, dealType: 'JEONSE', askingPriceManwon: null, depositManwon: 42000, monthlyRentManwon: null, tenantStatus: 'VACANT', tenantLeaseEndsAt: null, moveInAvailableAt: at(10), repairStatus: 'FULL', parkingAvailable: true, petAllowed: true, createdAt: at(-12), updatedAt: at(-1), priceChangedAt: at(-1) },
    { ...base, id: 'rl_demo3', aptNameSnapshot: '[데모] 예시힐스', floor: null, floorBand: 'HIGH', exclusiveAreaM2: 114.5, dealType: 'SALE', askingPriceManwon: 132000, depositManwon: null, monthlyRentManwon: null, tenantStatus: 'OWNER_OCCUPIED', tenantLeaseEndsAt: null, moveInAvailableAt: null, moveInNegotiable: true, repairStatus: 'ORIGINAL', parkingAvailable: null, petAllowed: null, createdAt: at(-20), updatedAt: at(-20) }
  );
  const c1 = protectPhone('010-0000-2001', ring);
  state.customers.push(
    { id: 'rc_demo1', realtorId: DEMO_REALTOR_ID, name: '[데모] 박고객', phoneEnc: c1.enc, phoneHash: c1.hash, emailEnc: null, emailHash: null, status: 'ACTIVE', priority: 1, nextFollowUpAt: at(0), memo: '주말 방문 선호', consentStatus: 'VERBAL', consentRecordedAt: at(-5), lastActivityAt: at(-1), deletedAt: null, createdAt: at(-5), updatedAt: at(-1) },
    { id: 'rc_demo2', realtorId: DEMO_REALTOR_ID, name: '[데모] 이고객', phoneEnc: null, phoneHash: null, emailEnc: null, emailHash: null, status: 'NEW', priority: 2, nextFollowUpAt: null, memo: null, consentStatus: 'NOT_RECORDED', consentRecordedAt: null, lastActivityAt: at(-1), deletedAt: null, createdAt: at(-1), updatedAt: at(-1) }
  );
  state.preferences.push({
    id: 'rpf_demo1', realtorId: DEMO_REALTOR_ID, customerId: 'rc_demo1', label: '기본', dealTypes: ['SALE'], budgetMinManwon: 80000, budgetMaxManwon: 95000, budgetTolerancePct: 5, monthlyRentMaxManwon: null, lawdCds: [], aptSeqs: [], areaMinM2: 80, areaMaxM2: 90, moveInTargetAt: at(50), commuteLabel: null, commuteLat: null, commuteLng: null, schoolIds: [], preferNewBuild: null, parkingRequired: true, floorPreference: 'HIGH', petRequired: null, mustHaveKeys: [], specialConditions: null, createdAt: at(-5), updatedAt: at(-5),
  });
  state.followups.push({ id: 'rf_demo1', realtorId: DEMO_REALTOR_ID, customerId: 'rc_demo1', listingId: null, kind: 'CALL', status: 'OPEN', dueAt: at(0), note: '매물 2건 안내 전화', doneAt: null, repeatRule: null, createdAt: at(-1), updatedAt: at(-1) });
}
