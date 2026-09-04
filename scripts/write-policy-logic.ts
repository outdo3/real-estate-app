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
