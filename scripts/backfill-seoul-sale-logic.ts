// SEOUL_SALE_BACKFILL_DRIVER_V1 — 서울 매매 full-history backfill driver의 순수 판정(DB·네트워크 없음).
//
// 쓰기 판정은 운영 cron과 **같은 함수**(src/lib/sync/sale-sync-core.ts `planSaleCellWrites`)를 쓴다.
// 이 모듈은 그 앞뒤의 범위·게이트·quota·셀 상태·master 분류·기존 행 변경(drift) 표시만 맡는다.

import type { TradeRowInput } from './trade-history-logic';
import type { ExistingTradeRow, SaleCellPlan } from '../src/lib/sync/sale-sync-core';
import { SEOUL_CODES } from './seed-seoul-apartment-master-logic';

/** 원천의 서울 매매 가장 이른 달(SEOUL_SALE_BACKFILL_PLAN_V1 §2 실측: 강서구 2005-07). */
export const SEOUL_SALE_START = '200507';

export function kstYm(now = new Date()): string {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}${String(k.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' 또는 'YYYYMM' → 'YYYYMM'. 형식이 틀리면 null. */
export function parseYm(v: string | undefined | null): string | null {
  if (!v) return null;
  const m = /^(\d{4})-?(\d{2})$/.exec(v.trim());
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}${m[2]}`;
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(4));
  const ey = Number(to.slice(0, 4));
  const em = Number(to.slice(4));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export interface Scope { districts: string[]; from: string; to: string; cells: { lawdCd: string; ym: string }[] }

/** 구·기간 → 셀 목록. 서울 25구만, 2005-07 이후, 현재 KST 달 이하. */
export function resolveScope(input: { districts: string[] | null; from: string | null; to: string | null; now?: Date }): { scope: Scope | null; errors: string[] } {
  const errors: string[] = [];
  const districts = input.districts ?? [];
  if (!districts.length) errors.push('DISTRICT_REQUIRED');
  for (const d of districts) if (!SEOUL_CODES.has(d)) errors.push(`NOT_SEOUL_DISTRICT_${d}`);
  const latest = kstYm(input.now);
  const from = input.from ?? SEOUL_SALE_START;
  const to = input.to ?? latest;
  if (from < SEOUL_SALE_START) errors.push(`FROM_BEFORE_${SEOUL_SALE_START}`);
  if (to > latest) errors.push(`TO_AFTER_${latest}`);
  if (from > to) errors.push('FROM_AFTER_TO');
  if (errors.length) return { scope: null, errors };
  const months = monthRange(from, to);
  return { scope: { districts, from, to, cells: districts.flatMap((lawdCd) => months.map((ym) => ({ lawdCd, ym }))) }, errors };
}

export type MasterClass = 'EXACT_MASTER' | 'MASTER_MISSING' | 'INVALID_APTSEQ' | 'REVIEW_REQUIRED';

/** 거래 → master: aptSeq 정확 일치만(이름·지번 추정 없음). 조회 구와 aptSeq 구가 다르면(이웃 구 오기재) REVIEW. */
export function classifyTradeMaster(row: Pick<TradeRowInput, 'aptSeq' | 'lawdCd'>, masters: ReadonlySet<string>): MasterClass {
  const seq = (row.aptSeq ?? '').trim();
  if (!/^\d{5}-\d+$/.test(seq) || !SEOUL_CODES.has(seq.slice(0, 5))) return 'INVALID_APTSEQ';
  if (seq.slice(0, 5) !== row.lawdCd) return 'REVIEW_REQUIRED';
  return masters.has(seq) ? 'EXACT_MASTER' : 'MASTER_MISSING';
}

export type CellState = 'PENDING' | 'FETCHED' | 'VALIDATED' | 'READY' | 'APPLIED' | 'PARTIAL' | 'BLOCKED';

/**
 * 계획 → 셀 상태. 쓰기 계획이 원천 신뢰 문제(형제 identity 불일치·insert 대조 불가)를 담고 있으면 BLOCKED(적재 보류).
 * 기존 행 UPDATE(취소 flip·restore·등기일 보충)는 READY로 두되 apply 시 별도 승인을 요구한다(evaluateApplyGates).
 */
export function cellStateFromPlan(plan: Pick<SaleCellPlan, 'reviewCandidates' | 'insertReconcileSkipped' | 'cancelReconcileSkipped'>): { state: 'READY' | 'BLOCKED'; reasons: string[] } {
  const reasons: string[] = [];
  if (plan.reviewCandidates > 0) reasons.push(`REVIEW_CANDIDATES_${plan.reviewCandidates}`);
  if (plan.insertReconcileSkipped > 0) reasons.push(`INSERT_RECONCILE_SKIPPED_${plan.insertReconcileSkipped}`);
  if (plan.cancelReconcileSkipped > 0) reasons.push(`CANCEL_RECONCILE_SKIPPED_${plan.cancelReconcileSkipped}`);
  return { state: reasons.length ? 'BLOCKED' : 'READY', reasons };
}

export interface DriftRow {
  id: number;
  kind: 'CANCEL_FLIP' | 'CANCEL_RESTORE' | 'REGISTRY_SUPPLEMENT';
  groupKeyStr: string;
  dealAmount: number;
  dealDate: string;
  floor: number | null;
  occurrenceIndex: number;
  dbCanceled: boolean;
  after: Record<string, unknown>;
}

/** 계획 중 **기존 행을 바꾸는** 항목(취소 flip·restore·등기일 보충) — apply 전에 명시 승인 대상. */
export function existingRowDrift(plan: Pick<SaleCellPlan, 'cancelFlips' | 'cancelRestores' | 'registrySupplements'>, existing: readonly ExistingTradeRow[]): DriftRow[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const base = (e: ExistingTradeRow) => ({ groupKeyStr: e.groupKeyStr, dealAmount: e.dealAmount, dealDate: e.dealDate.toISOString().slice(0, 10), floor: e.floor, occurrenceIndex: e.occurrenceIndex, dbCanceled: e.dealCanceled });
  const out: DriftRow[] = [];
  for (const f of plan.cancelFlips) { const e = byId.get(f.id); if (e) out.push({ id: f.id, kind: 'CANCEL_FLIP', ...base(e), after: { dealCanceled: true, cancelDate: f.cancelDate } }); }
  for (const id of plan.cancelRestores) { const e = byId.get(id); if (e) out.push({ id, kind: 'CANCEL_RESTORE', ...base(e), after: { dealCanceled: false, cancelDate: null } }); }
  for (const s of plan.registrySupplements) { const e = byId.get(s.id); if (e) out.push({ id: s.id, kind: 'REGISTRY_SUPPLEMENT', ...base(e), after: { registryDate: s.registryDate } }); }
  return out;
}

// ── SEOUL_SALE_NATURAL_KEY_COLLISION_PATCH_V1 ────────────────────────────────
//
// DB 자연키 unique는 `(group_key, deal_amount, deal_date, floor, occurrence_index)`로
// **lawdCd를 포함하지 않는다**. MOLIT이 같은 거래를 이웃 구 응답에도 실어 보내면(서울 실측
// 33행) 두 셀이 같은 자연키를 만들고, `createMany skipDuplicates`가 나중 쪽을 조용히 건너뛴다.
// 그러면 실제 inserted가 계획보다 작아져 applyMatchesPlan이 **정상 apply를 오탐 정지**시킨다.
//
// 그래서 계획 단계에서 건너뛸 수를 미리 센다. 건너뛰는 이유는 둘뿐이고 둘 다 결정적이다:
//   DB_EXISTS   이미 DB에 그 자연키가 있다(다른 구·다른 달·이전 실행이 넣었다)
//   RUN_EARLIER 이번 실행의 **앞선 셀**이 같은 자연키를 넣을 예정이다
//
// sale-sync-core(취소 판정)는 건드리지 않는다 — 이 계산은 driver 바깥에서만 쓴다.

/** DB unique와 같은 자연키 문자열. lawdCd·dealYmd는 들어가지 않는다(그것이 충돌의 원인이다). */
export function naturalKeyOf(r: { groupKeyStr: string; dealAmount: number; dealDate: string; floor: number | null; occurrenceIndex: number }): string {
  return `${r.groupKeyStr}|${r.dealAmount}|${r.dealDate}|${r.floor}|${r.occurrenceIndex}`;
}

/** aptSeq 앞 5자리가 canonical 구다. 형식이 아니면 null — 이름·지번으로 추측하지 않는다. */
export function canonicalLawdCdOf(aptSeq: string | null | undefined): string | null {
  const m = /^(\d{5})-\d+$/.exec((aptSeq ?? '').trim());
  return m ? m[1] : null;
}

export type SkipReason = 'DB_EXISTS' | 'RUN_EARLIER';

export interface PlannedInsertKey {
  naturalKey: string;
  aptSeq: string | null;
}

export interface CellPlannedKeys {
  lawdCd: string;
  ym: string;
  /** 이 셀이 넣으려는 행들의 자연키(계획 순서 그대로). */
  keys: PlannedInsertKey[];
}

export interface CellSkips {
  lawdCd: string;
  ym: string;
  plannedInserts: number;
  expectedSkips: number;
  expectedActualInserts: number;
  skipped: { naturalKey: string; aptSeq: string | null; reason: SkipReason; canonicalLawdCd: string | null; ownerIsCanonical: boolean | null }[];
}

export interface ExpectedSkipsResult {
  cells: CellSkips[];
  plannedInserts: number;
  expectedSkips: number;
  expectedActualInserts: number;
  /** canonical 구가 아닌 셀이 자연키를 먼저 차지하는 경우 — 적용 순서를 바꾸라는 신호. */
  nonCanonicalOwnerWarnings: { naturalKey: string; aptSeq: string | null; claimedBy: string; canonicalLawdCd: string | null }[];
}

/**
 * 셀들을 **실제 적용 순서 그대로** 훑으며 건너뛸 행을 센다(순서에 의존하지 않도록 결과를 순서와
 * 무관하게 만드는 것이 아니라, 실제 순서에서 무엇이 건너뛰어질지를 정확히 계산한다).
 *
 * `dbExistingKeys`는 계획된 자연키 중 **이미 DB에 있는 것**의 집합(읽기 전용 조회 결과).
 */
export function computeExpectedSkips(cells: readonly CellPlannedKeys[], dbExistingKeys: ReadonlySet<string>): ExpectedSkipsResult {
  const claimed = new Map<string, string>(); // naturalKey → 이번 실행에서 먼저 차지한 lawdCd
  const out: CellSkips[] = [];
  const warnings: ExpectedSkipsResult['nonCanonicalOwnerWarnings'] = [];

  for (const cell of cells) {
    const skipped: CellSkips['skipped'] = [];
    for (const k of cell.keys) {
      const canonical = canonicalLawdCdOf(k.aptSeq);
      if (dbExistingKeys.has(k.naturalKey)) {
        skipped.push({ naturalKey: k.naturalKey, aptSeq: k.aptSeq, reason: 'DB_EXISTS', canonicalLawdCd: canonical, ownerIsCanonical: null });
        continue;
      }
      const earlier = claimed.get(k.naturalKey);
      if (earlier !== undefined) {
        skipped.push({ naturalKey: k.naturalKey, aptSeq: k.aptSeq, reason: 'RUN_EARLIER', canonicalLawdCd: canonical, ownerIsCanonical: canonical ? earlier === canonical : null });
        continue;
      }
      claimed.set(k.naturalKey, cell.lawdCd);
    }
    out.push({
      lawdCd: cell.lawdCd, ym: cell.ym,
      plannedInserts: cell.keys.length,
      expectedSkips: skipped.length,
      expectedActualInserts: cell.keys.length - skipped.length,
      skipped,
    });
  }

  // 같은 실행 안에서 canonical이 아닌 구가 자연키를 차지했으면 경고한다(적용 순서 조정 대상).
  for (const cell of out) {
    for (const s of cell.skipped) {
      if (s.reason !== 'RUN_EARLIER' || !s.canonicalLawdCd) continue;
      const owner = claimed.get(s.naturalKey);
      if (owner && owner !== s.canonicalLawdCd) {
        warnings.push({ naturalKey: s.naturalKey, aptSeq: s.aptSeq, claimedBy: owner, canonicalLawdCd: s.canonicalLawdCd });
      }
    }
  }

  const plannedInserts = out.reduce((s, c) => s + c.plannedInserts, 0);
  const expectedSkips = out.reduce((s, c) => s + c.expectedSkips, 0);
  return { cells: out, plannedInserts, expectedSkips, expectedActualInserts: plannedInserts - expectedSkips, nonCanonicalOwnerWarnings: warnings };
}

export type QuotaDecision = 'CONTINUE' | 'STOP_RESERVE' | 'STOP_MAX_CALLS';

/** 같은 키를 Production이 함께 쓰므로 예약분에 닿거나 이번 실행 상한에 닿으면 멈춘다. remaining을 모르면(첫 호출 전) 계속. */
export function quotaDecision(remaining: number | null, reserve: number, callsUsed: number, maxCalls: number | null): QuotaDecision {
  if (maxCalls != null && callsUsed >= maxCalls) return 'STOP_MAX_CALLS';
  if (remaining != null && remaining <= reserve) return 'STOP_RESERVE';
  return 'CONTINUE';
}

export interface ApplyGateInput {
  apply: boolean;
  env: Record<string, string | undefined>;
  districtGiven: boolean;
  fromGiven: boolean;
  toGiven: boolean;
  expectInserts: number | null;
  plannedInserts: number;
  cellsNotReady: number;
  existingUpdates: number;
  approveExistingUpdates: boolean;
}

/**
 * apply는 전부 필요: --apply · ALLOW_PROD_DB_READ=1 · ALLOW_PROD_DB_WRITE=1 · DEFECT_A_GATE_PASS=1(Defect A 선결 확인) ·
 * --district · --from · --to(서울 전체 one-shot 금지) · 범위 전 셀 READY · --expect-inserts = dry-run 계획 insert 수 ·
 * 기존 행 UPDATE가 있으면 --approve-existing-updates.
 */
export function evaluateApplyGates(g: ApplyGateInput): { allowed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!g.apply) reasons.push('NO_APPLY_FLAG');
  if (g.env.ALLOW_PROD_DB_READ !== '1') reasons.push('ALLOW_PROD_DB_READ_NOT_1');
  if (g.env.ALLOW_PROD_DB_WRITE !== '1') reasons.push('ALLOW_PROD_DB_WRITE_NOT_1');
  if (g.env.DEFECT_A_GATE_PASS !== '1') reasons.push('BLOCKED_FOR_APPLY_DEFECT_A_GATE');
  if (!g.districtGiven) reasons.push('SCOPE_DISTRICT_REQUIRED');
  if (!g.fromGiven || !g.toGiven) reasons.push('SCOPE_FROM_TO_REQUIRED');
  if (g.cellsNotReady > 0) reasons.push(`CELLS_NOT_READY_${g.cellsNotReady}`);
  if (g.expectInserts == null) reasons.push('EXPECT_INSERTS_REQUIRED');
  else if (g.expectInserts !== g.plannedInserts) reasons.push(`EXPECT_INSERTS_MISMATCH_${g.expectInserts}_NE_${g.plannedInserts}`);
  if (g.existingUpdates > 0 && !g.approveExistingUpdates) reasons.push(`EXISTING_UPDATES_NEED_APPROVAL_${g.existingUpdates}`);
  return { allowed: reasons.length === 0, reasons };
}

/**
 * apply 뒤 셀 결과가 dry-run 계획과 같은가(다르면 원천이 바뀐 것 — 그 셀에서 정지).
 *
 * SEOUL_SALE_NATURAL_KEY_COLLISION_PATCH_V1 — 자연키가 겹치는 행은 `skipDuplicates`가 건너뛰므로
 * 실제 inserted는 **계획 − 예상 skip**이다. `expectedSkips`를 주지 않으면 0으로 본다(기존 동작).
 */
export function applyMatchesPlan(
  report: { inserted: number; updated: number },
  planned: { inserts: number; cancelFlips: number; expectedSkips?: number }
): boolean {
  const expected = planned.inserts - (planned.expectedSkips ?? 0);
  return report.inserted === expected && report.updated === planned.cancelFlips;
}
