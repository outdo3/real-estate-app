// DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5 §2/§3 — sale 전용 pagination completeness
// 판정 순수 함수(네트워크/DB 없음). rent의 scripts/rent-trade-history/
// rent-completeness-logic.ts와 동일한 4-상태 모델(COMPLETE/EMPTY_VALID/PARTIAL/
// INVALID)이지만, 그 파일 자체를 import하지 않고 sale 전용으로 별도 둔다 — 이 프로젝트의
// 기존 관례(rent-completeness-logic.ts 헤더 주석: "sale의 CellStatus를 그대로
// 재사용하도록 권고했지만... 4개 상태로 명시했다")가 이미 "파이프라인마다 독립된 상태
// enum을 둔다"는 방향이었고, 이번 STEP도 그 관례를 따라 이미 검증된 rent 코드를 전혀
// 건드리지 않는다(회귀 위험 0).
export type SaleCellStatus = 'COMPLETE' | 'EMPTY_VALID' | 'PARTIAL' | 'INVALID';

export interface SaleCompletenessInput {
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

// API 정상 응답 + totalCount=0 + 전체 pagination 완료 같은 실제 근거가 있을 때만
// EMPTY_VALID다. API 에러/timeout/parse 실패는 절대 EMPTY_VALID가 될 수 없다 —
// "실패"와 "실제 0건"을 혼동하면 이후 재동기화가 이 지역-월을 영구히 건너뛰게 되어
// 데이터가 조용히 누락된다(Phase 1 감사에서 실제로 발견된 문제의 재발 방지).
export function classifySaleCellCompleteness(input: SaleCompletenessInput): SaleCellStatus {
  if (input.firstPageFailed || input.totalCount === null) return 'INVALID';
  if (input.totalCount === 0) return 'EMPTY_VALID';
  if (input.anyLaterPageFailed || input.collectedCount < input.totalCount) return 'PARTIAL';
  return 'COMPLETE';
}
