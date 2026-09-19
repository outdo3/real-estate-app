import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DEFAULT_REPORT_PERIOD_KEY,
  parseReportPeriodKey,
  reportPreviousRange,
  resolvePeriod,
  resolveReportPeriod,
} from './report-period';
import { buildExportFilename, periodKeyOf, reportCanonicalUrl, reportShareUrl, type ReportIdentity } from './export-identity';
import { buildRegionReport, type RegionReportInput } from './region-report';
import type { TradeRow } from './region-aggregate';
import { VOLUME_PERIOD_OPTIONS, briefingPeriodFor, resolveVolumePeriod } from '../stats/volume-period';
import { previousPeriodRange } from '../regional-feed';

// STATS_PERIOD_IMAGE_PARITY_V2 — 통계 화면에서 고른 기간 하나가 한장 브리핑(화면·PNG·PDF·공유)까지
// 같은 날짜 범위로 가는지 고정한다. 예전에는 오늘/어제/7일/30일이 전부 "어제까지 30일" 리포트로 열렸다.

const ROOT = resolve(__dirname, '../../..');
const code = (p: string) =>
  readFileSync(join(ROOT, p), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NOON_KST = new Date('2026-09-19T03:00:00.000Z'); // 한국 2026-09-19 12:00
const EARLY_KST = new Date('2026-09-18T15:30:00.000Z'); // 한국 2026-09-19 00:30 (UTC 날짜는 아직 9/18)

// ── 1~6 · 기간 범위: 리포트가 통계 화면과 같은 계산기로 같은 범위를 만든다 ─────────────
test('1~6 · 오늘·어제·7일·15일·30일·3개월 — 리포트 범위 = 통계 화면 범위', () => {
  const expected: Record<string, [string, string]> = {
    today: ['2026-09-19', '2026-09-19'],
    yesterday: ['2026-09-18', '2026-09-18'],
    '7d': ['2026-09-13', '2026-09-19'],
    '15d': ['2026-09-05', '2026-09-19'],
    '30d': ['2026-08-21', '2026-09-19'],
    '3m': ['2026-06-19', '2026-09-19'],
  };
  for (const o of VOLUME_PERIOD_OPTIONS) {
    const r = resolveReportPeriod(o.key, NOON_KST);
    const s = resolveVolumePeriod(o.key, NOON_KST);
    assert.deepEqual([r.start, r.end], [s.from, s.to], `${o.key}: 화면과 브리핑의 범위가 다르다`);
    assert.deepEqual([r.start, r.end], expected[o.key], o.key);
    assert.equal(r.key, o.key);
    assert.equal(r.label, o.label);
    assert.equal(r.isDefault, false);
  }
  assert.equal(resolveReportPeriod('15d', NOON_KST).days, 15);
  assert.equal(resolveReportPeriod('7d', NOON_KST).days, 7);
  assert.equal(resolveReportPeriod('yesterday', NOON_KST).singleDay, true);
  assert.equal(resolveReportPeriod('today', NOON_KST).singleDay, true);
  assert.equal(resolveReportPeriod('7d', NOON_KST).singleDay, false);
});

test('7~9 · 직전 동일 기간 — 7/15/30일 모두 같은 일수, 시작 전날에 끝남, 화면과 같은 정의', () => {
  assert.deepEqual(reportPreviousRange('2026-09-13', '2026-09-19'), { start: '2026-09-06', end: '2026-09-12' });
  assert.deepEqual(reportPreviousRange('2026-09-05', '2026-09-19'), { start: '2026-08-21', end: '2026-09-04' }, '15일: 09-05~19 ↔ 08-21~09-04');
  assert.deepEqual(reportPreviousRange('2026-08-21', '2026-09-19'), { start: '2026-07-22', end: '2026-08-20' });
  for (const o of VOLUME_PERIOD_OPTIONS) {
    const r = resolveReportPeriod(o.key, NOON_KST);
    const stats = previousPeriodRange(resolveVolumePeriod(o.key, NOON_KST));
    assert.deepEqual(reportPreviousRange(r.start, r.end), { start: stats.from, end: stats.to }, `${o.key}: 직전 기간 정의가 화면과 다르다`);
  }
  // 리포트 읽기 계층이 실제로 이 함수로 비교 기간을 만든다.
  assert.match(code('src/lib/report/region-read.ts'), /const \{ start: prevStart, end: prevEnd \} = reportPreviousRange\(start, end\);/);
});

test('10 · KST 경계 — 한국 자정 직후(UTC 전날)에도 오늘·7일·15일이 하루 밀리지 않는다', () => {
  assert.deepEqual([resolveReportPeriod('today', EARLY_KST).start, resolveReportPeriod('today', EARLY_KST).end], ['2026-09-19', '2026-09-19']);
  assert.equal(resolveReportPeriod('7d', EARLY_KST).end, '2026-09-19');
  assert.equal(resolveReportPeriod('15d', EARLY_KST).start, '2026-09-05');
  assert.equal(resolveReportPeriod('yesterday', EARLY_KST).start, '2026-09-18');
});

test('11·21 · URL 파싱 — 15d는 15d로, 기존 30/90/365는 그대로, 모르는 값만 기본(30)', () => {
  for (const k of ['today', 'yesterday', '7d', '15d', '30d', '3m', '30', '90', '365'] as const) assert.equal(parseReportPeriodKey(k), k);
  assert.equal(parseReportPeriodKey(['15d', '30']), '15d');
  for (const bad of [undefined, '', '15', '14d', '999', 'abc', '30D']) assert.equal(parseReportPeriodKey(bad as string | undefined), DEFAULT_REPORT_PERIOD_KEY, String(bad));
  // 기본 진입(?period 없음)은 예전과 똑같다 — 어제까지 30일(30일 parity).
  const def = resolveReportPeriod(DEFAULT_REPORT_PERIOD_KEY, NOON_KST);
  const legacy = resolvePeriod(30, NOON_KST);
  assert.deepEqual([def.start, def.end, def.label, def.days], [legacy.start, legacy.end, legacy.label, legacy.days]);
  assert.equal(def.isDefault, true);
  assert.deepEqual([resolveReportPeriod('90', NOON_KST).start, resolveReportPeriod('90', NOON_KST).end], [resolvePeriod(90, NOON_KST).start, resolvePeriod(90, NOON_KST).end]);
  // 통계 30d(오늘까지)와 리포트 기본 30(어제까지)은 서로 다른 기간이다 — 섞지 않는다.
  assert.notEqual(resolveReportPeriod('30d', NOON_KST).end, def.end);
});

test('12·13 · 통계 카드 → 브리핑 링크가 선택 기간 키를 그대로 싣는다(7일·15일 포함, 30일 대체 없음)', () => {
  for (const o of VOLUME_PERIOD_OPTIONS) assert.equal(briefingPeriodFor(o.key, NOON_KST).periodKey, o.key);
  const card = code('src/components/stats/VolumeChartCard.tsx');
  assert.match(card, /period=\$\{encodeURIComponent\(briefing\.periodKey\)\}/);
  assert.ok(!/periodDays/.test(card), '예전의 30/90일 치환이 남아 있다');
  assert.ok(!/선택 기간과 기준이 달라요/.test(card));
  // 세 리포트 페이지가 키를 그대로 해석하고, 읽기 계층이 그 키로 범위를 만든다.
  for (const p of ['src/app/report/city/busan/page.tsx', 'src/app/report/district/[lawdCd]/page.tsx', 'src/app/report/dong/[lawdCd]/[dong]/page.tsx']) {
    const src = code(p);
    assert.match(src, /parseReportPeriodKey\(sp\?\.period\)/, p);
    assert.ok(!/parsePeriodParam/.test(src), `${p}가 여전히 30/90/365 전용 파서를 쓴다`);
  }
  const cached = code('src/lib/report/region-read-cached.ts');
  assert.match(cached, /resolveReportPeriod\(periodKey\)/);
  assert.match(cached, /periodMeta: \{ key: period\.key, singleDay: period\.singleDay, isDefault: period\.isDefault \}/);
});

const trade = (o: Partial<TradeRow> = {}): TradeRow => ({
  aptSeq: '26140-1', lawdCd: '26140', dong: '암남동', aptName: '단지A', exclusiveArea: 84.9, dealAmount: 50000,
  dealDate: '2026-09-15', dealCanceled: false, floor: 5, ...o,
});

function input(rows: TradeRow[], period: RegionReportInput['period'], level: 'CITY' | 'DISTRICT' = 'CITY'): RegionReportInput {
  return {
    level, lawdCd: level === 'CITY' ? null : '26140', dong: null, rows, previousCount: 3, twoYearRows: rows, trailingYearCount: 500,
    masters: [], period, generatedAt: '2026-09-19T03:00:00.000Z', dataAsOf: null, coverageComplete: true,
  };
}

test('15~19 · 한 기간의 행이 요약·거래 많은 단지·분포·최근 실거래를 모두 만든다(섹션끼리 기간이 섞이지 않는다)', () => {
  const r = resolveReportPeriod('7d', NOON_KST);
  const rows = [
    trade({ dealDate: '2026-09-13', aptName: '단지A', aptSeq: '26140-1' }),
    trade({ dealDate: '2026-09-15', aptName: '단지A', aptSeq: '26140-1', dealAmount: 52000 }),
    trade({ dealDate: '2026-09-19', aptName: '단지B', aptSeq: '26350-2', lawdCd: '26350', dong: '우동', dealAmount: 90000 }),
    trade({ dealDate: '2026-09-18', aptName: '단지C', aptSeq: '26470-3', lawdCd: '26470', dong: '연산동', dealAmount: 40000 }),
  ];
  const env = buildRegionReport(input(rows, { start: r.start, end: r.end, label: r.label, key: r.key, singleDay: r.singleDay, isDefault: r.isDefault }));
  const count = env.metrics.find((m) => m.key === 'transactionCount')!.value;
  assert.equal(count, 4);
  // 분포 합계 = 거래건수
  const dist = env.sections.find((s) => s.key === 'districtDistribution')!;
  assert.equal(dist.rows.reduce((a, x) => a + Number(x.cells.count), 0), count);
  // 거래 많은 단지 건수 합 ≤ 거래건수, 단지A 2건
  const complexes = env.sections.find((s) => s.key === 'representativeComplexes')!;
  assert.equal(complexes.rows.find((x) => x.cells.aptName === '단지A')!.cells.count, 2);
  // 최근 실거래는 모두 선택 기간 안
  const recent = env.sections.find((s) => s.key === 'recentTrades')!;
  assert.ok(recent.rows.length > 0);
  for (const x of recent.rows) assert.ok(String(x.cells.dealDate) >= r.start && String(x.cells.dealDate) <= r.end, String(x.cells.dealDate));
  // 최근 계약일도 기간 안
  assert.equal(env.metrics.find((m) => m.key === 'latestDealDate')!.value, '2026-09-19');
  // 직전 동일기간 대비 KPI가 있다(7일은 비교 가능)
  assert.ok(env.metrics.some((m) => m.key === 'transactionCountDelta'));
  // 헤더/부제에 기간 라벨이 실린다
  assert.equal(env.period.label, '최근 7일');
  assert.match(env.subtitle ?? '', /최근 7일/);
  // 읽기 계층: 본 조회와 분포·단지·최근 실거래가 모두 같은 (start, end) 조회 결과에서 나온다.
  const read = code('src/lib/report/region-read.ts');
  assert.match(read, /prisma\.apartmentTradeHistory\.findMany\(\{ where: whereFor\(level, lawdCd, dong, start, end\), select: TRADE_SELECT \}\)/);
});

test('19 · 하루짜리(오늘·어제)는 직전 기간 대비를 만들지 않는다 — 통계 화면과 같은 정책', () => {
  const r = resolveReportPeriod('yesterday', NOON_KST);
  const env = buildRegionReport(input([trade({ dealDate: '2026-09-18' })], { start: r.start, end: r.end, label: r.label, key: r.key, singleDay: true, isDefault: false }));
  assert.ok(!env.metrics.some((m) => m.key === 'transactionCountDelta'), '어제 브리핑에 전일 대비가 나오면 안 된다');
  assert.equal(env.interpretation.text, null);
  // 7일은 여전히 비교(기존 동작)
  const w = resolveReportPeriod('7d', NOON_KST);
  const env7 = buildRegionReport(input([trade()], { start: w.start, end: w.end, label: w.label }));
  assert.ok(env7.metrics.some((m) => m.key === 'transactionCountDelta'));
});

test('14·15·16 · PNG 파일명·공유 링크(PDF/카카오 포함)가 기간을 싣고, 기본 기간은 예전과 같다', () => {
  const base: ReportIdentity = { reportType: 'REGION_CITY', scope: { level: 'CITY', lawdCd: null, dong: null, aptSeqs: [] }, periodEnd: '2026-09-19' };
  assert.equal(buildExportFilename({ ...base, periodKey: '7d' }, 'png'), 'e-jip-busan-7d-2026-09-19.png');
  assert.equal(buildExportFilename({ ...base, periodKey: '15d' }, 'png'), 'e-jip-busan-15d-2026-09-19.png');
  assert.equal(buildExportFilename(base, 'png'), 'e-jip-busan-2026-09-19.png', '기본 기간 파일명은 그대로');
  const district: ReportIdentity = { ...base, reportType: 'REGION_DISTRICT', scope: { level: 'DISTRICT', lawdCd: '26140', dong: null, aptSeqs: [] } };
  assert.equal(buildExportFilename({ ...district, periodKey: 'yesterday' }, 'pdf'), 'e-jip-district-26140-yesterday-2026-09-19.pdf');
  assert.equal(reportShareUrl('https://e-jip.com', { ...district, periodKey: '15d' }), 'https://e-jip.com/report/district/26140?period=15d');
  assert.equal(reportShareUrl('https://e-jip.com', district), reportCanonicalUrl('https://e-jip.com', district), '기본 기간 공유 링크는 canonical 그대로');
  // envelope → 키: 기본 기간이면 null(쿼리 없음), 아니면 키
  const envOf = (period: Record<string, unknown>) => ({ period } as unknown as Parameters<typeof periodKeyOf>[0]);
  assert.equal(periodKeyOf(envOf({ start: 'a', end: 'b', label: 'x', key: '7d', isDefault: false })), '7d');
  assert.equal(periodKeyOf(envOf({ start: 'a', end: 'b', label: 'x', key: '30', isDefault: true })), null);
  assert.equal(periodKeyOf(envOf({ start: 'a', end: 'b', label: 'x' })), null);
  // PNG는 화면의 시트(data-export-root)를 그대로 캡처하고, PDF는 같은 페이지를 인쇄한다 — 공유 링크는 기간 포함 URL.
  const actions = code('src/components/report/ReportActions.tsx');
  assert.match(actions, /reportShareUrl\(resolveShareOrigin\(\), identity\)/);
  assert.match(actions, /periodKey: periodKeyOf\(envelope\)/);
  assert.match(actions, /window\.print\(\)/);
});

test('13 · 이미지 헤더 — 기간 라벨과 실제 날짜 범위가 시트(=PNG/PDF) 안에 실린다', () => {
  const sheet = code('src/components/report/RegionReportSheet.tsx');
  assert.match(sheet, /tags=\{\[heading \? '한장 브리핑' : '지역 브리핑', envelope\.period\.label, periodRangeText\(envelope\.period\.start, envelope\.period\.end\)\]\}/);
  assert.match(sheet, /return start === end \? dot\(start\) : `\$\{dot\(start\)\} ~ \$\{dot\(end\)\}`;/);
  assert.match(sheet, /<article className=\{styles\.sheet\} data-export-root="">/);
});

test('§14 · 중앙값 문구 — 매매 중앙가격 / ㎡당 매매 중앙가격, 카드 안 설명(이미지에도 남음), 계산은 불변', () => {
  const env = buildRegionReport(input([trade(), trade({ dealAmount: 70000 })], { start: '2026-09-13', end: '2026-09-19', label: '최근 7일' }));
  assert.equal(env.metrics.find((m) => m.key === 'medianDealAmount')!.label, '매매 중앙가격');
  assert.equal(env.metrics.find((m) => m.key === 'medianPricePerM2')!.label, '㎡당 매매 중앙가격');
  assert.equal(env.metrics.find((m) => m.key === 'medianDealAmount')!.value, 60000);
  const sheet = code('src/components/report/RegionReportSheet.tsx');
  assert.match(sheet, /medianDealAmount: '가격순 가운데 값 · 평균과 다름'/);
  assert.match(sheet, /hint=\{KPI_HINTS\[m\.key\] \?\? null\}/);
});

test('20 · 캐시 키 — 기간마다 분리된다(요약은 KST 날짜 키에 전 기간 포함, 단지/피드는 기간 범위로 필터)', () => {
  const dash = code('src/app/api/stats/dashboard/route.ts');
  assert.match(dash, /`stats-dashboard:v4:\$\{lawdCd\}:\$\{kstToday\}`/);
  assert.match(dash, /\['today', 'yesterday', '7d', '15d', '30d', '3m'\]/);
  const conc = code('src/app/api/stats/concentration/route.ts');
  assert.match(conc, /`stats-concentration-db:v1:\$\{lawdCds\.join\(','\)\}:\$\{apiType\}:\$\{fetchRange\.from\}:\$\{fetchRange\.to\}`/);
  // 리포트는 요청 단위 React cache — 인자(기간 키)가 다르면 다른 항목이다.
  assert.match(code('src/lib/report/region-read-cached.ts'), /async \(level: RegionLevel, lawdCd: string \| null, dong: string \| null, periodKey: ReportPeriodKey\)/);
});

test('21·24 · API가 15d를 30d로 바꾸지 않는다(단지·피드), 모르는 값은 기존 기본값', () => {
  const conc = code('src/app/api/stats/concentration/route.ts');
  assert.match(conc, /\['today', 'yesterday', '7d', '15d', '30d', '3m', '6m', '12m'\]/);
  const feed = code('src/app/api/stats/feed/route.ts');
  assert.match(feed, /\['today', 'yesterday', '7d', '15d', 'thisWeek', 'lastWeek', '30d', '12m', 'custom'\]/);
  assert.match(feed, /case '15d': return '최근 15일';/);
  assert.match(code('src/components/stats/ConcentrationView.tsx'), /\{ preset: '15d', label: '최근 15일' \}/);
  assert.match(code('src/components/stats/TransactionFeedView.tsx'), /\{ preset: '15d', label: '최근 15일' \}/);
});

test('22 · 모바일 기간 선택 — 6개 칩, 가로 스크롤 한 줄(줄바꿈으로 레이아웃이 밀리지 않음)', () => {
  assert.equal(VOLUME_PERIOD_OPTIONS.length, 6);
  const css = readFileSync(join(ROOT, 'src/components/stats/VolumeChartCard.module.css'), 'utf8');
  assert.match(css, /\.chipRow \{[^}]*overflow-x: auto;/);
  assert.match(code('src/components/stats/VolumeChartCard.tsx'), /<div className=\{styles\.chipRow\} role="group" aria-label="집계 기간">/);
});
