// REALTOR_PRO_MVP_V1 — 서비스 공통: 의존성·결과 타입·중개사 컨텍스트 로드·쓰기 가드·DTO 변환.
//
// 모든 서비스 함수는 (deps, actor, ...) 형태다. actor.userId는 **서버 세션**에서만 온다(요청 본문의 id를 믿지 않음).
// 소유권: 서비스는 컨텍스트의 profile.id(= realtorId)로만 저장소를 부른다 → 타인 행은 저장소 단계에서 "없음" → 404.
// 존재하지 않음과 타인 소유는 같은 404(타인 리소스 존재 여부를 드러내지 않음).

import { buildAuditEntry } from './audit';
import { resolveRealtorContext, type RealtorContext } from './access';
import type { PiiKeyring } from './crypto';
import type { ProRepo } from './repo';
import type { AuditAction, FieldError } from './rules';
import type { CustomerRow, ListingRow, PublicAptInfo } from './types';
import { maskPhone } from './rules';

export interface PublicAptDataSource {
  lookup(aptSeq: string): Promise<PublicAptInfo | null>;
}

export interface ProDeps {
  repo: ProRepo;
  ring: PiiKeyring | null; // 키 미설정이면 null — 연락처 저장·복호화 불가(나머지는 동작)
  now: () => Date;
  publicData: PublicAptDataSource;
}

export interface ProActor {
  userId: string;
}

export type ProError = { ok: false; status: number; code: string; message: string; fields?: FieldError[]; sensitiveFields?: string[] };
export type ProResult<T> = { ok: true; data: T } | ProError;

export const ok = <T>(data: T): ProResult<T> => ({ ok: true, data });
export const fail = (status: number, code: string, message: string, extra: Partial<ProError> = {}): ProError => ({ ok: false, status, code, message, ...extra });

export const NOT_FOUND = () => fail(404, 'NOT_FOUND', '찾을 수 없습니다.');
export const INVALID = (fields: FieldError[]) => fail(400, 'INVALID_INPUT', '입력값을 확인해 주세요.', { fields });

export async function loadContext(deps: ProDeps, actor: ProActor): Promise<RealtorContext> {
  const profile = await deps.repo.findProfileByUserId(actor.userId);
  const subs = profile ? await deps.repo.listSubscriptions(profile.id) : [];
  return resolveRealtorContext(profile, subs, deps.now());
}

/** 읽기 가능한 중개사(VERIFIED 또는 SUSPENDED) 컨텍스트. 아니면 403. */
export async function requireReader(deps: ProDeps, actor: ProActor): Promise<ProResult<RealtorContext & { profile: NonNullable<RealtorContext['profile']> }>> {
  const ctx = await loadContext(deps, actor);
  if (!ctx.canRead || !ctx.profile) return fail(403, 'NOT_VERIFIED_REALTOR', '인증된 중개사만 사용할 수 있습니다.');
  return ok(ctx as RealtorContext & { profile: NonNullable<RealtorContext['profile']> });
}

/** 쓰기 가능한 중개사(VERIFIED만). 정지 중이면 403 SUSPENDED. */
export async function requireWriter(deps: ProDeps, actor: ProActor): Promise<ProResult<RealtorContext & { profile: NonNullable<RealtorContext['profile']> }>> {
  const ctx = await loadContext(deps, actor);
  if (ctx.state === 'SUSPENDED') return fail(403, 'SUSPENDED', '이용이 정지된 계정입니다. 조회와 내보내기만 가능합니다.');
  if (!ctx.canWrite || !ctx.profile) return fail(403, 'NOT_VERIFIED_REALTOR', '인증된 중개사만 사용할 수 있습니다.');
  return ok(ctx as RealtorContext & { profile: NonNullable<RealtorContext['profile']> });
}

export async function audit(deps: ProDeps, actor: ProActor, realtorId: string | null, action: AuditAction, targetType: string, targetId: string | null, meta?: Record<string, unknown>) {
  await deps.repo.appendAudit(buildAuditEntry({ actorUserId: actor.userId, actorRole: 'REALTOR', action, targetType, targetId, realtorId, meta }));
}

// ── DTO(클라이언트로 내보내는 모양): 암호문·해시·소유 id를 싣지 않는다 ─────────────

export type ListingDto = Omit<ListingRow, 'realtorId' | 'ownerPhoneEnc' | 'ownerPhoneHash' | 'deletedAt'> & { hasOwnerPhone: boolean };

export function toListingDto(l: ListingRow): ListingDto {
  const { realtorId: _r, ownerPhoneEnc, ownerPhoneHash: _h, deletedAt: _d, ...rest } = l;
  return { ...rest, hasOwnerPhone: !!ownerPhoneEnc };
}

export type CustomerDto = Omit<CustomerRow, 'realtorId' | 'phoneEnc' | 'phoneHash' | 'emailEnc' | 'emailHash' | 'deletedAt'> & { hasPhone: boolean; hasEmail: boolean };

export function toCustomerDto(c: CustomerRow): CustomerDto {
  const { realtorId: _r, phoneEnc, phoneHash: _p, emailEnc, emailHash: _e, deletedAt: _d, ...rest } = c;
  return { ...rest, hasPhone: !!phoneEnc, hasEmail: !!emailEnc };
}

export { maskPhone };
