import assert from 'node:assert/strict';
import test from 'node:test';
import { computeMonthsForRegion } from './incremental-sync-logic.ts';

const NOW = new Date(2026, 7, 31); // 2026-08-31 (month index 7 = August, 0-based)

test('첫 실행(manifest에 이 지역 기록 없음)이면 overlapMonths개월만 처리한다(딥 백필 아님)', () => {
  const months = computeMonthsForRegion('26140', {}, NOW, 3);
  assert.deepEqual(months, ['202606', '202607', '202608']);
});

test('overlapMonths=1이면 현재월 하나만 처리한다', () => {
  const months = computeMonthsForRegion('26140', {}, NOW, 1);
  assert.deepEqual(months, ['202608']);
});

test('마지막 완료 달이 있으면 그 지점에서 overlapMonths만큼 물러난 지점부터 현재월까지 처리한다', () => {
  const manifest = {
    '26140:202605': { status: 'COMPLETE', fetched: 10, invalidRows: 0, insertCount: 10, updateFalseToTrue: 0, updateTrueToFalseSkipped: 0, conflicts: 0, at: '2026-06-01T00:00:00Z' },
  };
  const months = computeMonthsForRegion('26140', manifest, NOW, 3);
  // lastComplete=202605, overlap 3개월이면 202603부터 현재월(202608)까지
  assert.deepEqual(months, ['202603', '202604', '202605', '202606', '202607', '202608']);
});

test('EMPTY_VALID도 완료로 인정한다(0건 거래를 실패로 취급하지 않음)', () => {
  const manifest = {
    '26140:202607': { status: 'EMPTY_VALID', fetched: 0, invalidRows: 0, insertCount: 0, updateFalseToTrue: 0, updateTrueToFalseSkipped: 0, conflicts: 0, at: '2026-08-01T00:00:00Z' },
  };
  const months = computeMonthsForRegion('26140', manifest, NOW, 3);
  assert.deepEqual(months, ['202605', '202606', '202607', '202608']);
});

test('FAILED은 완료로 인정하지 않는다(완료 지점을 앞당기지 않음)', () => {
  const manifest = {
    '26140:202607': { status: 'FAILED', fetched: 0, invalidRows: 0, insertCount: 0, updateFalseToTrue: 0, updateTrueToFalseSkipped: 0, conflicts: 0, at: '2026-08-01T00:00:00Z' },
  };
  // FAILED만 있고 COMPLETE/EMPTY_VALID가 전혀 없으므로 "첫 실행"과 동일하게 처리(overlap만)
  const months = computeMonthsForRegion('26140', manifest, NOW, 3);
  assert.deepEqual(months, ['202606', '202607', '202608']);
});

test('다른 지역의 manifest 기록은 서로 간섭하지 않는다(lawdCd로 정확히 구분)', () => {
  const manifest = {
    '11680:202601': { status: 'COMPLETE', fetched: 5, invalidRows: 0, insertCount: 5, updateFalseToTrue: 0, updateTrueToFalseSkipped: 0, conflicts: 0, at: '2026-02-01T00:00:00Z' },
  };
  // 26140에 대한 기록이 없으므로 11680의 기록에 영향받지 않고 "첫 실행"으로 처리
  const months = computeMonthsForRegion('26140', manifest, NOW, 3);
  assert.deepEqual(months, ['202606', '202607', '202608']);
});

test('여러 달이 COMPLETE로 기록돼 있으면 그중 가장 최근 달을 기준으로 계산한다', () => {
  const manifest = {
    '26140:202601': { status: 'COMPLETE', fetched: 1, invalidRows: 0, insertCount: 1, updateFalseToTrue: 0, updateTrueToFalseSkipped: 0, conflicts: 0, at: '' },
    '26140:202607': { status: 'COMPLETE', fetched: 1, invalidRows: 0, insertCount: 1, updateFalseToTrue: 0, updateTrueToFalseSkipped: 0, conflicts: 0, at: '' },
    '26140:202604': { status: 'COMPLETE', fetched: 1, invalidRows: 0, insertCount: 1, updateFalseToTrue: 0, updateTrueToFalseSkipped: 0, conflicts: 0, at: '' },
  };
  const months = computeMonthsForRegion('26140', manifest, NOW, 1);
  // 가장 최근 완료 달=202607, overlap 1개월이면 202607부터 현재월(202608)까지
  assert.deepEqual(months, ['202607', '202608']);
});

test('이미 현재월까지 완료돼 있어도 최소 overlapMonths개월은 항상 재확인한다', () => {
  const manifest = {
    '26140:202608': { status: 'COMPLETE', fetched: 1, invalidRows: 0, insertCount: 1, updateFalseToTrue: 0, updateTrueToFalseSkipped: 0, conflicts: 0, at: '' },
  };
  const months = computeMonthsForRegion('26140', manifest, NOW, 3);
  assert.deepEqual(months, ['202606', '202607', '202608']);
});
