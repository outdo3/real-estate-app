import assert from 'node:assert/strict';
import test, { before } from 'node:test';

// GYEONGGI_8_PUBLIC_BETA_PREVIEW_V1 — Preview 빌드와 같은 env로 enablement를 **새로 읽어** 실제 런타임 판정을 본다
// (시뮬레이션 함수가 아니라 isPublicRegionAllowed 등 공개 표면이 실제로 부르는 함수). 각 테스트 파일은 별도
// 프로세스라 이 env는 다른 테스트에 새지 않는다. Production DB·네트워크 0.

type E = typeof import('./enablement');
type R = typeof import('./registry');
let e: E;
let r: R;

const GG8 = ['41111', '41113', '41115', '41117', '41131', '41133', '41150', '41210'];
const OPEN_AXES = ['app', 'search', 'map', 'detail'] as const;
const CLOSED_AXES = ['report', 'stats', 'sitemap', 'seoIndex', 'cronSync'] as const;
const ALL_AXES = [...OPEN_AXES, ...CLOSED_AXES] as const;

before(async () => {
  process.env.NEXT_PUBLIC_VERCEL_ENV = 'preview';
  process.env.NEXT_PUBLIC_GYEONGGI_8_BETA_PREVIEW = 'true';
  e = await import('./enablement');
  r = await import('./registry');
});

const nodes = (sido: string) => r.REGION_NODES.filter((n) => n.sidoCode === sido).map((n) => n.lawdCd);

test('Preview env: 스위치 켜짐 · Production 스위치는 그대로 false', () => {
  assert.equal(e.GYEONGGI_8_BETA_PREVIEW_ENABLED, true);
  assert.equal(e.GYEONGGI_BETA_ENABLED, false);
  assert.deepEqual([...e.GYEONGGI_BETA_LAWDCDS], GG8);
});

test('Preview env: 경기 8구만 app·search·map·detail 열림 · report·stats·sitemap·seoIndex·cronSync 닫힘', () => {
  for (const c of GG8) {
    for (const axis of OPEN_AXES) assert.equal(e.isPublicRegionAllowed(c, axis), true, `${c} ${axis}`);
    for (const axis of CLOSED_AXES) assert.equal(e.isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
    assert.equal(e.isTradeDbFirstLawdCd(c), false, `${c} DB-first(cronSync)는 이 STEP에서 바꾸지 않는다`);
    assert.equal(e.isStatsEnabledLawdCd(c), false, c);
  }
});

test('Preview env: 41135(분당)·부모 시(41110 수원시·41130 성남시)·나머지 경기는 전 축 닫힘', () => {
  const others = nodes('41').filter((c) => !GG8.includes(c));
  assert.ok(others.includes('41135') && others.includes('41110') && others.includes('41130'));
  assert.ok(others.length >= 30, `경기 나머지 ${others.length}`);
  for (const c of others) for (const axis of ALL_AXES) assert.equal(e.isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
  // registry 밖·형태 오류 코드도 닫힘(접두사로 추측하지 않는다)
  for (const c of ['41000', '41112', '41999', '4111', '411110', '', null, undefined]) {
    assert.equal(e.isPublicRegionAllowed(c as string, 'search'), false, String(c));
  }
});

test('Preview env: 검색·지도 allowlist = 부산 16 + 서울 8 + 경기 8 = 32, 경기는 정확히 8구', () => {
  for (const axis of ['search', 'map', 'detail', 'app'] as const) {
    const allowed = e.publicAllowedLawdCds(axis);
    assert.equal(allowed.length, 32, axis);
    assert.deepEqual(allowed.filter((c) => c.startsWith('41')).sort(), [...GG8].sort(), axis);
    assert.deepEqual(allowed.filter((c) => c.startsWith('11')).sort(), [...e.SEOUL_BETA_LAWDCDS].sort(), axis);
    assert.equal(allowed.filter((c) => c.startsWith('26')).length, 16, axis);
    assert.equal(allowed.filter((c) => !/^(26|11|41)/.test(c)).length, 0, axis);
  }
  for (const axis of ['report', 'stats', 'sitemap', 'seoIndex'] as const) {
    assert.equal(e.publicAllowedLawdCds(axis).filter((c) => c.startsWith('41')).length, 0, axis);
  }
});

test('Preview env: 선택기 — 경기 시도는 보이고 "경기도 전체"는 없다, 구 목록은 정확히 8구', () => {
  assert.equal(e.isSidoPubliclyHidden('41'), false);
  assert.equal(e.isSidoPartiallyPublic('41'), true, '"경기도 전체" 버튼·질의 차단');
  assert.equal(e.isTradeDbFirstSido('41'), false);
  assert.equal(e.isStatsEnabledSido('41'), false);
  // RegionSelectModal.selectSido와 같은 필터를 REGCODE 형태(10자리) 행에 적용한다.
  const regcodes = [
    '4100000000', // 경기도 자체
    ...nodes('41').map((c) => `${c}00000`),
  ];
  const shown = regcodes
    .filter((code) => code.substring(0, 5) !== '41000')
    .filter((code) => e.isPublicRegionAllowed(code.substring(0, 5), 'app'))
    .map((code) => code.substring(0, 5));
  assert.deepEqual(shown.sort(), [...GG8].sort());
});

test('Preview env: 부산 전 축 그대로 · 서울 8구 그대로(report 닫힘) · 차단 서울 17구 그대로 닫힘', () => {
  for (const c of nodes('26')) for (const axis of ALL_AXES) assert.equal(e.isPublicRegionAllowed(c, axis), true, `${c} ${axis}`);
  assert.equal(e.isSidoPartiallyPublic('26'), false, '"부산광역시 전체" 유지');
  for (const c of e.SEOUL_BETA_LAWDCDS) {
    for (const axis of OPEN_AXES) assert.equal(e.isPublicRegionAllowed(c, axis), true, `${c} ${axis}`);
    assert.equal(e.isPublicRegionAllowed(c, 'report'), false, c);
    assert.equal(e.isTradeDbFirstLawdCd(c), true, `${c} 서울 8구 DB-first 유지`);
  }
  const seoulBlocked = nodes('11').filter((c) => !(e.SEOUL_BETA_LAWDCDS as readonly string[]).includes(c));
  assert.equal(seoulBlocked.length, 17);
  for (const c of seoulBlocked) for (const axis of ALL_AXES) assert.equal(e.isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
});

test('Preview env: SEO — 경기 8구 상세 NOINDEX(canonical 없음), 리포트 BLOCKED, 41135 상세 BLOCKED', async () => {
  const { decidePublicSeo } = await import('../seo/seoul-blocked-seo');
  for (const c of GG8) {
    assert.equal(decidePublicSeo([c], 'detail'), 'NOINDEX', c);
    assert.equal(decidePublicSeo([c, `${c}`], 'app'), 'NOINDEX', c);
    assert.equal(decidePublicSeo([c], 'report'), 'BLOCKED', c);
  }
  assert.equal(decidePublicSeo(['41135'], 'detail'), 'BLOCKED');
  // 조작 URL: 쿼리 lawdCd는 열린 구, aptSeq는 닫힌 구 → 덜 열린 쪽
  assert.equal(decidePublicSeo(['41111', '41135'], 'detail'), 'BLOCKED');
  assert.equal(decidePublicSeo(['26440'], 'detail'), 'NONE', '부산 색인 그대로');
});

test('Preview env: 리포트·비교 리포트 CTA — 경기 8구 없음, 부산 그대로, 섞이면 없음', async () => {
  const { publicAptReportHref, publicCompareReportHref } = await import('../report/report-links');
  for (const c of GG8) {
    assert.equal(publicAptReportHref(`${c}-1`), null, c);
    assert.equal(publicCompareReportHref(`${c}-1`, '26440-10'), null, c);
    assert.equal(publicCompareReportHref(`${c}-1`, `${GG8[0]}-2`), null, c);
  }
  assert.equal(publicAptReportHref('26440-10'), '/report/apt/26440-10');
  assert.notEqual(publicCompareReportHref('26440-10', '26350-20'), null);
});

test('Preview env: 지도 상단 안내 — 경기 8구 없음, 41135·나머지 경기 있음, lawdCd 모름은 없음', async () => {
  const { shouldShowMapRegionNotice } = await import('../map/apt-map-notice');
  for (const c of GG8) assert.equal(shouldShowMapRegionNotice(c), false, c);
  for (const c of ['41135', '41110', '41190', '41460']) assert.equal(shouldShowMapRegionNotice(c), true, c);
  assert.equal(shouldShowMapRegionNotice(null), false);
  assert.equal(shouldShowMapRegionNotice('26440'), false);
});

test('Preview env: 학교 지역 해석 — canonical lawdCd가 구 전체를 정한다(수원 4구·성남 2구 분리, 시 단위 합산 없음)', async () => {
  const { resolveSchoolRegionQuery, addressMatchesRegion } = await import('../neis-sido-codes');
  const want: Record<string, string> = {
    '41111': '수원시 장안구', '41113': '수원시 권선구', '41115': '수원시 팔달구', '41117': '수원시 영통구',
    '41131': '성남시 수정구', '41133': '성남시 중원구', '41150': '의정부시', '41210': '광명시',
  };
  for (const [c, sigungu] of Object.entries(want)) {
    const q = resolveSchoolRegionQuery('경기도 수원시', c);
    assert.deepEqual(q, { sido: '경기도', sigungu, source: 'LAWD_CD' }, c);
  }
  assert.equal(addressMatchesRegion('경기도 수원시 장안구 정자동 1', '', '수원시 장안구'), true);
  assert.equal(addressMatchesRegion('경기도 수원시 권선구 권선동 1', '', '수원시 장안구'), false);
  assert.equal(addressMatchesRegion('경기도 성남시 분당구 정자동 1', '', '성남시 수정구'), false);
  assert.equal(addressMatchesRegion('경기도 성남시 수정구 태평동 1', '', '성남시 중원구'), false);
});
