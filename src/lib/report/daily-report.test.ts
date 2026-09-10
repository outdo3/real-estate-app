// REPORT-5 — 관찰일/백필/발행 게이트 순수 규칙 테스트.
// 실행: npx tsx --test src/lib/report/daily-report.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DAILY_SUPPORTED_FROM_KST,
  KST_OFFSET_MINUTES,
  MAX_LEGITIMATE_DISTINCT_MONTHS,
  SYNC_BOUNDS,
  detectBackfill,
  isValidYmd,
  monthsBefore,
  observationWindowKst,
  publicationMessage,
  resolvePublicationState,
  todayKst,
  ymdToYm,
} from './daily-observation';
import { buildDailyReport, type DailyReportInput, type DailyTradeRow } from './daily-report';
import { keepBusanCurrentScope, excludeCanceled } from './region-aggregate';

// ── §2 KST/UTC ──────────────────────────────────────────────────────────────
test('KST 하루는 UTC [D-1 15:00, D 15:00)로 변환된다', () => {
  const w = observationWindowKst('2026-09-09');
  assert.equal(w.startUtc.toISOString(), '2026-09-08T15:00:00.000Z');
  assert.equal(w.endUtcExclusive.toISOString(), '2026-09-09T15:00:00.000Z');
  assert.equal(w.endUtcExclusive.getTime() - w.startUtc.getTime(), 24 * 3600 * 1000, '정확히 24시간');
});

test('한국은 DST가 없어 여름/겨울 오프셋이 같다', () => {
  assert.equal(KST_OFFSET_MINUTES, 540);
  const off = (dateKst: string) =>
    Date.parse(dateKst + 'T00:00:00.000Z') - observationWindowKst(dateKst).startUtc.getTime();
  assert.equal(off('2026-07-15'), off('2026-01-15'));
});

test('todayKst는 UTC+9로 계산된다', () => {
  assert.equal(todayKst(new Date('2026-09-09T16:00:00.000Z')), '2026-09-10');
  assert.equal(todayKst(new Date('2026-09-09T14:59:59.000Z')), '2026-09-09');
});

test('날짜 형식 검증과 보조 변환', () => {
  assert.equal(isValidYmd('2026-09-09'), true);
  assert.equal(isValidYmd('2026-9-9'), false);
  assert.equal(isValidYmd('2026-02-30'), false);
  assert.equal(isValidYmd('not-a-date'), false);
  assert.equal(ymdToYm('2026-09-09'), '202609');
  assert.equal(monthsBefore('2026-09-09', 12), '2025-09-01');
});

// ── §6 백필 가드 ────────────────────────────────────────────────────────────
test('가드 경계는 shipped 상수에서 유도된다(임의 숫자 아님)', () => {
  assert.equal(SYNC_BOUNDS.overlapMonths, 3);
  assert.equal(SYNC_BOUNDS.recheckMaxMonthsBack, 12);
  assert.equal(MAX_LEGITIMATE_DISTINCT_MONTHS, 13);
});

test('알려진 백필일 2026-08-29(248개월)을 잡는다', () => {
  const r = detectBackfill({ totalRows: 855045, distinctDealYmd: 248, minDealDate: '2006-01-01' }, '2026-08-29');
  assert.equal(r.suspected, true);
  assert.equal(r.suspected && r.reason, 'TOO_MANY_MONTHS');
});

test('알려진 백필일 2026-09-03(24개월)을 잡는다', () => {
  const r = detectBackfill({ totalRows: 8921, distinctDealYmd: 24, minDealDate: '2006-11-01' }, '2026-09-03');
  assert.equal(r.suspected, true);
});

test('정상일 2026-09-09(7개월)은 잡지 않는다', () => {
  const r = detectBackfill({ totalRows: 89, distinctDealYmd: 7, minDealDate: '2026-02-10' }, '2026-09-09');
  assert.equal(r.suspected, false);
});

test('행 수는 판별자가 아니다(정상 206건 > 비정상 132건)', () => {
  assert.equal(detectBackfill({ totalRows: 206, distinctDealYmd: 4, minDealDate: '2026-06-18' }, '2026-09-07').suspected, false);
  assert.equal(detectBackfill({ totalRows: 132, distinctDealYmd: 1, minDealDate: '2026-08-01' }, '2026-08-31').suspected, false);
});

test('계약일이 12개월 지평보다 오래되면 잡는다', () => {
  const r = detectBackfill({ totalRows: 5, distinctDealYmd: 2, minDealDate: '2024-01-05' }, '2026-09-09');
  assert.equal(r.suspected, true);
  assert.equal(r.suspected && r.reason, 'CONTRACT_TOO_OLD');
});

test('관측 0건은 백필로 보지 않는다', () => {
  assert.equal(detectBackfill({ totalRows: 0, distinctDealYmd: 0, minDealDate: null }, '2026-09-09').suspected, false);
});

// ── §9~§12 발행 게이트 ──────────────────────────────────────────────────────
const pub = (o: Partial<Parameters<typeof resolvePublicationState>[0]> = {}) =>
  resolvePublicationState({
    dateKst: '2026-09-09',
    todayKst: '2026-09-10',
    backfill: { suspected: false },
    coverage: 'VERIFIED',
    validBusanRows: 10,
    ...o,
  });

test('백필은 지원 범위보다 먼저 판정된다(8/29가 백필로 보고된다)', () => {
  assert.equal(
    pub({ dateKst: '2026-08-29', backfill: { suspected: true, reason: 'TOO_MANY_MONTHS', detail: 'x' } }),
    'WITHHELD_BACKFILL'
  );
});

test('지원 범위 밖과 미래 날짜', () => {
  assert.equal(pub({ dateKst: '2026-08-01' }), 'OUTSIDE_SUPPORTED_RANGE');
  assert.equal(pub({ dateKst: '2026-09-30' }), 'OUTSIDE_SUPPORTED_RANGE');
  assert.equal(DAILY_SUPPORTED_FROM_KST, '2026-08-30');
});

test('검증되지 않으면 0건이라고 말하지 않는다', () => {
  assert.equal(pub({ coverage: 'UNVERIFIED', validBusanRows: 0 }), 'PREPARING');
  assert.equal(pub({ coverage: 'UNVERIFIED', validBusanRows: 10 }), 'PREPARING');
});

test('검증된 진짜 0건만 READY_ZERO', () => {
  assert.equal(pub({ coverage: 'VERIFIED', validBusanRows: 0 }), 'READY_ZERO');
  assert.equal(pub({ coverage: 'VERIFIED', validBusanRows: 3 }), 'READY');
});

test('상태별 문구가 서로 구분된다', () => {
  assert.equal(publicationMessage('READY', '9월 9일'), null);
  assert.ok(publicationMessage('WITHHELD_BACKFILL', '9월 9일')!.includes('데이터 정리'));
  assert.ok(publicationMessage('PREPARING', '9월 9일')!.includes('확인하는 중'));
  assert.ok(publicationMessage('OUTSIDE_SUPPORTED_RANGE', '9월 9일')!.includes('제공하지 않는 기간'));
});

// ── §4/§5 스코프·취소 ───────────────────────────────────────────────────────
const row = (o: Partial<DailyTradeRow> = {}): DailyTradeRow => ({
  aptSeq: '26350-1', lawdCd: '26350', dong: '우동', aptName: '테스트단지',
  exclusiveArea: 84.97, dealAmount: 82000, dealDate: '2026-08-28',
  dealCanceled: false, floor: 12, observedAt: '2026-09-09T10:00:00.000Z', ...o,
});

test('27110/11680은 부산 집계에서 제외된다', () => {
  assert.equal(keepBusanCurrentScope([row(), row({ lawdCd: '27110' }), row({ lawdCd: '11680' })]).length, 1);
});

test('취소 거래는 제외된다', () => {
  assert.equal(excludeCanceled([row(), row({ dealCanceled: true })]).length, 1);
});

// ── envelope ────────────────────────────────────────────────────────────────
const base = (o: Partial<DailyReportInput> = {}): DailyReportInput => ({
  window: observationWindowKst('2026-09-09'),
  rows: [row(), row({ dealAmount: 95000, dealDate: '2026-09-01' })],
  masters: [{ aptSeq: '26350-1', name: '보강된이름' }],
  backfill: { suspected: false },
  coverage: 'VERIFIED',
  publicationState: 'READY',
  rawObservedRows: 2,
  outOfScopeRows: 0,
  generatedAt: '2026-09-10T00:00:00.000Z',
  dataAsOf: '2026-09-09T20:00:17.040Z',
  ...o,
});

test('제목이 "새로 확인된" 의미를 담는다(§19)', () => {
  const e = buildDailyReport(base());
  assert.ok(e.title.includes('새로 확인된'));
  assert.ok(!e.title.includes('계약된'));
  assert.ok(e.subtitle!.includes('새로 확인한'));
});

test('모든 거래 행에 계약일이 실린다', () => {
  const e = buildDailyReport(base());
  const rowSections = e.sections.filter((x) => x.kind === 'ROWS');
  assert.ok(rowSections.length > 0);
  for (const s of rowSections) {
    for (const r of s.rows) {
      assert.ok(String(r.cells.dealDateLabel).startsWith('계약일'));
      assert.ok(r.cells.dealDate);
    }
  }
});

test('보류 상태에서는 숫자를 만들지 않는다(부분 집계 금지)', () => {
  for (const st of ['WITHHELD_BACKFILL', 'PREPARING', 'OUTSIDE_SUPPORTED_RANGE'] as const) {
    const e = buildDailyReport(base({ publicationState: st }));
    assert.equal(e.data!.numbersPublished, false);
    assert.equal(e.data!.totalObserved, 0);
    const m = e.metrics.find((x) => x.key === 'newlyObserved')!;
    assert.equal(m.value, null);
    assert.equal(m.displayValue, '확인 중');
    assert.equal(m.trust, 'MISSING');
    assert.equal(e.sections.length, 0);
  }
});

test('READY_ZERO는 0건을 명시하고 PREPARING과 다르다', () => {
  const zero = buildDailyReport(base({ publicationState: 'READY_ZERO', rows: [] }));
  assert.equal(zero.data!.numbersPublished, true);
  assert.equal(zero.metrics.find((m) => m.key === 'newlyObserved')!.value, 0);
  const prep = buildDailyReport(base({ publicationState: 'PREPARING', rows: [] }));
  assert.equal(prep.metrics.find((m) => m.key === 'newlyObserved')!.value, null);
  assert.notEqual(zero.data!.message, prep.data!.message);
});

test('스코프 밖 행 수를 숨기지 않고 note로 알린다', () => {
  const e = buildDailyReport(base({ outOfScopeRows: 132 }));
  assert.ok(e.trust.notes.some((n) => n.includes('132')));
});

test('관찰일/계약일 구분 note가 항상 있다', () => {
  for (const st of ['READY', 'PREPARING', 'WITHHELD_BACKFILL'] as const) {
    const e = buildDailyReport(base({ publicationState: st }));
    assert.ok(e.trust.notes.some((n) => n.includes('새로 확인한 날짜')));
  }
});

test('master 보강이 없어도 행을 버리지 않는다', () => {
  const e = buildDailyReport(base({ rows: [row({ aptSeq: null, aptName: '마스터없음' })], masters: [] }));
  const rep = e.sections.find((s) => s.key === 'representativeTrades')!;
  assert.equal(rep.rows.length, 1);
  assert.equal(rep.rows[0].enriched, false);
  assert.equal(rep.rows[0].cells.aptName, '마스터없음');
});

test('평 라벨을 만들지 않고 ㎡를 그대로 싣는다', () => {
  const json = JSON.stringify(buildDailyReport(base()));
  assert.ok(!/\d+평/.test(json));
  assert.ok(json.includes('84.97'));
});

test('대표 거래 정렬은 결정론적이다', () => {
  const rows = [
    row({ aptSeq: 'B', dealDate: '2026-08-01', dealAmount: 100 }),
    row({ aptSeq: 'A', dealDate: '2026-08-01', dealAmount: 100 }),
    row({ aptSeq: 'C', dealDate: '2026-08-02', dealAmount: 50 }),
  ];
  const once = buildDailyReport(base({ rows })).sections.find((s) => s.key === 'representativeTrades')!.rows.map((r) => r.cells.aptSeq);
  const twice = buildDailyReport(base({ rows: [...rows].reverse() })).sections.find((s) => s.key === 'representativeTrades')!.rows.map((r) => r.cells.aptSeq);
  assert.deepEqual(once, ['C', 'A', 'B']);
  assert.deepEqual(once, twice);
});

test('결정론적이다', () => {
  assert.equal(JSON.stringify(buildDailyReport(base())), JSON.stringify(buildDailyReport(base())));
});
