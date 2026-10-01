// REALTOR_PRO_MVP_V1 — 중개사 프로필: 신청·수정·상태 조회 + 관리자 수동 심사.
// 자격번호·등록번호는 암호화해서만 저장하고 화면에는 "등록됨/미등록"만 보인다(원문 재노출 경로 없음).

import { buildAuditEntry } from './audit';
import { encryptField } from './crypto';
import { capabilitiesFor } from './plan-limits';
import type { ProfileStatus } from './rules';
import { PROFILE_STATUSES, TERMS_VERSION, validateProfileInput } from './rules';
import { fail, INVALID, loadContext, ok, type ProActor, type ProDeps, type ProResult } from './service-core';
import type { RealtorProfileRow } from './types';

export interface ProfileDto {
  id: string;
  displayName: string;
  officeName: string | null;
  officePhone: string | null;
  officeAddress: string | null;
  status: ProfileStatus;
  statusReason: string | null;
  hasLicenseNumber: boolean;
  hasOfficeRegNo: boolean;
  hasBusinessRegNo: boolean;
  createdAt: Date;
}

export function toProfileDto(p: RealtorProfileRow): ProfileDto {
  return {
    id: p.id,
    displayName: p.displayName,
    officeName: p.officeName,
    officePhone: p.officePhone,
    officeAddress: p.officeAddress,
    status: p.status,
    statusReason: p.statusReason,
    hasLicenseNumber: !!p.licenseNumberEnc,
    hasOfficeRegNo: !!p.officeRegNoEnc,
    hasBusinessRegNo: !!p.businessRegNoEnc,
    createdAt: p.createdAt,
  };
}

export interface MyProStatus {
  state: 'NONE' | 'APPLICANT' | 'REJECTED' | 'VERIFIED' | 'SUSPENDED';
  plan: 'FREE' | 'PRO';
  profile: ProfileDto | null;
  capabilities: ReturnType<typeof capabilitiesFor>;
}

export async function getMyStatus(deps: ProDeps, actor: ProActor): Promise<ProResult<MyProStatus>> {
  const ctx = await loadContext(deps, actor);
  return ok({ state: ctx.state, plan: ctx.plan, profile: ctx.profile ? toProfileDto(ctx.profile) : null, capabilities: capabilitiesFor(ctx.plan) });
}

function encIds(input: { licenseNumber: string | null; officeRegNo: string | null; businessRegNo: string | null }, deps: ProDeps) {
  const anyId = input.licenseNumber || input.officeRegNo || input.businessRegNo;
  if (anyId && !deps.ring) return null;
  return {
    licenseNumberEnc: deps.ring ? encryptField(input.licenseNumber, deps.ring) : null,
    officeRegNoEnc: deps.ring ? encryptField(input.officeRegNo, deps.ring) : null,
    businessRegNoEnc: deps.ring ? encryptField(input.businessRegNo, deps.ring) : null,
  };
}

/** 신청(최초) 또는 반려 후 재신청. 상태는 항상 PENDING_REVIEW로 — 입력으로 상태를 정할 수 없다. */
export async function applyForPro(deps: ProDeps, actor: ProActor, body: unknown): Promise<ProResult<ProfileDto>> {
  const v = validateProfileInput(body, { requireTerms: true });
  if (!v.ok) return INVALID(v.errors);
  const ctx = await loadContext(deps, actor);
  if (ctx.state === 'VERIFIED' || ctx.state === 'SUSPENDED' || ctx.state === 'APPLICANT') return fail(409, 'ALREADY_APPLIED', '이미 신청했거나 인증된 계정입니다.');
  const ids = encIds(v.value, deps);
  if (!ids) return fail(503, 'PII_KEY_MISSING', '보안 설정이 끝나지 않아 자격번호를 저장할 수 없습니다.');
  const now = deps.now();
  const fields = {
    displayName: v.value.displayName,
    officeName: v.value.officeName,
    officePhone: v.value.officePhone,
    officeAddress: v.value.officeAddress,
    logoUrl: null,
    ...ids,
    termsAgreedAt: now,
    termsVersion: TERMS_VERSION,
  };
  let row: RealtorProfileRow | null;
  if (ctx.state === 'REJECTED' && ctx.profile) {
    row = await deps.repo.updateProfile(ctx.profile.id, fields);
    if (row) row = await deps.repo.adminSetProfileStatus(row.id, { status: 'PENDING_REVIEW', statusReason: null, reviewedByUserId: null, reviewedAt: null });
  } else {
    row = await deps.repo.createProfile({ ...fields, userId: actor.userId, status: 'PENDING_REVIEW', statusReason: null, reviewedByUserId: null, reviewedAt: null });
  }
  if (!row) return fail(500, 'SAVE_FAILED', '저장하지 못했습니다.');
  await deps.repo.appendAudit(buildAuditEntry({ actorUserId: actor.userId, actorRole: 'REALTOR', action: 'PROFILE_APPLIED', targetType: 'realtor_profile', targetId: row.id, realtorId: row.id }));
  return ok(toProfileDto(row));
}

/** 표시 정보 수정(이름·사무소·연락처). 상태·자격번호 변경은 이 경로로 안 된다. */
export async function updateMyProfile(deps: ProDeps, actor: ProActor, body: unknown): Promise<ProResult<ProfileDto>> {
  const v = validateProfileInput(body, { requireTerms: false });
  if (!v.ok) return INVALID(v.errors);
  const ctx = await loadContext(deps, actor);
  if (!ctx.profile) return fail(404, 'NOT_FOUND', '중개사 프로필이 없습니다.');
  if (ctx.state === 'SUSPENDED') return fail(403, 'SUSPENDED', '이용이 정지된 계정입니다.');
  const row = await deps.repo.updateProfile(ctx.profile.id, {
    displayName: v.value.displayName,
    officeName: v.value.officeName,
    officePhone: v.value.officePhone,
    officeAddress: v.value.officeAddress,
  });
  if (!row) return fail(404, 'NOT_FOUND', '중개사 프로필이 없습니다.');
  await deps.repo.appendAudit(buildAuditEntry({ actorUserId: actor.userId, actorRole: 'REALTOR', action: 'PROFILE_UPDATED', targetType: 'realtor_profile', targetId: row.id, realtorId: row.id, meta: { fields: ['displayName', 'officeName', 'officePhone', 'officeAddress'] } }));
  return ok(toProfileDto(row));
}

// ── 관리자(호출부가 requireAdmin()을 먼저 통과해야 한다) ──────────────────────

export async function adminListApplications(deps: ProDeps, status: ProfileStatus | null): Promise<ProResult<ProfileDto[]>> {
  if (status && !PROFILE_STATUSES.includes(status)) return INVALID([{ field: 'status', code: 'INVALID' }]);
  return ok((await deps.repo.adminListProfiles(status)).map(toProfileDto));
}

const ALLOWED_TRANSITIONS: Record<ProfileStatus, ProfileStatus[]> = {
  PENDING_REVIEW: ['VERIFIED', 'REJECTED'],
  REJECTED: ['PENDING_REVIEW'],
  VERIFIED: ['SUSPENDED'],
  SUSPENDED: ['VERIFIED'],
};

export async function adminSetStatus(
  deps: ProDeps,
  admin: { userId: string },
  realtorId: string,
  body: unknown
): Promise<ProResult<ProfileDto>> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const to = b.status;
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 200) : '';
  if (typeof to !== 'string' || !PROFILE_STATUSES.includes(to as ProfileStatus)) return INVALID([{ field: 'status', code: 'INVALID' }]);
  const cur = await deps.repo.adminGetProfile(realtorId);
  if (!cur) return fail(404, 'NOT_FOUND', '찾을 수 없습니다.');
  if (!ALLOWED_TRANSITIONS[cur.status].includes(to as ProfileStatus)) return fail(409, 'BAD_TRANSITION', `${cur.status} → ${to} 전환은 허용되지 않습니다.`);
  // REALTOR_PRO_POLICY_HARDENING_V1 — 관리자는 자기 신청을 승인(→VERIFIED, 정지 해제 포함)할 수 없다. 반려·정지는 그대로.
  // 차단 시도는 감사로그에 남기지 않는다: action CHECK 제약에 해당 값이 없어 migration이 필요하다(값 없는 서버 경고만).
  if (to === 'VERIFIED' && cur.userId === admin.userId) {
    console.warn('[pro-admin] self-approval blocked');
    return fail(409, 'SELF_APPROVAL_NOT_ALLOWED', '본인의 중개사 신청은 직접 승인할 수 없습니다. 다른 관리자가 승인해야 합니다.');
  }
  if ((to === 'REJECTED' || to === 'SUSPENDED') && !reason) return INVALID([{ field: 'reason', code: 'REQUIRED' }]);
  const now = deps.now();
  const row = await deps.repo.adminSetProfileStatus(realtorId, { status: to as ProfileStatus, statusReason: reason || null, reviewedByUserId: admin.userId, reviewedAt: now });
  if (!row) return fail(404, 'NOT_FOUND', '찾을 수 없습니다.');
  await deps.repo.appendAudit(buildAuditEntry({ actorUserId: admin.userId, actorRole: 'ADMIN', action: 'PROFILE_STATUS_CHANGE', targetType: 'realtor_profile', targetId: row.id, realtorId: row.id, reason, meta: { fromStatus: cur.status, toStatus: row.status } }));
  return ok(toProfileDto(row));
}

/** 베타 기간 Pro 기능 부여(과금 없음). 관리자만. */
export async function adminGrantBetaPro(deps: ProDeps, admin: { userId: string }, realtorId: string, days: number): Promise<ProResult<{ until: Date }>> {
  if (!Number.isInteger(days) || days < 1 || days > 180) return INVALID([{ field: 'days', code: 'INVALID' }]);
  const cur = await deps.repo.adminGetProfile(realtorId);
  if (!cur || cur.status !== 'VERIFIED') return fail(409, 'NOT_VERIFIED_REALTOR', '인증된 중개사에게만 부여할 수 있습니다.');
  const now = deps.now();
  const until = new Date(now.getTime() + days * 86_400_000);
  await deps.repo.createSubscription(realtorId, { plan: 'PRO', status: 'BETA_GRANT', currentPeriodStart: now, currentPeriodEnd: until });
  await deps.repo.appendAudit(buildAuditEntry({ actorUserId: admin.userId, actorRole: 'ADMIN', action: 'PLAN_CHANGE', targetType: 'realtor_profile', targetId: realtorId, realtorId, meta: { plan: 'PRO', toStatus: 'BETA_GRANT', count: days } }));
  return ok({ until });
}
