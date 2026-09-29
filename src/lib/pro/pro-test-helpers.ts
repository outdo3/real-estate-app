// REALTOR_PRO_MVP_V1 — 테스트 전용 도우미(합성 데이터만, DB·네트워크 없음). 앱 코드는 이 파일을 import하지 않는다.

import { randomBytes } from 'node:crypto';
import { loadPiiKeyring, type PiiKeyring } from './crypto';
import { createMemoryProRepo, emptyMemoryState, type MemoryState } from './repo-memory';
import type { ProDeps, PublicAptDataSource } from './service-core';
import type { PublicAptInfo, RealtorProfileRow } from './types';
import type { ProfileStatus } from './rules';

export function testRing(keyId = 'k1'): PiiKeyring {
  return loadPiiKeyring({ REALTOR_PRO_PII_KEY: randomBytes(32).toString('base64'), REALTOR_PRO_LOOKUP_PEPPER: randomBytes(24).toString('base64'), REALTOR_PRO_PII_KEY_ID: keyId });
}

export const FIXED_NOW = new Date('2026-09-30T03:00:00.000Z'); // 12:00 KST

export function makeDeps(opts: { state?: MemoryState; ring?: PiiKeyring | null; now?: Date; publicData?: PublicAptDataSource } = {}): ProDeps & { state: MemoryState } {
  const state = opts.state ?? emptyMemoryState();
  let now = opts.now ?? FIXED_NOW;
  const repo = createMemoryProRepo(state, () => now);
  return {
    repo,
    ring: opts.ring === undefined ? testRing() : opts.ring,
    now: () => now,
    publicData: opts.publicData ?? { lookup: async () => null },
    state,
    // 테스트가 시간을 옮길 수 있게
    set nowValue(d: Date) { now = d; },
  } as ProDeps & { state: MemoryState };
}

export function addProfile(state: MemoryState, userId: string, status: ProfileStatus = 'VERIFIED', id = `rp_${userId}`): RealtorProfileRow {
  const row: RealtorProfileRow = {
    id,
    userId,
    displayName: `중개사 ${userId}`,
    officeName: '테스트 사무소',
    officePhone: '051-000-0000',
    officeAddress: null,
    logoUrl: null,
    licenseNumberEnc: null,
    officeRegNoEnc: null,
    businessRegNoEnc: null,
    status,
    statusReason: null,
    reviewedByUserId: null,
    reviewedAt: null,
    termsAgreedAt: FIXED_NOW,
    termsVersion: 't',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
  state.profiles.push(row);
  return row;
}

export function grantPro(state: MemoryState, realtorId: string) {
  state.subscriptions.push({ id: `rs_${realtorId}`, realtorId, plan: 'PRO', status: 'BETA_GRANT', currentPeriodStart: new Date(FIXED_NOW.getTime() - 86_400_000), currentPeriodEnd: new Date(FIXED_NOW.getTime() + 30 * 86_400_000), createdAt: FIXED_NOW, updatedAt: FIXED_NOW });
}

export const listingBody = (over: Record<string, unknown> = {}) => ({
  aptNameSnapshot: '테스트아파트',
  dealType: 'SALE',
  askingPriceManwon: 89000,
  exclusiveAreaM2: 84.97,
  floor: 12,
  parkingAvailable: true,
  ...over,
});

export const customerBody = (over: Record<string, unknown> = {}) => ({ name: '박테스트', ...over });

export function publicInfo(over: Partial<PublicAptInfo> = {}): PublicAptInfo {
  return {
    aptSeq: '26350-100',
    name: '테스트단지',
    lawdCd: '26350',
    umdName: '우동',
    roadAddress: null,
    buildYear: 2020,
    totalHouseholds: 500,
    parkingCount: 600,
    lat: 35.16,
    lng: 129.16,
    detailOpen: true,
    tradeState: 'OK',
    recentTrades: [{ dealDate: '2026-09-01', priceManwon: 88000, exclusiveAreaM2: 84.97, floor: 10 }],
    areaOptionsM2: [59.98, 84.97],
    dataAsOf: FIXED_NOW,
    ...over,
  };
}
