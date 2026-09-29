// REALTOR_PRO_MVP_V1 — 중개사 상태·플랜 판정(순수). docs/pro/REALTOR_PRO_V1_ARCHITECTURE.md §3·§4
//
// 권한은 JWT에 굽지 않고 **매 요청 DB의 realtor_profiles + realtor_subscriptions**로 판정한다(정지 즉시 반영).
//
// 상태 → 가능한 것
//   NONE(프로필 없음)     : 소개·신청
//   APPLICANT(심사 중)    : 신청서 수정·상태 확인. 매물·고객 불가
//   REJECTED             : 사유 확인·재신청
//   VERIFIED             : 플랜(FREE/PRO) 한도 안에서 전부
//   SUSPENDED            : 읽기·내보내기만(쓰기 거부), 공유 링크 즉시 비활성

import type { PlanCode } from './rules';
import type { RealtorProfileRow, SubscriptionRow } from './types';

export type RealtorState = 'NONE' | 'APPLICANT' | 'REJECTED' | 'VERIFIED' | 'SUSPENDED';

export interface RealtorContext {
  state: RealtorState;
  profile: RealtorProfileRow | null;
  plan: PlanCode;
  canRead: boolean;
  canWrite: boolean;
}

const PRO_ACTIVE: ReadonlySet<SubscriptionRow['status']> = new Set(['ACTIVE', 'BETA_GRANT', 'GRACE']);

export function resolvePlan(subs: readonly SubscriptionRow[], now: Date): PlanCode {
  const t = now.getTime();
  const pro = subs.some(
    (s) => s.plan === 'PRO' && PRO_ACTIVE.has(s.status) && s.currentPeriodStart.getTime() <= t && (s.currentPeriodEnd == null || s.currentPeriodEnd.getTime() > t)
  );
  return pro ? 'PRO' : 'FREE';
}

export function resolveRealtorContext(profile: RealtorProfileRow | null, subs: readonly SubscriptionRow[], now: Date): RealtorContext {
  if (!profile) return { state: 'NONE', profile: null, plan: 'FREE', canRead: false, canWrite: false };
  const state: RealtorState =
    profile.status === 'VERIFIED' ? 'VERIFIED' : profile.status === 'SUSPENDED' ? 'SUSPENDED' : profile.status === 'REJECTED' ? 'REJECTED' : 'APPLICANT';
  const plan = resolvePlan(subs, now);
  return {
    state,
    profile,
    plan,
    canRead: state === 'VERIFIED' || state === 'SUSPENDED',
    canWrite: state === 'VERIFIED',
  };
}

/** KST 달력일 시작(UTC 기준 Date). 브리핑 일일 한도 집계용. */
export function kstDayStart(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3_600_000);
}
