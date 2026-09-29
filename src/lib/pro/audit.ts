// REALTOR_PRO_MVP_V1 — 감사로그 항목 조립(순수). docs/pro/REALTOR_PRO_V1_ARCHITECTURE.md §7.8
//
// 감사로그에는 **누가·무엇을·어느 대상에** 했는지만 남긴다. 연락처·이메일·메모·이름·토큰·키는 절대 넣지 않는다.
// meta는 allowlist 키만 통과시키고, 값도 짧은 식별 문자열·숫자·불리언·필드 이름 목록으로 제한한다.

import type { AuditAction, AuditActorRole } from './rules';
import type { AuditRow } from './types';

export const AUDIT_META_KEYS = ['count', 'fromStatus', 'toStatus', 'plan', 'fields', 'expiresInDays', 'engineVersion', 'sensitiveWarningAccepted'] as const;
type MetaKey = (typeof AUDIT_META_KEYS)[number];
export type AuditMeta = Partial<Record<MetaKey, string | number | boolean | string[]>>;

const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,40}$/;

function sanitizeMeta(meta: Record<string, unknown> | undefined): AuditRow['meta'] {
  if (!meta) return null;
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const key of AUDIT_META_KEYS) {
    const v = meta[key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string' && SAFE_TOKEN.test(v)) out[key] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'string' && SAFE_TOKEN.test(x))) out[key] = v.slice(0, 30) as string[];
  }
  return Object.keys(out).length ? out : null;
}

export function buildAuditEntry(input: {
  actorUserId: string | null;
  actorRole: AuditActorRole;
  action: AuditAction;
  targetType: string;
  targetId: string | null;
  realtorId: string | null;
  reason?: string | null;
  meta?: Record<string, unknown>;
}): Omit<AuditRow, 'id' | 'createdAt'> {
  return {
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    targetType: SAFE_TOKEN.test(input.targetType) ? input.targetType : 'UNKNOWN',
    targetId: input.targetId && SAFE_TOKEN.test(input.targetId) ? input.targetId : null,
    realtorId: input.realtorId && SAFE_TOKEN.test(input.realtorId) ? input.realtorId : null,
    // reason은 관리자 사유 같은 짧은 설명만 — 길이 제한, 전화·이메일 형태는 가린다
    reason: input.reason ? input.reason.slice(0, 200).replace(/\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4}/g, '[redacted]').replace(/[^\s@]+@[^\s@]+/g, '[redacted]') : null,
    meta: sanitizeMeta(input.meta),
  };
}
