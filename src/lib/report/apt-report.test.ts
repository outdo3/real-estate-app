// REPORT-3 — 단지 리포트 순수 규칙 테스트.
// 실행: npx tsx --test src/lib/report/apt-report.test.ts  (REPORT-1과 같은 이유로 tsx)
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApartmentReport, APT_MIN_TRADES_FOR_PRICE_INTERPRETATION, type AptReportInput, type AptScoreView } from './apt-report';
import type { TradeRow } from './region-aggregate';

const trade = (o: Partial<TradeRow> = {}): TradeRow => ({
  aptSeq: '26350-1', lawdCd: '26350', dong: '우동', aptName: '테스트단지',
  exclusiveArea: 84.99, dealAmount: 50000, dealDate: '2026-08-01',
  dealCanceled: false, floor: 10, ...o,
});

const score = (o: Partial<AptScoreView> = {}): AptScoreView => ({
  state: 'ok', overallScore: 67.4, scoreVersion: 'v2', eligibility: 'SCORE_AVAILABLE',
  domains: [{ key: 'transport', label: '교통', score: 70, coverage: 1 }],
  peerVerdict: { kind: 'unavailable' },
  briefing: { summary: '요약 문장입니다.', strengths: ['강점1'], caution: '확인할 점1' },
  ...o,
});

const base = (o: Partial<AptReportInput> = {}): AptReportInput => ({
  master: {
    aptSeq: '26350-1', name: '테스트단지', sigungu: '해운대구', umdName: '우동', sggCd: '26350',
    roadAddress: '도로명 1', jibunAddress: null, buildYear: 2005,
    totalHouseholds: 500, parkingCount: 600, parkingPerHousehold: 1.2,
  },
  trades12m: [trade(), trade({ dealAmount: 60000 }), trade({ dealAmount: 70000 }), trade({ dealAmount: 80000 }), trade({ dealAmount: 90000 })],
  twoYearTopCandidates: [trade({ dealAmount: 120000, dealDate: '2025-05-05' })],
  recentTradeRows: [trade({ dealDate: '2026-08-20', dealAmount: 90000 }), trade({ dealDate: '2026-08-01' })],
  score: score(),
  location: { nearestSubwayName: '해운대역', nearestSubwayDistanceM: 320, nearestElementaryDistanceM: 180,
    nearestElementarySchool: { name: '해운대초등학교', distanceM: 341 },
    convenienceCount500m: 12, martCount1000m: 2, parkCount1000m: 3, qualityFlag: 'OK', fetchedAt: '2026-09-01T00:00:00.000Z' },
  market: { medianPricePerM2_12m: 800, transactionCount12m: 5, priceChange12m: 0.083, fetchedAt: '2026-09-01T00:00:00.000Z' },
  period: { start: '2025-09-10', end: '2026-09-09', label: '최근 12개월' },
  generatedAt: '2026-09-10T00:00:00.000Z',
  dataAsOf: '2026-09-09T20:00:17.040Z',
  coverageComplete: true,
  ...o,
});

test('identity는 aptSeq이고 딥링크도 aptSeq를 쓴다', () => {
  const e = buildApartmentReport(base());
  assert.equal(e.reportType, 'APARTMENT_DETAIL');
  assert.deepEqual(e.scope.aptSeqs, ['26350-1']);
  assert.ok(e.navigationTargets[0].href.includes('aptSeq=26350-1'));
});

test('취소 거래는 어떤 집계에도 들어가지 않는다', () => {
  const e = buildApartmentReport(base({
    trades12m: [trade({ dealAmount: 10000 }), trade({ dealAmount: 999999, dealCanceled: true })],
    twoYearTopCandidates: [trade({ dealAmount: 999999, dealCanceled: true }), trade({ dealAmount: 50000 })],
    recentTradeRows: [trade({ dealAmount: 999999, dealCanceled: true }), trade({ dealAmount: 10000 })],
  }));
  assert.equal(e.metrics.find((m) => m.key === 'transactionCount12m')!.value, 1);
  assert.ok(!JSON.stringify(e).includes('999999'), '취소건 금액이 어디에도 남지 않는다');
});

test('2년 최고가는 기간 문구를 함께 싣고 "역대"라고 하지 않는다', () => {
  const e = buildApartmentReport(base());
  const h = e.highlights.find((x) => x.key === 'twoYearHigh')!;
  assert.ok(h.label.includes('최근 2년'));
  assert.ok(h.contextLabel.includes('최근 2년'));
  assert.ok(!/역대/.test(JSON.stringify(e)));
});

test('평 라벨을 만들지 않고 ㎡만 쓴다', () => {
  const e = buildApartmentReport(base());
  const rows = e.sections.find((s) => s.key === 'recentTrades')!.rows;
  assert.equal(rows[0].cells.exclusiveAreaM2, 84.99);
  assert.ok(!('pyeong' in rows[0].cells));
  assert.ok(!/\d+평/.test(JSON.stringify(e)));
});

test('주차 정보가 없으면 0이 아니라 MISSING이다', () => {
  const e = buildApartmentReport(base({
    master: { ...base().master, parkingCount: null, parkingPerHousehold: null },
  }));
  const p = e.metrics.find((m) => m.key === 'parking')!;
  assert.equal(p.value, null);
  assert.equal(p.trust, 'MISSING');
  assert.equal(p.displayValue, '정보 없음');
  assert.ok(e.trust.notes.some((n) => n.includes('주차')));
});

test('표본이 얇으면 가격 지표가 LIMITED로 내려간다', () => {
  const thin = buildApartmentReport(base({ trades12m: [trade(), trade()] }));
  assert.equal(thin.metrics.find((m) => m.key === 'medianDealAmount12m')!.trust, 'LIMITED');
  // 거래 건수 자체는 사실이므로 SAFE.
  assert.equal(thin.metrics.find((m) => m.key === 'transactionCount12m')!.trust, 'SAFE');
  assert.ok(APT_MIN_TRADES_FOR_PRICE_INTERPRETATION === 5);
});

test('거래가 없으면 0으로 채우지 않는다', () => {
  const e = buildApartmentReport(base({ trades12m: [], recentTradeRows: [], twoYearTopCandidates: [] }));
  assert.equal(e.metrics.find((m) => m.key === 'transactionCount12m')!.value, 0);
  const latest = e.metrics.find((m) => m.key === 'latestDealAmount')!;
  assert.equal(latest.value, null);
  assert.equal(latest.trust, 'MISSING');
  assert.equal(e.highlights.length, 0);
});

test('Score는 재계산하지 않고 넘겨받은 표시 상태를 따른다', () => {
  const ok = buildApartmentReport(base());
  assert.equal(ok.metrics.find((m) => m.key === 'ejipScore')!.value, 67, '반올림만 한다');

  for (const st of ['not-enough-data', 'v2-absent', 'no-result'] as const) {
    const e = buildApartmentReport(base({ score: score({ state: st, overallScore: null }) }));
    const s = e.metrics.find((m) => m.key === 'ejipScore')!;
    assert.equal(s.value, null, `${st}이면 점수를 만들지 않는다`);
    assert.equal(s.trust, 'MISSING');
    assert.ok(!e.sections.some((x) => x.key === 'scoreDomains'), '점수가 없으면 항목별 점수도 없다');
  }
});

test('eligibility=LIMITED면 점수를 SAFE로 올리지 않는다', () => {
  const e = buildApartmentReport(base({ score: score({ eligibility: 'LIMITED' }) }));
  assert.equal(e.metrics.find((m) => m.key === 'ejipScore')!.trust, 'LIMITED');
});

test('해석은 Score briefing만 쓰고 예측 어휘가 없다', () => {
  const e = buildApartmentReport(base());
  assert.equal(e.interpretation.source, 'EJIP_SCORE_BRIEFING');
  assert.equal(e.interpretation.text, '요약 문장입니다.');
  assert.deepEqual(e.data!.strengths, ['강점1']);
  assert.deepEqual(e.data!.cautions, ['확인할 점1']);
  for (const b of ['전망', '유망', '적기', '추천']) assert.ok(!JSON.stringify(e).includes(b));
});

test('briefing이 없으면 해석 문장을 만들지 않는다', () => {
  const e = buildApartmentReport(base({ score: score({ briefing: null }) }));
  assert.equal(e.interpretation.source, 'NONE');
  assert.equal(e.interpretation.text, null);
  assert.deepEqual(e.data!.strengths, []);
});

test('커버리지 미검증이면 UNVERIFIED로 내린다', () => {
  const e = buildApartmentReport(base({ coverageComplete: false }));
  assert.equal(e.trust.completeness, 'UNVERIFIED');
});

test('같은 입력이면 같은 envelope(결정론)', () => {
  assert.equal(JSON.stringify(buildApartmentReport(base())), JSON.stringify(buildApartmentReport(base())));
});
