// TRADE_DB_FIRST_V1 STEP F-2 — classifyAndWrite()(resync-cancellation-v2.ts)의
// per-row 분류 결정을 순수 함수로 분리한다(DB/네트워크 호출 없음, 다른
// scripts/*.ts를 값으로 import하지 않음 — trade-history-logic.ts/
// incremental-sync-logic.ts와 동일 원칙). classifyAndWrite() 자체는 DB
// findMany/transaction을 하므로 순수하지 않아 이 결정 로직만 떼어내
// 테스트 가능하게 한다.
import type { TradeRowInput } from './trade-history-logic';

export type RowClassificationKind =
  | 'noop'
  | 'insert'
  | 'updateFalseToTrue'
  | 'updateTrueToFalseSkipped'
  | 'conflict'
  | 'reviewRequired'
  // TRADE_REGISTRY_DATA_V1.1 §2 — 등기일자만 보충하는 self-heal 분류.
  | 'updateRegistryOnly';

export interface ExistingRowForMatch {
  id: number;
  aptName: string;
  dong: string;
  dealCanceled: boolean;
  /** TRADE_REGISTRY_DATA_V1.1 — self-heal 판정에 필수. 호출부는 반드시 select에 포함해야 한다
   * (optional로 두면 "select 누락"과 "실제 NULL"을 구분할 수 없어 조용히 오판한다). */
  registryDate: string | null;
}

/**
 * §11/§12/§14 — 자연키로 매칭된 기존 row(있으면)와 새로 받은 row를 비교해
 * 어떤 조치를 취할지 결정한다.
 * - 기존 row 없음 + aptSeq 없음 → `reviewRequired`(insert하지 않음 — §11/§12,
 *   name+dong fallback만으로 canonical apartment identity를 만들지 않는다).
 * - 기존 row 없음 + aptSeq 있음 → `insert`.
 * - 기존 row 있음 + aptName/dong 불일치 → `conflict`(occurrence 순서 흔들림
 *   의심, 건드리지 않음 — §10).
 * - 기존 row 있음 + false→true → `updateFalseToTrue`(적용).
 * - 기존 row 있음 + true→false → `updateTrueToFalseSkipped`(§14 가드, 절대
 *   되돌리지 않음).
 * - 기존 row 있음 + 취소상태 동일 + 양쪽 비취소 + DB registryDate NULL + 원천 값 있음
 *   → `updateRegistryOnly`(TRADE_REGISTRY_DATA_V1.1 §2).
 * - 그 외 기존 row 있음 → `noop`.
 *
 * TRADE_REGISTRY_DATA_V1.1 §2 우선순위(절대 순서):
 *   1. identity conflict / review  2. false→true  3. true→false skip
 *   4. registryDate 보충            5. noop
 * 취소 판정이 registryDate 보충보다 **항상 앞선다** — 아래 분기 순서가 그 계약이다.
 * (기존 kind들의 판정 결과는 이 재배치로 바뀌지 않는다: 취소상태가 같을 때만
 *  4/5에 도달하고, 다를 때는 2 또는 3으로 갈라지므로 이전 구현과 동치다.)
 */
export function classifyRow(fresh: TradeRowInput, match: ExistingRowForMatch | undefined): RowClassificationKind {
  if (!match) {
    return fresh.aptSeq ? 'insert' : 'reviewRequired';
  }
  if (match.aptName !== fresh.aptName || match.dong !== fresh.dong) {
    return 'conflict';
  }
  if (!match.dealCanceled && fresh.dealCanceled) {
    return 'updateFalseToTrue';
  }
  if (match.dealCanceled && !fresh.dealCanceled) {
    return 'updateTrueToFalseSkipped';
  }
  // 여기부터 취소 상태는 양쪽이 동일하다.
  // 취소된 거래는 원천이 등기일자를 주지 않으므로(등기 불가) 비취소 건만 대상으로 한다.
  if (!match.dealCanceled && !fresh.dealCanceled && isRegistrySupplementCandidate(fresh, match)) {
    return 'updateRegistryOnly';
  }
  return 'noop';
}

/** NULL → value 인 경우에만 true. value→value / value→NULL 은 항상 false. */
function isRegistrySupplementCandidate(
  fresh: { registryDate: string | null },
  match: { registryDate: string | null }
): boolean {
  if (match.registryDate != null && match.registryDate !== '') return false;
  return !!fresh.registryDate;
}

/**
 * TRADE_REGISTRY_DATA_V1.1 §3 WRITE CONTRACT — 이 함수가 반환하는 객체 **그대로만**
 * UPDATE에 쓴다. registryDate 단 하나의 필드만 담기며, 그 외 어떤 필드(취소/자연키/
 * 운영 메타)도 반환하지 않는다. 분류(classifyRow)와 **독립적으로** 전제를 재검사하는
 * 이중 안전장치다 — recordCoverageCells가 dry-run을 두 번 막는 것과 같은 패턴.
 *
 * 반환 null = 쓰지 않는다.
 */
export function buildRegistryOnlyUpdateFields(
  fresh: { registryDate: string | null },
  match: { registryDate: string | null }
): { registryDate: string } | null {
  if (!isRegistrySupplementCandidate(fresh, match)) return null;
  return { registryDate: fresh.registryDate as string };
}

/**
 * TRADE_REGISTRY_DATA_V1.1 §4 OCCURRENCE SAFETY.
 *
 * occurrenceIndex는 원천 응답의 등장 순서로 부여되므로, 같은 자연키 그룹
 * (groupKeyStr|dealAmount|dealDate|floor)에 형제 row가 여러 개면 순서가 흔들렸을 때
 * 형제의 등기일자를 서로 바꿔 쓸 수 있다(TRADE_REGISTRY_DATA_V1 실측: 2023+ 부산
 * 행의 8.9%가 다행 그룹).
 *
 * 그래서 **형제 전원의 registryDate가 완전히 동일할 때만** 보충한다. 이 조건에서는
 * 어느 형제에 써도 값이 같으므로 순서가 뒤바뀌어도 **오매칭이 성립할 수 없다**.
 * 하나라도 다르면(예: 한쪽만 등기 완료) 보충하지 않고 건너뛴다 — 잘못된 값을 쓰느니
 * NULL로 남기는 쪽이 안전하다(data truth 원칙: 모르면 만들지 않는다).
 */
export function isRegistrySupplementUnambiguous(siblings: { registryDate: string | null }[]): boolean {
  if (siblings.length <= 1) return true;
  const first = siblings[0].registryDate ?? '';
  return siblings.every((s) => (s.registryDate ?? '') === first);
}

/** 자연키에서 occurrenceIndex만 뺀 그룹 키 — 형제 판정용. */
export function occurrenceGroupKey(row: {
  groupKeyStr: string;
  dealAmount: number;
  dealDate: string;
  floor: number;
}): string {
  return `${row.groupKeyStr}|${row.dealAmount}|${row.dealDate}|${row.floor}`;
}

// ── CANCELLATION_RATCHET_PREVENTION_FIX_V1 ────────────────────────────────
//
// 왜 classifyRow()의 취소 분기만으로는 안 되는가(결함 A):
//   occurrenceIndex는 MOLIT 응답의 **등장 순서**로 부여되는데(trade-history-logic.ts),
//   같은 occurrence 그룹 안에서 그 순서는 호출마다 뒤바뀐다. 자연키가 occurrenceIndex를
//   포함하므로, 순서가 뒤집힐 때마다 그룹의 **다른 형제**가 fresh.dealCanceled=true와
//   매칭돼 flip되고, 먼저 flip된 형제는 `updateTrueToFalseSkipped`가 되돌리기를 막는다.
//   → 그룹이 단조적으로 전부 취소로 물든다. 실측(REPAIR_AUDIT_V1): 부산 21행 확정.
//
// 해결:
//   취소 상태를 **행 단위**가 아니라 **occurrence 그룹 단위의 취소 개수**로 맞춘다.
//   원천이 그 그룹에 취소 C건을 보고하면 DB에도 정확히 C건만 취소로 둔다. 개수는 응답
//   순서와 무관하므로 순서가 아무리 흔들려도 결과가 바뀌지 않는다(= 래칫이 성립하지 않음).
//
// 이 함수가 하지 않는 것:
//   - 자연키/occurrenceIndex/identity를 바꾸지 않는다(schema 변경 없음).
//   - 형제 수가 원천과 다르면 **아무것도 하지 않는다** — 추측해서 더 취소하거나 되돌리지 않는다.
//   - registryDate가 있는 행은 되돌리지 않는다(취소 거래는 등기가 없다 — 전제가 깨진 행).
//   - deal_canceled / cancel_date 외 어떤 필드도 건드리지 않는다.
//
// 호출부 계약: 원천 셀이 COMPLETE(또는 검증된 빈 셀)일 때만 호출한다. PARTIAL/INVALID에서
// 부르면 "못 읽은 것"을 "취소가 아니다"로 바꿔 쓰게 된다.

export interface CancelReconcileSourceRow {
  dealCanceled: boolean;
  cancelDate: string | null;
}

export interface CancelReconcileExistingRow {
  id: number;
  dealCanceled: boolean;
  cancelDate: string | null;
  registryDate: string | null;
  occurrenceIndex: number;
}

export type CancelReconcileSkipReason =
  /** 원천과 DB의 형제 수가 다르다 — 회수/신규 등 다른 사건이므로 취소 판정을 하지 않는다. */
  | 'SIBLING_COUNT_MISMATCH'
  /** 되돌려야 하는데 후보가 전부 registryDate를 갖고 있다 — 전제가 깨졌으므로 손대지 않는다. */
  | 'UNRESTORABLE_REGISTRY_DATE';

export type CancelReconcileResult =
  | { kind: 'noChange' }
  | { kind: 'skipped'; reason: CancelReconcileSkipReason }
  | {
      kind: 'reconcile';
      /** false → true 로 바꿀 행. cancelDate는 원천이 준 값만 쓴다(만들어내지 않는다). */
      toCancel: { id: number; cancelDate: string | null }[];
      /** true → false 로 되돌릴 행. cancel_date는 NULL로 지운다. */
      toRestore: { id: number }[];
    };

/** 정렬 안정성을 위한 비교자 — null은 항상 뒤로. */
function compareCancelDate(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * 한 occurrence 그룹의 취소 상태를 원천에 맞춘다. **순서 무관 · 결정적 · 멱등.**
 *
 * @param sourceRows   원천이 이 그룹에 대해 준 행 전부(취소/비취소 모두). 순서는 의미 없다.
 * @param existingRows DB의 형제 행 전부. 순서는 의미 없다.
 */
export function reconcileGroupCancellation(
  sourceRows: CancelReconcileSourceRow[],
  existingRows: CancelReconcileExistingRow[]
): CancelReconcileResult {
  // 형제 수가 다르면 어떤 행이 어떤 행에 대응하는지 알 수 없다. 추측하지 않는다.
  if (sourceRows.length !== existingRows.length) {
    return { kind: 'skipped', reason: 'SIBLING_COUNT_MISMATCH' };
  }

  const targetCanceled = sourceRows.filter((r) => r.dealCanceled).length;
  const currentCanceled = existingRows.filter((r) => r.dealCanceled).length;
  if (targetCanceled === currentCanceled) return { kind: 'noChange' };

  if (currentCanceled < targetCanceled) {
    // 부족분을 취소로 바꾼다. 후보는 현재 비취소 행, occurrenceIndex 오름차순(결정적).
    const need = targetCanceled - currentCanceled;
    const candidates = existingRows
      .filter((r) => !r.dealCanceled)
      .sort((a, b) => a.occurrenceIndex - b.occurrenceIndex || a.id - b.id)
      .slice(0, need);

    // 원천 해제일 multiset에서 이미 DB에 반영된 것을 빼고 남은 값을 쓴다 —
    // 형제는 서로 구분되지 않으므로 이 이상 정확히 배정할 방법이 원천에 없다.
    const remaining = sourceRows.filter((r) => r.dealCanceled).map((r) => r.cancelDate).sort(compareCancelDate);
    for (const e of existingRows) {
      if (!e.dealCanceled) continue;
      const i = remaining.indexOf(e.cancelDate);
      if (i >= 0) remaining.splice(i, 1);
    }

    return {
      kind: 'reconcile',
      toCancel: candidates.map((c, i) => ({ id: c.id, cancelDate: remaining[i] ?? null })),
      toRestore: [],
    };
  }

  // 과다 취소 — 결함 A가 만든 상태. 원천이 말한 만큼만 남기고 되돌린다.
  const excess = currentCanceled - targetCanceled;
  const restorable = existingRows
    .filter((r) => r.dealCanceled && r.registryDate == null)
    .sort((a, b) => b.occurrenceIndex - a.occurrenceIndex || b.id - a.id);
  if (restorable.length < excess) {
    return { kind: 'skipped', reason: 'UNRESTORABLE_REGISTRY_DATE' };
  }

  return { kind: 'reconcile', toCancel: [], toRestore: restorable.slice(0, excess).map((r) => ({ id: r.id })) };
}

// ── CANCELLATION_INSERT_PATH_FIX_V1 ────────────────────────────────────────
//
// 예방 수정(위 reconcileGroupCancellation)은 **기존 행의 취소 flip**을 그룹 개수로 바꿨지만,
// 형제가 **새로 늘어나는 insert**는 여전히 행 단위였다:
//
//   원천: 같은 거래 2줄(정상 1 + 취소 1) · DB: 1줄(취소)
//   1) 형제 수 2 ≠ 1 → reconcile은 SIBLING_COUNT_MISMATCH로 skip
//   2) insert는 occurrenceIndex(원천 응답 순서) 자연키로 행을 대응시킨다 — 원천 순서가
//      [정상, 취소]면 기존 취소 행이 index 0에 매칭되고, index 1의 **취소 행**이 새로 들어간다
//   3) DB 2/2 취소 ↔ 원천 1/2 — 새 false-cancel (CANCELLATION_PREVENTION_CRON_VALIDATION_GATE_V1: 7건)
//
// 해결: DB에 이미 형제가 있는 그룹에서 새로 넣을 행은 **그룹 개수**로 정한다.
//   넣을 행 수    = 원천 형제 수 − DB 형제 수
//   그중 취소 수  = max(0, 원천 취소 수 − DB 취소 수)
//   취소 수가 넣을 행 수보다 많으면(기존 정상 행까지 취소로 바꿔야 맞는 경우) 추측하지 않고 skip.
// 어느 원천 행의 내용을 쓸지, 어느 occurrenceIndex 자리에 둘지는 **응답 순서와 무관한**
// 결정적 규칙으로 정한다(아래). occurrenceIndex는 자연키 자리 배정에만 쓰고 진실 판정에는 쓰지 않는다.
//
// 이 함수가 하지 않는 것:
//   - 기존 행을 바꾸지 않는다(취소/치유는 reconcileGroupCancellation 담당, 치유는 게이트 뒤).
//   - 형제 수가 원천과 같거나 더 많은 그룹에는 아무것도 넣지 않는다(결함 B = 원천 회수는 별도).
//   - 원천이 COMPLETE가 아닌 셀에서 불리면 안 된다(호출부 계약, reconcile과 동일).

export interface GroupInsertSourceRow {
  occurrenceIndex: number;
  dealCanceled: boolean;
  cancelDate: string | null;
  registryDate: string | null;
  aptSeq: string | null;
  aptName: string;
  dong: string;
  jibun?: string | null;
  buildYear?: number | null;
  rawUid?: string | null;
}

export interface GroupInsertExistingRow {
  occurrenceIndex: number;
  dealCanceled: boolean;
  cancelDate: string | null;
  registryDate: string | null;
  aptName: string;
  dong: string;
}

export type GroupInsertSkipReason =
  /** aptSeq 없는 행 — name+dong fallback으로 identity를 만들지 않는다(classifyRow의 reviewRequired와 같은 원칙). */
  | 'NO_APT_SEQ'
  /** 원천/DB 형제의 단지명·동이 엇갈린다 — 같은 거래라고 단정할 수 없다. */
  | 'IDENTITY_MISMATCH'
  /** 원천 취소 부족분이 새로 넣을 행 수보다 많다 — 기존 정상 행을 취소로 바꿔야 맞는데, 그 판정은 추측이다. */
  | 'CANCELED_DEFICIT_EXCEEDS_MISSING'
  /** 방어용 — 이론상 도달 불가(원천에 넣을 만큼의 행이 남지 않음). */
  | 'INSUFFICIENT_SOURCE_ROWS';

export type GroupInsertPlan<T> =
  | { kind: 'none' }
  | { kind: 'skipped'; reason: GroupInsertSkipReason; missing: number }
  | { kind: 'insert'; rows: T[]; canceledInserts: number };

/** 응답 순서와 무관한 내용 기반 정렬 키. rawUid(응답 위치 기반)는 나머지가 완전히 같을 때만 순서를 가른다. */
function canonicalContentKey(r: GroupInsertSourceRow): string {
  return JSON.stringify([
    r.dealCanceled ? 1 : 0,
    r.cancelDate ?? '',
    r.registryDate ?? '',
    r.aptName,
    r.dong,
    r.jibun ?? '',
    r.buildYear ?? '',
    r.rawUid ?? '',
  ]);
}

/** 이미 DB에 있는 값과 같은 원천 행을 multiset에서 하나씩 뺀다(같은 값이면 어느 것을 빼도 같다). */
function removeMatched<T extends GroupInsertSourceRow>(pool: T[], taken: (string | null)[], field: 'cancelDate' | 'registryDate'): T[] {
  const rest = [...pool];
  for (const v of taken) {
    const i = rest.findIndex((r) => (r[field] ?? null) === (v ?? null));
    if (i >= 0) rest.splice(i, 1);
  }
  return rest;
}

/**
 * 한 occurrence 그룹에서 새로 넣을 행을 정한다. **순서 무관 · 결정적 · 멱등.**
 *
 * - DB 형제 0: 원천 행을 그대로 넣는다(신규 그룹 — 개수가 자명하게 일치하고, 기존 동작과 동일).
 * - 원천 형제 수 ≤ DB 형제 수: 넣지 않는다(같으면 reconcile 담당, 적으면 결함 B).
 * - 원천 형제 수 > DB 형제 수 > 0: 그룹 개수로 부족분을 계산해 넣는다.
 *
 * 반환 행의 occurrenceIndex는 0부터 DB가 쓰지 않는 자리를 오름차순으로 배정한다(자연키 중복 방지).
 * 취소 행이 먼저, 그다음 정상 행 순서로 자리를 받는다.
 */
export function planGroupInserts<T extends GroupInsertSourceRow>(
  sourceRows: T[],
  existingRows: GroupInsertExistingRow[]
): GroupInsertPlan<T> {
  if (existingRows.length === 0) {
    if (sourceRows.length === 0) return { kind: 'none' };
    return { kind: 'insert', rows: [...sourceRows], canceledInserts: sourceRows.filter((r) => r.dealCanceled).length };
  }
  const missing = sourceRows.length - existingRows.length;
  if (missing <= 0) return { kind: 'none' };

  if (sourceRows.some((r) => !r.aptSeq)) return { kind: 'skipped', reason: 'NO_APT_SEQ', missing };
  const name = sourceRows[0].aptName;
  const dong = sourceRows[0].dong;
  if (sourceRows.some((r) => r.aptName !== name || r.dong !== dong) || existingRows.some((e) => e.aptName !== name || e.dong !== dong)) {
    return { kind: 'skipped', reason: 'IDENTITY_MISMATCH', missing };
  }

  const sourceCanceled = sourceRows.filter((r) => r.dealCanceled).length;
  const dbCanceled = existingRows.filter((e) => e.dealCanceled).length;
  const canceledInserts = Math.max(0, sourceCanceled - dbCanceled);
  if (canceledInserts > missing) return { kind: 'skipped', reason: 'CANCELED_DEFICIT_EXCEEDS_MISSING', missing };
  const activeInserts = missing - canceledInserts;

  const byContent = (a: T, b: T) => {
    const ka = canonicalContentKey(a);
    const kb = canonicalContentKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  const canceledAll = sourceRows.filter((r) => r.dealCanceled).sort(byContent);
  const activeAll = sourceRows.filter((r) => !r.dealCanceled).sort(byContent);
  const canceledPool = removeMatched(canceledAll, existingRows.filter((e) => e.dealCanceled).map((e) => e.cancelDate), 'cancelDate');
  const activePool = removeMatched(activeAll, existingRows.filter((e) => !e.dealCanceled).map((e) => e.registryDate), 'registryDate');
  // 값 매칭으로 빠진 뒤에도 부족하면 같은 상태의 전체 풀에서 채운다(형제는 서로 구분되지 않는다).
  const pick = (pool: T[], full: T[], n: number): T[] | null => {
    const out = pool.slice(0, n);
    for (const r of full) {
      if (out.length >= n) break;
      if (!out.includes(r)) out.push(r);
    }
    return out.length === n ? out : null;
  };
  const canceledPicks = pick(canceledPool, canceledAll, canceledInserts);
  const activePicks = pick(activePool, activeAll, activeInserts);
  if (!canceledPicks || !activePicks) return { kind: 'skipped', reason: 'INSUFFICIENT_SOURCE_ROWS', missing };

  const used = new Set(existingRows.map((e) => e.occurrenceIndex));
  const freeSlots: number[] = [];
  for (let i = 0; freeSlots.length < missing; i++) if (!used.has(i)) freeSlots.push(i);

  const rows = [...canceledPicks, ...activePicks].map((r, i) => ({ ...r, occurrenceIndex: freeSlots[i] }));
  return { kind: 'insert', rows, canceledInserts };
}
