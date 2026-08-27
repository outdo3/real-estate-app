import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDecisionInsights } from './school-decision-insight.ts';

const base = [
  { aptSeq: 'A', name: 'A단지', distanceKm: 0.42, dealAmount: 120000, buildYear: 2011, totalHouseholds: 1786 },
  { aptSeq: 'B', name: 'B단지', distanceKm: 0.61, dealAmount: 103000, buildYear: 2012, totalHouseholds: 1013 },
  { aptSeq: 'C', name: 'C단지', distanceKm: 0.65, dealAmount: 98000, buildYear: 2008, totalHouseholds: 1312 },
];

test('buildDecisionInsights: 단지가 1개면 비교 자체를 생성하지 않는다', () => {
  assert.deepEqual(buildDecisionInsights([base[0]]), []);
});

test('buildDecisionInsights: 가장 가까운 단지를 언급한다', () => {
  const insights = buildDecisionInsights(base);
  assert.ok(insights.some((i) => i.text.includes('A단지') && i.text.includes('가장 가깝습니다')));
});

test('buildDecisionInsights: 최고가/최저가 차액을 실제 값으로 언급한다', () => {
  const insights = buildDecisionInsights(base);
  assert.ok(insights.some((i) => i.text.includes('A단지') && i.text.includes('C단지') && i.text.includes('억')));
});

test('buildDecisionInsights: 가장 신축 단지를 언급한다', () => {
  const insights = buildDecisionInsights(base);
  assert.ok(insights.some((i) => i.text.includes('B단지') && i.text.includes('2012')));
});

test('buildDecisionInsights: 현재 보고 있는 단지가 가장 가까우면 명시한다', () => {
  const withCurrent = base.map((a) => (a.aptSeq === 'A' ? { ...a, isCurrent: true } : a));
  const insights = buildDecisionInsights(withCurrent);
  assert.ok(insights.some((i) => i.text.includes('현재 보고 있는 A단지') && i.text.includes('가장 가깝습니다')));
});

test('buildDecisionInsights: 현재 보고 있는 단지가 1순위가 아니면 순위를 명시한다', () => {
  const withCurrent = base.map((a) => (a.aptSeq === 'C' ? { ...a, isCurrent: true } : a));
  const insights = buildDecisionInsights(withCurrent);
  assert.ok(insights.some((i) => i.text.includes('현재 보고 있는 C단지') && i.text.includes('3번째')));
});

test('buildDecisionInsights: 가격 값이 하나뿐이면 가격 비교를 만들지 않는다(추정 없음)', () => {
  const partial = [
    { aptSeq: 'A', name: 'A단지', distanceKm: 0.4, dealAmount: 120000, buildYear: null, totalHouseholds: null },
    { aptSeq: 'B', name: 'B단지', distanceKm: 0.6, dealAmount: null, buildYear: null, totalHouseholds: null },
  ];
  const insights = buildDecisionInsights(partial);
  assert.ok(!insights.some((i) => i.text.includes('매매가')));
});
