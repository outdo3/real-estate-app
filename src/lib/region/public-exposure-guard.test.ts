import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getRegionEnablement,
  getEnabledSidoCodes,
  isPublicRegionAllowed,
  isSidoPubliclyHidden,
  isSidoPartiallyPublic,
  isTradeDbFirstLawdCd,
  publicAllowedLawdCds,
  SEOUL_BETA_LAWDCDS,
} from './enablement';
import { REGION_NODES } from './registry';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { decidePublicSeo, lawdCdFromAptSeq } from '../seo/seoul-blocked-seo';
import { resolveTransactionsReadState } from '../trade-read-state';
import { buildDongRoutes, buildLaunchRegionRoutes } from '../sitemap-scope';
import {
  computePublicExposureGuarded,
  evaluateGgApplyGate,
  GYEONGGI_FIRST_BATCH,
  PUBLIC_AXES,
} from '../../../scripts/national-backfill/gyeonggi-master-seed-logic';

// GYEONGGI_PUBLIC_EXPOSURE_GUARD_V1 — 공개 노출 allowlist 회귀 테스트(§12 매트릭스).
// 공개 표면은 "차단된 서울인가?"가 아니라 "이 지역의 이 축이 열렸는가?"를 묻는다.

const ROOT = resolve(__dirname, '../../..');
/** 주석을 뺀 실제 코드만 본다. */
const code = (p: string) =>
  readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const BETA8 = SEOUL_BETA_LAWDCDS as readonly string[];
const SEOUL_ALL = REGION_NODES.filter((n) => n.sidoCode === '11').map((n) => n.lawdCd);
const SEOUL_BLOCKED = SEOUL_ALL.filter((c) => !BETA8.includes(c));
const GYEONGGI_ALL = REGION_NODES.filter((n) => n.sidoCode === '41').map((n) => n.lawdCd);
const GANGNAM = '11680';
const APP_SAFE = ['app', 'search', 'map', 'detail'] as const;

test('1. 부산 16구 — 모든 축이 그대로 열려 있다', () => {
  for (const c of BUSAN_LAWDCD_16) {
    for (const axis of [...PUBLIC_AXES, 'cronSync'] as const) assert.equal(isPublicRegionAllowed(c, axis), true, `${c} ${axis}`);
    assert.equal(decidePublicSeo([c], 'detail'), 'NONE');
    assert.equal(decidePublicSeo([c], 'report'), 'NONE');
  }
  assert.equal(isSidoPubliclyHidden('26'), false);
  assert.equal(isSidoPartiallyPublic('26'), false, '"부산광역시 전체"는 계속 가능');
});

test('2·3. 서울 승인 8구 — 검색·지도·상세는 열림, 리포트·통계·SEO는 닫힘(기존 beta와 동일)', () => {
  assert.equal(BETA8.length, 8);
  for (const c of BETA8) {
    for (const axis of APP_SAFE) assert.equal(isPublicRegionAllowed(c, axis), true, `${c} ${axis}`);
    for (const axis of ['report', 'stats', 'sitemap', 'seoIndex'] as const) assert.equal(isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
    assert.equal(isTradeDbFirstLawdCd(c), true, 'DB-first(cronSync)는 그대로');
    assert.equal(decidePublicSeo([c], 'detail'), 'NOINDEX', '상세는 열리되 색인 금지');
    assert.equal(decidePublicSeo([c], 'report'), 'BLOCKED');
  }
});

test('4. 공개 차단 서울(강남 + 나머지 16구) — 모든 공개 축 닫힘', () => {
  assert.equal(SEOUL_BLOCKED.length, 17);
  assert.ok(SEOUL_BLOCKED.includes(GANGNAM));
  for (const c of SEOUL_BLOCKED) {
    for (const axis of PUBLIC_AXES) assert.equal(isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
    assert.equal(decidePublicSeo([c], 'detail'), 'BLOCKED');
  }
});

test('5·14·16. 검색 — allowlist(IN)만, alias fallback도 같은 게이트, 다른 지역으로 대체하지 않는다', () => {
  const allowed = new Set(publicAllowedLawdCds('search'));
  assert.equal(allowed.size, 24);
  for (const c of GYEONGGI_ALL) assert.ok(!allowed.has(c), `경기 ${c}가 검색 allowlist에 있다`);
  const search = code('src/app/api/search/route.ts');
  assert.ok(/const regionScope = \{ sggCd: \{ in: \[\.\.\.publicAllowedLawdCds\('search'\)\] \} \};/.test(search));
  assert.equal((search.match(/\.\.\.regionScope,/g) || []).length, 2, '지역·단지 두 쿼리 모두');
  assert.ok(/isPublicRegionAllowed\(o\.sggCd, 'search'\)/.test(search), '오피스텔도 같은 allowlist');
  const alias = code('src/lib/search-alias-fallback.ts');
  const i = alias.indexOf("if (!isPublicRegionAllowed(m.sggCd, 'search')) {");
  assert.ok(i > 0, 'alias 게이트가 없다');
  assert.ok(/fallbackCache\.set\(keyword, null\);\s*return null;/.test(alias.slice(i, i + 200)), '차단 후 다음 후보로 넘어간다(지역 대체 위험)');
});

test('6·15. 지도/transactions — map 축이 닫힌 lawdCd는 MOLIT·master 좌표를 읽기 전에 거부', () => {
  const src = code('src/app/api/transactions/route.ts');
  const gate = src.indexOf("if (!isPublicRegionAllowed(lawdCd, 'map')) {");
  assert.ok(gate > 0, 'transactions에 공개 게이트가 없다');
  assert.ok(gate < src.indexOf('fetchApt12MonthsFromDb(lawdCd)'), 'DB 경로보다 뒤');
  assert.ok(gate < src.indexOf('fetchMolitData({ lawdCd'), 'MOLIT 호출보다 뒤');
  assert.ok(gate < src.indexOf('getMasterCoords(lawdCd)'), 'master 좌표 조회보다 뒤');
  assert.ok(/regionUnsupported: true/.test(src.slice(gate, gate + 400)));
  for (const c of [...GYEONGGI_ALL, ...SEOUL_BLOCKED, '27110', '99999']) assert.equal(isPublicRegionAllowed(c, 'map'), false, c);
  // 차단 응답은 "검증된 0건"으로 읽히지 않는다.
  const s = resolveTransactionsReadState(true, { transactions: [], regionUnsupported: true, partial: false });
  assert.equal(s.regionUnsupported, true);
  const zero = resolveTransactionsReadState(true, { transactions: [], partial: false });
  assert.equal(zero.regionUnsupported, undefined);
  assert.ok(/if \(txState\.regionUnsupported\) return \{ complexes: \[\], partial: false, unavailable: true \};/.test(code('src/lib/ai-search.ts')));
});

test('7. 상세 — 본 API·정보·교육·점수·검증 전부 detail 축으로 게이트(이름으로 지역 추측 없음)', () => {
  const main = code('src/app/api/apt/[name]/route.ts');
  const g = main.indexOf("if (!isPublicRegionAllowed(lawdCd, 'detail')) {");
  assert.ok(g > 0 && g < main.indexOf('fetchMolitMonthCached({'), '상세 게이트가 live MOLIT보다 뒤');
  assert.ok(!/isSeoulPublicBlocked/.test(main));
  assert.ok(/isPublicRegionAllowed\(lawdCd, 'detail'\)/.test(code('src/app/api/apt/[name]/info/route.ts')));
  assert.ok(/isPublicRegionAllowed\(lawdCd, 'detail'\)/.test(code('src/app/api/apt/[name]/education/route.ts')));
  assert.ok(/isPublicRegionAllowed\(resolvedAptSeq\.slice\(0, 5\), 'detail'\)/.test(code('src/app/api/apt/[name]/score/route.ts')));
  assert.ok(/isPublicRegionAllowed\(aptSeq\.slice\(0, 5\), 'detail'\)/.test(code('src/app/api/apt/[name]/verify/route.ts')));
  for (const c of [...GYEONGGI_ALL, '27110']) assert.equal(decidePublicSeo([c], 'detail'), 'BLOCKED', c);
});

test('8·9. 리포트·비교 — 단지 리포트 게이트를 비교가 우회하지 못한다', () => {
  const report = code('src/app/report/apt/[aptSeq]/page.tsx');
  assert.ok(/!isPublicRegionAllowed\(reportLawdCd, 'report'\)/.test(report));
  const cmp = code('src/lib/report/compare-read.ts');
  const g = cmp.indexOf("isPublicRegionAllowed(master.sggCd, 'report')");
  assert.ok(g > 0 && g < cmp.indexOf('apartmentTradeHistory.findMany'), '비교 리포트가 거래를 먼저 읽는다');
  assert.ok(/isPublicRegionAllowed\(master\.aptSeq\.slice\(0, 5\), 'report'\)/.test(cmp));
  const seeds = code('src/lib/compare-v2/resolve-seeds.ts');
  assert.ok(/isPublicRegionAllowed\(master\.sggCd, 'detail'\)/.test(seeds), '/stats/compare seed가 공개 게이트를 안 탄다');
  const statsCompare = code('src/app/stats/compare/page.tsx');
  assert.ok(/decidePublicSeo\(\[a\?\.lawdCd, b\?\.lawdCd, \.\.\.requestedLawdCds\], 'detail'\)/.test(statsCompare));
  for (const c of GYEONGGI_ALL) assert.equal(isPublicRegionAllowed(c, 'report'), false);
  assert.equal(decidePublicSeo(['26350', lawdCdFromAptSeq('41111-41')], 'report'), 'BLOCKED');
});

test('10. 지역 선택기 — 부산·서울만(서울은 8구, "서울 전체" 없음), 경기·그 밖 시도 없음', () => {
  assert.equal(isSidoPubliclyHidden('26'), false);
  assert.equal(isSidoPubliclyHidden('11'), false);
  assert.equal(isSidoPartiallyPublic('11'), true);
  for (const sido of ['41', '27', '28', '29', '30', '31', '36', '42', '43', '44', '45', '46', '47', '48', '50', '51', '52', '', null]) {
    assert.equal(isSidoPubliclyHidden(sido), true, `시도 ${sido}가 선택지에 나온다`);
  }
  const modal = code('src/components/RegionSelectModal.tsx');
  assert.ok(/isPublicRegionAllowed\(item\.code\.substring\(0, 5\), 'app'\)/.test(modal));
  assert.deepEqual(getEnabledSidoCodes(), ['26'], '시도 단위로 통째로 열린 곳은 여전히 부산뿐');
});

test('11·12. sitemap·seoIndex — 경기 URL 0, 경기 seoIndex false', () => {
  const region = buildLaunchRegionRoutes().map((r) => decodeURIComponent(r.path));
  const dong = buildDongRoutes([
    { lawdCd: '41111', dong: '정자동', count: 5000 },
    { lawdCd: '41210', dong: '하안동', count: 5000 },
    { lawdCd: '26350', dong: '우동', count: 500 },
  ]).map((r) => decodeURIComponent(r.path));
  const all = [...region, ...dong];
  assert.deepEqual(all.filter((p) => /41\d{3}|경기|수원|광명|의정부|성남/.test(p)), []);
  assert.ok(dong.some((p) => p.includes('26350')), '부산 동은 그대로');
  for (const c of GYEONGGI_ALL) {
    assert.equal(isPublicRegionAllowed(c, 'seoIndex'), false);
    assert.equal(isPublicRegionAllowed(c, 'sitemap'), false);
  }
});

test('13. 그 밖의 전국·registry 밖 코드는 기본 닫힘(fallback 없음)', () => {
  for (const c of ['27110', '28177', '29110', '30110', '31110', '36110', '47720', '50110', '99999', '', null, undefined]) {
    for (const axis of PUBLIC_AXES) assert.equal(isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
  }
});

test('17. 수집·감사 경로는 공개 정책에 묶이지 않는다(DATA_EXISTS ≠ PUBLIC_ALLOWED)', () => {
  // cronSync(DB-first 소스 선택)는 공개 축과 별개로 그대로다.
  for (const c of BUSAN_LAWDCD_16) assert.equal(isTradeDbFirstLawdCd(c), true);
  for (const c of GYEONGGI_ALL) assert.equal(isTradeDbFirstLawdCd(c), false, '경기 cronSync는 여전히 닫힘');
  // 수집 코어·scope·오케스트레이터 적재 경로는 공개 allowlist를 읽지 않는다.
  for (const p of ['src/lib/sync/sale-sync-scope.ts', 'src/lib/sync/sale-sync-core.ts', 'scripts/national-backfill/orchestrator-logic.ts']) {
    assert.ok(!/isPublicRegionAllowed|publicAllowedLawdCds/.test(code(p)), `${p}가 공개 정책에 묶였다`);
  }
  // 서울 전용 감사 스크립트가 쓰는 레거시 판정은 그대로 남는다.
  assert.ok(/export function seoulPublicBlockedLawdCds/.test(code('src/lib/region/enablement.ts')));
});

test('18·19·20. seed 게이트 — publicExposureGuarded는 enablement에서 계산되어 true, 41135 제외 유지, 경기 enablement 추가 없음', () => {
  const r = computePublicExposureGuarded((c, axis) => isPublicRegionAllowed(c, axis));
  assert.deepEqual(r, { guarded: true, openAxes: [] });
  // 누군가 경기 축 하나라도 열면 즉시 false가 된다.
  const opened = computePublicExposureGuarded((c, axis) => (c === '41111' && axis === 'search') || isPublicRegionAllowed(c, axis));
  assert.deepEqual(opened, { guarded: false, openAxes: ['41111:search'] });
  const gate = evaluateGgApplyGate({
    applyFlag: true, allowProdDbRead: '1', allowProdDbWrite: '1', districts: ['41135'], expectInserts: 1, plannedInserts: 1,
    expectPlanHash: 'h', planHash: 'h', coordinatesSkipped: false, publicExposureGuarded: r.guarded,
    reviewInScope: 0, unresolvedInScope: 0, unexpectedExistingMasters: 0,
  });
  assert.deepEqual(gate.reasons, ['DISTRICT_41135_EXCLUDED']);
  assert.ok(!(GYEONGGI_FIRST_BATCH as readonly string[]).includes('41135'));
  // enablement 소스에 경기 활성화가 없다.
  const en = code('src/lib/region/enablement.ts');
  assert.ok(!/'41'\s*:/.test(en), 'ENABLEMENT_BY_SIDO에 경기가 들어갔다');
  assert.ok(!/'41\d{3}'/.test(en), '경기 시군구가 allowlist에 들어갔다');
  for (const c of GYEONGGI_ALL) assert.deepEqual(Object.values(getRegionEnablement(c)).filter(Boolean), []);
});

test('모든 공개 소비자가 서울 deny-list에서 벗어났다(stats/supply는 분양 원천이라 예외)', () => {
  for (const p of [
    'src/app/api/search/route.ts', 'src/lib/search-alias-fallback.ts', 'src/app/api/apt/[name]/route.ts',
    'src/app/report/apt/[aptSeq]/page.tsx', 'src/components/RegionSelectModal.tsx', 'src/lib/seo/seoul-blocked-seo.ts',
  ]) {
    const c = code(p);
    assert.ok(!/isSeoulPublicBlocked|seoulPublicBlockedLawdCds/.test(c), `${p}가 아직 서울 deny-list를 쓴다`);
  }
  assert.ok(/sggCd: \{ in: \[\.\.\.publicAllowedLawdCds\('app'\)\] \}/.test(code('src/lib/nearby-apartments.ts')), '주변 단지 목록이 allowlist를 안 탄다');
});
