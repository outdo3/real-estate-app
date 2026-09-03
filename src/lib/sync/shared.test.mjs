// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §32 — sync core의 순수 판정 로직 테스트.
// (DB/네트워크 없음 — core 파일 자체는 prisma를 import하므로, 판정 로직만 shared.ts에
//  분리해 여기서 검증한다.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TimeBudget,
  currentCalendarMonth,
  httpStatusForRun,
  monthsInRange,
  resolveRentRange,
  resolveSaleRange,
} from './shared.ts';
import { latestCompleteMonth, subtractMonths } from '../../../scripts/rent-trade-history/incremental-sync-completed-month-logic.ts';

// ---------------------------------------------------------------------------
// §15 CURRENT MONTH — 진행 중인 달을 완료로 취급하지 않는다.
// ---------------------------------------------------------------------------

test('RENT 범위는 현재월을 절대 포함하지 않는다(기본 overlap=2)', () => {
  const now = new Date('2026-09-03T00:00:00Z');
  const latest = latestCompleteMonth(now); // 202608
  const { from, to } = resolveRentRange(latest, subtractMonths, {});
  assert.equal(to, '202608');
  assert.equal(from, '202607');
  assert.ok(!monthsInRange(from, to).includes('202609'), '현재월(202609)이 포함되면 안 된다');
});

test('RENT는 명시 범위를 줘도 완료월 너머로는 확장되지 않는다(clamp)', () => {
  const latest = '202608';
  const { to } = resolveRentRange(latest, subtractMonths, { from: '202607', to: '202612' });
  assert.equal(to, '202608', '미래/진행중 월 요청은 완료월로 clamp된다');
});

test('SALE 범위는 현재월까지 동기화한다(최신성) — 단 완료월 구분값을 따로 제공한다', () => {
  const now = new Date('2026-09-03T00:00:00Z');
  const latest = latestCompleteMonth(now);
  const { from, to } = resolveSaleRange(latest, currentCalendarMonth(now), subtractMonths, {});
  assert.equal(from, '202606'); // overlap 3 = 완료월 기준 3개월
  assert.equal(to, '202609'); // 현재월 포함 — 동기화는 하되 검증완료로 기록하지 않는다
  assert.equal(latest, '202608');
});

test('연말 경계에서 월 계산이 해를 넘어간다', () => {
  const now = new Date('2027-01-10T00:00:00Z');
  const latest = latestCompleteMonth(now);
  assert.equal(latest, '202612');
  const { from, to } = resolveRentRange(latest, subtractMonths, {});
  assert.equal(from, '202611');
  assert.equal(to, '202612');
});

test('monthsInRange는 해를 넘어가는 범위를 정확히 펼친다', () => {
  assert.deepEqual(monthsInRange('202611', '202702'), ['202611', '202612', '202701', '202702']);
});

// ---------------------------------------------------------------------------
// §19 HTTP STATUS POLICY — 성공이 아닌 것을 200으로 감추지 않는다.
// ---------------------------------------------------------------------------

test('SUCCESS만 200이다', () => {
  assert.equal(httpStatusForRun('SUCCESS'), 200);
});

test('PARTIAL / NEEDS_REVIEW / PARTIAL_RUN은 절대 200이 아니다', () => {
  for (const s of ['PARTIAL', 'NEEDS_REVIEW', 'PARTIAL_RUN']) {
    assert.notEqual(httpStatusForRun(s), 200, `${s}가 200이면 Cron이 성공으로 오인한다`);
    assert.equal(httpStatusForRun(s), 207);
  }
});

test('FAILED는 500이다', () => {
  assert.equal(httpStatusForRun('FAILED'), 500);
});

// ---------------------------------------------------------------------------
// §21 TIMEOUT — 예산을 넘기 전에 셀 경계에서 깨끗하게 멈춘다.
// ---------------------------------------------------------------------------

test('TimeBudget은 남은 시간이 한 셀 예상치보다 적으면 중단을 지시한다', () => {
  const budget = new TimeBudget(1000);
  assert.equal(budget.hasRoomFor(100), true, '충분한 여유가 있으면 계속한다');
  assert.equal(budget.hasRoomFor(5000), false, '한 셀도 못 끝낼 것 같으면 시작하지 않는다');
});

test('TimeBudget 0 예산이면 아무 셀도 시작하지 않는다', () => {
  const budget = new TimeBudget(0);
  assert.equal(budget.hasRoomFor(1), false);
});
