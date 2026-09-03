// DATA_FRESHNESS_AUTOMATION_V1_PHASE2 §6 — dashboard regression.
//
// 이 STEP에서 검증범위가 "module load 시점 상수"에서 "DB coverage 기반 async 조회"로
// 바뀌었다. 값 자체는 바뀌지 않아야 한다(coverage cell이 0개인 현재 상태에서 결과는
// legacyBootstrap과 정확히 같다). 여기서는 dashboard가 실제로 의존하는 두 가지 성질이
// 리팩터링 뒤에도 그대로인지 고정한다:
//
//   1) rolling 12개월 window를 verified/unverified로 나누는 경계
//   2) verified(DB로 셈) 구간과 remainder(MOLIT row로 셈) 구간이 **절대 겹치지 않음**
//      — 겹치면 거래량이 이중 카운트된다(사용자에게 보이는 숫자가 틀린다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitVerifiedMonths, clipDateRangeToVerified } from './rent-verified-range.ts';

const RANGE = { from: '202408', to: '202608' }; // 현재 실제 검증범위(legacyBootstrap)

// dashboard/route.ts의 last12Months 생성과 동일한 형태(now 기준 12개월, 마지막이 현재월).
function last12MonthsFrom(now) {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - i), 1));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

test('rolling 12개월 중 검증범위를 벗어난 월(진행 중인 현재월 포함)은 unverified로 분류된다', () => {
  // 2026-09 기준: window는 202510..202609. 검증범위 to=202608이므로 202609(현재월)만 밖.
  const months = last12MonthsFrom(new Date('2026-09-15T00:00:00Z'));
  assert.equal(months[months.length - 1], '202609');
  const { verified, unverified } = splitVerifiedMonths(months, RANGE);
  assert.deepEqual(unverified, ['202609']);
  assert.equal(verified.length, 11);
  assert.ok(!verified.includes('202609'), '현재월은 절대 verified가 아니다');
});

test('검증범위가 전진하지 않은 채 시간이 흐르면 window 뒤쪽이 점점 unverified가 된다', () => {
  // 이것이 Phase 1에서 P0로 지목된 바로 그 현상이다 — coverage가 자동 전진하지 않으면
  // 대시보드가 신뢰할 수 있는 구간이 매달 줄어든다.
  const months = last12MonthsFrom(new Date('2026-12-15T00:00:00Z'));
  const { verified, unverified } = splitVerifiedMonths(months, RANGE);
  assert.deepEqual(unverified, ['202609', '202610', '202611', '202612']);
  assert.equal(verified.length, 8);
});

test('remainder 시작점(clipped.to + 1일)은 DB가 센 구간과 절대 겹치지 않는다(이중 카운트 방지)', () => {
  // dashboard의 countRentRemainderByType과 동일한 계산.
  const from = new Date(Date.UTC(2026, 7, 1)); // 2026-08-01
  const to = new Date(Date.UTC(2026, 8, 30)); // 2026-09-30 (검증범위 밖까지 뻗음)
  const clipped = clipDateRangeToVerified(from, to, RANGE);
  assert.ok(clipped);
  const remainderFrom = new Date(clipped.to.getTime() + 24 * 60 * 60 * 1000);
  assert.equal(clipped.to.toISOString().slice(0, 10), '2026-08-31');
  assert.equal(remainderFrom.toISOString().slice(0, 10), '2026-09-01');
  assert.ok(remainderFrom > clipped.to, 'remainder는 DB 구간 이후에서 시작해야 한다');
});

test('range가 전부 검증범위 안이면 remainder가 비어 있다', () => {
  const from = new Date(Date.UTC(2026, 5, 1));
  const to = new Date(Date.UTC(2026, 6, 31));
  const clipped = clipDateRangeToVerified(from, to, RANGE);
  assert.ok(clipped);
  const remainderFrom = new Date(clipped.to.getTime() + 24 * 60 * 60 * 1000);
  assert.ok(remainderFrom > to, '검증범위가 range를 모두 덮으면 remainder 구간은 없다');
});

test('range가 전부 검증범위 밖이면 DB에 묻지 않고 전부 remainder로 센다', () => {
  const from = new Date(Date.UTC(2026, 8, 1));
  const to = new Date(Date.UTC(2026, 8, 30));
  assert.equal(clipDateRangeToVerified(from, to, RANGE), null);
});

test('coverage가 전진하면 verified 구간이 실제로 넓어진다(자동화의 목적)', () => {
  const months = last12MonthsFrom(new Date('2026-12-15T00:00:00Z'));
  const advanced = { from: '202408', to: '202611' }; // cron이 3개월 전진시킨 상태
  const { verified, unverified } = splitVerifiedMonths(months, advanced);
  assert.deepEqual(unverified, ['202612'], '현재월만 미검증으로 남는다');
  assert.equal(verified.length, 11);
});
