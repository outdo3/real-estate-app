import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GYEONGGI_BETA_LAWDCDS,
  SEOUL_17_BETA_LAWDCDS,
  SEOUL_17_ENABLEMENT,
  SEOUL_25_BETA_PREVIEW_ENABLED,
  SEOUL_BETA_LAWDCDS,
  getRegionEnablement,
  getSidoEnablement,
  isPublicRegionAllowed,
  isSidoPartiallyPublic,
  isSidoPubliclyHidden,
  isSidoWholeQuerySupported,
  publicAllowedLawdCds,
  resolveSeoul25PreviewFlag,
  simulateRegionEnablement,
  type RegionEnablement,
} from './enablement';
import { REGION_NODES } from './registry';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { decidePublicSeo } from '../seo/seoul-blocked-seo';
import { buildMasterCoordIndex, resolveApartmentCoords } from '../map-marker-coords';
import { toCanonicalCoordResult } from '../apt-canonical-coords';
import { shouldUseAttendanceZoneArtifact } from '../education/school-apartment-relations';
import { kindergartenSummaryLabel } from '../education/education-ui-labels';
import { findDongRegcode } from '../apt-building-info';
import { buildDongRoutes, buildLaunchRegionRoutes } from '../sitemap-scope';
import { resolveSaleSyncScope, SEOUL_SALE_SYNC_LAWDCDS } from '../sync/sale-sync-scope';
import { decideSupplyRegion, supplyCheckFrom } from '../stats/supply-region-gate';

// SEOUL_25_PUBLIC_BETA_PREP_V1 — Production과 같은 설정(Preview env 없음)에서 서울 17구는 전 축 닫힘이고,
// "켜면"은 simulateRegionEnablement(seoul17Open)로만 본다. Preview 빌드에서 실제로 켜진 상태는
// seoul-25-preview-on.test.ts(env를 넣고 모듈을 새로 읽음)가 본다.

const ROOT = resolve(__dirname, '../../..');
const code = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const S8 = SEOUL_BETA_LAWDCDS as readonly string[];
const S17 = SEOUL_17_BETA_LAWDCDS as readonly string[];
const SEOUL_ALL = REGION_NODES.filter((n) => n.sidoCode === '11').map((n) => n.lawdCd);
const GG_ALL = REGION_NODES.filter((n) => n.sidoCode === '41').map((n) => n.lawdCd);
const PUBLIC_AXES = ['app', 'search', 'map', 'detail', 'report', 'stats', 'sitemap', 'seoIndex'] as const;
const PREVIEW = { seoulBeta: true, gyeonggiBeta: false, seoul17Open: true } as const;
// SEOUL25_PRODUCTION_PUBLIC_ENABLE_V1 — 2026-09-30부터 Production도 17구 공개(Preview와 같은 프로필).
// GYEONGGI8_PRODUCTION_PUBLIC_ENABLE_V1 — 같은 날 경기 8구도 공개(gyeonggiBeta). 서울 판정은 경기 스위치와 독립.
const PROD = { seoulBeta: true, gyeonggiBeta: true, seoul17Open: true } as const;
const GG8 = GYEONGGI_BETA_LAWDCDS as readonly string[];
const sim = (c: string, axis: keyof RegionEnablement, flags: { seoulBeta: boolean; gyeonggiBeta: boolean; seoul17Open?: boolean } = PREVIEW) => simulateRegionEnablement(c, flags)[axis];
const REP = { 강남: '11680', 서초: '11650', 송파: '11710', 노원: '11350', 강서: '11500', 관악: '11620', 성북: '11290', 은평: '11380' } as const;

test('0 · 17구 목록 = 서울 25 − 공개 8 (중복·누락 없음, 전부 MOLIT leaf)', () => {
  assert.equal(S17.length, 17);
  assert.equal(new Set([...S8, ...S17]).size, 25);
  assert.deepEqual([...new Set([...S8, ...S17])].sort(), [...SEOUL_ALL].sort());
  for (const c of S17) assert.equal(REGION_NODES.find((n) => n.lawdCd === c)?.isMolitLeaf, true, c);
  for (const [name, c] of Object.entries(REP)) assert.equal(REGION_NODES.find((n) => n.lawdCd === c)?.name, `${name}구`, c);
});

test('1 · Preview 스위치는 두 값이 정확할 때만 켜진다(fail-closed)', () => {
  assert.equal(resolveSeoul25PreviewFlag('preview', 'true'), true);
  for (const [env, flag] of [
    ['production', 'true'], ['development', 'true'], [undefined, 'true'], ['', 'true'],
    ['preview', undefined], ['preview', ''], ['preview', 'TRUE'], ['preview', 'true '], ['preview', '1'], ['Preview', 'true'], [undefined, undefined],
  ] as const) assert.equal(resolveSeoul25PreviewFlag(env, flag), false, `${env}/${flag}`);
  // 이 테스트 런타임(= Production과 같은 기본 env): 꺼짐
  assert.equal(SEOUL_25_BETA_PREVIEW_ENABLED, false);
  // 인라인되도록 리터럴 process.env 참조여야 한다(동적 조회는 클라이언트 번들에서 빈 값)
  const src = code('src/lib/region/enablement.ts');
  assert.match(src, /resolveSeoul25PreviewFlag\(\s*process\.env\.NEXT_PUBLIC_VERCEL_ENV,\s*process\.env\.NEXT_PUBLIC_SEOUL_25_BETA_PREVIEW\s*\)/);
});

test('14 · Production 설정(2026-09-30 공개): 서울 17구는 앱·검색·지도·상세·DB 읽기만 · 공개 8구·부산 그대로 · 경기는 8구만(41135 닫힘)', () => {
  for (const c of S17) {
    for (const axis of ['app', 'search', 'map', 'detail', 'cronSync'] as const) assert.equal(isPublicRegionAllowed(c, axis), true, `${c} ${axis}`);
    for (const axis of ['report', 'stats', 'supply', 'sitemap', 'seoIndex'] as const) assert.equal(isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
    assert.equal(decidePublicSeo([c], 'detail'), 'NOINDEX', c);
    assert.equal(decidePublicSeo([c], 'report'), 'BLOCKED', c);
  }
  for (const c of S8) for (const axis of ['app', 'search', 'map', 'detail'] as const) assert.equal(isPublicRegionAllowed(c, axis), true, `${c} ${axis}`);
  for (const c of GG_ALL) {
    for (const axis of PUBLIC_AXES) {
      const open = GG8.includes(c) && (['app', 'search', 'map', 'detail'] as readonly string[]).includes(axis);
      assert.equal(isPublicRegionAllowed(c, axis), open, `${c} ${axis}`);
    }
  }
  for (const c of BUSAN_LAWDCD_16) for (const axis of PUBLIC_AXES) assert.equal(isPublicRegionAllowed(c, axis), true, `${c} ${axis}`);
  for (const axis of ['search', 'map', 'detail', 'app'] as const) {
    const set = publicAllowedLawdCds(axis);
    assert.equal(set.length, 16 + 8 + 17 + 8, axis); // + 경기 8구(2026-09-30)
    assert.ok(S17.every((c) => set.includes(c)), axis);
  }
  // SEOUL25_BETA_PREP_REBASE_COMPILE_FIX_V1 — supply(84e1c61): 17구·경기·서울 전체 닫힘, 공개 8구·부산 열림
  for (const c of S17) assert.equal(getRegionEnablement(c).supply, false, `${c} supply`);
  for (const c of GG_ALL) assert.equal(getRegionEnablement(c).supply, false, `${c} supply`);
  for (const c of S8) assert.equal(getRegionEnablement(c).supply, true, `${c} supply`);
  for (const c of BUSAN_LAWDCD_16) assert.equal(getRegionEnablement(c).supply, true, `${c} supply`);
  assert.equal(decideSupplyRegion('서울특별시', '강남구').allowed, false);
  assert.equal(decideSupplyRegion('서울특별시', null).allowed, false);
  assert.equal(decideSupplyRegion('경기도', null).allowed, false);
  assert.equal(decideSupplyRegion('서울특별시', '마포구').allowed, true);
  // 시뮬레이션 PROD(= Preview 스위치 없음) == 런타임
  for (const n of REGION_NODES) assert.deepEqual(simulateRegionEnablement(n.lawdCd, PROD), getRegionEnablement(n.lawdCd), n.lawdCd);
});

test('3 · "서울특별시 전체": 8구 부분 공개 · 25구 공개(시뮬레이션) 모두 없음 · 부산 전체 그대로 · 미출시 시도 그대로', () => {
  // 1) 지금(2026-09-30부터 25/25 공개): "일부 공개"는 아니지만 시도 단위 질의는 없다
  assert.equal(isSidoPartiallyPublic('11'), false);
  assert.equal(isSidoWholeQuerySupported('11'), false);
  // 2) 25/25: "일부 공개" 판정은 false가 되지만(= 예전 가드는 전체 버튼을 되살림) 시도 단위 질의는 여전히 미지원
  const open25 = SEOUL_ALL.filter((c) => sim(c, 'app')).length;
  assert.equal(open25, 25);
  const partially25 = open25 > 0 && open25 < SEOUL_ALL.length;
  assert.equal(partially25, false, '25구가 다 열리면 예전 가드(isSidoPartiallyPublic)는 "서울 전체"를 막지 못한다');
  assert.equal(simulateRegionEnablement(SEOUL_ALL[0], PREVIEW).app, true);
  // 새 가드는 시도 층을 본다 — 서울 시도 층은 어떤 스위치에서도 닫힘
  assert.equal(isSidoWholeQuerySupported('11'), false);
  // 3) 부산: 시도 층 출시 + 전 구 공개 → "부산광역시 전체" 유지
  assert.equal(isSidoWholeQuerySupported('26'), true);
  assert.equal(isSidoPartiallyPublic('26'), false);
  // 4) 미출시·모르는 시도
  for (const s of ['41', '27', '', null, undefined]) assert.equal(isSidoWholeQuerySupported(s), false, String(s));
  // 경기는 2026-09-30 8구 공개로 선택지에 나오지만 "경기도 전체"는 위에서처럼 없다
  assert.equal(isSidoPubliclyHidden('41'), false);
  assert.equal(isSidoPubliclyHidden('27'), true);
  // 선택기는 새 가드로만 "시도 전체"를 만든다(버튼·핸들러 둘 다)
  const modal = code('src/components/RegionSelectModal.tsx');
  assert.ok(/if \(!isSidoWholeQuerySupported\(sidoCode\)\) return;/.test(modal));
  assert.ok(/\{isSidoWholeQuerySupported\(selectedSido\?\.code\.substring\(0, 2\)\) && \(/.test(modal));
  assert.ok(!/isSidoPartiallyPublic/.test(modal), '선택기가 여전히 "일부 공개" 판정에 기댄다');
  // 서버 쪽 서울 전체 질의도 계속 닫힘(통계·피드는 시도 층 기반)
  const enable = code('src/lib/region/enablement.ts');
  assert.ok(!/'11': /.test(enable.slice(enable.indexOf('const ENABLEMENT_BY_SIDO'), enable.indexOf('export const SEOUL_BETA_LAWDCDS'))), '서울이 시도 층에 들어갔다');
});

test('2·4·5·6 · Preview 시뮬레이션: 25구 app·search·map·detail·DB 읽기 열림, report·stats·supply·sitemap·seoIndex 닫힘', () => {
  assert.deepEqual(SEOUL_17_ENABLEMENT, { app: true, search: true, map: true, detail: true, report: false, stats: false, supply: false, sitemap: false, seoIndex: false, cronSync: true });
  for (const c of SEOUL_ALL) {
    for (const axis of ['app', 'search', 'map', 'detail'] as const) assert.equal(sim(c, axis), true, `${c} ${axis}`);
    for (const axis of ['report', 'stats', 'sitemap', 'seoIndex'] as const) assert.equal(sim(c, axis), false, `${c} ${axis}`);
  }
  // SEOUL25_BETA_PREP_REBASE_COMPILE_FIX_V1 — supply(청약홈): Preview 17구는 닫힘, 공개 8구는 기존 정책대로 열림
  for (const c of S17) assert.equal(sim(c, 'supply'), false, `${c} supply`);
  for (const c of S8) assert.equal(sim(c, 'supply'), true, `${c} supply`);
  const previewSupply = supplyCheckFrom((c) => simulateRegionEnablement(c, PREVIEW), getSidoEnablement);
  assert.equal(decideSupplyRegion('서울특별시', '강남구', previewSupply).allowed, false, 'Preview 17구 공급');
  assert.equal(decideSupplyRegion('서울특별시', '마포구', previewSupply).allowed, true, 'Preview 8구 공급');
  assert.equal(decideSupplyRegion('서울특별시', null, previewSupply).allowed, false, 'Preview 서울 전체 공급');
  assert.equal(decideSupplyRegion('경기도', '수원시 장안구', previewSupply).allowed, false, 'Preview 경기 공급');
  // SEOUL25_PREVIEW_READ_ONLY_DB_V1 — cronSync = DB-first 읽기 스위치: Preview 17구는 적재 데이터를 읽는다(쓰기·cron 없음), 공개 8구는 그대로 열림
  for (const c of S17) assert.equal(sim(c, 'cronSync'), true, c);
  for (const c of S8) assert.equal(sim(c, 'cronSync'), true, c);
  // 검색·지도 allowlist = 부산 16 + 서울 25, 경기·그 밖 없음
  for (const axis of ['search', 'map', 'detail'] as const) {
    const set = REGION_NODES.filter((n) => sim(n.lawdCd, axis)).map((n) => n.lawdCd);
    assert.equal(set.length, 41, axis);
    assert.ok(set.every((c) => c.startsWith('26') || SEOUL_ALL.includes(c)), axis);
  }
  // 경기·registry 밖 코드는 Preview에서도 닫힘
  for (const c of [...GG_ALL, '27110', '99999', '1168', '11680x']) for (const axis of PUBLIC_AXES) assert.equal(sim(c, axis), false, `${c} ${axis}`);
  // Preview 스위치만 켜고 서울 beta가 꺼지면 25구 전부 닫힘(서울 마스터 스위치가 우선)
  for (const c of SEOUL_ALL) assert.equal(simulateRegionEnablement(c, { seoulBeta: false, gyeonggiBeta: false, seoul17Open: true }).app, false, c);
});

test('4 · 검색: 공개 allowlist(sggCd IN) 하나로만 좁힌다 — 이름·시도 전체 fallback 없음', () => {
  const s = code('src/app/api/search/route.ts');
  assert.ok(/const regionScope = \{ sggCd: \{ in: \[\.\.\.publicAllowedLawdCds\('search'\)\] \} \};/.test(s));
  assert.ok(/isPublicRegionAllowed\(o\.sggCd, 'search'\)/.test(s), '오피스텔 결과도 같은 축');
  assert.ok(/isPublicRegionAllowed\(m\.sggCd, 'search'\)/.test(code('src/lib/search-alias-fallback.ts')), '별칭 fallback도 같은 축');
  assert.ok(/sggCd: \{ in: \[\.\.\.publicAllowedLawdCds\('app'\)\] \}/.test(code('src/lib/nearby-apartments.ts')), '주변 단지도 allowlist');
});

test('5 · 지도: 닫힌 구는 MOLIT 전에 regionUnsupported · 17구 Preview는 DB-first가 아니다(live 경로) · null 좌표는 마커 없음', () => {
  const tx = code('src/app/api/transactions/route.ts');
  assert.ok(tx.indexOf("if (!isPublicRegionAllowed(lawdCd, 'map'))") < tx.indexOf('fetchMolitData({ lawdCd'));
  assert.ok(/regionUnsupported: true/.test(tx));
  assert.ok(/const isDbFirstEligible = isMapMarkerShape && isTradeDbFirstLawdCd\(lawdCd\);/.test(tx));
  // 마커 좌표: 같은 동·정확 이름 master만, null 좌표면 null(0,0·다른 단지 좌표 없음)
  const idx = buildMasterCoordIndex([
    { name: '래미안', umdName: '대치동', aptSeq: '11680-1', buildYear: 2000, latitude: null, longitude: null },
    { name: '다른단지', umdName: '대치동', aptSeq: '11680-2', buildYear: 2001, latitude: 37.49, longitude: 127.06 },
    { name: '래미안', umdName: '상계동', aptSeq: '11350-9', buildYear: 1995, latitude: 37.65, longitude: 127.06 },
  ] as never);
  assert.deepEqual(resolveApartmentCoords(idx, '대치동', '래미안'), { aptSeq: '11680-1', completionYear: 2000, lat: null, lng: null }, '다른 구 동명 단지 좌표를 빌리지 않는다');
  assert.deepEqual(resolveApartmentCoords(idx, '대치동', '래미안아파트'), { aptSeq: null, completionYear: null, lat: null, lng: null }, '이름 포함 관계로 잡지 않는다');
});

test('6 · 상세: 공개 게이트가 MOLIT·DB보다 먼저 · DB-first는 aptSeq 구 코드의 cronSync(17구 Preview는 DB만) · 좌표 없으면 NO_COORDINATE', () => {
  const d = code('src/app/api/apt/[name]/route.ts');
  assert.ok(d.indexOf("isPublicRegionAllowed(lawdCd, 'detail')") < d.indexOf('fetchMolitMonthCached({'));
  assert.ok(/if \(aptSeq && isTradeDbFirstLawdCd\(aptSeq\.slice\(0, 5\)\)\)/.test(d));
  for (const r of ['info', 'education', 'score']) assert.ok(/isPublicRegionAllowed\(/.test(code(`src/app/api/apt/[name]/${r}/route.ts`)), r);
  assert.equal(toCanonicalCoordResult({ aptSeq: '11680-1', latitude: null, longitude: null, geocodeQuality: 'failed', jibunAddress: null } as never, 'APT_SEQ').status, 'NO_COORDINATE');
  assert.ok(/emptyResponse\('UNSUPPORTED_REGION'\)/.test(code('src/app/api/apt/[name]/score/route.ts')));
  assert.ok(/const identityEligible = location != null && master\.sggCd != null && isCoordHigh;/.test(code('src/lib/score-v2/adapter.ts')), '입지 피처 없으면 점수 부적격(지어내지 않음)');
});

test('7·8 · 리포트·통계·SEO·sitemap: Preview에서도 닫힘 · 상세는 NOINDEX · sitemap 서울 0', () => {
  const blocked = (lawd: string, axis: keyof RegionEnablement) => !sim(lawd, axis);
  for (const c of SEOUL_ALL) {
    assert.equal(decidePublicSeo([c], 'detail', blocked), 'NOINDEX', c);
    assert.equal(decidePublicSeo([c], 'report', blocked), 'BLOCKED', c);
    assert.equal(decidePublicSeo([c], 'app', blocked), 'NOINDEX', c);
  }
  // 리포트 페이지·비교 리포트는 report 축으로 게이트
  assert.ok(/isPublicRegionAllowed\(reportLawdCd, 'report'\)/.test(code('src/app/report/apt/[aptSeq]/page.tsx')));
  assert.ok(/isPublicRegionAllowed\(master\.sggCd, 'report'\)/.test(code('src/lib/report/compare-read.ts')));
  const routes = [...buildLaunchRegionRoutes(), ...buildDongRoutes(SEOUL_ALL.map((lawdCd) => ({ lawdCd, dong: '역삼동', count: 9999 })))].map((r) => decodeURIComponent(r.path));
  assert.deepEqual(routes.filter((p) => /11\d{3}|서울|강남|노원|관악/.test(p)), []);
  assert.ok(routes.length > 0, '부산 sitemap 경로는 그대로');
  assert.ok(/buildLaunchRegionRoutes\(\)/.test(code('src/app/sitemap.ts')));
});

test('9 · 학교·위치: 부산 전용 artifact·유치원·동 코드가 서울 대표 구에 붙지 않는다', () => {
  for (const c of Object.values(REP)) {
    assert.equal(shouldUseAttendanceZoneArtifact({ canonicalNeisSchoolCode: null, queryLawdCd: c }), false, c);
    assert.equal(kindergartenSummaryLabel(0, { covered: false }), '준비 중');
  }
  assert.ok(/kindergartenCoverage: KINDERGARTEN_COVERED_SIDO\.has\(lawdCd\.slice\(0, 2\)\)/.test(code('src/app/api/apt/[name]/education/route.ts')));
  assert.ok(/where: \{ schoolName: poiName, sigunguCode: lawdCd \}/.test(code('src/lib/education/nearby-education.ts')), '공식 학교 매칭은 시군구 코드 정확 일치');
  // 서울 동명 법정동(신사동: 강남 11680 · 관악 11620) — 구 코드와 마지막 토큰 정확 일치만
  const regs = [
    { code: '1168010700', name: '서울특별시 강남구 신사동' },
    { code: '1162010200', name: '서울특별시 관악구 신사동' },
    { code: '1168010600', name: '서울특별시 강남구 대치동' },
  ];
  assert.equal(findDongRegcode(regs, '11680', '신사동'), '1168010700');
  assert.equal(findDongRegcode(regs, '11620', '신사동'), '1162010200');
  assert.equal(findDongRegcode(regs, '11680', '사동'), null, '부분 문자열로 잡지 않는다');
  const info = code('src/app/api/apt/[name]/info/route.ts');
  assert.ok(/if \(owner && owner\.lawdCd !== lawdCd\) throw new Error\('CACHE_ROW_OWNED_BY_OTHER_REGION'\)/.test(info));
});

// SEOUL25_GO_LIVE_PREP_V1 — cron 확장은 main 377acf7에서 적용·배포됐다(SEOUL_17_CRON_EXPANSION_V1). 서울 8구 scope는 그대로.
test('13 · cron: 서울 8구 scope 불변 + 17구는 seoul-b 9 · seoul-c 8 별도 scope(공개 스위치와 무관)', () => {
  const seoul = resolveSaleSyncScope('seoul');
  assert.deepEqual(seoul.ok ? [...(seoul.lawdCds ?? [])].sort() : null, [...S8].sort());
  assert.deepEqual([...SEOUL_SALE_SYNC_LAWDCDS].sort(), [...S8].sort());
  const b = resolveSaleSyncScope('seoul-b'); const c = resolveSaleSyncScope('seoul-c');
  assert.ok(b.ok && c.ok);
  assert.deepEqual([...((b.ok && b.lawdCds) || []), ...((c.ok && c.lawdCds) || [])].sort(), [...S17].sort());
  const crons = (JSON.parse(readFileSync(resolve(ROOT, 'vercel.json'), 'utf8')).crons as { path: string }[]).map((x) => x.path);
  assert.equal(crons.length, 11);
  assert.equal(crons.filter((p) => /scope=seoul-b|scope=seoul-c/.test(p)).length, 4);
});

test('7 · 리포트 CTA: 리포트 미지원 지역(서울 25 전부)에서는 상세·비교 CTA를 만들지 않는다 · 부산은 그대로', async () => {
  const { isReportRegionOpen } = await import('../report/report-links');
  for (const c of SEOUL_ALL) assert.equal(isReportRegionOpen(`${c}-123`), false, c);
  for (const c of BUSAN_LAWDCD_16) assert.equal(isReportRegionOpen(`${c}-1`), true, c);
  for (const bad of [null, undefined, '', '래미안', '11680', '11680-', 'x11680-1', '26140-1 ']) assert.equal(isReportRegionOpen(bad as never), bad === '26140-1 ', String(bad));
  const detail = code('src/app/apt/[name]/apt-client.tsx');
  assert.ok(/const reportHref = isReportRegionOpen\(canonicalAptSeq\) \? aptReportHref\(canonicalAptSeq\) : null;/.test(detail));
  const cmp = code('src/components/compare/CompareV2.tsx');
  assert.ok(/const compareReportUrl = both && isReportRegionOpen\(seqA\) && isReportRegionOpen\(seqB\) \? compareReportHref\(seqA, seqB\) : null;/.test(cmp));
});

