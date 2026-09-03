import { test } from 'node:test';
import assert from 'node:assert/strict';
// NOTE(PHASE2): 이 파일은 원래 `.test.ts`였고, 확장자 없는 `./rent-verified-range`를
// import해서 node --experimental-strip-types --test로는 **아예 실행되지 않았다**
// (ERR_MODULE_NOT_FOUND) — 즉 이 신뢰-핵심 로직의 테스트가 조용히 죽어 있었다.
// repo의 다른 테스트와 같은 `.test.mjs` 관례로 옮기고 명시적 확장자를 붙여 실제로
// 실행되게 고친다(`.ts` 확장자 import는 tsconfig의 allowImportingTsExtensions와
// 충돌하므로 .mjs가 이 repo에서 유일하게 일관된 선택이다).
import {
  computeVerifiedRangeFromCoverage,
  isVerifiedCellStatus,
  splitVerifiedMonths,
  clipDateRangeToVerified,
} from './rent-verified-range.ts';

const DISTRICTS = ['A', 'B', 'C']; // 작은 합성 district 집합 — 실제 16개 부산 구 대신 사용
const BOOTSTRAP = { from: '202408', to: '202608' };

function cellsOf(cells) {
  const map = {};
  for (const [k, status] of Object.entries(cells)) map[k] = { status };
  return map;
}

function allDistricts(month, status) {
  return Object.fromEntries(DISTRICTS.map((d) => [`${d}:${month}`, status]));
}

test('cells가 비어 있으면 legacyBootstrap 그대로 반환한다(회귀: 이전 하드코딩 값과 동일)', () => {
  const result = computeVerifiedRangeFromCoverage(BOOTSTRAP, cellsOf({}), DISTRICTS, new Date('2026-09-03'));
  assert.deepEqual(result, { from: '202408', to: '202608' });
});

test('16/16(합성: 3/3) 전부 COMPLETE인 다음 달은 verified로 전진한다', () => {
  const result = computeVerifiedRangeFromCoverage(BOOTSTRAP, cellsOf(allDistricts('202609', 'COMPLETE')), DISTRICTS, new Date('2026-10-15'));
  assert.equal(result.to, '202609');
});

test('15/16(합성: 2/3)만 COMPLETE면 그 달은 전진하지 않는다', () => {
  const cells = cellsOf({ 'A:202609': 'COMPLETE', 'B:202609': 'COMPLETE', 'C:202609': 'PARTIAL' });
  const result = computeVerifiedRangeFromCoverage(BOOTSTRAP, cells, DISTRICTS, new Date('2026-10-15'));
  assert.equal(result.to, '202608'); // legacyBootstrap.to 그대로, 전진 없음
});

test('일부 구가 아예 cells에 없어도(아직 sync 안 됨) 전진하지 않는다', () => {
  const cells = cellsOf({ 'A:202609': 'COMPLETE', 'B:202609': 'COMPLETE' }); // C 없음
  const result = computeVerifiedRangeFromCoverage(BOOTSTRAP, cells, DISTRICTS, new Date('2026-10-15'));
  assert.equal(result.to, '202608');
});

test('재시도로 실패했던 구가 나중에 COMPLETE가 되면 그때 전진한다(retry completion)', () => {
  const attempt1 = cellsOf({ 'A:202609': 'COMPLETE', 'B:202609': 'COMPLETE', 'C:202609': 'PARTIAL' });
  assert.equal(computeVerifiedRangeFromCoverage(BOOTSTRAP, attempt1, DISTRICTS, new Date('2026-10-15')).to, '202608');

  const attempt2 = cellsOf(allDistricts('202609', 'COMPLETE'));
  assert.equal(computeVerifiedRangeFromCoverage(BOOTSTRAP, attempt2, DISTRICTS, new Date('2026-10-15')).to, '202609');
});

test('연속된 여러 달이 전부 COMPLETE면 계속 전진한다', () => {
  const cells = cellsOf({ ...allDistricts('202609', 'COMPLETE'), ...allDistricts('202610', 'COMPLETE') });
  const result = computeVerifiedRangeFromCoverage(BOOTSTRAP, cells, DISTRICTS, new Date('2026-11-15'));
  assert.equal(result.to, '202610');
});

test('중간에 미완료 달이 끼면 그 이전까지만 전진한다(연속성 유지)', () => {
  const cells = cellsOf({ ...allDistricts('202609', 'COMPLETE'), ...allDistricts('202611', 'COMPLETE') });
  const result = computeVerifiedRangeFromCoverage(BOOTSTRAP, cells, DISTRICTS, new Date('2026-12-15'));
  assert.equal(result.to, '202609'); // 202611이 COMPLETE라도 202610 gap 때문에 거기서 멈춤
});

test('현재 달(진행 중)은 COMPLETE로 잘못 기록돼 있어도 verified에 포함하지 않는다', () => {
  // 방어적 가드 — 정상 sync 엔진이라면 애초에 현재월을 COMPLETE로 안 남기지만, 이 함수
  // 자체도 독립적으로 같은 규칙을 강제해야 한다(§15 단일 실패 지점 의존 금지).
  const cells = cellsOf(allDistricts('202609', 'COMPLETE'));
  const result = computeVerifiedRangeFromCoverage(BOOTSTRAP, cells, DISTRICTS, new Date('2026-09-15'));
  assert.equal(result.to, '202608');
});

test('from은 항상 legacyBootstrap.from 그대로다(역방향 확장 없음)', () => {
  const cells = cellsOf(allDistricts('202609', 'COMPLETE'));
  const result = computeVerifiedRangeFromCoverage(BOOTSTRAP, cells, DISTRICTS, new Date('2026-10-15'));
  assert.equal(result.from, '202408');
});

// ---------------------------------------------------------------------------
// PHASE2 §14 — EMPTY_VALID semantics 수정에 대한 회귀 테스트.
// ---------------------------------------------------------------------------

test('EMPTY_VALID는 검증된 상태다 — 실제 거래 0건인 구가 있어도 coverage가 멈추지 않는다', () => {
  // 이것이 Phase 2에서 고친 잠재 버그다: writer는 EMPTY_VALID를 기록하는데 reader는
  // COMPLETE만 인정해서, 전월세 거래가 진짜 0건인 구-월 하나가 coverage를 영구히 막았다.
  const cells = cellsOf({ 'A:202609': 'COMPLETE', 'B:202609': 'EMPTY_VALID', 'C:202609': 'COMPLETE' });
  const result = computeVerifiedRangeFromCoverage(BOOTSTRAP, cells, DISTRICTS, new Date('2026-10-15'));
  assert.equal(result.to, '202609');
});

test('전부 EMPTY_VALID인 달도 전진한다(신뢰할 수 있는 진짜 0건)', () => {
  const cells = cellsOf(allDistricts('202609', 'EMPTY_VALID'));
  const result = computeVerifiedRangeFromCoverage(BOOTSTRAP, cells, DISTRICTS, new Date('2026-10-15'));
  assert.equal(result.to, '202609');
});

test('PARTIAL/INVALID는 검증된 상태가 아니다', () => {
  assert.equal(isVerifiedCellStatus('COMPLETE'), true);
  assert.equal(isVerifiedCellStatus('EMPTY_VALID'), true);
  assert.equal(isVerifiedCellStatus('PARTIAL'), false);
  assert.equal(isVerifiedCellStatus('INVALID'), false);
  assert.equal(isVerifiedCellStatus(undefined), false);
});

test('INVALID만 있는 달은 전진하지 않는다(실패를 검증으로 승격 금지)', () => {
  const cells = cellsOf(allDistricts('202609', 'INVALID'));
  const result = computeVerifiedRangeFromCoverage(BOOTSTRAP, cells, DISTRICTS, new Date('2026-10-15'));
  assert.equal(result.to, '202608');
});

// ---------------------------------------------------------------------------
// range를 인자로 받게 바뀐 helper들 — 기존 의미가 그대로 보존되는지 확인한다.
// ---------------------------------------------------------------------------

test('splitVerifiedMonths는 범위 안/밖을 정확히 나눈다(정렬 안 된 입력도 안전)', () => {
  const { verified, unverified } = splitVerifiedMonths(['202609', '202408', '202512', '202407'], BOOTSTRAP);
  assert.deepEqual(verified.sort(), ['202408', '202512']);
  assert.deepEqual(unverified.sort(), ['202407', '202609']);
});

test('clipDateRangeToVerified는 검증범위 끝에서 자른다', () => {
  const clipped = clipDateRangeToVerified(new Date(Date.UTC(2026, 7, 1)), new Date(Date.UTC(2026, 11, 31)), BOOTSTRAP);
  assert.ok(clipped);
  assert.equal(clipped.to.toISOString().slice(0, 10), '2026-08-31'); // 202608의 마지막 날
});

test('검증범위와 전혀 겹치지 않으면 null을 반환한다', () => {
  const clipped = clipDateRangeToVerified(new Date(Date.UTC(2026, 8, 1)), new Date(Date.UTC(2026, 8, 30)), BOOTSTRAP);
  assert.equal(clipped, null);
});
