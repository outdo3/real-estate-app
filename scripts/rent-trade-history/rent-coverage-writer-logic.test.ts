import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRecordCoverageCell } from './rent-coverage-writer-logic';

test('dry-run은 COMPLETE여도 절대 기록하지 않는다', () => {
  assert.equal(shouldRecordCoverageCell('dry-run', 'COMPLETE'), false);
});

test('dry-run은 EMPTY_VALID여도 절대 기록하지 않는다', () => {
  assert.equal(shouldRecordCoverageCell('dry-run', 'EMPTY_VALID'), false);
});

test('apply + COMPLETE는 기록한다', () => {
  assert.equal(shouldRecordCoverageCell('apply', 'COMPLETE'), true);
});

test('apply + EMPTY_VALID는 기록한다(실제 0건으로 pagination까지 확인된 상태)', () => {
  assert.equal(shouldRecordCoverageCell('apply', 'EMPTY_VALID'), true);
});

test('apply + PARTIAL은 기록하지 않는다(실패로 취급 — 다음 실행에서 재시도)', () => {
  assert.equal(shouldRecordCoverageCell('apply', 'PARTIAL'), false);
});

test('apply + INVALID는 기록하지 않는다', () => {
  assert.equal(shouldRecordCoverageCell('apply', 'INVALID'), false);
});
