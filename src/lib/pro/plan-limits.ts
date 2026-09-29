// REALTOR_PRO_MVP_V1 — Free/Pro 한도·기능의 **유일한** 정의. docs/pro/REALTOR_PRO_V1_FREE_VS_PRO.md
//
// 앱 어디에도 한도 숫자를 따로 쓰지 않는다 — 전부 여기서 읽는다(plan-limits.test.ts가 고정).
// 결제·구독 과금은 없다(Phase 3). 베타 동안 subscription BETA_GRANT로 Pro 기능을 준다.

import type { PlanCode } from './rules';

export interface PlanCapabilities {
  activeListings: number;
  customers: number;
  preferenceSetsPerCustomer: number;
  manualMatchTopN: number | null; // null = 전체
  automaticMatching: boolean;
  matchingAlerts: boolean;
  briefingsPerDay: number; // KST 달력일
  briefingExpiryDays: { min: number; max: number; default: number };
  followupsPerCustomer: number; // 열린(OPEN) 팔로업 수
  repeatFollowups: boolean;
  customBranding: boolean;
  listingNoteHistory: 'LATEST_ONLY' | 'FULL';
  dashboardSections: readonly DashboardSection[];
}

export const DASHBOARD_SECTIONS = [
  'FOLLOWUPS_TODAY',
  'LEASE_ENDING',
  'MATCHED_LISTINGS',
  'NEW_LISTINGS',
  'PRICE_CHANGED',
  'SCHEDULE',
  'RECENT_BRIEFINGS',
  'UNHANDLED_CUSTOMERS',
] as const;
export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];

export const PLAN_CAPABILITIES: Readonly<Record<PlanCode, PlanCapabilities>> = {
  FREE: {
    activeListings: 10,
    customers: 5,
    preferenceSetsPerCustomer: 1,
    manualMatchTopN: 3,
    automaticMatching: false,
    matchingAlerts: false,
    briefingsPerDay: 3,
    briefingExpiryDays: { min: 7, max: 7, default: 7 },
    followupsPerCustomer: 1,
    repeatFollowups: false,
    customBranding: false,
    listingNoteHistory: 'LATEST_ONLY',
    dashboardSections: ['FOLLOWUPS_TODAY', 'LEASE_ENDING', 'UNHANDLED_CUSTOMERS'],
  },
  PRO: {
    activeListings: 300,
    customers: 500,
    preferenceSetsPerCustomer: 3,
    manualMatchTopN: null,
    automaticMatching: true,
    matchingAlerts: true,
    briefingsPerDay: 200, // "무제한" 대신 남용 방지 soft cap
    briefingExpiryDays: { min: 1, max: 30, default: 14 },
    followupsPerCustomer: 20,
    repeatFollowups: true,
    customBranding: true,
    listingNoteHistory: 'FULL',
    dashboardSections: DASHBOARD_SECTIONS,
  },
};

export function capabilitiesFor(plan: PlanCode): PlanCapabilities {
  return PLAN_CAPABILITIES[plan];
}

export type LimitKey = 'activeListings' | 'customers' | 'briefingsPerDay' | 'followupsPerCustomer' | 'preferenceSetsPerCustomer';

export interface LimitCheck {
  allowed: boolean;
  limit: number;
  used: number;
}

/** 새 항목 1개를 더 만들 수 있는가(서버에서만 판정 — 클라이언트 표시는 참고용). */
export function checkLimit(plan: PlanCode, key: LimitKey, used: number): LimitCheck {
  const limit = PLAN_CAPABILITIES[plan][key];
  return { allowed: used < limit, limit, used };
}

export const PLAN_LABELS: Record<PlanCode, string> = { FREE: 'Free', PRO: 'Pro' };

export const LIMIT_MESSAGES: Record<LimitKey, (limit: number) => string> = {
  activeListings: (n) => `활성 매물은 ${n}건까지 등록할 수 있습니다. 보관한 매물은 한도에 포함되지 않습니다.`,
  customers: (n) => `고객은 ${n}명까지 등록할 수 있습니다.`,
  briefingsPerDay: (n) => `브리핑은 하루 ${n}건까지 만들 수 있습니다.`,
  followupsPerCustomer: (n) => `고객당 진행 중인 팔로업은 ${n}개까지입니다.`,
  preferenceSetsPerCustomer: (n) => `고객당 조건 세트는 ${n}개까지입니다.`,
};
