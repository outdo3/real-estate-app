// REALTOR_PRO_MVP_V1 — 고객 CRM. docs/pro/REALTOR_PRO_V1_ARCHITECTURE.md §7
//
// · 구조화 매칭 조건(realtor_customer_preferences)과 자유 메모(realtor_customers.memo)는 분리 — 메모는 매칭 입력이 아니다.
// · 연락처(전화·이메일)는 즉시 암호화 + HMAC 조회 해시. 목록·상세 DTO에는 "있음/없음"만. 조회는 명시적 경로(감사로그).
// · 삭제는 soft delete(30일 후 hard delete — 보존 배치 Phase 4). 삭제된 고객은 어디서도 조회되지 않는다(404).

import { checkLimit, LIMIT_MESSAGES } from './plan-limits';
import { decryptField, protectEmail, protectPhone } from './crypto';
import {
  CUSTOMER_FREE_TEXT_KEYS,
  SENSITIVE_WARNING,
  sensitiveFieldsIn,
  validateCustomerInput,
  validatePreferenceInput,
  type CustomerInput,
} from './rules';
import {
  audit,
  fail,
  INVALID,
  NOT_FOUND,
  ok,
  requireReader,
  requireWriter,
  toCustomerDto,
  type CustomerDto,
  type ProActor,
  type ProDeps,
  type ProResult,
} from './service-core';
import type { CustomerWrite, FollowupRow, PreferenceRow, PreferenceWrite } from './types';

function sensitiveGate(body: unknown): ProResult<null> {
  const fields = body && typeof body === 'object' ? sensitiveFieldsIn(body as Record<string, unknown>, CUSTOMER_FREE_TEXT_KEYS) : [];
  if (fields.length && (body as Record<string, unknown>).confirmSensitive !== true) return fail(422, 'SENSITIVE_TEXT_CONFIRM', SENSITIVE_WARNING, { sensitiveFields: fields });
  return ok(null);
}

function contactWrites(input: Partial<CustomerInput>, deps: ProDeps): ProResult<Partial<CustomerWrite>> {
  const out: Partial<CustomerWrite> = {};
  const hasPhone = Object.prototype.hasOwnProperty.call(input, 'phone');
  const hasEmail = Object.prototype.hasOwnProperty.call(input, 'email');
  if ((input.phone || input.email) && !deps.ring) return fail(503, 'PII_KEY_MISSING', '보안 설정이 끝나지 않아 연락처를 저장할 수 없습니다.');
  if (hasPhone) {
    const p = deps.ring ? protectPhone(input.phone ?? null, deps.ring) : { enc: null, hash: null };
    out.phoneEnc = p.enc;
    out.phoneHash = p.hash;
  }
  if (hasEmail) {
    const e = deps.ring ? protectEmail(input.email ?? null, deps.ring) : { enc: null, hash: null };
    out.emailEnc = e.enc;
    out.emailHash = e.hash;
  }
  return ok(out);
}

export async function listCustomers(deps: ProDeps, actor: ProActor, q: { search?: string | null; includeClosed?: boolean }): Promise<ProResult<{ items: CustomerDto[]; count: number; limit: number }>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const rows = await deps.repo.listCustomers(realtorId, { search: q.search?.slice(0, 40) ?? null, includeClosed: !!q.includeClosed });
  const count = await deps.repo.countCustomers(realtorId);
  return ok({ items: rows.map(toCustomerDto), count, limit: checkLimit(ctx.data.plan, 'customers', count).limit });
}

export async function createCustomer(deps: ProDeps, actor: ProActor, body: unknown): Promise<ProResult<CustomerDto>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const v = validateCustomerInput(body);
  if (!v.ok) return INVALID(v.errors);
  const gate = sensitiveGate(body);
  if (!gate.ok) return gate;
  const realtorId = ctx.data.profile.id;
  const limit = checkLimit(ctx.data.plan, 'customers', await deps.repo.countCustomers(realtorId));
  if (!limit.allowed) return fail(403, 'PLAN_LIMIT', LIMIT_MESSAGES.customers(limit.limit));
  const contacts = contactWrites(v.value, deps);
  if (!contacts.ok) return contacts;
  const now = deps.now();
  const input = v.value as CustomerInput;
  const data: CustomerWrite = {
    name: input.name,
    phoneEnc: contacts.data.phoneEnc ?? null,
    phoneHash: contacts.data.phoneHash ?? null,
    emailEnc: contacts.data.emailEnc ?? null,
    emailHash: contacts.data.emailHash ?? null,
    status: input.status,
    priority: input.priority,
    nextFollowUpAt: null,
    memo: input.memo,
    consentStatus: input.consentStatus,
    consentRecordedAt: input.consentStatus === 'NOT_RECORDED' ? null : now,
    lastActivityAt: now,
    deletedAt: null,
  };
  const row = await deps.repo.createCustomer(realtorId, data);
  await audit(deps, actor, realtorId, 'CUSTOMER_CREATED', 'realtor_customer', row.id);
  return ok(toCustomerDto(row));
}

export interface CustomerDetail {
  customer: CustomerDto;
  preferences: PreferenceRow[];
  followups: FollowupRow[];
}

export async function getCustomer(deps: ProDeps, actor: ProActor, id: string): Promise<ProResult<CustomerDetail>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const row = await deps.repo.getCustomer(realtorId, id);
  if (!row) return NOT_FOUND();
  const preferences = await deps.repo.listPreferences(realtorId, id);
  const followups = await deps.repo.listFollowups(realtorId, { customerId: id });
  await audit(deps, actor, realtorId, 'CUSTOMER_VIEWED', 'realtor_customer', id);
  return ok({ customer: toCustomerDto(row), preferences, followups });
}

export async function updateCustomer(deps: ProDeps, actor: ProActor, id: string, body: unknown): Promise<ProResult<CustomerDto>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const cur = await deps.repo.getCustomer(realtorId, id);
  if (!cur) return NOT_FOUND();
  const v = validateCustomerInput(body, { partial: true });
  if (!v.ok) return INVALID(v.errors);
  const gate = sensitiveGate(body);
  if (!gate.ok) return gate;
  const contacts = contactWrites(v.value, deps);
  if (!contacts.ok) return contacts;
  const { phone: _p, email: _e, ...plain } = v.value;
  const now = deps.now();
  const data: Partial<CustomerWrite> = { ...plain, ...contacts.data, lastActivityAt: now };
  if (plain.consentStatus && plain.consentStatus !== cur.consentStatus) data.consentRecordedAt = plain.consentStatus === 'NOT_RECORDED' ? null : now;
  const row = await deps.repo.updateCustomer(realtorId, id, data);
  if (!row) return NOT_FOUND();
  await audit(deps, actor, realtorId, 'CUSTOMER_UPDATED', 'realtor_customer', id, { fields: Object.keys(v.value) });
  return ok(toCustomerDto(row));
}

/** soft delete + 연락처·메모 즉시 비움(보존 배치 전에도 개인정보가 남지 않게). */
export async function deleteCustomer(deps: ProDeps, actor: ProActor, id: string): Promise<ProResult<{ deleted: true }>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const row = await deps.repo.updateCustomer(realtorId, id, { deletedAt: deps.now(), phoneEnc: null, phoneHash: null, emailEnc: null, emailHash: null, memo: null });
  if (!row) return NOT_FOUND();
  await audit(deps, actor, realtorId, 'CUSTOMER_DELETED', 'realtor_customer', id);
  return ok({ deleted: true });
}

export async function revealCustomerContact(deps: ProDeps, actor: ProActor, id: string): Promise<ProResult<{ phone: string | null; email: string | null }>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const row = await deps.repo.getCustomer(realtorId, id);
  if (!row) return NOT_FOUND();
  if ((row.phoneEnc || row.emailEnc) && !deps.ring) return fail(503, 'PII_KEY_MISSING', '보안 설정이 끝나지 않아 연락처를 볼 수 없습니다.');
  try {
    const phone = deps.ring ? decryptField(row.phoneEnc, deps.ring) : null;
    const email = deps.ring ? decryptField(row.emailEnc, deps.ring) : null;
    await audit(deps, actor, realtorId, 'CONTACT_DECRYPTED', 'realtor_customer', id, { fields: [phone ? 'phone' : null, email ? 'email' : null].filter(Boolean) as string[] });
    return ok({ phone, email });
  } catch {
    return fail(500, 'DECRYPT_FAILED', '연락처를 복호화하지 못했습니다. 관리자에게 문의해 주세요.');
  }
}

// ── 조건 세트 ────────────────────────────────────────────────────────────────

/** 조건 세트 생성(preferenceId 없음) 또는 수정. Free 1세트 / Pro 3세트. */
export async function savePreference(deps: ProDeps, actor: ProActor, customerId: string, preferenceId: string | null, body: unknown): Promise<ProResult<PreferenceRow>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const customer = await deps.repo.getCustomer(realtorId, customerId);
  if (!customer) return NOT_FOUND();
  const v = validatePreferenceInput(body);
  if (!v.ok) return INVALID(v.errors);
  const data: PreferenceWrite = v.value;
  let row: PreferenceRow | null;
  if (preferenceId) {
    const existing = (await deps.repo.listPreferences(realtorId, customerId)).find((p) => p.id === preferenceId);
    if (!existing) return NOT_FOUND();
    row = await deps.repo.updatePreference(realtorId, preferenceId, data);
  } else {
    const count = (await deps.repo.listPreferences(realtorId, customerId)).length;
    const limit = checkLimit(ctx.data.plan, 'preferenceSetsPerCustomer', count);
    if (!limit.allowed) return fail(403, 'PLAN_LIMIT', LIMIT_MESSAGES.preferenceSetsPerCustomer(limit.limit));
    row = await deps.repo.createPreference(realtorId, customerId, data);
  }
  if (!row) return NOT_FOUND();
  await deps.repo.updateCustomer(realtorId, customerId, { lastActivityAt: deps.now() });
  await audit(deps, actor, realtorId, 'CUSTOMER_UPDATED', 'realtor_customer', customerId, { fields: ['preferences'] });
  return ok(row);
}
