import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildRegionReport, buildSummaryLine, isLowSampleCount, regionPriceTop, regionReportDataOf, topPriceBandSub, topPriceBandText, type RegionReportInput } from './region-report';
import type { TradeRow } from './region-aggregate';
import { representativeComplexes } from './region-aggregate';
import { resolveReportPeriod } from './report-period';
import { buildExportFilename, buildInstagramFilename, identityOf, reportShareUrl } from './export-identity';
import { buildSalePriceKpi } from '../stats/sale-price-kpi';
import { buildRegionPriceComparison, dongUniverseFromTrades } from '../stats/region-price-comparison';
import { compareTopComplex } from '../stats/complex-trade-count';
import { BUSAN_DISTRICTS } from './region-scope';

// ONE_PAGE_REPORT_REDESIGN_V1 — 한장 리포트 정보구조 재설계 + 인스타 피드 4:5 preset.
// 계산은 통계 화면과 **같은 함수·같은 행**이어야 하고(값 일치), 새 DB 조회는 없다. 인스타 이미지는 같은 envelope을 읽는다.

const ROOT = resolve(__dirname, '../../..');
const code = (p: string) =>
  readFileSync(join(ROOT, p), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const raw = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const NOON_KST = new Date('2026-09-19T03:00:00.000Z');

let seq = 0;
function trade(o: Partial<TradeRow> = {}): TradeRow {
  seq++;
  return {
    aptSeq: `26140-${1000 + (seq % 7)}`,
    lawdCd: '26140',
    dong: '암남동',
    aptName: `단지${seq % 7}`,
    exclusiveArea: 84.9,
    dealAmount: 30000 + (seq % 9) * 5000,
    dealDate: '2026-09-15',
    dealCanceled: false,
    floor: 5,
    ...o,
  };
}

function input(level: RegionReportInput['level'], rows: TradeRow[], periodKey: string, extra: Partial<RegionReportInput> = {}): RegionReportInput {
  const p = resolveReportPeriod(periodKey as never, NOON_KST);
  return {
    level,
    lawdCd: level === 'CITY' ? null : '26140',
    dong: level === 'DONG' ? '암남동' : null,
    rows,
    previousCount: 12,
    trailingYearCount: 400,
    twoYearRows: rows.slice(0, 3),
    masters: [],
    period: { start: p.start, end: p.end, label: p.label, key: p.key, singleDay: p.singleDay, isDefault: p.isDefault },
    generatedAt: NOON_KST.toISOString(),
    dataAsOf: '2026-09-18T19:10:00.000Z',
    coverageComplete: true,
    ...extra,
  };
}

/** 통계 대시보드와 같은 호출(verifiedApt = 취소 제외 행, 같은 기간 range). */
const statsKpi = (rows: TradeRow[], key: string) => {
  const p = resolveReportPeriod(key as never, NOON_KST);
  return buildSalePriceKpi(
    rows.filter((r) => !r.dealCanceled).map((r) => ({ dealAmount: r.dealAmount, excluUseArea: r.exclusiveArea, dealDate: r.dealDate, dealCanceled: r.dealCanceled })),
    { from: p.start, to: p.end }
  );
};

// ── 1~4 · 기간별: 리포트 값 = 통계 화면 함수 값, 기간 키가 envelope에 남는다 ────────────────
for (const key of ['7d', '15d', '30d', '3m']) {
  test(`1~4 · ${key} — 가격대·㎡당 중앙가격이 통계 화면과 같고 기간이 유지된다`, () => {
    const p = resolveReportPeriod(key as never, NOON_KST);
    const rows = [
      ...Array.from({ length: 14 }, (_, i) => trade({ dealDate: p.end, dealAmount: 21000 + i * 1000 })),
      trade({ dealDate: p.start, dealAmount: 45000 }),
      trade({ dealDate: p.start, dealAmount: 99000, dealCanceled: true }),
    ];
    const env = buildRegionReport(input('CITY', rows, key));
    const data = regionReportDataOf(env)!;
    const expected = statsKpi(rows, key);
    assert.deepEqual(data.priceKpi, expected);
    assert.equal(env.metrics.find((m) => m.key === 'medianPricePerM2')!.value, expected.medianPricePerM2);
    assert.equal(env.metrics.find((m) => m.key === 'transactionCount')!.value, expected.count);
    assert.equal(env.metrics.find((m) => m.key === 'topPriceBand')!.displayValue, topPriceBandText(expected));
    assert.equal(env.period.key, key);
    assert.ok(data.summaryLine.startsWith(p.label), data.summaryLine);
  });
}

// ── 5 · 부산 전체: 구·군별 평균 = 통계 화면 함수(구 universe) ───────────────────────────
test('5 · 부산 전체 구·군별 평균 매매가격 — 통계 화면과 같은 값·순서(거래 있는 구만)', () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => trade({ lawdCd: '26350', dong: '우동', dealAmount: 70000 + i * 1000 })),
    ...Array.from({ length: 5 }, (_, i) => trade({ lawdCd: '26140', dong: '암남동', dealAmount: 40000 + i * 1000 })),
    ...Array.from({ length: 2 }, () => trade({ lawdCd: '26500', dong: '남천동', dealAmount: 150000 })),
  ];
  const env = buildRegionReport(input('CITY', rows, '30d'));
  const p = resolveReportPeriod('30d', NOON_KST);
  const stats = buildRegionPriceComparison(
    rows.map((r) => ({ lawdCd: r.lawdCd, dong: r.dong, dealAmount: r.dealAmount, excluUseArea: r.exclusiveArea, dealDate: r.dealDate, dealCanceled: r.dealCanceled })),
    'district',
    BUSAN_DISTRICTS.map((d) => ({ key: d.lawdCd, name: d.name })),
    { from: p.start, to: p.end }
  );
  const data = regionReportDataOf(env)!;
  assert.deepEqual(data.regionPrice!.rows, stats.rows.filter((r) => r.count > 0));
  const top = regionPriceTop(data.regionPrice);
  // 1억 5천 2건(표본 적음)은 1위로 올라오지 않는다 — 참고 묶음.
  assert.deepEqual(top.ranked.map((r) => r.name), ['해운대구', '서구']);
  assert.deepEqual(top.reference.map((r) => r.name), ['수영구']);
});

// ── 6 · 구: 동별 평균 = 통계 화면 함수(12개월 동 universe) — 거래 있는 동의 값·순서가 같다 ─────────
test('6 · 구 리포트 동별 평균 매매가격 — 통계 화면과 같은 값·순서', () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, i) => trade({ dong: '서대신동2가', dealAmount: 60000 + i * 500 })),
    ...Array.from({ length: 5 }, () => trade({ dong: '암남동', dealAmount: 43000 })),
    trade({ dong: '충무동1가', dealAmount: 70000 }),
    trade({ dong: '  ', dealAmount: 50000 }),
  ];
  const env = buildRegionReport(input('DISTRICT', rows, '30d'));
  const p = resolveReportPeriod('30d', NOON_KST);
  const priceRows = rows.map((r) => ({ lawdCd: r.lawdCd, dong: r.dong, dealAmount: r.dealAmount, excluUseArea: r.exclusiveArea, dealDate: r.dealDate, dealCanceled: r.dealCanceled }));
  // 통계는 최근 12개월 동 목록을 universe로 쓴다(거래 없는 동 포함) — 거래 있는 동만 비교한다.
  const universe = [...dongUniverseFromTrades(priceRows), { key: '남부민동', name: '남부민동' }];
  const stats = buildRegionPriceComparison(priceRows, 'dong', universe, { from: p.start, to: p.end });
  const data = regionReportDataOf(env)!;
  assert.deepEqual(data.regionPrice!.rows, stats.rows.filter((r) => r.count > 0));
  assert.equal(data.regionPrice!.unclassifiedCount, stats.unclassifiedCount);
  assert.equal(data.regionPrice!.unclassifiedCount, 1, '동 정보 없는 거래는 지어내지 않고 분류 불가로 센다');
  // 동 리포트에는 하위 지역 비교가 없다.
  assert.equal(regionReportDataOf(buildRegionReport(input('DONG', rows, '30d')))!.regionPrice, null);
});

// ── 7 · 거래 많은 단지: 유효 행 하나 = 한 건, 동률 순서까지 통계 화면 규칙과 같다 ─────────────
test('7 · 거래 많은 단지 — 대운스카이뷰1차 46건 semantics, 동률은 공용 규칙(건수 → 최근 계약일 → 이름)', () => {
  const same = { aptSeq: '26380-2073', aptName: '대운스카이뷰1차', lawdCd: '26380', dong: '하단동', exclusiveArea: 24.43, dealAmount: 13500, floor: 6, dealDate: '2026-09-10' };
  const rows: TradeRow[] = [
    ...Array.from({ length: 46 }, () => ({ ...same, dealCanceled: false })),
    { ...same, dealCanceled: true },
    ...Array.from({ length: 6 }, () => trade({ aptSeq: 'X', aptName: '나', dealDate: '2026-09-18' })),
    ...Array.from({ length: 6 }, () => trade({ aptSeq: 'Y', aptName: '가', dealDate: '2026-09-18' })),
  ];
  const env = buildRegionReport(input('CITY', rows, '30d'));
  const section = env.sections.find((s) => s.key === 'representativeComplexes')!;
  assert.deepEqual(section.rows.map((r) => [r.cells.aptName, r.cells.count]), [['대운스카이뷰1차', 46], ['가', 6], ['나', 6]]);
  const expectOrder = representativeComplexes(rows, 5).map((c) => c.aptName);
  const sorted = [...representativeComplexes(rows, 5)].sort((a, b) => compareTopComplex({ ...a, name: a.aptName }, { ...b, name: b.aptName }));
  assert.deepEqual(sorted.map((c) => c.aptName), expectOrder);
  // 인스타 카드는 같은 섹션 행을 그대로 쓴다(다시 세지 않는다).
  const card = code('src/components/report/RegionInstagramCard.tsx');
  assert.match(card, /sectionOf\(envelope, 'representativeComplexes'\)/);
  assert.doesNotMatch(card, /groupValidTradesByComplex|countValidTradesByComplex|buildConcentrationRanking/);
});

// ── 8 · 가격대: 동률은 모두, 3개 이상이면 "한 가격대로 모이지 않음" — 통계 화면 카드와 같은 규칙 ─────────
test('8 · 많이 거래된 가격대 — 통계 화면 표기 규칙과 같다', () => {
  const k = (amounts: number[]) =>
    buildSalePriceKpi(amounts.map((a) => ({ dealAmount: a, excluUseArea: 84, dealDate: '2026-09-10', dealCanceled: false })), { from: '2026-09-01', to: '2026-09-19' });
  assert.equal(topPriceBandText(k([21000, 25000, 31000])), '2억원대');
  assert.equal(topPriceBandText(k([31000, 32000, 41000, 42000])), '3억원대 · 4억원대');
  assert.equal(topPriceBandSub(k([31000, 32000, 41000, 42000])), '각 2건 · 전체의 50%');
  assert.equal(topPriceBandText(k([5000, 15000, 25000])), '한 가격대로 모이지 않음');
  assert.equal(topPriceBandSub(k([5000, 15000, 25000])), '3개 가격대가 각 1건');
  assert.equal(topPriceBandText(k([5000])), '1억원 미만');
  assert.equal(topPriceBandText(k([])), '거래 없음');
  assert.equal(topPriceBandSub(k([])), null);
  // 통계 카드와 같은 문자열 규칙(1~2개 = 이름 ' · '로 연결, 3개 이상 = 문구)
  const card = code('src/components/stats/VolumeChartCard.tsx');
  assert.match(card, /salePriceKpi\.topBands\.length <= 2/);
  assert.match(card, /한 가격대로 모이지 않음/);
});

// ── 9 · 0건: 가짜 0원/평균 없음 ─────────────────────────────────────────────────────
test('9 · 거래 0건 — 거래 없음·데이터 없음, 0원·평균을 만들지 않는다', () => {
  const env = buildRegionReport(input('DISTRICT', [], 'today', { previousCount: 0, twoYearRows: [] }));
  const data = regionReportDataOf(env)!;
  const band = env.metrics.find((m) => m.key === 'topPriceBand')!;
  assert.equal(band.value, null);
  assert.equal(band.trust, 'MISSING');
  assert.equal(band.displayValue, '거래 없음');
  assert.equal(env.metrics.find((m) => m.key === 'medianPricePerM2')!.value, null);
  assert.deepEqual(data.regionPrice!.rows, []);
  assert.equal(data.summaryLine, '오늘 부산 서구에서 확인된 매매 거래가 없습니다.');
  assert.ok(!/0원|0만원/.test(JSON.stringify(env.metrics.map((m) => m.displayValue))));
  // 하루짜리는 증감 지표를 만들지 않는다(기존 정책) — 화면은 "비교 안 함"으로 적는다.
  assert.equal(env.metrics.find((m) => m.key === 'transactionCountDelta'), undefined);
  assert.match(code('src/components/report/RegionReportSheet.tsx'), /displayValue: '비교 안 함'/);
  const card = code('src/components/report/RegionInstagramCard.tsx');
  assert.match(card, /value: '데이터 없음'/);
  assert.match(card, /text="해당 기간 거래가 없습니다"/);
});

// ── 10 · 표본 적음: 5건 이상 우선, 1~4건 참고 묶음, 요약 문장은 가격대를 말하지 않는다 ─────────────
test('10 · 표본 적음 — 순위 묶음/참고 묶음 분리, 5행 고정, 요약은 사실만', () => {
  const row = (name: string, count: number, avg: number) => ({ key: name, name, count, avgAmount: avg, avgPricePerM2: null, lowSample: count < 5 });
  const cmp = { level: 'dong' as const, totalCount: 0, unclassifiedCount: 0, rows: [row('A', 9, 50000), row('B', 5, 40000), row('C', 4, 90000), row('D', 1, 80000), row('E', 2, 30000), row('F', 3, 20000), row('G', 1, 10000)] };
  const top = regionPriceTop(cmp);
  assert.deepEqual(top.ranked.map((r) => r.name), ['A', 'B']);
  assert.deepEqual(top.reference.map((r) => r.name), ['C', 'D', 'E']);
  assert.equal(top.omittedLowSample, 2);
  assert.equal(top.ranked.length + top.reference.length, 5);
  assert.equal(isLowSampleCount(4), true);
  assert.equal(isLowSampleCount(5), false);
  assert.equal(isLowSampleCount(0), false);
  const kpi = buildSalePriceKpi([{ dealAmount: 30000, excluUseArea: 84, dealDate: '2026-09-10', dealCanceled: false }], { from: '2026-09-01', to: '2026-09-19' });
  assert.equal(buildSummaryLine({ periodLabel: '최근 7일', regionName: '부산 서구 암남동', count: 1, priceKpi: kpi }), '최근 7일 부산 서구 암남동 매매 1건이 확인됐습니다.');
  const kpi2 = buildSalePriceKpi([21000, 22000, 23000, 24000, 31000].map((a) => ({ dealAmount: a, excluUseArea: 84, dealDate: '2026-09-10', dealCanceled: false })), { from: '2026-09-01', to: '2026-09-19' });
  assert.equal(buildSummaryLine({ periodLabel: '최근 15일', regionName: '부산', count: 5, priceKpi: kpi2 }), '최근 15일 부산 매매 5건, 2억원대 거래가 가장 많았습니다.');
  // 평가·전망 어휘를 쓰지 않는다.
  assert.doesNotMatch(code('src/lib/report/region-report.ts').slice(code('src/lib/report/region-report.ts').indexOf('export function buildSummaryLine')), /상승|하락|오를|내릴|전망|예상|추천|저평가|고평가/);
});

// ── 11 · 인스타 1080×1350 ──────────────────────────────────────────────────────────
test('11 · 인스타 피드 — 정확히 1080×1350, 넘치면 자르지 않고 실패, 외부 리소스 없음', () => {
  const card = code('src/components/report/RegionInstagramCard.tsx');
  assert.match(card, /export const INSTAGRAM_FEED_WIDTH = 1080;/);
  assert.match(card, /export const INSTAGRAM_FEED_HEIGHT = 1350;/);
  assert.doesNotMatch(card, /<img|next\/image|fetch\(|prisma/);
  const css = raw('src/components/report/RegionInstagramCard.module.css');
  assert.doesNotMatch(css, /url\(|@font-face|@import/);
  // 캡처는 height를 복사하지 않는다 — 행은 min-height로 둔다.
  const rowRule = css.slice(css.indexOf('.row {'), css.indexOf('}', css.indexOf('.row {')));
  assert.match(rowRule, /min-height: \d+px;/);
  assert.doesNotMatch(rowRule, /[^-]height:/);
  const stage = code('src/components/report/InstagramExportStage.tsx');
  assert.match(stage, /captureElementToFixedPng\(card, INSTAGRAM_FEED_WIDTH, INSTAGRAM_FEED_HEIGHT\)/);
  assert.match(stage, /overflows\(card\) \|\| overflows\(body\)/);
  assert.match(stage, /EXPORT_SIZE_MISMATCH/);
  const png = code('src/lib/report/dom-to-png.ts');
  assert.match(png, /export async function captureElementToFixedPng\(node: HTMLElement, outW: number, outH: number\)/);
  assert.match(png, /EXPORT_ASPECT_MISMATCH/);
  assert.match(png, /canvas\.width = outW;\s*canvas\.height = outH;/);
});

// ── 12 · PNG(기본 이미지) 회귀 ─────────────────────────────────────────────────────
test('12 · 기본 이미지 — A4 캡처 경로 그대로, 파일명 불변, 인스타 파일명은 접미사만 다르다', () => {
  const env = buildRegionReport(input('DISTRICT', [trade()], '15d'));
  const id = identityOf(env);
  assert.equal(buildExportFilename(id, 'png'), 'e-jip-district-26140-15d-2026-09-19.png');
  assert.equal(buildInstagramFilename(id), 'e-jip-district-26140-15d-2026-09-19-instagram-4x5.png');
  const actions = code('src/components/report/ReportActions.tsx');
  assert.match(actions, /const \{ blob \} = await captureReportExport\(node\);/);
  // 기본 캡처는 예전처럼 말줄임을 풀고(overflow:visible) 자른다 — 인스타만 keepOverflow.
  const png = code('src/lib/report/dom-to-png.ts');
  assert.match(png, /const clone = cloneWithStyles\(node\);/);
  assert.match(png, /const clone = cloneWithStyles\(node, true\);/);
  // 문서 밀도: KPI 4칸 한 줄, 최근 실거래 3건, 분포는 문서에서 뺀다(웹에는 링크와 함께 남음).
  const css = raw('src/components/report/ReportSheet.module.css');
  assert.match(css, /\.sheet\[data-export-mode='a4'\] \.kpiGrid4 \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.sheet\[data-export-mode='a4'\] \.tradeList\[data-export-cap='3'\] > \*:nth-child\(n \+ 4\) \{ display: none; \}/);
  assert.match(css, /\.sheet\[data-export-mode='a4'\] \[data-export-hide\] \{ display: none; \}/);
});

// ── 13 · PDF 회귀 ─────────────────────────────────────────────────────────────────
test('13 · PDF — 인쇄 파이프라인 그대로, 인쇄 밀도에도 같은 규칙', () => {
  const actions = code('src/components/report/ReportActions.tsx');
  assert.match(actions, /window\.print\(\)/);
  assert.ok(actions.includes('onClick={savePdf}'), '액션바 PDF 버튼이 그대로다');
  const css = raw('src/components/report/ReportSheet.module.css');
  const print = css.slice(css.indexOf('@media print {'), css.indexOf('/* ── REGIONAL_SEO_KEYWORD_LANDING_V1'));
  assert.match(print, /\.kpiGrid4 \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \}/);
  assert.match(print, /\.tradeList\[data-export-cap='3'\] > \*:nth-child\(n \+ 4\) \{ display: none; \}/);
  assert.match(print, /\.sheet \[data-export-hide\] \{ display: none; \}/);
  // 저장 메뉴·인스타 무대는 인쇄물에 남지 않는다(액션바 안 / data-export-exclude).
  assert.match(code('src/components/report/InstagramExportStage.tsx'), /\[EXPORT_EXCLUDE_ATTR\]: ''/);
});

// ── 14 · 공유 회귀 ────────────────────────────────────────────────────────────────
test('14 · 공유 — 기간 키가 공유 링크에 그대로, 공유 경로 코드는 변경 없음', () => {
  const env = buildRegionReport(input('CITY', [trade()], '15d'));
  assert.equal(reportShareUrl('https://e-jip.com', identityOf(env)), 'https://e-jip.com/report/city/busan?period=15d');
  const actions = code('src/components/report/ReportActions.tsx');
  assert.match(actions, /await navigator\.share\(\{ title, text, url, files: \[file\] \}\);/);
  // SHARE_UX_V2 — 카카오 카드 전송은 공통 시트(useShareSheet)로 옵겨갔다.
  // 리포트가 그 경로를 여전히 report 성격으로 타는지만 확인한다.
  assert.match(actions, /useShareSheet\(\{/);
  assert.match(actions, /shareType: 'report',/);
  assert.match(actions, /periodKey: periodKeyOf\(envelope\)/);
});

// ── 15 · 새 쿼리 없음 ──────────────────────────────────────────────────────────────
test('15 · 새 DB/API 조회 없음 — region-read의 조회는 그대로, 새 계산은 순수 함수', () => {
  const read = code('src/lib/report/region-read.ts');
  assert.equal((read.match(/prisma\.\w+\.(findMany|count|findFirst|findUnique|aggregate|groupBy)\(/g) ?? []).length, 6);
  assert.doesNotMatch(read, /\$queryRaw/);
  for (const p of ['src/lib/report/region-report.ts', 'src/components/report/RegionInstagramCard.tsx', 'src/components/report/InstagramExportStage.tsx', 'src/components/report/RegionReportSheet.tsx']) {
    assert.doesNotMatch(code(p), /from '@\/lib\/prisma'|fetch\(|useSWR/, p);
  }
  // 인스타 무대는 누른 뒤에만 불러온다(첫 렌더·번들에 없음).
  assert.match(code('src/components/report/ReportActions.tsx'), /dynamic\(\(\) => import\('\.\/InstagramExportStage'\), \{ ssr: false \}\)/);
});

// ── 16 · 모바일 레이아웃 ───────────────────────────────────────────────────────────
test('16 · 모바일 — 저장 메뉴는 화면 안(360px), 항목 터치 영역 56px, KPI는 좁은 화면 2열', () => {
  const css = raw('src/components/report/RegionReportSheet.module.css');
  const menu = css.slice(css.indexOf('.saveMenu {'), css.indexOf('}', css.indexOf('.saveMenu {')));
  assert.match(menu, /width: min\(360px, calc\(100vw - 24px\)\);/);
  const item = css.slice(css.indexOf('.saveMenuItem {'), css.indexOf('}', css.indexOf('.saveMenuItem {')));
  assert.match(item, /min-height: 56px;/);
  const sheet = raw('src/components/report/ReportSheet.module.css');
  assert.match(sheet, /\.kpiGrid4 \{ grid-template-columns: var\(--r-kpi-cols\); \}/);
  assert.match(sheet, /@media \(max-width: 860px\) \{[\s\S]*?--r-kpi-cols: repeat\(2, 1fr\);/);
  const name = sheet.slice(sheet.indexOf('.priceNameText {'), sheet.indexOf('}', sheet.indexOf('.priceNameText {')));
  assert.match(name, /text-overflow: ellipsis;/);
  // 메뉴 항목 문구 — FINAL_POLISH_V1: [이미지] 메뉴는 이미지 형식 두 가지만, PDF는 액션바 버튼 하나.
  const actions = code('src/components/report/ReportActions.tsx');
  for (const label of ['기본 이미지', '인스타 피드용']) assert.ok(actions.includes(`<strong>${label}</strong>`), label);
  assert.ok(!actions.includes('<strong>PDF</strong>'), '메뉴에 PDF가 중복된다');
  assert.equal((actions.match(/role="menuitem"/g) ?? []).length, 2);
  assert.ok(actions.includes('onClick={savePdf}'), '액션바 PDF 버튼');
  assert.ok(actions.includes('<ActionLabel text="PDF" />'));
});

// ── FINAL_POLISH_V1 · 최근 실거래 건수 표시 = 실제로 보이는 행 수(웹 5 / 문서 3) ─────────────────
test('최근 실거래 건수 — 웹은 표시 행 수, 문서(PNG/PDF)는 3건, 일부 표시 안내 유지', () => {
  const sheet = code('src/components/report/RegionReportSheet.tsx');
  assert.match(sheet, /const DOC_TRADE_CAP = 3;/);
  assert.match(sheet, /<span className=\{styles\.webOnly\}>\{rows\.length\}건<\/span>/);
  assert.match(sheet, /<span className=\{styles\.docOnly\}>\{DOC_TRADE_CAP\}건<\/span>/);
  assert.match(sheet, /data-export-cap="3"/);
  assert.match(sheet, /rows\.length > DOC_TRADE_CAP && <p className=\{styles\.exportNote\}>최근 거래 일부 표시/);
  const css = raw('src/components/report/ReportSheet.module.css');
  assert.match(css, /\.webOnly \{ display: var\(--r-web-inline\); \}/);
  assert.match(css, /\.docOnly \{ display: var\(--r-doc-inline\); \}/);
  // 웹 기본값(웹 표시), A4 캡처·인쇄에서 뒤집힌다.
  const sheetBlock = css.slice(css.indexOf('.sheet {'), css.indexOf('/* ── 헤더'));
  assert.match(sheetBlock, /--r-web-inline: inline;/);
  assert.match(sheetBlock, /--r-doc-inline: none;/);
  const a4 = css.slice(css.indexOf(".sheet[data-export-mode='a4'] {"), css.indexOf('/* 남는 세로는'));
  assert.match(a4, /--r-web-inline: none;\s*--r-doc-inline: inline;/);
  const print = css.slice(css.indexOf('@media print {'), css.indexOf('/* ── REGIONAL_SEO_KEYWORD_LANDING_V1'));
  assert.match(print, /--r-web-inline: none;\s*--r-doc-inline: inline;/);
});

// ── 기간 밖 거래 ──────────────────────────────────────────────────────────────────
test('기간 밖 거래는 건수·최근 실거래·가격대·지역 평균 어디에도 들어가지 않는다', () => {
  const p = resolveReportPeriod('7d', NOON_KST);
  const inside = trade({ dealDate: p.end, aptName: '안' });
  const outside = trade({ dealDate: '2026-08-01', aptName: '밖', dealAmount: 990000 });
  const env = buildRegionReport(input('CITY', [inside, outside], '7d'));
  assert.equal(env.metrics.find((m) => m.key === 'transactionCount')!.value, 1);
  const recent = env.sections.find((s) => s.key === 'recentTrades')!;
  assert.deepEqual(recent.rows.map((r) => r.cells.aptName), ['안']);
  const data = regionReportDataOf(env)!;
  assert.equal(data.priceKpi.count, 1);
  assert.equal(data.regionPrice!.totalCount, 1);
});
