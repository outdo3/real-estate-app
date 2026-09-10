// REPORT-4 — 비교 리포트 순수 규칙 테스트.
// 실행: npx tsx --test src/lib/report/compare-report.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCompareReport, rankableInReport, reclassifyForReport, type CompareReportInput, type CompareSideInfo } from './compare-report';
import { buildDifferences } from '@/lib/compare-v2/difference';
import type { CompareApartment, CompareMetric, MetricTrust, MetricDirection } from '@/lib/compare-v2/types';

const metric = (o: Partial<CompareMetric> = {}): CompareMetric => ({
  key: 'totalHouseholds', label: '세대수', value: 500, displayValue: '500세대',
  unit: '세대', period: null, area: null, trust: 'SAFE' as MetricTrust,
  direction: 'higher-better' as MetricDirection, ...o,
});

const apt = (metrics: CompareMetric[], name = 'A단지'): CompareApartment => ({
  identity: { kind: 'aptSeq', aptSeq: name === 'A단지' ? 'A-1' : 'B-1', lawdCd: '26350', dong: '우동', name },
  displayName: name, regionLabel: '해운대구 우동', metrics, score: null, loadError: false,
});

const side = (o: Partial<CompareSideInfo> = {}): CompareSideInfo => ({
  aptSeq: 'A-1', name: 'A단지', regionLabel: '해운대구 우동',
  buildYear: 2005, totalHouseholds: 500, parkingCount: 600,
  scoreState: 'ok', overallScore: 70, eligibility: 'SCORE_AVAILABLE',
  domains: [{ key: 'transport', label: '교통', score: 72, coverage: 1 }], ...o,
});

const base = (o: Partial<CompareReportInput> = {}): CompareReportInput => ({
  sides: [side(), side({ aptSeq: 'B-1', name: 'B단지', totalHouseholds: 300, overallScore: 65 })],
  a: apt([metric({ value: 500, displayValue: '500세대' })], 'A단지'),
  b: apt([metric({ value: 300, displayValue: '300세대' })], 'B단지'),
  period: { start: '2023-09-10', end: '2026-09-09', label: '최근 36개월 거래 기준' },
  generatedAt: '2026-09-10T00:00:00.000Z',
  dataAsOf: '2026-09-09T20:00:17.040Z',
  coverageComplete: true,
  ...o,
});

test('양쪽이 SAFE일 때만 우열을 인정한다', () => {
  const safe = buildDifferences([metric({ value: 500 })], [metric({ value: 300 })]);
  assert.equal(rankableInReport(safe[0]), true, 'SAFE+SAFE → 랭킹 가능');

  const limited = buildDifferences([metric({ value: 500, trust: 'LIMITED' })], [metric({ value: 300 })]);
  assert.equal(limited[0].favors, 'a', 'Compare V2 자체는 LIMITED에서도 favors를 낸다');
  assert.equal(rankableInReport(limited[0]), false, '리포트는 그것을 우열로 인정하지 않는다');

  const missing = buildDifferences([metric({ value: null, trust: 'MISSING' })], [metric({ value: 300 })]);
  assert.equal(rankableInReport(missing[0]), false);
});

test('SAFE가 아닌 favors 항목은 강점이 아니라 판단 제한으로 내려간다', () => {
  const diffs = buildDifferences([metric({ value: 500, trust: 'LIMITED' })], [metric({ value: 300 })]);
  const t = reclassifyForReport(diffs);
  assert.equal(t.aStrengths.length, 0, 'LIMITED는 강점이 되지 않는다');
  assert.equal(t.bStrengths.length, 0);
  assert.equal(t.needsReview.length, 1, '판단 제한으로 내려간다');
});

test('SAFE 우열은 그대로 강점에 남는다', () => {
  const t = reclassifyForReport(buildDifferences([metric({ value: 500 })], [metric({ value: 300 })]));
  assert.equal(t.aStrengths.length, 1);
  assert.equal(t.bStrengths.length, 0);
});

test('종합 승자를 만들지 않는다', () => {
  const e = buildCompareReport(base());
  assert.equal(e.data!.overallWinner, null, 'overallWinner는 항상 null이다');
  const json = JSON.stringify(e);
  for (const banned of ['더 좋습니다', '추천', '우승', '승자', '더 낫습니다']) {
    assert.ok(!json.includes(banned), `승자 단정 금지: ${banned}`);
  }
  // 해석은 "우선순위에 따라 달라진다"로 끝나야 한다.
  assert.ok(e.interpretation.text!.includes('우선순위'));
});

test('identity는 aptSeq이고 딥링크 2개가 각각 aptSeq를 보존한다', () => {
  const e = buildCompareReport(base());
  assert.deepEqual(e.scope.aptSeqs, ['A-1', 'B-1']);
  assert.equal(e.navigationTargets.length, 2);
  assert.ok(e.navigationTargets[0].href.includes('aptSeq=A-1'));
  assert.ok(e.navigationTargets[1].href.includes('aptSeq=B-1'));
});

test('한쪽 점수가 없으면 점수 비교를 MISSING으로 두고 도메인 섹션을 만들지 않는다', () => {
  const e = buildCompareReport(base({
    sides: [side(), side({ aptSeq: 'B-1', name: 'B단지', overallScore: null, eligibility: 'NOT_ENOUGH_DATA', scoreState: 'not-enough-data' })],
  }));
  const s = e.metrics.find((m) => m.key === 'ejipScore')!;
  assert.equal(s.trust, 'MISSING');
  assert.ok(s.displayValue.includes('준비 중'));
  assert.ok(!e.sections.some((x) => x.key === 'scoreDomains'));
});

test('주차 정보가 없으면 0이 아니라 정보 없음', () => {
  const e = buildCompareReport(base({
    sides: [side({ parkingCount: null }), side({ aptSeq: 'B-1', name: 'B단지', parkingCount: 600 })],
  }));
  const p = e.metrics.find((m) => m.key === 'parking')!;
  assert.ok(p.displayValue.startsWith('정보 없음'));
  assert.equal(p.trust, 'MISSING');
  assert.ok(e.trust.notes.some((n) => n.includes('주차')));
});

test('트레이드오프 4분류 섹션이 항상 존재한다', () => {
  const e = buildCompareReport(base());
  for (const k of ['aStrengths', 'bStrengths', 'similar', 'needsReview']) {
    assert.ok(e.sections.some((s) => s.key === k), `${k} 섹션 필요`);
  }
});

test('커버리지 미검증이면 UNVERIFIED', () => {
  assert.equal(buildCompareReport(base({ coverageComplete: false })).trust.completeness, 'UNVERIFIED');
});

test('평 라벨과 역대 신고가 표현이 없다', () => {
  const json = JSON.stringify(buildCompareReport(base()));
  assert.ok(!/\d+평/.test(json));
  assert.ok(!/역대/.test(json));
});

test('같은 입력이면 같은 envelope(결정론)', () => {
  assert.equal(JSON.stringify(buildCompareReport(base())), JSON.stringify(buildCompareReport(base())));
});
