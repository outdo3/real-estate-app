import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildSalePriceKpi, priceBandOf, type SaleKpiTrade } from './sale-price-kpi';
import { priceBandLabel, priceBandRangeText } from './price-band-label';
import { buildRegionPriceComparison, REGION_PRICE_LOW_SAMPLE_BELOW, type RegionPriceTrade } from './region-price-comparison';
import { VOLUME_PERIOD_OPTIONS, resolveVolumePeriod } from './volume-period';
import { aggregate, type TradeRow } from '../report/region-aggregate';

// REGIONAL_PRICE_COMPARISON_UX_V1.1 — 상단 KPI(거래건수 · 많이 거래된 가격대 · ㎡당 중앙가격 · 거래량 변화)와 지역 비교 그룹 정렬.

const ROOT = resolve(__dirname, '../../..');
const codeOf = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const RANGE = { from: '2026-09-05', to: '2026-09-19' };
const NOW = new Date('2026-09-19T03:00:00Z');
function t(o: Partial<SaleKpiTrade> = {}): SaleKpiTrade {
  return { dealAmount: 35000, excluUseArea: 84.9, dealDate: '2026-09-10', dealCanceled: false, ...o };
}

test('1 · 많이 거래된 가격대 — 1억원 균일 구간의 최빈 구간과 그 건수', () => {
  const k = buildSalePriceKpi([t({ dealAmount: 35000 }), t({ dealAmount: 39999 }), t({ dealAmount: 30000 }), t({ dealAmount: 40000 }), t({ dealAmount: 9000 })], RANGE);
  assert.deepEqual(k.topBands, [{ lowerEok: 3, count: 3 }]);
  assert.equal(priceBandOf(40000), 4, '4억 정각은 4억원대');
  assert.equal(priceBandOf(9999), 0);
  assert.equal(priceBandLabel(0), '1억원 미만');
  assert.equal(priceBandLabel(3), '3억원대');
  assert.equal(priceBandRangeText(3), '3억 이상 4억 미만');
  // 고가도 같은 폭 — 넓은 구간으로 묶지 않는다(폭이 넓어 최빈이 되는 왜곡 방지)
  assert.equal(priceBandOf(125000), 12);
});

test('1b · 최다 구간이 동률이면 임의로 고르지 않고 모두 돌려준다', () => {
  const k = buildSalePriceKpi([t({ dealAmount: 31000 }), t({ dealAmount: 45000 }), t({ dealAmount: 12000 }), t({ dealAmount: 33000 }), t({ dealAmount: 41000 })], RANGE);
  assert.deepEqual(k.topBands.map((b) => b.lowerEok), [3, 4]);
});

test('2 · 구간 합계 = 매매 거래건수', () => {
  const trades = [...Array(50)].map((_, i) => t({ dealAmount: 5000 + i * 3700, dealDate: `2026-09-${String(5 + (i % 15)).padStart(2, '0')}` }));
  const k = buildSalePriceKpi(trades, RANGE);
  assert.equal(k.bands.reduce((s, b) => s + b.count, 0), k.count);
  assert.equal(k.count, 50);
});

test('3 · 취소 거래 제외', () => {
  const k = buildSalePriceKpi([t({ dealAmount: 35000 }), t({ dealAmount: 55000, dealCanceled: true }), t({ dealAmount: 56000, dealCanceled: true })], RANGE);
  assert.equal(k.count, 1);
  assert.deepEqual(k.topBands, [{ lowerEok: 3, count: 1 }]);
});

test('4 · 같은 조건 여러 거래 보존(내용 dedupe 없음)', () => {
  const k = buildSalePriceKpi([t(), t(), t()], RANGE);
  assert.equal(k.count, 3);
  assert.ok(!/dedupe\w*\(/i.test(codeOf('src/lib/stats/sale-price-kpi.ts')));
});

const PERIOD_TRADES = ['2026-09-19', '2026-09-18', '2026-09-13', '2026-09-05', '2026-08-21', '2026-06-19', '2026-06-01'].map((d, i) => t({ dealDate: d, dealAmount: 10000 * (i + 1) + 500 }));
for (const [n, key] of [[5, 'today'], [6, 'yesterday'], [7, '7d'], [8, '15d'], [9, '30d'], [10, '3m']] as const) {
  test(`${n} · ${key} — KPI는 요약과 같은 기간 계산기(resolveVolumePeriod) 범위`, () => {
    const range = resolveVolumePeriod(key, NOW);
    const k = buildSalePriceKpi(PERIOD_TRADES, range);
    const expected = PERIOD_TRADES.filter((x) => x.dealDate >= range.from && x.dealDate <= range.to).length;
    assert.equal(k.count, expected);
    assert.equal(k.bands.reduce((s, b) => s + b.count, 0), expected);
  });
}

test('11 · 거래 0건 — 가짜 구간·0원 없음, ㎡당은 null', () => {
  const k = buildSalePriceKpi([t({ dealDate: '2026-01-01' })], RANGE);
  assert.equal(k.count, 0);
  assert.deepEqual(k.bands, []);
  assert.deepEqual(k.topBands, []);
  assert.equal(k.medianPricePerM2, null);
  const card = codeOf('src/components/stats/VolumeChartCard.tsx');
  assert.match(card, /<span className=\{styles\.kpiValueMuted\}>거래 없음<\/span>/);
  assert.match(card, /<span className=\{styles\.kpiValueMuted\}>데이터 없음<\/span>/);
  assert.match(card, /<span className=\{styles\.kpiValueMuted\}>0건<\/span>/);
});

test('12 · 표본 적음 라벨 — 가격대 KPI와 지역 행 모두 5건 미만', () => {
  assert.equal(REGION_PRICE_LOW_SAMPLE_BELOW, 5);
  const card = codeOf('src/components/stats/VolumeChartCard.tsx');
  assert.match(card, /salePriceKpi\.count < REGION_PRICE_LOW_SAMPLE_BELOW && <span className=\{styles\.lowSampleTag\}>표본 적음<\/span>/);
  assert.match(card, /row\.lowSample && <span className=\{styles\.lowSampleTag\}>표본 적음<\/span>/);
});

test('13 · 지역 정렬 그룹 B — 5건 이상(평균순) → 표본 적음(평균순) → 거래 없음, 누락 없음', () => {
  const r = (dong: string, n: number, amount: number): RegionPriceTrade[] =>
    [...Array(n)].map(() => ({ lawdCd: '26350', dong, dealAmount: amount, excluUseArea: 84, dealDate: '2026-09-10', dealCanceled: false }));
  const universe = ['중동', '우동', '재송동', '좌동', '송정동', '반송동'].map((d) => ({ key: d, name: d }));
  const res = buildRegionPriceComparison(
    [...r('중동', 1, 109000), ...r('우동', 6, 70000), ...r('재송동', 5, 80000), ...r('좌동', 2, 90000), ...r('송정동', 9, 40000)],
    'dong', universe, RANGE
  );
  assert.deepEqual(res.rows.map((x) => x.key), ['재송동', '우동', '송정동', '중동', '좌동', '반송동']);
  assert.equal(res.rows.length, universe.length);
  assert.equal(res.rows.find((x) => x.key === '중동')!.avgAmount, 109000, '가격은 바꾸지 않는다');
  const card = codeOf('src/components/stats/VolumeChartCard.tsx');
  assert.match(card, /row\.avgAmount != null && !row\.lowSample \? i \+ 1 : ''/);
  assert.match(card, /거래 \{REGION_PRICE_LOW_SAMPLE_BELOW\}건 미만 · 참고용/);
});

test('14·15 · 지역 비교 섹션 — 부산 전체 구별 / 구 동별, KPI 바로 아래 유지', () => {
  const card = codeOf('src/components/stats/VolumeChartCard.tsx');
  assert.match(card, /'동별 평균 매매가격' : '구별 평균 매매가격'/);
  const grid = card.indexOf('styles.kpiGrid');
  const section = card.indexOf('regionPriceTitle}</h4>');
  const top = card.indexOf('aria-label="거래가 많은 단지"');
  assert.ok(grid > 0 && grid < section && section < top);
  const route = codeOf('src/app/api/stats/dashboard/route.ts');
  assert.match(route, /const level = isSidoAll \? 'district' : 'dong'/);
});

test('16 · KPI 라벨이 계산과 맞다 — 중앙가격 KPI 없음, ㎡당은 "중앙가격", 지역 행 ㎡당은 "평균"', () => {
  const card = codeOf('src/components/stats/VolumeChartCard.tsx');
  for (const label of ['거래건수', '많이 거래된 가격대', '㎡당 중앙가격', '거래량 변화']) assert.ok(card.includes(`>${label}</span>`), label);
  assert.ok(!/매매 중앙가격/.test(card), '통계 화면 상단에 매매 중앙가격 KPI가 있다');
  assert.match(card, /㎡당 평균 \$\{Math\.round\(row\.avgPricePerM2\)/);
  // ㎡당 중앙가격 = 브리핑과 같은 계산(거래별 금액÷전용면적의 중앙값, 소수 1자리)
  const rows: TradeRow[] = [[30000, 60], [50000, 84], [90000, 100], [20000, 40]].map(([a, m], i) => ({
    id: String(i), aptSeq: null, aptName: 'x', lawdCd: '26350', dong: '우동', dealAmount: a, exclusiveArea: m, floor: 1, dealDate: '2026-09-10', dealCanceled: false,
  }) as unknown as TradeRow);
  const k = buildSalePriceKpi([[30000, 60], [50000, 84], [90000, 100], [20000, 40]].map(([a, m]) => t({ dealAmount: a, excluUseArea: m })), RANGE);
  assert.equal(k.medianPricePerM2, Math.round(aggregate(rows).medianPricePerM2! * 10) / 10);
});

test('17 · 한장 브리핑 KPI — 통계 화면과 같은 네 칸, 매매 중앙가격은 지우지 않고 가격 상세로(ONE_PAGE_REPORT_REDESIGN_V1)', () => {
  const sheet = codeOf('src/components/report/RegionReportSheet.tsx');
  assert.match(sheet, /REGION_CITY: \['transactionCount', 'topPriceBand', 'medianPricePerM2', 'transactionCountDelta'\]/);
  assert.match(sheet, /REGION_DISTRICT: \['transactionCount', 'topPriceBand', 'medianPricePerM2', 'transactionCountDelta'\]/);
  // 매매 중앙가격: 동 KPI + 구·부산 "가격 상세"(envelope 지표 그대로)
  assert.match(sheet, /REGION_DONG: \['transactionCount', 'topPriceBand', 'medianPricePerM2', 'medianDealAmount'\]/);
  assert.match(sheet, /const keys = \['medianDealAmount', 'latestDealDate'\]\.filter\(\(k\) => !shownKeys\.includes\(k\)\);/);
  assert.match(codeOf('src/lib/report/region-report.ts'), /label: '㎡당 매매 중앙가격'/);
  assert.match(codeOf('src/lib/report/region-report.ts'), /key: 'medianDealAmount'/);
});

test('18 · 모바일 — KPI 2열(360~390), 넓은 화면 4열, 값 줄바꿈 허용', () => {
  const css = readFileSync(resolve(ROOT, 'src/components/stats/VolumeChartCard.module.css'), 'utf8');
  assert.match(css, /\.kpiGrid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(min-width: 720px\) \{\s*\.kpiGrid \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.kpi \{[^}]*min-width: 0;/);
  assert.match(css, /overflow-wrap: anywhere;/);
});

test('19 · N+1 없음 — 이미 읽은 verifiedApt로 계산, 새 DB/외부 호출 없음, 캐시 v6', () => {
  const route = codeOf('src/app/api/stats/dashboard/route.ts');
  assert.match(route, /salePriceKpiByPeriod\[preset\] = buildSalePriceKpi\(verifiedApt, range\)/);
  assert.match(route, /stats-dashboard-sido:v6:/);
  assert.match(route, /stats-dashboard:v6:/);
  assert.ok(!/prisma|fetch\(/.test(codeOf('src/lib/stats/sale-price-kpi.ts')));
});

test('20 · 기간 일치 — KPI·지역 비교·요약이 같은 comparisonPreset과 같은 range', () => {
  const route = codeOf('src/app/api/stats/dashboard/route.ts');
  assert.match(route, /const range = resolveVolumePeriod\(preset, now\);\s*regionPriceByPeriod\[preset\] = buildRegionPriceComparison\(verifiedApt, level, universe, range\);\s*salePriceKpiByPeriod\[preset\] = buildSalePriceKpi\(verifiedApt, range\);/);
  const card = codeOf('src/components/stats/VolumeChartCard.tsx');
  assert.match(card, /data\?\.salePriceKpiByPeriod\?\.\[comparisonPreset\]/);
  assert.match(card, /data\?\.regionPriceByPeriod\?\.\[comparisonPreset\]/);
  assert.match(card, /data\?\.volumeSummaryByPeriod\?\.\[comparisonPreset\]/);
  assert.deepEqual(VOLUME_PERIOD_OPTIONS.map((o) => o.key), ['today', 'yesterday', '7d', '15d', '30d', '3m']);
});
