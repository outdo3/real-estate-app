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
  resolveSaleRecheckBand,
  orderRecheckCellsByStaleness,
  SALE_RECHECK_MIN_MONTHS_BACK,
  SALE_RECHECK_MAX_MONTHS_BACK,
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

// ---------------------------------------------------------------------------
// SALE_CANCELLATION_COVERAGE_V1 §3/§5 — late cancellation recheck band.
// ---------------------------------------------------------------------------

test('recheck band는 daily overlap 바로 바깥에서 시작해 12개월 전까지 덮는다', () => {
  const latest = '202608'; // now = 2026-09
  const { from, to } = resolveSaleRecheckBand(latest, subtractMonths);
  assert.equal(from, '202508'); // latestComplete - 12
  assert.equal(to, '202605'); // latestComplete - 3
  assert.equal(monthsInRange(from, to).length, 10);
});

test('recheck band와 daily fresh 범위는 겹치지도, 사이를 비우지도 않는다', () => {
  const now = new Date('2026-09-03T00:00:00Z');
  const latest = latestCompleteMonth(now);
  const fresh = resolveSaleRange(latest, currentCalendarMonth(now), subtractMonths, {});
  const band = resolveSaleRecheckBand(latest, subtractMonths);
  const freshMonths = monthsInRange(fresh.from, fresh.to);
  const bandMonths = monthsInRange(band.from, band.to);

  const overlap = bandMonths.filter((m) => freshMonths.includes(m));
  assert.deepEqual(overlap, [], '두 경로가 같은 셀을 중복 fetch하면 예산 낭비다');

  // 두 범위를 합치면 band.from ~ 현재월이 빈 달 없이 연속이어야 한다.
  const union = [...bandMonths, ...freshMonths];
  assert.deepEqual(union, monthsInRange(band.from, fresh.to), 'band와 fresh 사이에 구멍이 있으면 안 된다');
});

test('recheck band는 진행 중인 현재월도, 미완료 달도 절대 포함하지 않는다', () => {
  const now = new Date('2026-09-03T00:00:00Z');
  const latest = latestCompleteMonth(now); // 202608
  const { to } = resolveSaleRecheckBand(latest, subtractMonths);
  assert.ok(to < latest, 'band 상한은 완료월보다도 이전이어야 한다');
  assert.ok(!monthsInRange('202508', to).includes('202609'));
});

test('recheck band 상수는 실측 취소지연 p99(11.8개월)를 덮는다', () => {
  assert.equal(SALE_RECHECK_MIN_MONTHS_BACK, 3, 'daily overlap(3개월)과 정확히 맞물려야 한다');
  assert.ok(SALE_RECHECK_MAX_MONTHS_BACK >= 12, 'p99 11.8개월을 덮으려면 12개월 이상이어야 한다');
});

test('recheck band는 해를 넘어가는 경우에도 정확하다', () => {
  const { from, to } = resolveSaleRecheckBand('202601', subtractMonths);
  assert.equal(from, '202501');
  assert.equal(to, '202510');
});

test('한 번도 검증되지 않은 셀이 항상 최우선이다', () => {
  const ordered = orderRecheckCellsByStaleness([
    { lawdCd: '26110', dealYmd: '202601', lastVerifiedAtMs: 1000 },
    { lawdCd: '26140', dealYmd: '202601' }, // 기록 없음
    { lawdCd: '26170', dealYmd: '202601', lastVerifiedAtMs: 5 },
  ]);
  assert.equal(ordered[0].lawdCd, '26140');
  assert.equal(ordered[1].lawdCd, '26170'); // 그 다음은 가장 오래된 검증
  assert.equal(ordered[2].lawdCd, '26110');
});

test('오래 확인되지 않은 셀부터 처리한다(starvation 방지)', () => {
  const cells = [
    { lawdCd: '26110', dealYmd: '202601', lastVerifiedAtMs: 300 },
    { lawdCd: '26140', dealYmd: '202602', lastVerifiedAtMs: 100 },
    { lawdCd: '26170', dealYmd: '202603', lastVerifiedAtMs: 200 },
  ];
  const ordered = orderRecheckCellsByStaleness(cells);
  assert.deepEqual(ordered.map((c) => c.lawdCd), ['26140', '26170', '26110']);
});

test('정렬은 입력 배열을 변형하지 않는다', () => {
  const cells = [
    { lawdCd: '26170', dealYmd: '202601', lastVerifiedAtMs: 200 },
    { lawdCd: '26110', dealYmd: '202601', lastVerifiedAtMs: 100 },
  ];
  const before = cells.map((c) => c.lawdCd).join(',');
  orderRecheckCellsByStaleness(cells);
  assert.equal(cells.map((c) => c.lawdCd).join(','), before);
});

test('동률이면 결정적으로 정렬된다(최신 달 우선, 그다음 lawdCd 오름차순)', () => {
  const cells = [
    { lawdCd: '26170', dealYmd: '202601', lastVerifiedAtMs: 100 },
    { lawdCd: '26110', dealYmd: '202601', lastVerifiedAtMs: 100 },
    { lawdCd: '26140', dealYmd: '202603', lastVerifiedAtMs: 100 },
  ];
  const a = orderRecheckCellsByStaleness(cells).map((c) => `${c.lawdCd}:${c.dealYmd}`);
  const b = orderRecheckCellsByStaleness([...cells].reverse()).map((c) => `${c.lawdCd}:${c.dealYmd}`);
  assert.deepEqual(a, ['26140:202603', '26110:202601', '26170:202601']);
  assert.deepEqual(a, b, '입력 순서가 달라도 결과가 같아야 한다');
});

test('전체 band를 한 바퀴 돌면 모든 셀이 정확히 한 번씩 나온다', () => {
  const cells = [];
  for (const m of monthsInRange('202508', '202605')) {
    for (const l of ['26110', '26140', '26170']) cells.push({ lawdCd: l, dealYmd: m });
  }
  const ordered = orderRecheckCellsByStaleness(cells);
  assert.equal(ordered.length, 30);
  assert.equal(new Set(ordered.map((c) => `${c.lawdCd}:${c.dealYmd}`)).size, 30);
});
