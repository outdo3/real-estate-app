// TRADE_DB_FIRST_V1 STEP F-2 — classifyAndWrite()(resync-cancellation-v2.ts)의
// per-row 분류 결정을 순수 함수로 분리한다(DB/네트워크 호출 없음, 다른
// scripts/*.ts를 값으로 import하지 않음 — trade-history-logic.ts/
// incremental-sync-logic.ts와 동일 원칙). classifyAndWrite() 자체는 DB
// findMany/transaction을 하므로 순수하지 않아 이 결정 로직만 떼어내
// 테스트 가능하게 한다.
import type { TradeRowInput } from './trade-history-logic';

export type RowClassificationKind = 'noop' | 'insert' | 'updateFalseToTrue' | 'updateTrueToFalseSkipped' | 'conflict' | 'reviewRequired';

export interface ExistingRowForMatch {
  id: number;
  aptName: string;
  dong: string;
  dealCanceled: boolean;
}

/**
 * §11/§12/§14 — 자연키로 매칭된 기존 row(있으면)와 새로 받은 row를 비교해
 * 어떤 조치를 취할지 결정한다.
 * - 기존 row 없음 + aptSeq 없음 → `reviewRequired`(insert하지 않음 — §11/§12,
 *   name+dong fallback만으로 canonical apartment identity를 만들지 않는다).
 * - 기존 row 없음 + aptSeq 있음 → `insert`.
 * - 기존 row 있음 + aptName/dong 불일치 → `conflict`(occurrence 순서 흔들림
 *   의심, 건드리지 않음 — §10).
 * - 기존 row 있음 + dealCanceled 동일 → `noop`.
 * - 기존 row 있음 + false→true → `updateFalseToTrue`(적용).
 * - 기존 row 있음 + true→false → `updateTrueToFalseSkipped`(§14 가드, 절대
 *   되돌리지 않음).
 */
export function classifyRow(fresh: TradeRowInput, match: ExistingRowForMatch | undefined): RowClassificationKind {
  if (!match) {
    return fresh.aptSeq ? 'insert' : 'reviewRequired';
  }
  if (match.aptName !== fresh.aptName || match.dong !== fresh.dong) {
    return 'conflict';
  }
  if (match.dealCanceled === fresh.dealCanceled) {
    return 'noop';
  }
  if (!match.dealCanceled && fresh.dealCanceled) {
    return 'updateFalseToTrue';
  }
  return 'updateTrueToFalseSkipped';
}
