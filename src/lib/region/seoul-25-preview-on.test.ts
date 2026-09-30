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
  // SEOUL25_PREVIEW_READ_ONLY_DB_V1 — Preview 17구는 DB-first로 읽고 live MOLIT는 부르지 않는다
  for (const c of e.SEOUL_17_BETA_LAWDCDS) assert.equal(e.isTradeDbFirstLawdCd(c), true, `${c} DB-first`);
  for (const c of e.SEOUL_17_BETA_LAWDCDS) assert.equal(e.isDbOnlyLawdCd(c), true, `${c} DB only`);
  for (const c of [...e.SEOUL_BETA_LAWDCDS, '26350', '41111', '99999']) assert.equal(e.isDbOnlyLawdCd(c), false, `${c} not DB-only`);
  // SEOUL25_BETA_PREP_REBASE_COMPILE_FIX_V1 — Preview에서도 17구 공급은 닫힘, 8구는 그대로
  for (const c of e.SEOUL_17_BETA_LAWDCDS) assert.equal(e.isPublicRegionAllowed(c, 'supply'), false, `${c} supply`);
  for (const c of e.SEOUL_BETA_LAWDCDS) assert.equal(e.isPublicRegionAllowed(c, 'supply'), true, `${c} supply`);
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

test('Preview env: 공급 라우트 — 17구·서울 전체·경기 거부, 공개 8구·부산 허용(84e1c61 유지)', async () => {
  const { decideSupplyRegion } = await import('../stats/supply-region-gate');
  for (const g of ['강남구', '서초구', '관악구', '성북구']) assert.equal(decideSupplyRegion('서울특별시', g).allowed, false, g);
  assert.equal(decideSupplyRegion('서울특별시', null).allowed, false);
  assert.equal(decideSupplyRegion('경기도', null).allowed, false);
  assert.equal(decideSupplyRegion('경기도', '수원시 장안구').allowed, false);
  assert.equal(decideSupplyRegion('서울특별시', '마포구').allowed, true);
  assert.equal(decideSupplyRegion('부산광역시', null).allowed, true);
});

test('Preview env: 17구 live MOLIT는 네트워크 없이 실패로 닫힘 · 8구·부산은 그대로 MOLIT 경로', async () => {
  const { fetchMolitData, DB_ONLY_MOLIT_MESSAGE } = await import('../api-molit');
  const { classifyMolitMonthResult } = await import('../apt-trade-completeness');
  let calls = 0;
  const fetchOnce = async () => { calls++; return []; };
  for (const c of e.SEOUL_17_BETA_LAWDCDS) {
    for (const type of ['apt', 'rent', 'officetel'] as const) {
      const r = await fetchMolitData({ lawdCd: c, dealYmd: '202608', type }, { fetchOnce });
      assert.equal(r.length, 1, c);
      assert.equal(r[0].typeLabel, '에러', `${c} 실패 플레이스홀더(빈 배열 = 0건 위장 금지)`);
      assert.ok(String(r[0].name).includes(DB_ONLY_MOLIT_MESSAGE), c);
      assert.equal(classifyMolitMonthResult(r), 'FAILED', c);
    }
  }
  assert.equal(calls, 0, 'Preview 17구에서 MOLIT fetch가 호출됐다');
  for (const c of ['11440', '26350']) await fetchMolitData({ lawdCd: c, dealYmd: '202608', type: 'apt' }, { fetchOnce });
  assert.equal(calls, 2, '8구·부산은 기존 MOLIT 경로 그대로');
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
