import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRentCellCompleteness, shouldPersistCellRows } from './rent-completeness-logic.ts';

test('첫 페이지 실패면 totalCount 무관하게 INVALID다(§34 — 실패를 EMPTY_VALID로 위장 금지)', () => {
  const status = classifyRentCellCompleteness({ firstPageFailed: true, totalCount: null, collectedCount: 0, anyLaterPageFailed: false });
  assert.equal(status, 'INVALID');
});

test('totalCount가 null이면(파싱 불가) firstPageFailed=false여도 INVALID다', () => {
  const status = classifyRentCellCompleteness({ firstPageFailed: false, totalCount: null, collectedCount: 0, anyLaterPageFailed: false });
  assert.equal(status, 'INVALID');
});

test('정상 응답 + totalCount=0이면 EMPTY_VALID다', () => {
  const status = classifyRentCellCompleteness({ firstPageFailed: false, totalCount: 0, collectedCount: 0, anyLaterPageFailed: false });
  assert.equal(status, 'EMPTY_VALID');
});

test('모든 페이지 성공 + 수집량이 totalCount와 일치하면 COMPLETE다', () => {
  const status = classifyRentCellCompleteness({ firstPageFailed: false, totalCount: 868, collectedCount: 868, anyLaterPageFailed: false });
  assert.equal(status, 'COMPLETE');
});

test('이후 페이지 중 하나라도 실패하면 PARTIAL이다(수집량이 totalCount와 같아도)', () => {
  const status = classifyRentCellCompleteness({ firstPageFailed: false, totalCount: 868, collectedCount: 868, anyLaterPageFailed: true });
  assert.equal(status, 'PARTIAL');
});

test('수집량이 totalCount보다 적으면 PARTIAL이다(pagination 미완료를 COMPLETE로 판정 금지)', () => {
  const status = classifyRentCellCompleteness({ firstPageFailed: false, totalCount: 868, collectedCount: 500, anyLaterPageFailed: false });
  assert.equal(status, 'PARTIAL');
});

// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §11/§12 — "PARTIAL을 COMPLETE처럼 취급 금지"는
// 판정에서 끝나면 안 되고 **쓰기 경로**에서도 강제돼야 한다. PARTIAL cell을 그대로
// 저장하면 단순히 몇 건이 빠지는 문제가 아니다: occurrenceIndex가 (lawdCd, dealYmd)
// 배치 전체 feed 기준으로 매겨지기 때문에(rent-history-logic.ts), 잘린 feed는 같은
// 실제 거래에 다른 occurrenceIndex → 다른 자연키를 부여한다. 그러면 나중에 완전한
// 재동기화를 해도 되돌릴 수 없는 조용한 중복 row가 남는다.
test('COMPLETE cell만 DB에 쓸 수 있다', () => {
  assert.equal(shouldPersistCellRows('COMPLETE'), true);
});

test('PARTIAL cell은 절대 쓰지 않는다(잘린 feed → occurrenceIndex 재번호 → 복구 불가능한 중복 자연키)', () => {
  assert.equal(shouldPersistCellRows('PARTIAL'), false);
});

test('INVALID cell은 절대 쓰지 않는다', () => {
  assert.equal(shouldPersistCellRows('INVALID'), false);
});

test('EMPTY_VALID cell은 쓸 row 자체가 없다 — 쓰기 대상이 아니다', () => {
  assert.equal(shouldPersistCellRows('EMPTY_VALID'), false);
});
