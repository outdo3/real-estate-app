import assert from 'node:assert/strict';
import test, { before } from 'node:test';

// SEOUL_25_PUBLIC_BETA_PREP_V1 — Preview 빌드와 같은 env로 enablement를 **새로 읽어** 실제 런타임 판정을 본다.
// (각 테스트 파일은 별도 프로세스라 이 env는 다른 테스트에 새지 않는다.) Production DB·네트워크 0.

type E = typeof import('./enablement');
type R = typeof import('./registry');
let e: E;
let r: R;

before(async () => {
  process.env.NEXT_PUBLIC_VERCEL_ENV = 'preview';
  process.env.NEXT_PUBLIC_SEOUL_25_BETA_PREVIEW = 'true';
  e = await import('./enablement');
  r = await import('./registry');
});

test('Preview env: 스위치 켜짐 · 서울 25구 app·search·map·detail 공개 · report·stats·sitemap·seoIndex 닫힘', () => {
  assert.equal(e.SEOUL_25_BETA_PREVIEW_ENABLED, true);
  const seoul = r.REGION_NODES.filter((n) => n.sidoCode === '11').map((n) => n.lawdCd);
  assert.equal(seoul.length, 25);
  for (const c of seoul) {
    for (const axis of ['app', 'search', 'map', 'detail'] as const) assert.equal(e.isPublicRegionAllowed(c, axis), true, `${c} ${axis}`);
    for (const axis of ['report', 'stats', 'sitemap', 'seoIndex'] as const) assert.equal(e.isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
  }
  for (const c of e.SEOUL_17_BETA_LAWDCDS) assert.equal(e.isTradeDbFirstLawdCd(c), false, `${c} DB-first(적재 미완료)`);
  assert.equal(e.publicAllowedLawdCds('search').length, 41);
  assert.equal(e.publicAllowedLawdCds('report').filter((c) => c.startsWith('11')).length, 0);
});

test('Preview env: 25구가 다 열려도 "서울특별시 전체"는 없다 · 서울 시도 층·DB-first·통계는 닫힘 · 부산 그대로', () => {
  assert.equal(e.isSidoPartiallyPublic('11'), false, '25/25 — 예전 가드라면 "서울 전체"가 되살아났다');
  assert.equal(e.isSidoWholeQuerySupported('11'), false);
  assert.equal(e.isTradeDbFirstSido('11'), false);
  assert.equal(e.isStatsEnabledSido('11'), false);
  assert.equal(e.isSidoWholeQuerySupported('26'), true);
  for (const c of r.REGION_NODES.filter((n) => n.sidoCode === '26').map((n) => n.lawdCd)) {
    for (const axis of ['app', 'search', 'map', 'detail', 'report', 'stats', 'sitemap', 'seoIndex', 'cronSync'] as const) assert.equal(e.isPublicRegionAllowed(c, axis), true, `${c} ${axis}`);
  }
  for (const c of r.REGION_NODES.filter((n) => n.sidoCode === '41').map((n) => n.lawdCd)) assert.equal(e.isPublicRegionAllowed(c, 'app'), false, c);
});

test('Preview env: SEO — 서울 상세는 NOINDEX, 리포트는 BLOCKED', async () => {
  const { decidePublicSeo } = await import('../seo/seoul-blocked-seo');
  for (const c of ['11680', '11350', '11620', '11380', '11290', '11110']) {
    assert.equal(decidePublicSeo([c], 'detail'), 'NOINDEX', c);
    assert.equal(decidePublicSeo([c], 'report'), 'BLOCKED', c);
  }
});

test('Preview env: 서울 25 리포트 CTA 없음 · 부산 CTA 그대로', async () => {
  const { isReportRegionOpen } = await import('../report/report-links');
  for (const c of ['11680', '11350', '11620', '11380', '11290', '11110']) assert.equal(isReportRegionOpen(`${c}-1`), false, c);
  assert.equal(isReportRegionOpen('26140-1164'), true);
});
