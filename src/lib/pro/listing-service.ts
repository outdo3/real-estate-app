// REALTOR_PRO_MVP_V1 — 비공개 매물 노트. docs/pro/REALTOR_PRO_V1_ARCHITECTURE.md §5·§7
//
// · aptSeq는 이집 검색 결과(APARTMENT 계약)에서 받은 값만 저장한다 — 이름으로 다른 단지를 찾아 연결하지 않는다.
//   aptSeq 없는 매물("단지 정보 미연결")도 저장 가능, 단지 기반 prefill·매칭 조건은 확인 필요로 남는다.
// · 공공 단지 정보(준공·세대수 등)는 복제 저장하지 않고 aptSeq로 조회한다(표시용 이름 스냅샷만 저장).
// · 소유자 연락처는 즉시 암호화(평문 저장·로그 없음). 조회는 명시적 "연락처 보기"(감사로그) 경로만.
// · 자유 텍스트에 비밀번호·열쇠 패턴이 있으면 confirmSensitive=true 없이 저장하지 않는다.

import { capabilitiesFor, checkLimit, LIMIT_MESSAGES } from './plan-limits';
import { decryptField, protectPhone } from './crypto';
import {
  checkDealPrices,
  LISTING_FREE_TEXT_KEYS,
  SENSITIVE_WARNING,
  sensitiveFieldsIn,
  validateListingInput,
  type ListingInput,
} from './rules';
import {
  audit,
  fail,
  INVALID,
  NOT_FOUND,
  ok,
  requireReader,
  requireWriter,
  toListingDto,
  type ListingDto,
  type ProActor,
  type ProDeps,
  type ProResult,
} from './service-core';
import type { ListingNoteRow, ListingRow, ListingWrite, PublicAptInfo } from './types';

function isConfirmed(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as Record<string, unknown>).confirmSensitive === true;
}

function sensitiveGate(body: unknown): ProResult<null> {
  const fields = body && typeof body === 'object' ? sensitiveFieldsIn(body as Record<string, unknown>, LISTING_FREE_TEXT_KEYS) : [];
  if (fields.length && !isConfirmed(body)) return fail(422, 'SENSITIVE_TEXT_CONFIRM', SENSITIVE_WARNING, { sensitiveFields: fields });
  return ok(null);
}

function toWrite(input: Partial<ListingInput>, phone: { enc: string | null; hash: string | null } | null): Partial<ListingWrite> {
  const { ownerPhone: _p, ...rest } = input;
  const out: Partial<ListingWrite> = { ...rest };
  if (phone) {
    out.ownerPhoneEnc = phone.enc;
    out.ownerPhoneHash = phone.hash;
  }
  return out;
}

export async function listListings(deps: ProDeps, actor: ProActor, q: { includeArchived?: boolean; search?: string | null }): Promise<ProResult<{ items: ListingDto[]; activeCount: number; limit: number }>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const rows = await deps.repo.listListings(realtorId, { includeArchived: !!q.includeArchived, search: q.search?.slice(0, 40) ?? null });
  const activeCount = await deps.repo.countActiveListings(realtorId);
  return ok({ items: rows.map(toListingDto), activeCount, limit: capabilitiesFor(ctx.data.plan).activeListings });
}

export async function createListing(deps: ProDeps, actor: ProActor, body: unknown): Promise<ProResult<ListingDto>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const v = validateListingInput(body);
  if (!v.ok) return INVALID(v.errors);
  const gate = sensitiveGate(body);
  if (!gate.ok) return gate;
  const realtorId = ctx.data.profile.id;
  const used = await deps.repo.countActiveListings(realtorId);
  const limit = checkLimit(ctx.data.plan, 'activeListings', used);
  if (!limit.allowed) return fail(403, 'PLAN_LIMIT', LIMIT_MESSAGES.activeListings(limit.limit), {});
  if (v.value.ownerPhone && !deps.ring) return fail(503, 'PII_KEY_MISSING', '보안 설정이 끝나지 않아 연락처를 저장할 수 없습니다.');
  const phone = deps.ring ? protectPhone(v.value.ownerPhone ?? null, deps.ring) : { enc: null, hash: null };
  const input = v.value as ListingInput;
  const data: ListingWrite = {
    ...(toWrite(input, phone) as ListingWrite),
    ownerPhoneEnc: phone.enc,
    ownerPhoneHash: phone.hash,
    isActive: true,
    closedAt: null,
    priceChangedAt: null,
    deletedAt: null,
  };
  const row = await deps.repo.createListing(realtorId, data);
  await audit(deps, actor, realtorId, 'LISTING_CREATED', 'realtor_listing', row.id, { sensitiveWarningAccepted: isConfirmed(body) });
  return ok(toListingDto(row));
}

export interface ListingDetail {
  listing: ListingDto;
  notes: ListingNoteRow[];
  publicInfo: PublicAptInfo | null;
}

export async function getListing(deps: ProDeps, actor: ProActor, id: string): Promise<ProResult<ListingDetail>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const row = await deps.repo.getListing(realtorId, id);
  if (!row) return NOT_FOUND();
  const history = capabilitiesFor(ctx.data.plan).listingNoteHistory;
  const notes = await deps.repo.listListingNotes(realtorId, id, history === 'FULL' ? 100 : 1);
  const publicInfo = row.aptSeq ? await deps.publicData.lookup(row.aptSeq) : null;
  return ok({ listing: toListingDto(row), notes, publicInfo });
}

export async function updateListing(deps: ProDeps, actor: ProActor, id: string, body: unknown): Promise<ProResult<ListingDto>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const cur = await deps.repo.getListing(realtorId, id);
  if (!cur) return NOT_FOUND();
  const v = validateListingInput(body, { partial: true });
  if (!v.ok) return INVALID(v.errors);
  const gate = sensitiveGate(body);
  if (!gate.ok) return gate;
  const merged = { ...cur, ...v.value } as ListingRow & Partial<ListingInput>;
  const priceErr = checkDealPrices(merged);
  if (priceErr) return INVALID([priceErr]);

  let phone: { enc: string | null; hash: string | null } | null = null;
  if (Object.prototype.hasOwnProperty.call(v.value, 'ownerPhone')) {
    if (v.value.ownerPhone && !deps.ring) return fail(503, 'PII_KEY_MISSING', '보안 설정이 끝나지 않아 연락처를 저장할 수 없습니다.');
    phone = deps.ring ? protectPhone(v.value.ownerPhone ?? null, deps.ring) : { enc: null, hash: null };
  }
  const data = toWrite(v.value, phone);
  const priceKey = cur.dealType === 'SALE' ? 'askingPriceManwon' : 'depositManwon';
  const prevPrice = cur[priceKey];
  const nextPrice = (data as Record<string, unknown>)[priceKey] as number | null | undefined;
  const priceChanged = nextPrice !== undefined && nextPrice !== prevPrice;
  if (priceChanged) data.priceChangedAt = deps.now();

  const row = await deps.repo.updateListing(realtorId, id, data);
  if (!row) return NOT_FOUND();
  if (priceChanged) await deps.repo.addListingNote(realtorId, id, { kind: 'PRICE_CHANGE', body: null, prevPriceManwon: prevPrice, newPriceManwon: nextPrice ?? null });
  await audit(deps, actor, realtorId, 'LISTING_UPDATED', 'realtor_listing', id, { fields: Object.keys(v.value).filter((k) => k !== 'ownerPhone').concat(phone ? ['ownerPhone'] : []) });
  return ok(toListingDto(row));
}

/** 보관(비활성) ↔ 재활성화. 재활성화는 활성 한도를 다시 검사한다. 계약완료(closed)도 여기서. */
export async function setListingActive(deps: ProDeps, actor: ProActor, id: string, body: unknown): Promise<ProResult<ListingDto>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const cur = await deps.repo.getListing(realtorId, id);
  if (!cur) return NOT_FOUND();
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const active = b.active === true;
  const closed = b.closed === true;
  if (active && !cur.isActive) {
    const used = await deps.repo.countActiveListings(realtorId);
    const limit = checkLimit(ctx.data.plan, 'activeListings', used);
    if (!limit.allowed) return fail(403, 'PLAN_LIMIT', LIMIT_MESSAGES.activeListings(limit.limit));
  }
  const now = deps.now();
  const row = await deps.repo.updateListing(realtorId, id, { isActive: active, closedAt: closed ? now : active ? null : cur.closedAt });
  if (!row) return NOT_FOUND();
  await deps.repo.addListingNote(realtorId, id, { kind: 'STATUS_CHANGE', body: active ? '활성' : closed ? '계약완료' : '보관', prevPriceManwon: null, newPriceManwon: null });
  await audit(deps, actor, realtorId, 'LISTING_ARCHIVED', 'realtor_listing', id, { toStatus: active ? 'ACTIVE' : closed ? 'CLOSED' : 'ARCHIVED' });
  return ok(toListingDto(row));
}

/** soft delete(30일 후 hard delete는 보존 배치 — Phase 4). */
export async function deleteListing(deps: ProDeps, actor: ProActor, id: string): Promise<ProResult<{ deleted: true }>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const row = await deps.repo.updateListing(realtorId, id, { deletedAt: deps.now(), isActive: false });
  if (!row) return NOT_FOUND();
  await audit(deps, actor, realtorId, 'LISTING_DELETED', 'realtor_listing', id);
  return ok({ deleted: true });
}

export async function addListingNote(deps: ProDeps, actor: ProActor, id: string, body: unknown): Promise<ProResult<ListingNoteRow>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const text = typeof b.body === 'string' ? b.body.trim() : '';
  if (!text || text.length > 2000) return INVALID([{ field: 'body', code: text ? 'TOO_LONG' : 'REQUIRED' }]);
  if (sensitiveFieldsIn({ body: text }, ['body']).length && b.confirmSensitive !== true) return fail(422, 'SENSITIVE_TEXT_CONFIRM', SENSITIVE_WARNING, { sensitiveFields: ['body'] });
  const note = await deps.repo.addListingNote(ctx.data.profile.id, id, { kind: 'NOTE', body: text, prevPriceManwon: null, newPriceManwon: null });
  if (!note) return NOT_FOUND();
  return ok(note);
}

/** 소유자 연락처 복호화(명시적 조회). 매 호출 감사로그 — 로그에는 대상 id와 필드 이름만. */
export async function revealListingOwnerContact(deps: ProDeps, actor: ProActor, id: string): Promise<ProResult<{ ownerName: string | null; ownerPhone: string | null }>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const row = await deps.repo.getListing(realtorId, id);
  if (!row) return NOT_FOUND();
  if (row.ownerPhoneEnc && !deps.ring) return fail(503, 'PII_KEY_MISSING', '보안 설정이 끝나지 않아 연락처를 볼 수 없습니다.');
  let phone: string | null = null;
  try {
    phone = deps.ring ? decryptField(row.ownerPhoneEnc, deps.ring) : null;
  } catch {
    return fail(500, 'DECRYPT_FAILED', '연락처를 복호화하지 못했습니다. 관리자에게 문의해 주세요.');
  }
  await audit(deps, actor, realtorId, 'CONTACT_DECRYPTED', 'realtor_listing', id, { fields: ['ownerPhone'] });
  return ok({ ownerName: row.ownerName, ownerPhone: phone });
}

/** 매물 등록 전 단지 prefill(공공 데이터, aptSeq로만). 인증 중개사만. 형식이 틀린 aptSeq는 조회하지 않는다. */
export async function getApartmentPrefill(deps: ProDeps, actor: ProActor, aptSeq: string): Promise<ProResult<PublicAptInfo | null>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  if (!/^\d{5}-\d{1,12}$/.test(aptSeq)) return INVALID([{ field: 'aptSeq', code: 'INVALID' }]);
  return ok(await deps.publicData.lookup(aptSeq));
}
