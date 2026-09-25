import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GYEONGGI_BETA_ENABLED,
  GYEONGGI_BETA_ENABLEMENT,
  GYEONGGI_BETA_LAWDCDS,
  SEOUL_BETA_LAWDCDS,
  getRegionEnablement,
  isPublicRegionAllowed,
  simulateRegionEnablement,
  type RegionEnablement,
} from './enablement';
import { REGION_NODES } from './registry';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { decidePublicSeo } from '../seo/seoul-blocked-seo';
import { buildMasterCoordIndex, resolveApartmentCoords } from '../map-marker-coords';
import { toCanonicalCoordResult } from '../apt-canonical-coords';
import { shouldUseAttendanceZoneArtifact } from '../education/school-apartment-relations';
import { kindergartenEmptyMessage, kindergartenSummaryLabel } from '../education/education-ui-labels';
import { findDongRegcode } from '../apt-building-info';
import { buildDongRoutes, buildLaunchRegionRoutes } from '../sitemap-scope';
import { resolveSaleSyncScope } from '../sync/sale-sync-scope';
import { GYEONGGI_FIRST_BATCH } from '../../../scripts/national-backfill/gyeonggi-master-seed-logic';

// GYEONGGI_CRON_AND_PUBLIC_READINESS_AUDIT_V1 — 경기 beta 후보(스위치 OFF)와 공개 전 안전장치 회귀 테스트.
// "켜면"은 simulateRegionEnablement로만 본다 — Production 설정(GYEONGGI_BETA_ENABLED)은 false 그대로다.

const ROOT = resolve(__dirname, '../../..');
const code = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GG8 = GYEONGGI_BETA_LAWDCDS as readonly string[];
const SEOUL8 = SEOUL_BETA_LAWDCDS as readonly string[];
const GG_ALL = REGION_NODES.filter((n) => n.sidoCode === '41').map((n) => n.lawdCd);
const GG_OTHER = GG_ALL.filter((c) => !GG8.includes(c));
const SEOUL_BLOCKED = REGION_NODES.filter((n) => n.sidoCode === '11' && !SEOUL8.includes(n.lawdCd)).map((n) => n.lawdCd);
const ON = { seoulBeta: true, gyeonggiBeta: true } as const;
const NOW = { seoulBeta: true, gyeonggiBeta: false } as const;
const PUBLIC_AXES = ['app', 'search', 'map', 'detail', 'report', 'stats', 'sitemap', 'seoIndex'] as const;
const sim = (c: string, axis: keyof RegionEnablement, flags: { seoulBeta: boolean; gyeonggiBeta: boolean } = ON) => simulateRegionEnablement(c, flags)[axis];
const allowedSet = (axis: keyof RegionEnablement, flags = ON) => REGION_NODES.filter((n) => sim(n.lawdCd, axis, flags)).map((n) => n.lawdCd);

test('0. 현재 런타임: 경기 beta 스위치 OFF — 경기 전 축 닫힘, 시뮬레이션 NOW = 런타임', () => {
  assert.equal(GYEONGGI_BETA_ENABLED, false);
  for (const c of GG_ALL) for (const axis of PUBLIC_AXES) assert.equal(isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
  for (const n of REGION_NODES) assert.deepEqual(simulateRegionEnablement(n.lawdCd, NOW), getRegionEnablement(n.lawdCd), n.lawdCd);
});

test('1·17. 후보는 정확히 첫 배치 8구(MOLIT leaf, 41135 없음) — seed·cron 후보와 같은 목록', () => {
  assert.deepEqual([...GG8], ['41111', '41113', '41115', '41117', '41131', '41133', '41150', '41210']);
  assert.deepEqual([...GG8], [...GYEONGGI_FIRST_BATCH]);
  for (const c of GG8) assert.equal(REGION_NODES.find((n) => n.lawdCd === c)?.isMolitLeaf, true, c);
  assert.ok(!GG8.includes('41135'));
  // cron은 이번 STEP에서 바뀌지 않는다
  assert.equal(resolveSaleSyncScope('gyeonggi').ok, false);
});

test('1. 켜면: 8구 app·search·map·detail만 열리고 report·stats·sitemap·seoIndex·cronSync는 닫힘', () => {
  assert.deepEqual(GYEONGGI_BETA_ENABLEMENT, { app: true, search: true, map: true, detail: true, report: false, stats: false, sitemap: false, seoIndex: false, cronSync: false });
  for (const c of GG8) {
    for (const axis of ['app', 'search', 'map', 'detail'] as const) assert.equal(sim(c, axis), true, `${c} ${axis}`);
    for (const axis of ['report', 'stats', 'sitemap', 'seoIndex', 'cronSync'] as const) assert.equal(sim(c, axis), false, `${c} ${axis}`);
  }
});

test('2·3. 켜도 나머지 경기(부모 시 41110·41130 포함)와 41135는 전 축 닫힘', () => {
  assert.equal(GG_OTHER.length, GG_ALL.length - 8);
  for (const c of [...GG_OTHER, '41135', '41110', '41130']) for (const axis of PUBLIC_AXES) assert.equal(sim(c, axis), false, `${c} ${axis}`);
});

test('4·5. 켜면 검색·지도 allowlist = 부산 16 + 서울 8 + 경기 8 = 32, 그 밖 없음', () => {
  for (const axis of ['search', 'map'] as const) {
    const set = allowedSet(axis);
    assert.equal(set.length, 32, axis);
    assert.ok(set.every((c) => c.startsWith('26') || SEOUL8.includes(c) || GG8.includes(c)), axis);
  }
  // 소비자는 allowlist로만 판정한다(서울 deny-list 아님) — 이름으로 지역을 넓히지 않는다
  assert.ok(/sggCd: \{ in: \[\.\.\.publicAllowedLawdCds\('search'\)\] \}/.test(code('src/app/api/search/route.ts')));
  assert.ok(/if \(!isPublicRegionAllowed\(lawdCd, 'map'\)\)/.test(code('src/app/api/transactions/route.ts')));
});

test('6·14. null 좌표 master: aptSeq identity는 유지, 마커 좌표는 null(0,0·다른 단지 좌표 없음)', () => {
  const idx = buildMasterCoordIndex([
    { name: '태산', umdName: '오목천동', aptSeq: '41113-19', buildYear: 1990, latitude: null, longitude: null },
    { name: '다른단지', umdName: '오목천동', aptSeq: '41113-20', buildYear: 1995, latitude: 37.25, longitude: 126.95 },
  ] as never);
  assert.deepEqual(resolveApartmentCoords(idx, '오목천동', '태산'), { aptSeq: '41113-19', completionYear: 1990, lat: null, lng: null });
  // 이름 포함 관계로 다른 단지를 잡지 않는다(2순위 fallback 제거됨)
  assert.deepEqual(resolveApartmentCoords(idx, '오목천동', '태산아파트'), { aptSeq: null, completionYear: null, lat: null, lng: null });
});

test('7. 상세 canonical 좌표: aptSeq 행에 좌표가 없으면 NO_COORDINATE — 이름 검색으로 내려가지 않는다', () => {
  assert.equal(toCanonicalCoordResult({ aptSeq: '41113-19', latitude: null, longitude: null, geocodeQuality: 'failed', jibunAddress: null } as never, 'APT_SEQ').status, 'NO_COORDINATE');
  const src = code('src/lib/apt-canonical-coords.ts');
  assert.ok(/if \(byAptSeq\) return toCanonicalCoordResult\(byAptSeq, 'APT_SEQ'\);/.test(src));
});

test('8. 닫힌 지역은 live MOLIT 전에 끝난다(상세·지도)', () => {
  const detail = code('src/app/api/apt/[name]/route.ts');
  assert.ok(detail.indexOf("isPublicRegionAllowed(lawdCd, 'detail')") < detail.indexOf('fetchMolitMonthCached({'));
  const tx = code('src/app/api/transactions/route.ts');
  assert.ok(tx.indexOf("isPublicRegionAllowed(lawdCd, 'map')") < tx.indexOf('fetchMolitData({ lawdCd'));
});

test('9·10. 부산 전용 통학구역 artifact는 부산 밖 동명 학교에 쓰지 않는다(의정부 신곡초 ≠ 부산 신곡초)', () => {
  assert.equal(shouldUseAttendanceZoneArtifact({ canonicalNeisSchoolCode: '7150123', queryLawdCd: '41150' }), true, 'NEIS 코드 매칭은 이름 충돌이 없다');
  assert.equal(shouldUseAttendanceZoneArtifact({ canonicalNeisSchoolCode: null, queryLawdCd: '41150' }), false);
  assert.equal(shouldUseAttendanceZoneArtifact({ canonicalNeisSchoolCode: null, queryLawdCd: '11440' }), false);
  assert.equal(shouldUseAttendanceZoneArtifact({ canonicalNeisSchoolCode: null, queryLawdCd: '26350' }), true, '부산은 기존 동작');
  assert.equal(shouldUseAttendanceZoneArtifact({ canonicalNeisSchoolCode: null, queryLawdCd: '' }), true, 'lawdCd 없는 기존 링크 호환');
  const route = code('src/app/api/school/[id]/route.ts');
  assert.ok(route.indexOf('shouldUseAttendanceZoneArtifact(') < route.indexOf('getApartmentsForSchool('), 'artifact 조회가 지역 판정보다 먼저다');
  // 공식 학교 매칭은 시군구 코드(5자리 = 시도 포함)로 좁힌다
  assert.ok(/where: \{ schoolName: poiName, sigunguCode: lawdCd \}/.test(code('src/lib/education/nearby-education.ts')));
});

test('11. 가까운 학교·유치원 조회는 거리 상한이 있다(유치원 2km · 학교 3km · 점수 초등 1km)', () => {
  assert.ok(/const RADIUS_KM = 2;/.test(code('src/lib/education/nearby-education.ts')));
  assert.ok(/radius=3000&sort=distance/.test(code('src/app/api/apt/[name]/education/route.ts')));
  assert.ok(/categorySearch\('SC4', [^)]*1000/.test(code('src/lib/apartment-score/collectors/location.ts')));
});

test('11b. 데이터 없는 지역·좌표 없는 단지에 "없음"이라고 하지 않는다', () => {
  assert.equal(kindergartenSummaryLabel(0, { covered: false }), '준비 중');
  assert.equal(kindergartenSummaryLabel(0, { coordinateUnavailable: true, covered: false }), '확인 불가');
  assert.equal(kindergartenSummaryLabel(0, { covered: true }), '2km 이내 없음', '부산 기존 문구');
  assert.equal(kindergartenSummaryLabel(3, {}), '주변 3곳');
  assert.match(kindergartenEmptyMessage({ covered: false }), /준비 중/);
  const route = code('src/app/api/apt/[name]/education/route.ts');
  assert.ok(/coordinateMissing: apt\.latitude == null \|\| apt\.longitude == null/.test(route));
  assert.ok(/kindergartenCoverage: KINDERGARTEN_COVERED_SIDO\.has\(lawdCd\.slice\(0, 2\)\)/.test(route));
});

test('12. 점수는 지어내지 않는다: V2는 입지 피처 없으면 식별 부적격, 공개 안 된 지역은 UNSUPPORTED', () => {
  assert.ok(/const identityEligible = location != null && master\.sggCd != null && isCoordHigh;/.test(code('src/lib/score-v2/adapter.ts')));
  assert.ok(/emptyResponse\('UNSUPPORTED_REGION'\)/.test(code('src/app/api/apt/[name]/score/route.ts')));
});

test('13·14·15·16. 켜도 리포트·통계 닫힘, 상세 SEO는 noindex, sitemap 경기 0', () => {
  for (const c of GG8) {
    assert.equal(sim(c, 'report'), false);
    assert.equal(sim(c, 'stats'), false);
    // 켰을 때의 SEO 판정(시뮬레이션 기준): 상세는 열리되 NOINDEX, 리포트는 BLOCKED
    const blocked = (lawd: string, axis: keyof RegionEnablement) => !sim(lawd, axis);
    assert.equal(decidePublicSeo([c], 'detail', blocked), 'NOINDEX', c);
    assert.equal(decidePublicSeo([c], 'report', blocked), 'BLOCKED', c);
    // 현재 런타임은 BLOCKED
    assert.equal(decidePublicSeo([c], 'detail'), 'BLOCKED', c);
  }
  assert.equal(decidePublicSeo(['41135'], 'detail', (l, a) => !sim(l, a)), 'BLOCKED');
  const routes = [...buildLaunchRegionRoutes(), ...buildDongRoutes(GG8.map((lawdCd) => ({ lawdCd, dong: '정자동', count: 9999 })))].map((r) => decodeURIComponent(r.path));
  assert.deepEqual(routes.filter((p) => /41\d{3}|경기|수원|성남|의정부|광명/.test(p)), []);
});

test('18·19·20. 켜도 부산 16·서울 승인 8·차단 서울 17은 지금과 같다', () => {
  for (const c of [...BUSAN_LAWDCD_16, ...SEOUL8, ...SEOUL_BLOCKED]) {
    assert.deepEqual(simulateRegionEnablement(c, ON), getRegionEnablement(c), c);
  }
  assert.equal(SEOUL_BLOCKED.length, 17);
});

test('상세 보조 데이터는 지역을 맞춰 찾는다(부산·경기 동명 법정동 금곡동·중동·중앙동)', () => {
  const info = code('src/app/api/apt/[name]/info/route.ts');
  assert.ok(/where: \{ name: aptName, dong: dongKey, lawdCd \}/.test(info));
  assert.ok(/where: \{ dong: dongKey, jibun: effectiveJibun, lawdCd \}/.test(info));
  assert.ok(/if \(owner && owner\.lawdCd !== lawdCd\) throw new Error\('CACHE_ROW_OWNED_BY_OTHER_REGION'\)/.test(info), '다른 지역 캐시 행을 덮어쓴다');
  assert.ok(info.indexOf('CACHE_ROW_OWNED_BY_OTHER_REGION') < info.indexOf('prisma.apartment.upsert('));
  const fac = code('src/app/api/apt/[name]/facilities/route.ts');
  assert.ok(/\.\.\.\(lawdCd \? \{ lawdCd \} : \{\}\)/.test(fac));
  assert.ok(/if \(lawdCd && !isPublicRegionAllowed\(lawdCd, 'detail'\)\)/.test(fac));
});

test('건축물대장 법정동 코드: 마지막 토큰 정확 일치만(교동 ≠ 매교동), 여러 개면 null', () => {
  const regs = [
    { code: '4111500000', name: '경기도 수원시 팔달구' },
    { code: '4111512600', name: '경기도 수원시 팔달구 매교동' },
    { code: '4111512700', name: '경기도 수원시 팔달구 교동' },
  ];
  assert.equal(findDongRegcode(regs, '41115', '교동'), '4111512700');
  assert.equal(findDongRegcode(regs, '41115', '매교동'), '4111512600');
  assert.equal(findDongRegcode(regs, '41115', '팔달동'), null);
  assert.equal(findDongRegcode(regs, '41111', '교동'), null, '다른 구 코드로 찾지 않는다');
  assert.equal(findDongRegcode([...regs, { code: '4111599999', name: '경기도 수원시 팔달구 교동' }], '41115', '교동'), null, '모호하면 추측하지 않는다');
  assert.equal(findDongRegcode([{ code: '2635010500', name: '부산광역시 해운대구 우동' }], '26350', '우동'), '2635010500', '부산 기존 동작');
});
