import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySaleCellCompleteness } from './sale-pagination-logic';

test('첫 페이지 실패면 totalCount 무관하게 INVALID다(실패를 EMPTY_VALID로 위장 금지)', () => {
  const status = classifySaleCellCompleteness({ firstPageFailed: true, totalCount: null, collectedCount: 0, anyLaterPageFailed: false });
  assert.equal(status, 'INVALID');
});

test('totalCount가 null이면(파싱 불가) firstPageFailed=false여도 INVALID다', () => {
  const status = classifySaleCellCompleteness({ firstPageFailed: false, totalCount: null, collectedCount: 0, anyLaterPageFailed: false });
  assert.equal(status, 'INVALID');
});

test('정상 응답 + totalCount=0이면 EMPTY_VALID다(실제 0건 — 실패와 구분)', () => {
  const status = classifySaleCellCompleteness({ firstPageFailed: false, totalCount: 0, collectedCount: 0, anyLaterPageFailed: false });
  assert.equal(status, 'EMPTY_VALID');
});

test('단일 페이지(totalCount <= 1000)로 전량 수집되면 COMPLETE다', () => {
  const status = classifySaleCellCompleteness({ firstPageFailed: false, totalCount: 532, collectedCount: 532, anyLaterPageFailed: false });
  assert.equal(status, 'COMPLETE');
});

test('여러 페이지 전량 수집(예: 1,000행 초과)되면 COMPLETE다', () => {
  const status = classifySaleCellCompleteness({ firstPageFailed: false, totalCount: 1500, collectedCount: 1500, anyLaterPageFailed: false });
  assert.equal(status, 'COMPLETE');
});

test('정확히 페이지 경계(totalCount가 numOfRows의 배수)에서도 COMPLETE 판정이 정확하다', () => {
  const status = classifySaleCellCompleteness({ firstPageFailed: false, totalCount: 2000, collectedCount: 2000, anyLaterPageFailed: false });
  assert.equal(status, 'COMPLETE');
});

test('마지막 페이지가 부분 실패하면(이전 페이지들은 성공) PARTIAL이다', () => {
  const status = classifySaleCellCompleteness({ firstPageFailed: false, totalCount: 1500, collectedCount: 1000, anyLaterPageFailed: true });
  assert.equal(status, 'PARTIAL');
});

test('이후 페이지 중 하나라도 실패하면 PARTIAL이다(수집량이 우연히 totalCount와 같아도)', () => {
  const status = classifySaleCellCompleteness({ firstPageFailed: false, totalCount: 1500, collectedCount: 1500, anyLaterPageFailed: true });
  assert.equal(status, 'PARTIAL');
});

test('수집량이 totalCount보다 적으면(count mismatch) PARTIAL이다 — pagination 미완료를 COMPLETE로 판정 금지', () => {
  const status = classifySaleCellCompleteness({ firstPageFailed: false, totalCount: 1000, collectedCount: 731, anyLaterPageFailed: false });
  assert.equal(status, 'PARTIAL');
});

test('과거 truncation 재현 시나리오: totalCount=1000(구 numOfRows 상한)인데 실제로는 더 있었을 사례 — collectedCount가 totalCount와 같아도 totalCount 자체가 진짜 전체값이면 COMPLETE(이 함수는 API가 보고한 totalCount만 신뢰한다, 그 이상은 API 응답 자체의 정확성에 의존)', () => {
  const status = classifySaleCellCompleteness({ firstPageFailed: false, totalCount: 1000, collectedCount: 1000, anyLaterPageFailed: false });
  assert.equal(status, 'COMPLETE');
});
