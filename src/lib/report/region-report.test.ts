// REPORT ENGINE REPORT-1 — 순수 규칙 테스트.
//
// 실행: npx tsx --test src/lib/report/region-report.test.ts
// tsx로 도는 이유: 이 모듈들은 서로를 확장자 없이 import하는데(앱 코드의 정상 관례이자
// tsconfig moduleResolution=bundler 전제), node 네이티브 ESM 로더는 그걸 해석하지 못한다.
// tsx는 Next와 같은 방식으로 해석하므로 프로덕션 코드를 테스트 때문에 비틀지 않아도 된다.
// DB에 접근하지 않는다 — Prisma를 import하는 region-read.ts는 여기서 쓰지 않는다.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUSAN_CURRENT_LAWD_CODES,
  isBusanCurrentLawdCd,
  districtName,
  resolveScopeLawdCds,
  normalizeDong,
} from './region-scope';
import {
  MIN_SAMPLE_FOR_INTERPRETATION,
  aggregate,
  countDelta,
  describeCountDelta,
  distribution,
  enrichRows,
  excludeCanceled,
  keepBusanCurrentScope,
  median,
  prepareRows,
  recentTrades,
  representativeComplexes,
  sampleGate,
  topPricedTrades,
  trustForSample,
} from './region-aggregate';
import { buildRegionReport } from './region-report';
import { summarizeTrust } from './types';
import type { MetricTrust, ReportMetric } from './types';
import type { RegionReportInput } from './region-report';
import type { TradeRow } from './region-aggregate';

const trade = (o: Partial<TradeRow> = {}): TradeRow => ({
  aptSeq: '26350-1', lawdCd: '26350', dong: '우동', aptName: '테스트단지',
  exclusiveArea: 84.99, dealAmount: 50000, dealDate: '2026-08-01',
  dealCanceled: false, floor: 10, ...o,
});

// ── §4 스코프 ────────────────────────────────────────────────────────────────
test('부산 현행 코드는 정확히 16개다', () => {
  assert.equal(BUSAN_CURRENT_LAWD_CODES.length, 16);
  assert.equal(new Set(BUSAN_CURRENT_LAWD_CODES).size, 16);
  assert.ok(BUSAN_CURRENT_LAWD_CODES.every((c) => c.startsWith('26')));
});

test('스코프 밖 코드(27110 대구 중구 / 11680 서울 강남구)는 거부한다', () => {
  assert.equal(isBusanCurrentLawdCd('27110'), false);
  assert.equal(isBusanCurrentLawdCd('11680'), false);
  assert.equal(isBusanCurrentLawdCd('26350'), true);
  // 이름을 추측하지 않는다.
  assert.equal(districtName('27110'), null);
  assert.equal(districtName('26350'), '해운대구');

  const r = resolveScopeLawdCds(['26350', '27110']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.rejected, ['27110']);
});

test('스코프 미지정이면 16개 전체를 쓴다', () => {
  const r = resolveScopeLawdCds(null);
  assert.equal(r.ok, true);
  assert.equal(r.lawdCds.length, 16);
});

test('스코프 밖 행은 집계 진입 단계에서 제거된다', () => {
  const rows = [trade(), trade({ lawdCd: '27110' }), trade({ lawdCd: '11680' })];
  const kept = keepBusanCurrentScope(rows);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].lawdCd, '26350');
});

test('dong 정규화는 공백만 다듬고 표기를 통합하지 않는다', () => {
  assert.equal(normalizeDong('  우동 '), '우동');
  assert.equal(normalizeDong(''), null);
  assert.equal(normalizeDong(null), null);
  assert.equal(normalizeDong('동인동1가'), '동인동1가');
});

// ── §7 취소 ─────────────────────────────────────────────────────────────────
test('취소 거래는 건수/중앙값/대표거래/2년 최고가 어디에도 쓰이지 않는다', () => {
  const rows = [
    trade({ dealAmount: 10000 }),
    trade({ dealAmount: 999999, dealCanceled: true }), // 최고가지만 취소건
  ];
  assert.equal(excludeCanceled(rows).length, 1);
  const agg = aggregate(prepareRows(rows));
  assert.equal(agg.transactionCount, 1);
  assert.equal(agg.medianDealAmount, 10000);
  assert.equal(topPricedTrades(prepareRows(rows), 1)[0].dealAmount, 10000);
});

// ── §8 LEFT JOIN 안전 ────────────────────────────────────────────────────────
test('master 보강은 행 수를 바꾸지 않는다 (matched/unmatched/mixed)', () => {
  const rows = [
    trade({ aptSeq: 'A' }),
    trade({ aptSeq: 'B' }),
    trade({ aptSeq: null, aptName: '마스터없는단지' }),
  ];
  const masters = [{ aptSeq: 'A', name: '보강된이름', roadAddress: '도로명', totalHouseholds: 100, buildYear: 2000 }];

  const none = enrichRows(rows, []);
  const some = enrichRows(rows, masters);
  assert.equal(none.length, 3, '보강 없어도 3행');
  assert.equal(some.length, 3, '일부만 보강돼도 3행');

  assert.equal(some[0].enriched, true);
  assert.equal(some[0].cells.aptName, '보강된이름');
  assert.equal(some[1].enriched, false);
  assert.equal(some[1].cells.aptName, '테스트단지', 'master 없으면 거래 원본 이름을 그대로 쓴다');
  assert.equal(some[2].enriched, false);
  assert.equal(some[2].cells.aptName, '마스터없는단지');
  // 없는 값은 만들지 않는다.
  assert.equal(some[1].cells.totalHouseholds, null);
  assert.equal(some[1].cells.buildYear, null);
});

test('보강 행 key는 같은 단지·같은 날 복수 거래에서도 충돌하지 않는다', () => {
  const rows = [trade({ dealAmount: 50000 }), trade({ dealAmount: 50000 })];
  const keys = enrichRows(rows, []).map((r) => r.key);
  assert.equal(new Set(keys).size, 2);
});

test('평 라벨을 만들지 않고 ㎡를 그대로 싣는다', () => {
  const [row] = enrichRows([trade({ exclusiveArea: 84.99 })], []);
  assert.equal(row.cells.exclusiveAreaM2, 84.99);
  assert.ok(!('pyeong' in row.cells), '평 필드를 만들지 않는다');
});

// ── §9 표본 게이트 ───────────────────────────────────────────────────────────
test('표본 게이트는 10건을 경계로 판정한다', () => {
  assert.equal(MIN_SAMPLE_FOR_INTERPRETATION, 10);
  const thin = sampleGate(9, '최근 1년');
  assert.equal(thin.sampleSufficient, false);
  assert.ok(thin.reason!.includes('9건'));
  const ok = sampleGate(10, '최근 1년');
  assert.equal(ok.sampleSufficient, true);
  assert.equal(ok.reason, null);
});

test('표본이 얇으면 지표는 LIMITED, 값이 없으면 MISSING', () => {
  assert.equal(trustForSample(123, sampleGate(50, '최근 1년')), 'SAFE');
  assert.equal(trustForSample(123, sampleGate(3, '최근 1년')), 'LIMITED');
  assert.equal(trustForSample(null, sampleGate(50, '최근 1년')), 'MISSING');
});

// ── 계산 ────────────────────────────────────────────────────────────────────
test('중앙값은 빈 배열에서 0이 아니라 null이다', () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('직전 기간이 0건이면 증감률을 만들지 않는다', () => {
  const d = countDelta(5, 0);
  assert.equal(d.ratio, null);
  assert.ok(describeCountDelta(d, '이번 기간', '직전 기간').includes('계산하지 않았습니다'));
});

test('해석 문장은 실측 차이값만 말하고 예측 어휘를 쓰지 않는다', () => {
  const text = describeCountDelta(countDelta(118, 100), '이번 달', '지난달');
  assert.ok(text.includes('18%'));
  for (const banned of ['전망', '가능성', '유망', '예상', '기대']) {
    assert.ok(!text.includes(banned), `예측 어휘 금지: ${banned}`);
  }
});

// ── §11 결정론적 정렬 ────────────────────────────────────────────────────────
test('최근 거래 정렬은 결정론적이다(계약일 → 금액 → aptSeq)', () => {
  const rows = [
    trade({ aptSeq: 'B', dealDate: '2026-08-01', dealAmount: 100 }),
    trade({ aptSeq: 'A', dealDate: '2026-08-01', dealAmount: 100 }),
    trade({ aptSeq: 'C', dealDate: '2026-08-02', dealAmount: 50 }),
  ];
  const once = recentTrades(rows, 3).map((r) => r.aptSeq);
  const twice = recentTrades([...rows].reverse(), 3).map((r) => r.aptSeq);
  assert.deepEqual(once, ['C', 'A', 'B']);
  assert.deepEqual(once, twice, '입력 순서가 달라도 같은 결과');
});

test('분포 정렬도 동률에서 흔들리지 않는다', () => {
  const rows = [trade({ dong: '나동' }), trade({ dong: '가동' })];
  const d = distribution(rows, 'dong', (k) => k);
  assert.deepEqual(d.map((x) => x.key), ['가동', '나동']);
  assert.equal(d[0].share, 0.5);
});

test('대표 단지는 aptSeq 우선으로 묶고 다른 단지를 합치지 않는다', () => {
  const rows = [
    trade({ aptSeq: 'A', aptName: '가단지' }),
    trade({ aptSeq: 'A', aptName: '가단지' }),
    trade({ aptSeq: null, aptName: '이름만단지', dong: '우동' }),
  ];
  const c = representativeComplexes(rows, 5);
  assert.equal(c.length, 2);
  assert.equal(c[0].aptSeq, 'A');
  assert.equal(c[0].count, 2);
  assert.equal(c[1].aptSeq, null);
});

// ── §3 trust 요약 ────────────────────────────────────────────────────────────
test('trust 요약은 지표별 trust를 덮어쓰지 않는다', () => {
  const m = (trust: MetricTrust): ReportMetric => ({ key: 'k', label: 'l', value: 1, displayValue: '1', unit: null, trust, reason: null, sampleSize: null, source: { source: 's', dataAsOf: null } });
  assert.equal(summarizeTrust([m('SAFE'), m('SAFE')]).completeness, 'COMPLETE');
  assert.equal(summarizeTrust([m('SAFE'), m('LIMITED')]).completeness, 'PARTIAL', 'LIMITED를 SAFE로 승격하지 않는다');
  assert.equal(summarizeTrust([m('SAFE'), m('MISSING')]).completeness, 'PARTIAL');
  assert.equal(summarizeTrust([m('SAFE'), m('UNSAFE')]).completeness, 'UNVERIFIED');
});

// ── envelope 조립 ────────────────────────────────────────────────────────────
const baseInput = (o: Partial<RegionReportInput> = {}): RegionReportInput => ({
  level: 'DISTRICT' as const, lawdCd: '26350', dong: null,
  rows: [trade(), trade({ dealAmount: 70000, dealDate: '2026-08-05' })],
  previousRows: [trade({ dealDate: '2026-07-01' })],
  trailingYearCount: 100,
  twoYearRows: [trade({ dealAmount: 120000, dealDate: '2025-05-05' })],
  masters: [],
  period: { start: '2026-08-01', end: '2026-08-31', label: '2026년 8월' },
  generatedAt: '2026-09-10T00:00:00.000Z',
  dataAsOf: '2026-09-09T20:00:17.040Z',
  coverageComplete: true,
  ...o,
});

test('envelope은 스코프/취소 제외/기간을 명시한다', () => {
  const e = buildRegionReport(baseInput());
  assert.equal(e.reportType, 'REGION_DISTRICT');
  assert.equal(e.scope.displayName, '부산 해운대구');
  assert.deepEqual(e.trust.scopeLawdCds, ['26350']);
  assert.equal(e.trust.canceledExcluded, true);
  assert.equal(e.period.label, '2026년 8월');
  assert.equal(e.dataAsOf, '2026-09-09T20:00:17.040Z');
});

test('커버리지 미검증이면 지표가 SAFE여도 COMPLETE라고 말하지 않는다', () => {
  const e = buildRegionReport(baseInput({ coverageComplete: false }));
  assert.equal(e.trust.completeness, 'UNVERIFIED');
  assert.ok(e.trust.notes.some((n: string) => n.includes('검증되지 않았')));
});

test('2년 최고가 하이라이트는 기간 문구를 반드시 함께 싣는다', () => {
  const e = buildRegionReport(baseInput());
  const h = e.highlights.find((x) => x.key === 'twoYearHigh');
  assert.ok(h);
  assert.ok(h.label.includes('최근 2년'));
  assert.ok(h.contextLabel.includes('최근 2년'));
  assert.ok(!h.label.includes('신고가'), '역대 신고가 표현 금지');
});

test('표본이 얇으면 해석을 붙이지 않는다', () => {
  const thin = buildRegionReport(baseInput({ trailingYearCount: 4 }));
  assert.equal(thin.interpretation.source, 'NONE');
  assert.equal(thin.interpretation.text, null);
  // 건수 자체는 여전히 사실이므로 SAFE로 보여준다.
  assert.equal(thin.metrics.find((m) => m.key === 'transactionCount')!.trust, 'SAFE');
  assert.equal(thin.metrics.find((m) => m.key === 'medianDealAmount')!.trust, 'LIMITED');
});

test('거래가 없으면 0으로 채우지 않고 MISSING으로 둔다', () => {
  const e = buildRegionReport(baseInput({ rows: [], twoYearRows: [], previousRows: [] }));
  assert.equal(e.metrics.find((m) => m.key === 'transactionCount')!.value, 0);
  const med = e.metrics.find((m) => m.key === 'medianDealAmount')!;
  assert.equal(med.value, null);
  assert.equal(med.trust, 'MISSING');
  assert.equal(med.displayValue, '정보 없음');
  assert.equal(e.highlights.length, 0);
});

test('부산 전체 리포트는 16개 코드를 스코프로 기록한다', () => {
  const e = buildRegionReport(baseInput({ level: 'CITY', lawdCd: null }));
  assert.equal(e.reportType, 'REGION_CITY');
  assert.equal(e.trust.scopeLawdCds.length, 16);
  assert.ok(e.sections.some((s) => s.key === 'districtDistribution'));
});

test('같은 입력이면 같은 envelope이 나온다(결정론)', () => {
  const a = JSON.stringify(buildRegionReport(baseInput()));
  const b = JSON.stringify(buildRegionReport(baseInput()));
  assert.equal(a, b);
});
