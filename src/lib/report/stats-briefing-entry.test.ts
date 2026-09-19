import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveStatsReportEntry, statsBriefingTarget, withBriefingPeriod } from './stats-report-entry';
import { parseReportPeriodKey, resolveReportPeriod } from './report-period';
import { VOLUME_PERIOD_OPTIONS, resolveVolumePeriod } from '../stats/volume-period';

// STATS_15D_BRIEFING_ENTRY_FIX — Production 재현: 실거래 화면 "최근 15일" → "부산 한장 브리핑"이
// `/report/city/busan`(기본 30일, 1,998건)으로 열렸다. 버튼은 통계 상세 페이지의 공용 CTA였고, 기간은
// 화면(TransactionFeedView) 안의 상태라 CTA가 몰랐다. 이 테스트는 그 진입 경로를 고정한다.

const ROOT = resolve(__dirname, '../../..');
const codeOf = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const NOON_KST = new Date('2026-09-19T03:00:00.000Z');

const CITY = resolveStatsReportEntry({ lawdCd: null, sidoCode: '26', dong: 'all', sigungu: '' })!;
const DISTRICT = resolveStatsReportEntry({ lawdCd: '26140', sidoCode: '26', dong: 'all', sigungu: '서구' })!;
const DONG = resolveStatsReportEntry({ lawdCd: '26140', sidoCode: '26', dong: '암남동', sigungu: '서구' })!;

test('시·구·동 진입 × 6개 기간 — 링크에 선택 기간이 실리고, 리포트가 화면과 같은 범위를 읽는다', () => {
  for (const [entry, base] of [[CITY, '/report/city/busan'], [DISTRICT, '/report/district/26140'], [DONG, DONG.href]] as const) {
    for (const o of VOLUME_PERIOD_OPTIONS) {
      const t = statsBriefingTarget(entry, o.key, NOON_KST);
      assert.equal(t.href, `${base}?period=${o.key}`, `${entry.scope} ${o.key}`);
      assert.equal(t.matchesSelection, true);
      assert.match(t.basisLabel, / · 매매$/);
      // 리포트 페이지가 이 링크의 ?period=를 읽으면 화면과 같은 날짜 범위가 나온다.
      const key = parseReportPeriodKey(new URL(t.href, 'https://e-jip.com').searchParams.get('period') ?? undefined);
      const r = resolveReportPeriod(key, NOON_KST);
      const s = resolveVolumePeriod(o.key, NOON_KST);
      assert.deepEqual([r.start, r.end], [s.from, s.to], `${entry.scope} ${o.key}`);
    }
  }
  assert.equal(statsBriefingTarget(CITY, '15d', NOON_KST).href, '/report/city/busan?period=15d');
  assert.equal(statsBriefingTarget(CITY, '15d', NOON_KST).basisLabel, '최근 15일 · 2026.09.05 ~ 2026.09.19 기준 · 매매');
  assert.equal(statsBriefingTarget(CITY, 'yesterday', NOON_KST).basisLabel, '어제 · 2026.09.18 기준 · 매매');
});

test('브리핑에 같은 기간이 없는 선택(이번 주·지난주·12개월)·기간 없는 화면 — 기본 기간으로 열되 그 기간을 밝힌다', () => {
  for (const p of ['thisWeek', 'lastWeek', '12m', '6m', null, undefined, 'bogus']) {
    const t = statsBriefingTarget(CITY, p as string | null, NOON_KST);
    assert.equal(t.href, '/report/city/busan', String(p));
    assert.equal(t.matchesSelection, false);
    assert.equal(t.basisLabel, '최근 30일 · 2026.08.20 ~ 2026.09.18 기준 · 매매', '기본 브리핑(어제까지 30일)을 그대로 적는다');
  }
});

test('쿼리 결합 — 이미 쿼리가 있으면 &로 잇는다', () => {
  assert.equal(withBriefingPeriod('/report/city/busan', '7d'), '/report/city/busan?period=7d');
  assert.equal(withBriefingPeriod('/report/x?a=1', '15d'), '/report/x?a=1&period=15d');
});

test('배선 — 통계 상세 CTA는 화면이 알려준 기간으로 링크를 만들고, 기간을 가진 두 화면이 그 기간을 올려 보낸다', () => {
  const page = codeOf('src/app/stats/[type]/type-client.tsx');
  assert.match(page, /const target = statsBriefingTarget\(entry, briefingPeriod\);/);
  assert.match(page, /<Link href=\{target\.href\} className=\{styles\.reportCta\}>/);
  assert.ok(!/<Link href=\{entry\.href\} className=\{styles\.reportCta\}>/.test(page), 'CTA가 여전히 기간 없는 경로를 쓴다');
  assert.match(page, /<TransactionFeedView [^>]*onPeriodChange=\{setBriefingPeriod\}/);
  assert.match(page, /<ConcentrationView [^>]*onPeriodChange=\{setBriefingPeriod\}/);
  for (const v of ['src/components/stats/TransactionFeedView.tsx', 'src/components/stats/ConcentrationView.tsx']) {
    assert.match(codeOf(v), /useEffect\(\(\) => \{\s*onPeriodChange\?\.\(preset\);\s*\}, \[preset, onPeriodChange\]\);/, v);
  }
  // 거래량 카드도 같은 결합 함수를 쓴다(링크 규칙 한 곳).
  assert.match(codeOf('src/components/stats/VolumeChartCard.tsx'), /withBriefingPeriod\(reportEntry\.href, briefing\.periodKey\)/);
});
