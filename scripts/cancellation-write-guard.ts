// SALE_CANCELLATION_COVERAGE_V1 §8 — legacy upsert 경로의 true→false 역전 FAIL-SAFE.
//
// 배경(RECORD_HIGH_TRUST_V1 §3 / V3 §8에서 확인된 유일한 역전 위험):
// `backfill-trade-history.ts`의 범용 `upsertRows()`는 upsert의 `update` 절에
// `dealCanceled: row.dealCanceled`를 **무조건** 써서, 원천이 어떤 이유로 취소를
// 되돌려 보내면 이미 보정된 `true`를 `false`로 덮어쓸 수 있다. 이 경로는
// `sync-trade-history.ts`도 `runTradeHistoryJob()`을 통해 그대로 공유한다.
//
// 노출도는 V2+V3 apply 이후 크게 늘었다 — B구간 취소가 629건에서 11,481건이 됐으므로
// 되돌려질 수 있는 행이 18배가 됐다.
//
// 정책은 이미 정해져 있다(write-policy-logic.ts `updateTrueToFalseSkipped`):
// **false→true만 적용하고 true→false는 절대 적용하지 않는다.** 문제는 그 정책이
// classifyRow를 쓰는 경로에만 있고 legacy upsert에는 없었다는 점이다.
//
// Prisma upsert의 `update` 절은 조건부 갱신을 표현할 수 없다. 그래서 "덮어쓸지"를
// **필드 존재 여부**로 표현한다: 원천이 취소가 아니라고 하면 cancellation 필드를
// update 절에서 아예 빼버린다. 그러면 기존 값이 무엇이든 보존되므로 true→false가
// **구조적으로 불가능**해진다. false→false는 어차피 변화가 없어 손실이 없다.
//
// registryDate는 취소와 무관한 등기 정보라 항상 갱신한다.

export interface CancellationFieldsInput {
  dealCanceled: boolean;
  cancelDate: string | null;
  registryDate: string | null;
}

export interface CancellationUpdateFields {
  dealCanceled?: true;
  cancelDate?: string | null;
  registryDate: string | null;
}

/**
 * upsert의 `update` 절에 넣을 취소 관련 필드를 만든다.
 *
 * - 원천이 취소(`true`)  → `dealCanceled: true` + `cancelDate` 갱신 (승인된 false→true).
 * - 원천이 비취소(`false`) → cancellation 필드를 **생략**한다. 기존 DB 값이 보존되므로
 *   이미 취소로 보정된 행이 되돌아가지 않는다.
 *
 * 반환 타입에 `dealCanceled?: true`만 허용해 `false`를 쓰는 것이 타입 수준에서도
 * 불가능하게 했다.
 */
export function buildCancellationUpdateFields(row: CancellationFieldsInput): CancellationUpdateFields {
  if (row.dealCanceled) {
    return { dealCanceled: true, cancelDate: row.cancelDate, registryDate: row.registryDate };
  }
  return { registryDate: row.registryDate };
}

/** 감사/로깅용 — 이번 upsert가 취소 상태를 되돌리려 했는지(=가드가 막았는지). */
export function wouldHaveReversedCancellation(
  row: CancellationFieldsInput,
  existing: { dealCanceled: boolean } | undefined | null
): boolean {
  return !!existing && existing.dealCanceled && !row.dealCanceled;
}
