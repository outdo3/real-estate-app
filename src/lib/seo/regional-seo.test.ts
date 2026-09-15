import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

import {
  BRAND_NAME,
  MAIN_DESCRIPTION,
  MAIN_TITLE,
  buildBreadcrumbJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  serializeJsonLd,
} from './site-seo';
import {
  DONG_INDEX_MIN_TRADES_1Y,
  MAX_REGION_TITLE_CHARS,
  buildRegionSeoMetadata,
  buildRegionSeoName,
  decideRegionRobots,
  shortSidoName,
} from './region-seo';
import {
  REPORT_AVAILABLE_DATA,
  cityReportSeo,
  districtNavLinks,
  districtReportSeo,
  dongNavLinks,
  dongReportSeo,
} from './report-region-seo';
import { MIN_SAMPLE_FOR_INTERPRETATION } from '../report/region-aggregate';
import { BUSAN_DISTRICTS } from '../report/region-scope';
import { buildDongRoutes, buildLaunchRegionRoutes } from '../sitemap-scope';

/**
 * REGIONAL_SEO_KEYWORD_LANDING_V1 §22 — 지역 SEO 계약.
 *
 * 렌더 결과(head의 실제 태그)는 로컬 프로덕션 빌드 QA에서 확인한다. 여기서는 (1) 템플릿이
 * 결정론적으로 무엇을 내보내는지, (2) 페이지가 그 템플릿에 배선돼 있는지를 고정한다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 문구를 인용한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ORIGIN = 'https://e-jip.com';

// ── 1~3. 메인 ──────────────────────────────────────────────────────────────

test('1 메인 title이 사용자 확정값과 정확히 같다', () => {
  assert.equal(MAIN_TITLE, '이집(E-JIP) - 아파트 실거래가·거래량·학군·부동산 데이터');
  const home = codeOf(read('src/app/page.tsx'));
  assert.ok(/title: MAIN_TITLE,/.test(home), '홈 title이 단일 출처를 쓰지 않는다');
  const layout = codeOf(read('src/app/layout.tsx'));
  assert.ok(/^\s*title: MAIN_TITLE,/m.test(layout), '루트 기본 title이 메인 title이 아니다');
});

test('2 메인 description이 사용자 확정값과 정확히 같다', () => {
  assert.equal(
    MAIN_DESCRIPTION,
    '복잡한 부동산, 이집으로 쉽게. 아파트 실거래가부터 거래량, 학군, 교통, 단지 비교까지 한눈에 확인하세요.'
  );
  assert.ok(/description: MAIN_DESCRIPTION,/.test(codeOf(read('src/app/page.tsx'))));
  // 옛 문구가 메타데이터 코드에 남아 있지 않다.
  for (const p of ['src/app/page.tsx', 'src/app/layout.tsx', 'src/config/site.ts']) {
    assert.ok(!codeOf(read(p)).includes('언제 어디서나 쉽게'), `${p}에 옛 설명이 남아 있다`);
  }
});

test('3 메인 OG/twitter가 같은 title·description을 쓰고 og:url이 홈을 가리킨다', () => {
  const home = codeOf(read('src/app/page.tsx'));
  assert.ok(/openGraph: buildOpenGraph\(\{ title: MAIN_TITLE, description: MAIN_DESCRIPTION, path: '\/' \}\)/.test(home));
  assert.ok(/alternates: \{ canonical: '\/' \}/.test(home));
  // 홈 twitter는 card/images를 포함한 buildTwitter로 명시한다.
  assert.ok(/twitter: buildTwitter\(\{ title: MAIN_TITLE, description: MAIN_DESCRIPTION \}\)/.test(home));
  const layout = codeOf(read('src/app/layout.tsx'));
  const og = layout.slice(layout.indexOf('openGraph: {'), layout.indexOf('twitter: {'));
  assert.ok(/title: MAIN_TITLE/.test(og) && /description: MAIN_DESCRIPTION/.test(og));
  // 루트 twitter에는 제목을 두지 않는다 — 다른 화면이 메인 제목을 물려받지 않게.
  const tw = layout.slice(layout.indexOf('twitter: {'), layout.indexOf('verification: {'));
  assert.ok(!/title:|description:/.test(tw), '루트 twitter 제목이 모든 화면으로 새어 나간다');
  assert.ok(/card: 'summary_large_image'/.test(tw));
});

// ── 4~7. 지역 ──────────────────────────────────────────────────────────────

test('4 부산 서구 구 메타데이터', () => {
  const seo = districtReportSeo('26140');
  assert.equal(seo.title, '부산 서구 아파트 시세·실거래가·거래량 | 이집');
  assert.equal(seo.heading, '부산 서구 아파트 시세·실거래가');
  assert.equal(
    seo.description,
    '부산 서구 아파트 매매 시세를 국토교통부 실거래가로 확인하세요. 최근 실거래, 중앙 거래가·㎡당 가격, 거래량 변화, 거래가 많은 단지, 동별 거래 분포, 최근 2년 최고 거래가를 한 장에 정리했습니다.'
  );
  assert.equal(seo.canonicalPath, '/report/district/26140');
  assert.deepEqual(seo.robots, { index: true, follow: true });
  assert.deepEqual(
    seo.breadcrumbs.map((b) => b.name),
    ['이집', '부산', '서구']
  );
});

test('5 부산 사하구 구 메타데이터', () => {
  const seo = districtReportSeo('26380');
  assert.equal(seo.title, '부산 사하구 아파트 시세·실거래가·거래량 | 이집');
  assert.ok(seo.description.startsWith('부산 사하구 아파트 매매 시세를'));
  assert.equal(seo.canonicalPath, '/report/district/26380');
  assert.equal(seo.robots.index, true);
});

test('6 부산 해운대구 구 메타데이터', () => {
  const seo = districtReportSeo('26350');
  assert.equal(seo.title, '부산 해운대구 아파트 시세·실거래가·거래량 | 이집');
  assert.equal(seo.heading, '부산 해운대구 아파트 시세·실거래가');
  assert.equal(seo.canonicalPath, '/report/district/26350');
});

test('7 동 메타데이터 — 실거래로 확인된 동만 이름을 쓰고, 표본이 있을 때만 색인', () => {
  const ok = dongReportSeo('26140', '암남동', 25);
  assert.equal(ok.title, '부산 서구 암남동 아파트 시세·실거래가 | 이집');
  assert.equal(ok.heading, '부산 서구 암남동 아파트 시세·실거래가');
  assert.equal(ok.canonicalPath, `/report/dong/26140/${encodeURIComponent('암남동')}`);
  assert.deepEqual(ok.robots, { index: true, follow: true });
  // 동 KPI에는 증감률이 없다 → "거래량 변화"를 약속하지 않는다. 하위 분포도 없다.
  assert.ok(!ok.description.includes('거래량 변화') && !ok.description.includes('분포'));
  assert.deepEqual(ok.breadcrumbs.map((b) => b.name), ['이집', '부산', '서구', '암남동']);

  const thin = dongReportSeo('26140', '아미동2가', 6);
  assert.equal(thin.title, '부산 서구 아미동2가 아파트 시세·실거래가 | 이집');
  assert.deepEqual(thin.robots, { index: false, follow: true }, '표본이 얇은 동이 색인된다');

  const gijang = dongReportSeo('26710', '기장읍 교리', 12);
  assert.equal(gijang.title, '부산 기장군 기장읍 교리 아파트 시세·실거래가 | 이집');
  assert.ok(gijang.title.length <= MAX_REGION_TITLE_CHARS);

  assert.equal(dongReportSeo('26380', '괴정동', 40).title, '부산 사하구 괴정동 아파트 시세·실거래가 | 이집');
});

test('7 동 색인 기준은 리포트 표본 게이트와 같은 값이다(기준을 따로 만들지 않는다)', () => {
  assert.equal(DONG_INDEX_MIN_TRADES_1Y, MIN_SAMPLE_FOR_INTERPRETATION);
  assert.equal(decideRegionRobots({ level: 'DONG', verified: true, trailingYearTrades: 9 }).index, false);
  assert.equal(decideRegionRobots({ level: 'DONG', verified: true, trailingYearTrades: 10 }).index, true);
  assert.equal(decideRegionRobots({ level: 'DONG', verified: true, trailingYearTrades: null }).index, false);
});

// ── 8~9. canonical ─────────────────────────────────────────────────────────

test('8 canonical은 쿼리 없는 깨끗한 경로다', () => {
  const all = [cityReportSeo(), ...BUSAN_DISTRICTS.map((d) => districtReportSeo(d.lawdCd)), dongReportSeo('26140', '암남동', 25)];
  for (const s of all) {
    assert.ok(s.canonicalPath, '색인 페이지에 canonical이 없다');
    assert.ok(!s.canonicalPath!.includes('?'), `canonical에 쿼리가 있다: ${s.canonicalPath}`);
    assert.ok(!/[가-힣]/.test(s.canonicalPath!), `인코딩되지 않은 한글: ${s.canonicalPath}`);
  }
  assert.equal(cityReportSeo().canonicalPath, '/report/city/busan');
});

test('9 쿼리 변형(?period=, ?sido=&sigungu=)은 같은 canonical로 모인다', () => {
  // 지역 리포트: generateMetadata가 searchParams를 읽지 않는다 → ?period=90도 같은 canonical.
  for (const p of ['src/app/report/city/busan/page.tsx', 'src/app/report/district/[lawdCd]/page.tsx', 'src/app/report/dong/[lawdCd]/[dong]/page.tsx']) {
    const code = codeOf(read(p));
    const meta = code.slice(code.indexOf('export async function generateMetadata'), code.indexOf('export default'));
    assert.ok(!/searchParams/.test(meta), `${p} 메타데이터가 쿼리에 따라 달라진다`);
    assert.ok(/alternates: \{ canonical: seo\.canonicalPath \}/.test(meta), `${p} canonical이 템플릿에서 오지 않는다`);
  }
  // 공유용 지역 쿼리 화면은 깨끗한 경로가 canonical이다.
  assert.ok(/alternates: \{ canonical: '\/stats' \}/.test(codeOf(read('src/app/stats/page.tsx'))));
  assert.ok(/alternates: \{ canonical: '\/school' \}/.test(codeOf(read('src/app/school/page.tsx'))));
  const mapLayout = codeOf(read('src/app/map/layout.tsx'));
  assert.ok(/const MAP_PATH = '\/map';/.test(mapLayout) && /alternates: \{ canonical: MAP_PATH \}/.test(mapLayout));
  assert.ok(/alternates: \{ canonical: '\/report' \}/.test(codeOf(read('src/app/report/page.tsx'))));
  const typePage = codeOf(read('src/app/stats/[type]/page.tsx'));
  assert.ok(/`\/stats\/\$\{encodeURIComponent\(type\)\}`/.test(typePage));
  assert.ok(/item\?\.status === 'soon' \? \{ robots: \{ index: false, follow: true \} \}/.test(typePage), '준비 중 통계 메뉴가 색인된다');
  // 단지 상세: 식별이 완전할 때만, 단일 경로 정의로 정규화한다.
  assert.ok(/aptDetailHref\(\{ name: aptName/.test(codeOf(read('src/app/apt/[name]/page.tsx'))));
});

// ── 10. noindex ────────────────────────────────────────────────────────────

test('10 사용자별·임시 상태 화면은 noindex다', () => {
  const noindexFollowFalse = /robots: \{ index: false, follow: false \}/;
  for (const p of ['src/app/my/layout.tsx', 'src/app/admin/layout.tsx', 'src/app/community/write/layout.tsx', 'src/app/community/[id]/edit/layout.tsx', 'src/app/feedback/page.tsx']) {
    assert.ok(noindexFollowFalse.test(codeOf(read(p))), `${p}가 noindex가 아니다`);
  }
  // 글쓰기·수정은 부모(/community) canonical을 물려받지 않는다.
  for (const p of ['src/app/community/write/layout.tsx', 'src/app/community/[id]/edit/layout.tsx']) {
    assert.ok(/alternates: \{ canonical: null \}/.test(codeOf(read(p))), `${p}가 /community canonical을 상속한다`);
  }
  assert.ok(/robots: \{ index: false, follow: true \}/.test(codeOf(read('src/app/report/compare/page.tsx'))));
  assert.ok(/robots: \{ index: false, follow: true \}/.test(codeOf(read('src/app/ai-search/page.tsx'))));
  assert.ok(/a && b \? \{ robots: \{ index: false, follow: true \} \}/.test(codeOf(read('src/app/stats/compare/page.tsx'))));
  // 레이아웃은 메타데이터만 싣는다 — 접근 제어를 대신하거나 바꾸지 않는다.
  assert.ok(!/AuthGate|redirect|getServerSession/.test(codeOf(read('src/app/admin/layout.tsx'))));
  // robots.txt 규칙은 그대로다.
  const robots = read('src/app/robots.ts');
  for (const d of ['/api/', '/admin', '/my', '/community/write']) assert.ok(robots.includes(`'${d}'`));
});

// ── 11~12. 사이트맵 ────────────────────────────────────────────────────────

const DONG_SAMPLE = [
  { lawdCd: '26140', dong: '암남동', count: 25 },
  { lawdCd: '26140', dong: '서대신동3가', count: 30 },
  { lawdCd: '26140', dong: '아미동2가', count: 6 },
  { lawdCd: '26380', dong: '괴정동', count: 80 },
  { lawdCd: '26380', dong: '괴정동', count: 80 },
  { lawdCd: '26710', dong: '기장읍 교리', count: 11 },
];

test('11 사이트맵 지역 URL에 중복이 없다', () => {
  const sitemap = read('src/app/sitemap.ts');
  const staticPaths = [...sitemap.matchAll(/\{ path: '([^']+)'/g)].map((m) => m[1]);
  const paths = [...staticPaths, ...buildLaunchRegionRoutes().map((r) => r.path), ...buildDongRoutes(DONG_SAMPLE).map((r) => r.path)];
  assert.equal(new Set(paths).size, paths.length, `중복: ${paths.filter((p, i) => paths.indexOf(p) !== i)}`);
  assert.deepEqual(staticPaths, ['/', '/stats', '/school', '/community', '/report']);
});

test('12 사이트맵 지역 URL은 각 페이지의 canonical과 정확히 같고 색인 대상이다', () => {
  const byPath = new Map<string, ReturnType<typeof cityReportSeo>>();
  byPath.set(cityReportSeo().canonicalPath!, cityReportSeo());
  for (const d of BUSAN_DISTRICTS) byPath.set(districtReportSeo(d.lawdCd).canonicalPath!, districtReportSeo(d.lawdCd));
  for (const r of buildLaunchRegionRoutes()) {
    const seo = byPath.get(r.path);
    assert.ok(seo, `사이트맵 경로에 대응하는 canonical이 없다: ${r.path}`);
    assert.equal(seo!.robots.index, true, `noindex 페이지가 사이트맵에 있다: ${r.path}`);
  }
  for (const r of buildDongRoutes(DONG_SAMPLE)) {
    const [, , , lawdCd, enc] = r.path.split('/');
    const row = DONG_SAMPLE.find((d) => d.lawdCd === lawdCd && d.dong === decodeURIComponent(enc))!;
    const seo = dongReportSeo(lawdCd, row.dong, row.count);
    assert.equal(seo.canonicalPath, r.path);
    assert.equal(seo.robots.index, true);
  }
  assert.ok(!buildDongRoutes(DONG_SAMPLE).some((r) => r.path.includes(encodeURIComponent('아미동2가'))), '표본 미달 동이 사이트맵에 있다');
});

// ── 13. 잘못된 지역 ────────────────────────────────────────────────────────

test('13 잘못된 지역은 지역 이름·canonical을 만들지 않고 noindex다', () => {
  for (const code of ['11680', '27110', '99999', '', 'abc']) {
    const s = districtReportSeo(code);
    assert.equal(s.title, '지역 리포트 | 이집');
    assert.equal(s.canonicalPath, null);
    assert.equal(s.heading, null);
    assert.deepEqual(s.robots, { index: false, follow: true });
    assert.ok(!/강남|남산|서구/.test(s.title + s.description));
  }
  // 거래 데이터에서 확인되지 않은 동(0건/조회 실패)은 URL의 동 이름을 제목에 싣지 않는다.
  for (const n of [0, null]) {
    const fake = dongReportSeo('26140', '가짜동', n);
    assert.equal(fake.title, '지역 리포트 | 이집');
    assert.ok(!fake.title.includes('가짜동') && !fake.description.includes('가짜동'));
    assert.equal(fake.robots.index, false);
    assert.equal(fake.canonicalPath, null);
  }
  assert.equal(dongReportSeo('11680', '역삼동', 400).robots.index, false, '부산 밖 코드의 동이 색인된다');
  assert.equal(buildRegionSeoName('DISTRICT', { sido: '가짜도', district: '서구' }), null);
  assert.equal(buildRegionSeoName('DISTRICT', { sido: '부산광역시' }), null, '구가 없는데 구 이름을 만들었다');
  assert.equal(buildRegionSeoName('DONG', { sido: '부산광역시', district: '서구', dong: '<script>' }), null);
  assert.equal(shortSidoName('Busan'), null);
});

// ── 14~15. 서울·경기 확장 ─────────────────────────────────────────────────

const DISTRICT_DATA = REPORT_AVAILABLE_DATA.DISTRICT;

test('14 서울 이름 — 광역시와 같은 시도+구 체계', () => {
  const cases: Array<[string, string]> = [
    ['강남구', '서울 강남구 아파트 시세·실거래가·거래량 | 이집'],
    ['송파구', '서울 송파구 아파트 시세·실거래가·거래량 | 이집'],
    ['마포구', '서울 마포구 아파트 시세·실거래가·거래량 | 이집'],
  ];
  for (const [district, title] of cases) {
    const m = buildRegionSeoMetadata({ level: 'DISTRICT', region: { sido: '서울특별시', district }, availableData: DISTRICT_DATA });
    assert.equal(m?.title, title);
    assert.equal(m?.heading, `서울 ${district} 아파트 시세·실거래가`);
  }
  assert.equal(
    buildRegionSeoMetadata({ level: 'DONG', region: { sido: '서울특별시', district: '강남구', dong: '대치동' }, availableData: REPORT_AVAILABLE_DATA.DONG })?.title,
    '서울 강남구 대치동 아파트 시세·실거래가 | 이집'
  );
});

test('15 경기 이름 — 시도+시+구 2단계, 길면 보조 키워드부터 줄인다', () => {
  const bundang = buildRegionSeoMetadata({ level: 'DISTRICT', region: { sido: '경기도', city: '성남시', district: '분당구' }, availableData: DISTRICT_DATA });
  assert.equal(bundang?.name, '경기 성남시 분당구');
  assert.equal(bundang?.title, '경기 성남시 분당구 아파트 시세·실거래가·거래량 | 이집');

  const yeongtong = buildRegionSeoMetadata({ level: 'DISTRICT', region: { sido: '경기도', city: '수원시', district: '영통구' }, availableData: DISTRICT_DATA });
  assert.equal(yeongtong?.title, '경기 수원시 영통구 아파트 시세·실거래가·거래량 | 이집');

  const ilsan = buildRegionSeoMetadata({ level: 'DISTRICT', region: { sido: '경기도', city: '고양시', district: '일산서구' }, availableData: DISTRICT_DATA });
  assert.equal(ilsan?.name, '경기 고양시 일산서구');
  assert.equal(ilsan?.title, '경기 고양시 일산서구 아파트 시세·실거래가·거래량 | 이집');
  assert.ok(ilsan!.title.length <= MAX_REGION_TITLE_CHARS);

  // 상한을 넘는 이름(경남 창원시 마산합포구)은 보조 키워드 "거래량"부터 뺀다.
  const masan = buildRegionSeoMetadata({ level: 'DISTRICT', region: { sido: '경상남도', city: '창원시', district: '마산합포구' }, availableData: DISTRICT_DATA });
  assert.equal(masan?.title, '경남 창원시 마산합포구 아파트 시세·실거래가 | 이집');
  assert.ok(masan!.title.length <= MAX_REGION_TITLE_CHARS);

  // 구가 없는 시(김포시)도 같은 함수로.
  assert.equal(
    buildRegionSeoMetadata({ level: 'DISTRICT', region: { sido: '경기도', city: '김포시' }, availableData: DISTRICT_DATA })?.name,
    '경기 김포시'
  );
  // 17개 시도 전부 짧은 이름을 갖는다(추측 없이 표).
  const sidos = Object.keys((require('../regions') as typeof import('../regions')).REGION_DATA);
  for (const s of sidos) assert.ok(shortSidoName(s), `${s}의 짧은 이름이 없다`);
});

// ── 16. 하드코딩 없음 ─────────────────────────────────────────────────────

test('16 구 이름을 SEO 코드에 반복해서 적지 않는다 — 단일 출처(BUSAN_DISTRICTS)에서만 나온다', () => {
  const names = BUSAN_DISTRICTS.map((d) => d.name).filter((n) => n.length >= 3); // '서구' 같은 짧은 이름은 문구에 우연히 섞인다
  const files = ['src/lib/seo/region-seo.ts', 'src/lib/seo/report-region-seo.ts', 'src/lib/seo/site-seo.ts', 'src/lib/seo/region-seo-read.ts', 'src/app/sitemap.ts', 'src/lib/sitemap-scope.ts', 'src/app/report/district/[lawdCd]/page.tsx', 'src/app/report/dong/[lawdCd]/[dong]/page.tsx', 'src/app/report/city/busan/page.tsx'];
  for (const f of files) {
    const code = codeOf(read(f));
    for (const n of names) assert.ok(!code.includes(`'${n}'`) && !code.includes(`${n} 아파트`), `${f}에 ${n}이 하드코딩돼 있다`);
    assert.ok(!/'26\d{3}'/.test(code), `${f}에 lawdCd가 하드코딩돼 있다`);
  }
  // 범용 템플릿에는 부산이 없다.
  assert.ok(!codeOf(read('src/lib/seo/region-seo.ts')).includes('부산'));
  assert.equal(districtNavLinks().length, 16);
  assert.deepEqual(dongNavLinks('26140', DONG_SAMPLE).map((l) => l.name), ['서대신동3가', '암남동']);
});

// ── 17. 사이트 이름 일관성 ────────────────────────────────────────────────

test('17 사이트 이름이 og:site_name·WebSite·Organization·앱 이름에서 같다', () => {
  assert.equal(BRAND_NAME, '이집');
  const site = buildWebSiteJsonLd(`${ORIGIN}/`);
  assert.equal(site.name, BRAND_NAME);
  assert.equal(site.url, `${ORIGIN}/`, '이중 슬래시/누락');
  assert.deepEqual(site.alternateName, ['E-JIP', '이집(E-JIP)']);
  assert.equal(buildOrganizationJsonLd(ORIGIN).name, BRAND_NAME);
  const layout = codeOf(read('src/app/layout.tsx'));
  assert.ok(/siteName: BRAND_NAME/.test(layout) && /applicationName: BRAND_NAME/.test(layout));
  assert.ok(/title: '이집',\s*statusBarStyle/.test(layout), '홈 화면 앱 이름이 바뀌었다');
  assert.ok(/name: BRAND_NAME,/.test(codeOf(read('src/config/site.ts'))));
  // 구조화 데이터는 홈에만 — 모든 페이지에 WebSite를 반복하지 않는다.
  assert.ok(/buildWebSiteJsonLd\(siteConfig\.url\)/.test(codeOf(read('src/app/page.tsx'))));
  assert.ok(!/buildWebSiteJsonLd/.test(codeOf(read('src/app/layout.tsx'))));
});

test('17 구조화 데이터에 부동산 가격·평점을 넣지 않고, 스크립트 탈출 문자를 막는다', () => {
  const crumbs = buildBreadcrumbJsonLd(ORIGIN, districtReportSeo('26140').breadcrumbs)!;
  const items = crumbs.itemListElement as Array<{ position: number; item: string; name: string }>;
  assert.deepEqual(items.map((i) => i.position), [1, 2, 3]);
  assert.equal(items[2].item, `${ORIGIN}/report/district/26140`);
  assert.equal(buildBreadcrumbJsonLd(ORIGIN, [{ name: '이집', path: '/' }]), null);
  const all = JSON.stringify([crumbs, buildWebSiteJsonLd(ORIGIN), buildOrganizationJsonLd(ORIGIN)]);
  assert.ok(!/price|offers|aggregateRating|ratingValue/i.test(all));
  const s = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
  assert.ok(!s.includes('<'), '`<`가 이스케이프되지 않았다');
});

// ── 18. 키워드 스터핑 회귀 ─────────────────────────────────────────────────

test('18 제목·H1·설명에 키워드 나열/없는 데이터가 없다', () => {
  const all = [
    cityReportSeo(),
    ...BUSAN_DISTRICTS.map((d) => districtReportSeo(d.lawdCd)),
    dongReportSeo('26140', '암남동', 25),
    dongReportSeo('26710', '기장읍 교리', 12),
  ];
  for (const s of all) {
    assert.ok(s.title.length <= MAX_REGION_TITLE_CHARS, `제목이 길다(${s.title.length}): ${s.title}`);
    assert.equal(s.title.split('아파트').length - 1, 1, `"아파트" 반복: ${s.title}`);
    assert.equal(s.title.split('이집').length - 1, 1, `브랜드 반복: ${s.title}`);
    const tokens = s.title.replace(' | 이집', '').split(/[\s·]+/);
    assert.equal(new Set(tokens).size, tokens.length, `같은 단어 반복: ${s.title}`);
    assert.ok(s.heading && !s.heading.includes('|') && s.heading.length <= 30, `H1이 키워드 나열이다: ${s.heading}`);
    // 지역 리포트에는 전세·월세·학군·분양 데이터가 없다 — 약속하지 않는다.
    assert.ok(!/전세|월세|학군|분양|갭|신고가/.test(s.title + s.description), `없는 데이터를 약속한다: ${s.title} / ${s.description}`);
    assert.equal(s.description.split('아파트').length - 1, 1, `설명에 "아파트" 반복: ${s.description}`);
  }
  // 16개 구 제목은 지역명만 다르다는 이유로 설명까지 복사되지 않는다 — 지역명이 들어간 자리가 실제로 다르다.
  const descs = BUSAN_DISTRICTS.map((d) => districtReportSeo(d.lawdCd).description);
  assert.equal(new Set(descs).size, 16);
});

test('18 H1은 페이지당 하나 — 시트는 heading 하나만 h1으로 렌더한다', () => {
  const sheet = codeOf(read('src/components/report/RegionReportSheet.tsx'));
  assert.ok(!/<h1/.test(sheet), '시트가 h1을 직접 추가했다(ReportHeader가 유일한 h1)');
  assert.ok(/title=\{h1\}/.test(sheet));
  assert.ok(/const h1 = heading \?\? title;/.test(sheet));
  // 공유/내보내기 제목은 기존 제품 문구 그대로다.
  assert.ok(/<ReportActions title=\{title\} envelope=\{envelope\} \/>/.test(sheet));
  // 지역 경로·하위 지역 링크는 내보내기 루트 밖에 있다.
  const exportRootAt = sheet.indexOf('data-export-root=""');
  assert.ok(sheet.indexOf('styles.regionCrumbs') < exportRootAt, '경로 표시가 공유 이미지 안에 들어간다');
  assert.ok(sheet.indexOf('styles.regionNav}') > sheet.indexOf('</article>'), '하위 지역 링크가 공유 이미지 안에 들어간다');
});

// ── 보조: 새 SEO 파일이 서버 전용 모듈을 순수 모듈에 끌어오지 않는다 ─────────

test('순수 SEO 모듈은 prisma를 import하지 않는다(DB 조회는 region-seo-read 하나)', () => {
  const dir = resolve(ROOT, 'src/lib/seo');
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (!statSync(full).isFile() || f.endsWith('.test.ts') || f === 'region-seo-read.ts') continue;
    assert.ok(!/@\/lib\/prisma|@prisma\/client/.test(readFileSync(full, 'utf8')), `${f}가 prisma를 import한다`);
  }
  const reader = codeOf(read('src/lib/seo/region-seo-read.ts'));
  assert.ok(/groupBy\(/.test(reader) && !/\.(create|update|upsert|delete)(Many)?\(/.test(reader), '읽기 전용이 아니다');
  assert.ok(/dealCanceled: false/.test(reader), '취소 거래 제외 규칙이 없다');
});
