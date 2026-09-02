// DATA_FRESHNESS_AUTOMATION_V1_PHASE1_5 §12 — coverage manifest에 셀을 기록할지
// 결정하는 순수 함수(파일/DB I/O 없음). Phase 2가 실제 --apply 동기화를 구현할 때
// 이 함수를 그대로 호출하면 된다. 이번 STEP은 실제 apply를 수행하지 않으므로(§0 STOP
// 조건) 이 함수는 synthetic 입력으로만 테스트된다 — 로직만 미리 검증해 둔다.
import type { RentCellStatus } from './rent-completeness-logic';

export type SyncMode = 'dry-run' | 'apply';

// dry-run은 절대 coverage manifest를 갱신하지 않는다(§12 명시 원칙) — apply 모드이고
// 셀이 실제로 "완전하게 확인됨"(COMPLETE 또는 EMPTY_VALID — 둘 다 pagination이 끝까지
// 검증된 상태다, rent-completeness-logic.ts 참고)일 때만 기록 대상이다. PARTIAL/INVALID는
// 절대 기록하지 않는다 — 다음 실행에서 다시 시도하도록 그대로 미기록 상태로 남긴다.
export function shouldRecordCoverageCell(mode: SyncMode, status: RentCellStatus): boolean {
  if (mode === 'dry-run') return false;
  return status === 'COMPLETE' || status === 'EMPTY_VALID';
}
