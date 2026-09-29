// REALTOR_PRO_MVP_V1 — 팔로업(재연락·방문·계약·입주 일정). 발송(문자·메일·카카오) 없음 — 대시보드 표시만.
//
// Free: 고객당 진행 중(OPEN) 팔로업 1개 · 반복 없음. Pro: 여러 개 + 반복 규칙 저장(자동 재생성은 완료 시 다음 1건).
// 고객의 nextFollowUpAt(대시보드 정렬용 비정규화)은 가장 이른 OPEN 팔로업으로 맞춘다.

import { capabilitiesFor, checkLimit, LIMIT_MESSAGES } from './plan-limits';
import { validateFollowupInput } from './rules';
import { fail, INVALID, NOT_FOUND, ok, requireReader, requireWriter, type ProActor, type ProDeps, type ProResult } from './service-core';
import type { FollowupRow } from './types';

async function syncNextFollowUp(deps: ProDeps, realtorId: string, customerId: string | null) {
  if (!customerId) return;
  const open = await deps.repo.listFollowups(realtorId, { customerId, status: 'OPEN' });
  await deps.repo.updateCustomer(realtorId, customerId, { nextFollowUpAt: open[0]?.dueAt ?? null });
}

export async function listFollowups(deps: ProDeps, actor: ProActor, q: { status?: 'OPEN' | 'DONE' | 'CANCELED'; customerId?: string }): Promise<ProResult<FollowupRow[]>> {
  const ctx = await requireReader(deps, actor);
  if (!ctx.ok) return ctx;
  return ok(await deps.repo.listFollowups(ctx.data.profile.id, { status: q.status, customerId: q.customerId }));
}

export async function createFollowup(deps: ProDeps, actor: ProActor, body: unknown): Promise<ProResult<FollowupRow>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const v = validateFollowupInput(body);
  if (!v.ok) return INVALID(v.errors);
  const realtorId = ctx.data.profile.id;
  const caps = capabilitiesFor(ctx.data.plan);
  // 대상은 본인 소유여야 한다(타인 id를 넣어도 404)
  if (v.value.customerId && !(await deps.repo.getCustomer(realtorId, v.value.customerId))) return NOT_FOUND();
  if (v.value.listingId && !(await deps.repo.getListing(realtorId, v.value.listingId))) return NOT_FOUND();
  if (v.value.repeatRule && !caps.repeatFollowups) return fail(403, 'PLAN_FEATURE', '반복 팔로업은 Pro 기능입니다.');
  if (v.value.customerId) {
    const limit = checkLimit(ctx.data.plan, 'followupsPerCustomer', await deps.repo.countOpenFollowups(realtorId, v.value.customerId));
    if (!limit.allowed) return fail(403, 'PLAN_LIMIT', LIMIT_MESSAGES.followupsPerCustomer(limit.limit));
  }
  const row = await deps.repo.createFollowup(realtorId, { ...v.value, status: 'OPEN', doneAt: null });
  await syncNextFollowUp(deps, realtorId, row.customerId);
  return ok(row);
}

/** 완료/취소/일정 변경. 반복 규칙이 있는 팔로업을 완료하면 다음 1건을 만든다(Pro). */
export async function updateFollowup(deps: ProDeps, actor: ProActor, id: string, body: unknown): Promise<ProResult<FollowupRow>> {
  const ctx = await requireWriter(deps, actor);
  if (!ctx.ok) return ctx;
  const realtorId = ctx.data.profile.id;
  const cur = (await deps.repo.listFollowups(realtorId)).find((f) => f.id === id);
  if (!cur) return NOT_FOUND();
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const patch: Partial<Pick<FollowupRow, 'status' | 'doneAt' | 'note' | 'dueAt'>> = {};
  const now = deps.now();
  if (b.action === 'done') Object.assign(patch, { status: 'DONE', doneAt: now });
  else if (b.action === 'cancel') Object.assign(patch, { status: 'CANCELED', doneAt: null });
  else if (b.action === 'reopen') Object.assign(patch, { status: 'OPEN', doneAt: null });
  else if (b.action === 'reschedule') {
    const d = typeof b.dueAt === 'string' ? new Date(b.dueAt) : null;
    if (!d || Number.isNaN(d.getTime())) return INVALID([{ field: 'dueAt', code: 'INVALID' }]);
    patch.dueAt = d;
  } else return INVALID([{ field: 'action', code: 'INVALID' }]);
  if (typeof b.note === 'string') patch.note = b.note.trim().slice(0, 200) || null;
  const row = await deps.repo.updateFollowup(realtorId, id, patch);
  if (!row) return NOT_FOUND();
  if (b.action === 'done' && cur.repeatRule && capabilitiesFor(ctx.data.plan).repeatFollowups) {
    const next = new Date(cur.dueAt);
    if (cur.repeatRule === 'WEEKLY') next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    await deps.repo.createFollowup(realtorId, { customerId: cur.customerId, listingId: cur.listingId, kind: cur.kind, status: 'OPEN', dueAt: next, note: cur.note, doneAt: null, repeatRule: cur.repeatRule });
  }
  await syncNextFollowUp(deps, realtorId, row.customerId);
  return ok(row);
}
