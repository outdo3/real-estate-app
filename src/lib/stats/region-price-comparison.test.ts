import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  REGION_PRICE_LOW_SAMPLE_BELOW,
  buildRegionPriceComparison,
  dongUniverseFromTrades,
  formatRegionAvgPrice,
  type RegionPriceTrade,
} from './region-price-comparison';
import { VOLUME_PERIOD_OPTIONS, resolveVolumePeriod } from './volume-period';

// REGIONAL_PRICE_COMPARISON_V1 — 부산 전체 → 구·군별, 구 → 법정동별 평균 매매가격(선택 기간 그대로).

const ROOT = resolve(__dirname, '../../..');
const codeOf = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const RANGE = { from: '2026-09-01', to: '2026-09-19' };
function t(o: Partial<RegionPriceTrade> = {}): RegionPriceTrade {
  return { lawdCd: '26140', dong: '암남동', dealAmount: 30000, excluUseArea: 84.9, dealDate: '2026-09-10', dealCanceled: false, ...o };
}
const DISTRICTS = [
  { key: '26140', name: '서구' },
  { key: '26350', name: '해운대구' },
  { key: '26380', name: '사하구' },
];

test('1 · 평균 = 유효 매매 거래금액의 산술평균(만원 반올림)', () => {
  const r = buildRegionPriceComparison([t({ dealAmount: 30000 }), t({ dealAmount: 40001 }), t({ dealAmount: 50000 })], 'dong', [{ key: '암남동', name: '암남동' }], RANGE);
  assert.equal(r.rows[0].count, 3);
  assert.equal(r.rows[0].avgAmount, 40000);
});

test('2 · 취소 거래는 평균·건수 모두에서 뺀다', () => {
  const r = buildRegionPriceComparison([t({ dealAmount: 30000 }), t({ dealAmount: 90000, dealCanceled: true })], 'dong', [{ key: '암남동', name: '암남동' }], RANGE);
  assert.equal(r.rows[0].count, 1);
  assert.equal(r.rows[0].avgAmount, 30000);
});

test('3 · 가짜 dedupe 없음 — 같은 날·금액·면적의 유효 3건은 3건', () => {
  const same = { dealAmount: 42000, excluUseArea: 59.9, dealDate: '2026-09-12' };
  const r = buildRegionPriceComparison([t(same), t(same), t(same)], 'dong', [{ key: '암남동', name: '암남동' }], RANGE);
  assert.equal(r.rows[0].count, 3);
  assert.ok(!/dedupe\w*\(/i.test(codeOf('src/lib/stats/region-price-comparison.ts')), '평균 계산이 내용 dedupe를 쓴다');
});

test('4 · 거래 없는 지역은 "거래 없음"(avgAmount null) — 0원 평균을 만들지 않는다', () => {
  const r = buildRegionPriceComparison([t({ lawdCd: '26140' })], 'district', DISTRICTS, RANGE);
  const empty = r.rows.filter((x) => x.count === 0);
  assert.equal(empty.length, 2);
  for (const e of empty) {
    assert.equal(e.avgAmount, null);
    assert.equal(e.avgPricePerM2, null);
    assert.equal(e.lowSample, false);
  }
  assert.ok(r.rows.every((x) => x.avgAmount !== 0));
});

test('5 · 표본 적음 — 5건 미만만 표시, 숨기지 않는다', () => {
  assert.equal(REGION_PRICE_LOW_SAMPLE_BELOW, 5);
  const trades = [...Array(4)].map(() => t({ dong: '암남동' })).concat([...Array(5)].map(() => t({ dong: '서대신동1가' })));
  const r = buildRegionPriceComparison(trades, 'dong', [{ key: '암남동', name: '암남동' }, { key: '서대신동1가', name: '서대신동1가' }], RANGE);
  const by = new Map(r.rows.map((x) => [x.key, x]));
  assert.equal(by.get('암남동')!.lowSample, true);
  assert.equal(by.get('서대신동1가')!.lowSample, false);
  assert.equal(r.rows.length, 2, '표본이 적은 지역도 목록에 남는다');
});

test('6 · 1건 지역도 평균을 그대로 보여준다(최소 건수로 숨기지 않음)', () => {
  const r = buildRegionPriceComparison([t({ dealAmount: 12345 })], 'dong', [{ key: '암남동', name: '암남동' }], RANGE);
  assert.equal(r.rows[0].avgAmount, 12345);
  assert.equal(r.rows[0].lowSample, true);
});

test('7 · 정렬 — 평균 높은 순 → 건수 많은 순 → 지역명, 거래 없는 지역은 맨 뒤', () => {
  const universe = ['가동', '나동', '다동', '라동', '마동'].map((d) => ({ key: d, name: d }));
  const r = buildRegionPriceComparison(
    [
      t({ dong: '다동', dealAmount: 50000 }),
      t({ dong: '나동', dealAmount: 30000 }),
      t({ dong: '나동', dealAmount: 30000 }),
      t({ dong: '가동', dealAmount: 30000 }),
      t({ dong: '라동', dealAmount: 30000 }),
    ],
    'dong', universe, RANGE
  );
  assert.deepEqual(r.rows.map((x) => x.key), ['다동', '나동', '가동', '라동', '마동']);
});

test('8 · 기간 밖 거래는 세지 않는다(경계 포함)', () => {
  const r = buildRegionPriceComparison(
    [t({ dealDate: '2026-08-31' }), t({ dealDate: '2026-09-01' }), t({ dealDate: '2026-09-19' }), t({ dealDate: '2026-09-20' })],
    'dong', [{ key: '암남동', name: '암남동' }], RANGE
  );
  assert.equal(r.rows[0].count, 2);
});

test('9 · 건수 대조 — 하위 지역 합계 + 미분류 = 기간 안 유효 매매 건수', () => {
  const trades = [
    t({ lawdCd: '26140' }), t({ lawdCd: '26350' }), t({ lawdCd: '26350', dealCanceled: true }),
    t({ lawdCd: '26380' }), t({ lawdCd: '99999' }), t({ lawdCd: '26380', dealDate: '2026-07-01' }),
  ];
  const r = buildRegionPriceComparison(trades, 'district', DISTRICTS, RANGE);
  const expected = trades.filter((x) => !x.dealCanceled && x.dealDate >= RANGE.from && x.dealDate <= RANGE.to).length;
  assert.equal(r.totalCount + r.unclassifiedCount, expected);
  assert.equal(r.unclassifiedCount, 1);
});

test('10 · 동 정보가 없는 행은 추정하지 않고 미분류로 센다', () => {
  const r = buildRegionPriceComparison([t({ dong: null }), t({ dong: '  ' }), t()], 'dong', [{ key: '암남동', name: '암남동' }], RANGE);
  assert.equal(r.rows[0].count, 1);
  assert.equal(r.unclassifiedCount, 2);
});

test('11 · 구 단위 identity는 lawdCd — 다른 구의 같은 동 이름이 섞이지 않는다', () => {
  const r = buildRegionPriceComparison(
    [t({ lawdCd: '26140', dong: '중앙동', dealAmount: 10000 }), t({ lawdCd: '26350', dong: '중앙동', dealAmount: 90000 })],
    'district', DISTRICTS, RANGE
  );
  const by = new Map(r.rows.map((x) => [x.key, x]));
  assert.equal(by.get('26140')!.avgAmount, 10000);
  assert.equal(by.get('26350')!.avgAmount, 90000);
});

test('12 · 동 목록 = 12개월 유효 거래에 실제로 나타난 법정동(원천 표기, 추정 없음)', () => {
  const u = dongUniverseFromTrades([t({ dong: '암남동' }), t({ dong: '서대신동1가' }), t({ dong: '암남동' }), t({ dong: '남부민동', dealCanceled: true }), t({ dong: null })]);
  assert.deepEqual(u.map((x) => x.key).sort(), ['서대신동1가', '암남동']);
});

test('13 · ㎡당은 면적이 유효한 거래만으로 계산(보조 지표), 면적 없으면 null', () => {
  const r = buildRegionPriceComparison([t({ dealAmount: 60000, excluUseArea: 60 }), t({ dealAmount: 90000, excluUseArea: null })], 'dong', [{ key: '암남동', name: '암남동' }], RANGE);
  assert.equal(r.rows[0].avgAmount, 75000);
  assert.equal(r.rows[0].avgPricePerM2, 1000);
  const r2 = buildRegionPriceComparison([t({ excluUseArea: null })], 'dong', [{ key: '암남동', name: '암남동' }], RANGE);
  assert.equal(r2.rows[0].avgPricePerM2, null);
});

test('14 · 6개 기간 모두 같은 계산기(resolveVolumePeriod) 범위 — 3개월은 기존 달력 3개월 그대로', () => {
  const now = new Date('2026-09-19T03:00:00Z');
  assert.deepEqual(VOLUME_PERIOD_OPTIONS.map((o) => o.key), ['today', 'yesterday', '7d', '15d', '30d', '3m']);
  const trades = [
    t({ dealDate: '2026-09-19' }), t({ dealDate: '2026-09-18' }), t({ dealDate: '2026-09-13' }),
    t({ dealDate: '2026-09-05' }), t({ dealDate: '2026-08-21' }), t({ dealDate: '2026-06-19' }), t({ dealDate: '2026-06-01' }),
  ];
  for (const o of VOLUME_PERIOD_OPTIONS) {
    const range = resolveVolumePeriod(o.key, now);
    const r = buildRegionPriceComparison(trades, 'dong', [{ key: '암남동', name: '암남동' }], range);
    const expected = trades.filter((x) => x.dealDate >= range.from && x.dealDate <= range.to).length;
    assert.equal(r.totalCount, expected, o.key);
  }
});

test('15 · 대시보드 — 추가 쿼리 없이 verifiedApt(요약 sale과 같은 행)·같은 기간으로 계산', () => {
  const route = codeOf('src/app/api/stats/dashboard/route.ts');
  assert.match(route, /buildRegionPriceComparison\(verifiedApt, level, universe, resolveVolumePeriod\(preset, now\)\)/);
  assert.match(route, /sale: buildComparison\(verifiedApt, current, previous\)/);
  assert.match(route, /regionPriceByPeriod,/);
  // 새 DB 조회를 만들지 않는다
  assert.ok(!/prisma/.test(codeOf('src/lib/stats/region-price-comparison.ts')));
});

test('16 · 대시보드 — 시도 전체는 구·군(지역코드) 목록, 구는 법정동 목록', () => {
  const route = codeOf('src/app/api/stats/dashboard/route.ts');
  assert.match(route, /const level = isSidoAll \? 'district' : 'dong'/);
  assert.match(route, /districtUniverse = districts\.map\(\(d\) => \(\{ key: d\.code\.substring\(0, 5\)/);
  assert.match(route, /dongUniverseFromTrades\(verifiedApt\)/);
});

test('17 · 캐시 키 v5 — 이전 응답(regionPriceByPeriod 없음)과 섞이지 않는다', () => {
  const route = codeOf('src/app/api/stats/dashboard/route.ts');
  assert.match(route, /stats-dashboard-sido:v5:/);
  assert.match(route, /stats-dashboard:v5:/);
  assert.ok(!/stats-dashboard(-sido)?:v4:/.test(route));
});

test('18 · 화면 — 옵션 A: 요약 KPI 아래 섹션 추가(매매만), 상위 5 + 전체 보기, 거래 없음·표본 적음 표시', () => {
  const card = codeOf('src/components/stats/VolumeChartCard.tsx');
  assert.match(card, /data\?\.regionPriceByPeriod\?\.\[comparisonPreset\]/);
  assert.match(card, /dealType === 'sale' && regionPrice/);
  assert.match(card, /'동별 평균 매매가격' : '구별 평균 매매가격'/);
  assert.match(card, /거래 없음/);
  assert.match(card, /표본 적음/);
  assert.match(card, /REGION_PRICE_PREVIEW = 5/);
  // 요약 KPI(거래건수)는 그대로, 섹션은 그 아래·거래 많은 단지 위
  const kpi = card.indexOf('styles.summaryValue');
  const section = card.indexOf('regionPriceTitle}</h4>');
  const top = card.indexOf('aria-label="거래가 많은 단지"');
  assert.ok(kpi > 0 && kpi < section && section < top);
});

test('19 · 한장 브리핑의 중앙가격 KPI는 제거하지 않는다', () => {
  const sheet = codeOf('src/components/report/RegionReportSheet.tsx');
  assert.match(sheet, /medianDealAmount/);
  assert.match(sheet, /medianPricePerM2/);
});

test('20 · 가격 표기 — 억/만 단위, 0원 없음', () => {
  assert.equal(formatRegionAvgPrice(62000), '6억 2,000만원');
  assert.equal(formatRegionAvgPrice(60000), '6억원');
  assert.equal(formatRegionAvgPrice(3500), '3,500만원');
  assert.equal(formatRegionAvgPrice(123456.6), '12억 3,457만원');
});
