// RENT_TRADE_HISTORY_V1 PHASE B — completeness 판정 순수 함수(네트워크/DB 없음).
// PHASE A §15는 sale의 CellStatus('COMPLETE'|'EMPTY_VALID'|'FAILED'|'INVALID',
// scripts/incremental-sync-logic.ts)를 그대로 재사용하도록 권고했지만, 이번 PHASE
// 작업 지시(§33/§34)는 rent sync 엔진에 실제 pagination(§31)이 필요함을 전제로 4개
// 상태를 COMPLETE/EMPTY_VALID/PARTIAL/INVALID로 명시했다 — sale의 FAILED(첫 페이지부터
// 완전 실패)와 달리 PARTIAL은 "일부 페이지는 성공했지만 이후 페이지가 실패해 totalCount
// 보다 적게 모았다"는, pagination이 있어야 존재할 수 있는 중간 상태다. sale sync는
// 지금까지 1페이지(numOfRows=1000)로 항상 충분했기 때문에 이 상태가 필요 없었을 뿐,
// PHASE A의 권고와 실제로 상충하지 않는다(더 세분화된 상위 집합).
export type RentCellStatus = 'COMPLETE' | 'EMPTY_VALID' | 'PARTIAL' | 'INVALID';

export interface CompletenessInput {
  // 첫 페이지 자체가 파싱 실패/timeout/네트워크 에러로 끝났는가. true면 totalCount조차
  // 신뢰할 수 없다.
  firstPageFailed: boolean;
  // API가 정상 응답한 totalCount(첫 페이지 응답에서 확인). firstPageFailed=true면 항상 null.
  totalCount: number | null;
  // 지금까지 실제로 수집(파싱 성공)한 item 수(여러 페이지 합산).
  collectedCount: number;
  // 2페이지 이상 진행 중 어느 한 페이지라도 재시도 소진 후 실패했는가.
  anyLaterPageFailed: boolean;
}

/**
 * §33/§34 — API 정상 응답 + totalCount=0 + 전체 pagination 완료 같은 실제 근거가 있을
 * 때만 EMPTY_VALID다. API 에러/timeout/parse 실패는 절대 EMPTY_VALID가 될 수 없다
 * (§34) — "실패"와 "실제 0건"을 혼동하면 이후 재동기화가 이 지역-월을 영구히
 * 건너뛰게 되어 데이터가 조용히 누락된다.
 */
export function classifyRentCellCompleteness(input: CompletenessInput): RentCellStatus {
  if (input.firstPageFailed || input.totalCount === null) return 'INVALID';
  if (input.totalCount === 0) return 'EMPTY_VALID';
  if (input.anyLaterPageFailed || input.collectedCount < input.totalCount) return 'PARTIAL';
  return 'COMPLETE';
}
