import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DEFAULT_VOLUME_PERIOD,
  VOLUME_PERIOD_OPTIONS,
  briefingPeriodFor,
  feedPresetFor,
  hasComparablePreviousPeriod,
  isSingleDayPeriod,
  kstDateString,
  needsReportingLagNotice,
  resolveVolumePeriod,
} from './volume-period';
import { buildTopComplexHref, topComplexRows } from './volume-top-complexes';
import { previousPeriodRange } from '../regional-feed';
import { resolvePriceRankingPeriod } from '../price-ranking';

/**
 * STATISTICS_PERIOD_TRADE_UX_V1 — 거래량 영역 기간 = Master Filter, 계약일·KST 기준.
 */

const ROOT = resolve(__dirname, '../../..');
const code = (p: string) =>
  readFileSync(join(ROOT, p), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// 한국 2026-09-15 00:30 = UTC 2026-09-14 15:30 (UTC 서버에서 기존 로직은 "오늘"을 9/14로 봤다)
const KST_EARLY = new Date('2026-09-14T15:30:00.000Z');
// 한국 2026-09-15 23:59 = UTC 2026-09-15 14:59
const KST_LATE = new Date('2026-09-15T14:59:00.000Z');
// 한국 2026-09-16 00:00 = UTC 2026-09-15 15:00
const KST_MIDNIGHT = new Date('2026-09-15T15:00:00.000Z');

test('기간 옵션: 오늘·어제·최근 7일·최근 15일·최근 30일·최근 3개월, 기본값은 기존과 같은 최근 30일', () => {
  assert.deepEqual(VOLUME_PERIOD_OPTIONS.map((o) => o.label), ['오늘', '어제', '최근 7일', '최근 15일', '최근 30일', '최근 3개월']);
  assert.equal(DEFAULT_VOLUME_PERIOD, '30d');
});

test('KST 날짜 경계: 한국 자정 직후에도 오늘이 하루 밀리지 않는다(UTC 서버)', () => {
  assert.equal(kstDateString(KST_EARLY), '2026-09-15');
  assert.equal(kstDateString(KST_LATE), '2026-09-15');
  assert.equal(kstDateString(KST_MIDNIGHT), '2026-09-16');
  assert.deepEqual(resolveVolumePeriod('today', KST_EARLY), { from: '2026-09-15', to: '2026-09-15' });
  assert.deepEqual(resolveVolumePeriod('yesterday', KST_EARLY), { from: '2026-09-14', to: '2026-09-14' });
  assert.deepEqual(resolveVolumePeriod('today', KST_MIDNIGHT), { from: '2026-09-16', to: '2026-09-16' });
  // 기존 해석(UTC)은 같은 순간을 전날로 봤다 — 고친 이유를 고정한다
  assert.equal(resolvePriceRankingPeriod('7d', KST_EARLY).to, '2026-09-14');
  assert.equal(resolveVolumePeriod('7d', KST_EARLY).to, '2026-09-15');
});

test('7일/30일/3개월 범위와 직전 동일 기간', () => {
  const now = new Date('2026-09-15T03:00:00.000Z'); // KST 12:00
  assert.deepEqual(resolveVolumePeriod('7d', now), { from: '2026-09-09', to: '2026-09-15' });
  assert.deepEqual(resolveVolumePeriod('30d', now), { from: '2026-08-17', to: '2026-09-15' });
  assert.deepEqual(resolveVolumePeriod('3m', now), { from: '2026-06-15', to: '2026-09-15' });
  // 한국 낮 시간(UTC 날짜 = KST 날짜)에는 기존 규칙과 결과가 같다 → 기존 7일/30일/3개월 회귀 없음
  for (const p of ['7d', '30d', '3m'] as const) assert.deepEqual(resolveVolumePeriod(p, now), resolvePriceRankingPeriod(p, now));
  assert.deepEqual(previousPeriodRange(resolveVolumePeriod('7d', now)), { from: '2026-09-02', to: '2026-09-08' });
  assert.deepEqual(previousPeriodRange(resolveVolumePeriod('yesterday', now)), { from: '2026-09-13', to: '2026-09-13' });
  // 월말·연말 경계
  assert.deepEqual(resolveVolumePeriod('yesterday', new Date('2026-01-01T01:00:00.000Z')), { from: '2025-12-31', to: '2025-12-31' });
  assert.deepEqual(resolveVolumePeriod('30d', new Date('2026-03-01T01:00:00.000Z')), { from: '2026-01-31', to: '2026-03-01' });
});

test('하루 단위: 전날 증감 비교 없음 + 신고 시차 안내', () => {
  assert.equal(isSingleDayPeriod('today'), true);
  assert.equal(hasComparablePreviousPeriod('today'), false);
  assert.equal(hasComparablePreviousPeriod('yesterday'), false);
  assert.equal(hasComparablePreviousPeriod('7d'), true);
  assert.equal(needsReportingLagNotice('today'), true);
  assert.equal(needsReportingLagNotice('yesterday'), true);
  assert.equal(needsReportingLagNotice('7d'), true);
  assert.equal(needsReportingLagNotice('15d'), true);
  assert.equal(hasComparablePreviousPeriod('15d'), true);
  assert.equal(needsReportingLagNotice('3m'), false);
});

test('한장 브리핑은 선택한 기간을 그대로 연다 — 30일로 바꾸지 않는다(STATS_PERIOD_IMAGE_PARITY_V2)', () => {
  const now = new Date('2026-09-19T03:00:00.000Z'); // KST 2026-09-19 12:00
  const expected: Record<string, string> = {
    today: '오늘 · 2026.09.19 기준',
    yesterday: '어제 · 2026.09.18 기준',
    '7d': '최근 7일 · 2026.09.13 ~ 2026.09.19 기준',
    '15d': '최근 15일 · 2026.09.05 ~ 2026.09.19 기준',
    '30d': '최근 30일 · 2026.08.21 ~ 2026.09.19 기준',
    '3m': '최근 3개월 · 2026.06.19 ~ 2026.09.19 기준',
  };
  for (const o of VOLUME_PERIOD_OPTIONS) {
    const b = briefingPeriodFor(o.key, now);
    assert.equal(b.periodKey, o.key, `${o.key}가 다른 기간으로 바뀌었다`);
    assert.equal(b.matchesSelection, true);
    assert.equal(b.basisLabel, expected[o.key]);
  }
  assert.equal(feedPresetFor('3m'), null, '피드에 3개월 preset이 없으면 링크를 만들지 않는다');
  assert.equal(feedPresetFor('yesterday'), 'yesterday');
  assert.equal(feedPresetFor('15d'), '15d');
});

test('거래 많은 단지: 응답 순서 그대로 상위 5개, canonical 상세 링크(없으면 링크 없음)', () => {
  const entries = Array.from({ length: 8 }, (_, i) => ({ rank: i + 1, name: `단지${i}`, dong: '연산동', lawdCd: '26470', currentCount: 10 - i, aptSeq: i === 0 ? '26470-1' : null }));
  const rows = topComplexRows(entries, 5);
  assert.deepEqual(rows.map((r) => r.rank), [1, 2, 3, 4, 5]);
  assert.equal(topComplexRows([{ ...entries[0], currentCount: 0 }], 5).length, 0);
  const href = new URL(buildTopComplexHref(rows[0])!, 'https://e-jip.com');
  assert.deepEqual([decodeURIComponent(href.pathname), href.searchParams.get('lawdCd'), href.searchParams.get('dong'), href.searchParams.get('aptSeq')], ['/apt/단지0', '26470', '연산동', '26470-1']);
  assert.equal(new URL(buildTopComplexHref(rows[1])!, 'https://e-jip.com').searchParams.has('aptSeq'), false);
  assert.equal(buildTopComplexHref({ ...rows[0], lawdCd: '' }), null);
  assert.equal(buildTopComplexHref({ ...rows[0], dong: '' }), null);
});

test('dashboard: 6개 기간을 KST 계약일로 계산하고 캐시를 KST 날짜별로 가른다', () => {
  const route = code('src/app/api/stats/dashboard/route.ts');
  assert.match(route, /const VOLUME_COMPARISON_PRESETS: VolumePeriodPreset\[\] = \['today', 'yesterday', '7d', '15d', '30d', '3m'\];/);
  assert.equal((route.match(/const current = resolveVolumePeriod\(preset, now\);/g) ?? []).length, 2);
  assert.ok(!/resolvePriceRankingPeriod/.test(route));
  assert.match(route, /`stats-dashboard-sido:v6:\$\{sidoCodeParam\}:\$\{kstToday\}`/);
  // 계약일(dealDate) 기준 집계, 취소 제외 — 수집일(created_at)을 쓰지 않는다
  assert.match(route, /trades\.filter\(\(t: any\) => t\.dealDate >= range\.from && t\.dealDate <= range\.to\)\.length/);
  assert.match(route, /const verifiedApt = allAptTrades\.filter\(\(t: any\) => !t\.dealCanceled\);/);
  assert.ok(!/createdAt|created_at/.test(route));
});

test('concentration: 같은 기간 규칙 + 부산은 카드·피드와 같은 DB 원장, aptSeq 전달', () => {
  const route = code('src/app/api/stats/concentration/route.ts');
  assert.match(route, /\['today', 'yesterday', '7d', '15d', '30d', '3m', '6m', '12m'\]/);
  assert.match(route, /isVolumePeriodPreset\(preset\) \? resolveVolumePeriod\(preset, now\) : resolvePriceRankingPeriod\(preset, now\)/);
  assert.match(route, /const dbBacked = isFeedDbBackedSido\(/);
  assert.match(route, /loadBusanFeedTradesFromDb\(lawdCds, months, rentSplit\.verified\)/);
  assert.match(route, /aptSeq: e\.aptSeq,/);
  const feed = code('src/app/api/stats/feed/route.ts');
  assert.match(feed, /preset === 'today' \|\| preset === 'yesterday' \|\| preset === '7d' \|\| preset === '15d' \|\| preset === '30d'\s*\? resolveVolumePeriod\(preset, now\)/);
});

test('카드: 기간 하나가 요약·단지·실거래 목록·브리핑에 같이 적용된다', () => {
  const card = code('src/components/stats/VolumeChartCard.tsx');
  assert.match(card, /useState<VolumePeriodPreset>\(DEFAULT_VOLUME_PERIOD\)/);
  assert.match(card, /VOLUME_PERIOD_OPTIONS\.map\(\(p\) =>/);
  assert.match(card, /period: comparisonPreset, dealType, sort: 'count'/);
  assert.match(card, /\/stats\/feed\?period=\$\{feedPreset\}&dealType=\$\{dealType\}/);
  assert.match(card, /\/stats\/top-traded\?\$\{moreQuery\}/);
  assert.match(card, /briefingPeriodFor\(comparisonPreset\)/);
  assert.match(card, /\{briefing\.basisLabel\}/);
  assert.match(card, /해당 기간에 확인된 거래가 없습니다\./);
  assert.match(card, /실거래 신고 시차에 따라 이후 거래가 추가될 수 있어요\./);
  // 클릭해야 보이던 버튼은 즉시 노출 목록으로 대체
  assert.ok(!/이 기간 거래가 많은 단지 보기/.test(card));
  // 아이콘만 있던 버튼은 실제 기능(연도별 표) 이름을 가진다
  assert.match(card, /<Table2 size=\{13\} aria-hidden="true" \/>연도별 표/);
  // 월별 차트는 선택 기간과 별도라는 사실을 표시
  assert.match(card, /최근 12개월 · 선택 기간과 별도/);
  // 0건을 큰 숫자로 위장하지 않는다
  assert.match(card, /metric\.currentCount > 0 \? \(/);
});

test('더보기/실거래 목록 화면이 같은 기간으로 열린다', () => {
  const conc = code('src/components/stats/ConcentrationView.tsx');
  assert.match(conc, /\{ preset: 'today', label: '오늘' \},\s*\{ preset: 'yesterday', label: '어제' \},/);
  assert.match(conc, /if \(e\.aptSeq\) qs\.set\('aptSeq', e\.aptSeq\);/);
  const feed = code('src/components/stats/TransactionFeedView.tsx');
  assert.match(feed, /PERIOD_OPTIONS\.some\(\(p\) => p\.preset === initialPeriod\) \? initialPeriod! : '7d'/);
});
