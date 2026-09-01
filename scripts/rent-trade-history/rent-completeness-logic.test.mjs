import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRentCellCompleteness } from './rent-completeness-logic.ts';

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
