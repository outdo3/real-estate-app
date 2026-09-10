// REPORT-7 — 리포트 진입 링크 규칙 테스트.
//
// 핵심 계약: canonical identity가 없으면 **null**이고, 호출부는 null이면 CTA를
// 렌더하지 않는다. 깨진 리포트로 보내느니 진입점을 안 만드는 편이 낫다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aptReportHref,
  cityReportHref,
  compareReportHref,
  dailyReportHref,
  districtReportHref,
  dongReportHref,
  REPORT_LABELS,
} from './report-links';
import { reportCanonicalPath } from './export-identity';

test('canonical id가 있으면 정확한 경로를 만든다', () => {
  assert.equal(cityReportHref(), '/report/city/busan');
  assert.equal(districtReportHref('26350'), '/report/district/26350');
  assert.equal(dongReportHref('26140', '서대신동3가'), `/report/dong/26140/${encodeURIComponent('서대신동3가')}`);
  assert.equal(aptReportHref('26140-1164'), '/report/apt/26140-1164');
  assert.equal(compareReportHref('26140-1164', '26140-1356'), '/report/compare?a=26140-1164&b=26140-1356');
  assert.equal(dailyReportHref('2026-09-09'), '/report/daily/2026-09-09');
});

test('identity가 없으면 null — 진입 CTA를 만들지 않는다', () => {
  assert.equal(districtReportHref(null), null);
  assert.equal(districtReportHref(''), null);
  assert.equal(districtReportHref('   '), null);
  assert.equal(dongReportHref('26140', null), null);
  assert.equal(dongReportHref(null, '서대신동3가'), null);
  assert.equal(aptReportHref(null), null);
  assert.equal(aptReportHref(undefined), null);
});

test('비교는 두 aptSeq가 모두 있어야 하고, 같은 단지는 거부한다', () => {
  assert.equal(compareReportHref('26140-1164', null), null);
  assert.equal(compareReportHref(null, '26140-1356'), null);
  // REPORT-4의 SAME_APARTMENT 가드와 같은 규칙.
  assert.equal(compareReportHref('26140-1164', '26140-1164'), null);
});

test('비교 a/b 순서가 보존된다', () => {
  assert.equal(compareReportHref('A', 'B'), '/report/compare?a=A&b=B');
  assert.equal(compareReportHref('B', 'A'), '/report/compare?a=B&b=A');
});

test('일별 링크는 YYYY-MM-DD만 받는다(형식 추측 금지)', () => {
  assert.equal(dailyReportHref('2026-09-09'), '/report/daily/2026-09-09');
  assert.equal(dailyReportHref('2026-9-9'), null);
  assert.equal(dailyReportHref('오늘'), null);
  assert.equal(dailyReportHref(''), null);
  assert.equal(dailyReportHref(null), null);
});

test('특수문자가 든 identity는 인코딩된다', () => {
  const href = aptReportHref('26140 1164/x');
  assert.ok(href && !href.includes(' '));
  assert.ok(href && !href.slice('/report/apt/'.length).includes('/'));
});

test('진입 링크와 공유 canonical 경로가 같은 정의를 쓴다', () => {
  // 갈라지면 공유 링크가 다른 리포트를 가리킨다 — 같은 값이어야 한다.
  assert.equal(
    reportCanonicalPath({
      reportType: 'APARTMENT_DETAIL',
      scope: { level: 'APARTMENT', lawdCd: null, dong: null, aptSeqs: ['26140-1164'] },
      periodEnd: '2026-09-10',
    }),
    aptReportHref('26140-1164')
  );
  assert.equal(
    reportCanonicalPath({
      reportType: 'REGION_DONG',
      scope: { level: 'DONG', lawdCd: '26140', dong: '서대신동3가', aptSeqs: null },
      periodEnd: '2026-09-10',
    }),
    dongReportHref('26140', '서대신동3가')
  );
  assert.equal(
    reportCanonicalPath({
      reportType: 'APARTMENT_COMPARE',
      scope: { level: 'COMPARE', lawdCd: null, dong: null, aptSeqs: ['A', 'B'] },
      periodEnd: '2026-09-10',
    }),
    compareReportHref('A', 'B')
  );
});

test('§16 용어가 일관된다', () => {
  assert.ok(REPORT_LABELS.city.includes('한장 브리핑'));
  assert.ok(REPORT_LABELS.district('해운대구').includes('한장 브리핑'));
  assert.ok(REPORT_LABELS.apt.includes('한장 리포트'));
  assert.ok(REPORT_LABELS.compare.includes('비교 리포트'));
  // 일별은 "오늘 계약"으로 읽히면 안 된다.
  assert.ok(REPORT_LABELS.daily.includes('새로 확인된'));
  assert.equal(REPORT_LABELS.daily.includes('계약된'), false);
  // 금지 표현
  for (const v of [REPORT_LABELS.city, REPORT_LABELS.apt, REPORT_LABELS.compare, REPORT_LABELS.daily]) {
    assert.equal(/보고서|분석지|리포트북|브리핑카드/.test(v), false);
  }
});
