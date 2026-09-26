import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GYEONGGI_BETA_ENABLED,
  GYEONGGI_BETA_LAWDCDS,
  SEOUL_BETA_LAWDCDS,
  isPublicRegionAllowed,
  simulateRegionEnablement,
  type RegionEnablement,
} from './enablement';
import { REGION_NODES, getRegionByLawdCd } from './registry';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import {
  APT_MAP_UNSUPPORTED_REGION_MESSAGE,
  APT_MAP_ZERO_MESSAGE,
  APT_MAP_ERROR_MESSAGE,
  APT_MAP_PARTIAL_MESSAGE,
  MAP_REGION_NOTICE_BODY,
  MAP_REGION_NOTICE_TITLE,
  resolveAptMapNotice,
  shouldShowMapRegionNotice,
} from '../map/apt-map-notice';
import { resolveTransactionsReadState } from '../trade-read-state';
import { publicAptReportHref, publicCompareReportHref, aptReportHref } from '../report/report-links';
import {
  addressMatchesRegion,
  dongTokenAfterSigungu,
  resolveSchoolRegionQuery,
  schoolBelongsToRegion,
} from '../neis-sido-codes';
import { buildMasterCoordIndex, resolveApartmentCoords } from '../map-marker-coords';
import { hasUsableHandoffCoords } from '../map-property-focus';

// GYEONGGI_PUBLIC_BETA_BLOCKER_FIX_PREP_V1 — 경기 beta 공개 전 blocker 4건 + null 좌표 UX 회귀 테스트.
// "켜면"은 simulateRegionEnablement로만 본다 — Production 스위치(GYEONGGI_BETA_ENABLED)는 false 그대로다.

const ROOT = resolve(__dirname, '../../..');
const code = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const codeNoJsxComments = (p: string) => code(p).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const GG8 = GYEONGGI_BETA_LAWDCDS as readonly string[];
const SEOUL8 = SEOUL_BETA_LAWDCDS as readonly string[];
const BUSAN16 = BUSAN_LAWDCD_16 as readonly string[];
const GG_OTHER = REGION_NODES.filter((n) => n.sidoCode === '41' && !GG8.includes(n.lawdCd)).map((n) => n.lawdCd);
const SEOUL_BLOCKED = REGION_NODES.filter((n) => n.sidoCode === '11' && !SEOUL8.includes(n.lawdCd)).map((n) => n.lawdCd);
const NOW = { seoulBeta: true, gyeonggiBeta: false } as const;
const ON = { seoulBeta: true, gyeonggiBeta: true } as const;
const allowWith = (flags: { seoulBeta: boolean; gyeonggiBeta: boolean }) =>
  (lawdCd: string, axis: keyof RegionEnablement) => simulateRegionEnablement(lawdCd, flags)[axis];
const aptSeq = (lawdCd: string) => `${lawdCd}-1`;

test('0. Production 스위치는 그대로 OFF — 이 STEP은 경기를 열지 않는다', () => {
  assert.equal(GYEONGGI_BETA_ENABLED, false);
  const src = code('src/lib/region/enablement.ts');
  assert.ok(/export const GYEONGGI_BETA_ENABLED = false;/.test(src));
  assert.ok(!/'41': /.test(src), '시도 층에 경기가 들어갔다');
});

// ── BLOCKER 1 — 공개되지 않은 지역 지도 상태 ────────────────────────────────

test('1. regionUnsupported 응답은 "지원하지 않는 지역" 안내가 된다(0건 문구가 아니다)', () => {
  const st = resolveTransactionsReadState(true, { transactions: [], regionUnsupported: true, partial: false });
  assert.equal(st.regionUnsupported, true);
  const n = resolveAptMapNotice({ layerOn: true, status: 'ready', partial: false, regionUnsupported: st.regionUnsupported === true, markerCount: st.trades.length });
  assert.deepEqual(n, { text: APT_MAP_UNSUPPORTED_REGION_MESSAGE, tone: 'info' });
  assert.ok(!/없습니다|거래 없음|데이터 없음/.test(APT_MAP_UNSUPPORTED_REGION_MESSAGE), '미지원을 "없음"으로 말한다');
});

test('2. 진짜 0건 · 미지원 · 실패 · 부분 실패는 서로 다른 문구다', () => {
  const base = { layerOn: true, status: 'ready' as const, partial: false, regionUnsupported: false, markerCount: 0 };
  const zero = resolveAptMapNotice(base);
  const unsupported = resolveAptMapNotice({ ...base, regionUnsupported: true });
  const error = resolveAptMapNotice({ ...base, status: 'error' });
  const partial = resolveAptMapNotice({ ...base, partial: true });
  assert.equal(zero?.text, APT_MAP_ZERO_MESSAGE);
  assert.equal(unsupported?.text, APT_MAP_UNSUPPORTED_REGION_MESSAGE);
  assert.equal(error?.text, APT_MAP_ERROR_MESSAGE);
  assert.equal(partial?.text, APT_MAP_PARTIAL_MESSAGE);
  assert.equal(new Set([zero?.text, unsupported?.text, error?.text, partial?.text]).size, 4);
  // 검증된 0건 응답(regionUnsupported 없음)은 계속 0건이다.
  const zeroState = resolveTransactionsReadState(true, { transactions: [], partial: false });
  assert.equal(zeroState.regionUnsupported, undefined);
  // 레이어가 꺼져 있거나 로딩 중이면 아무 말도 하지 않는다(기존 동작).
  assert.equal(resolveAptMapNotice({ ...base, layerOn: false, regionUnsupported: true }), null);
  assert.equal(resolveAptMapNotice({ ...base, status: 'loading', regionUnsupported: true }), null);
  // 마커가 있으면 안내 없음(기존 동작).
  assert.equal(resolveAptMapNotice({ ...base, markerCount: 3 }), null);
});

test('2b. 지도 페이지가 regionUnsupported를 읽고 캐시에도 보존한다', () => {
  const map = code('src/app/map/page.tsx');
  assert.ok(/const regionUnsupported = txState\.regionUnsupported === true;/.test(map));
  assert.ok(/setAptRegionUnsupported\(cached\.regionUnsupported\)/.test(map), '캐시 히트에서 미지원이 0건으로 바뀐다');
  assert.ok(/resolveAptMapNotice\(\{/.test(map));
  assert.ok(!/현재 지도 범위에 표시할 아파트가 없습니다/.test(map), '0건 문구가 페이지에 따로 남아 있다');
});

// ── BLOCKER 2 — 부산 전용 지도 문구 ────────────────────────────────────────

test('3. 지도 안내에서 부산 전용 문구가 사라졌다', () => {
  const notice = codeNoJsxComments('src/components/map/OutOfBusanNotice.tsx');
  const map = codeNoJsxComments('src/app/map/page.tsx');
  for (const src of [notice, map]) {
    assert.ok(!/부산 외 지역|부산 지역 데이터를 우선|부산 데이터를 우선/.test(src), '부산 전용 문구가 남아 있다');
  }
  for (const text of [MAP_REGION_NOTICE_TITLE, MAP_REGION_NOTICE_BODY, APT_MAP_UNSUPPORTED_REGION_MESSAGE]) {
    assert.ok(!/부산|서울|경기/.test(text), `특정 시도를 말한다: ${text}`);
  }
  assert.ok(!/isInsideBusanBounds/.test(notice), '판정이 아직 부산 좌표 상자다');
});

test('3b. 상단 지역 안내: 공개 지역(부산·서울 beta)에는 뜨지 않고, 닫힌 지역에만 뜬다', () => {
  for (const c of BUSAN16) assert.equal(shouldShowMapRegionNotice(c), false, `부산 ${c}`);
  for (const c of SEOUL8) assert.equal(shouldShowMapRegionNotice(c), false, `서울 beta ${c}`);
  for (const c of SEOUL_BLOCKED) assert.equal(shouldShowMapRegionNotice(c), true, `차단 서울 ${c}`);
  for (const c of [...GG8, ...GG_OTHER]) assert.equal(shouldShowMapRegionNotice(c), true, `경기(현재 OFF) ${c}`);
  assert.equal(shouldShowMapRegionNotice('27110'), true, 'registry 밖 전국(대구)');
  // 지역을 아직 모르면 "미지원"이라 하지 않는다.
  assert.equal(shouldShowMapRegionNotice(null), false);
  assert.equal(shouldShowMapRegionNotice(''), false);
});

// ── BLOCKER 3 — 리포트 진입 CTA ───────────────────────────────────────────

test('4. 리포트 CTA: 부산은 그대로 노출(기존 route 동일)', () => {
  for (const c of BUSAN16) assert.equal(publicAptReportHref(aptSeq(c)), aptReportHref(aptSeq(c)), c);
  assert.equal(publicAptReportHref('26140-1164'), '/report/apt/26140-1164');
  assert.equal(publicCompareReportHref('26140-1164', '26140-1356'), '/report/compare?a=26140-1164&b=26140-1356');
});

test('5. 리포트 CTA: 서울 beta 8구는 숨김(report 축 닫힘), 차단 서울도 숨김', () => {
  for (const c of [...SEOUL8, ...SEOUL_BLOCKED]) assert.equal(publicAptReportHref(aptSeq(c)), null, c);
  assert.equal(publicCompareReportHref('26140-1164', '11440-1'), null, '한쪽이라도 닫히면 비교 리포트 CTA 없음');
  assert.equal(publicCompareReportHref('11440-1', '26140-1164'), null);
});

test('6. 리포트 CTA: 경기 beta 8구는 현재도, 켜도(시뮬레이션) 숨김', () => {
  for (const c of GG8) {
    assert.equal(publicAptReportHref(aptSeq(c)), null, `현재 ${c}`);
    assert.equal(publicAptReportHref(aptSeq(c), allowWith(ON)), null, `켜면 ${c}`);
    assert.equal(publicCompareReportHref(aptSeq(c), '26140-1164', allowWith(ON)), null, `켜면 비교 ${c}`);
  }
  // 켜도 부산은 그대로 열려 있다.
  assert.equal(publicAptReportHref('26140-1164', allowWith(ON)), '/report/apt/26140-1164');
});

test('6b. 리포트 CTA는 canonical aptSeq로만 판정한다 — 형태가 아니면 fail-closed, 상세·비교가 게이트를 쓴다', () => {
  assert.equal(publicAptReportHref(null), null);
  assert.equal(publicAptReportHref('롯데캐슬'), null);
  assert.equal(publicAptReportHref('2614-1'), null);
  assert.equal(publicAptReportHref('99999-1'), null, 'registry 밖 코드');
  assert.ok(/const reportHref = publicAptReportHref\(canonicalAptSeq\);/.test(code('src/app/apt/[name]/apt-client.tsx')));
  assert.ok(/publicCompareReportHref\(/.test(code('src/components/compare/CompareV2.tsx')));
  const links = code('src/lib/report/report-links.ts');
  assert.ok(!/pathname|startsWith\('11'\)|서울/.test(links), '경로·시도 하드코딩으로 판정한다');
});

// ── BLOCKER 4 — 학교 시/군/구 파싱 ────────────────────────────────────────

const GG_GU: Record<string, string> = {
  '41111': '수원시 장안구',
  '41113': '수원시 권선구',
  '41115': '수원시 팔달구',
  '41117': '수원시 영통구',
  '41131': '성남시 수정구',
  '41133': '성남시 중원구',
  '41135': '성남시 분당구',
};
const school = (name: string, addr: string) => ({ SCHUL_NM: name, ORG_RDNMA: addr, LCTN_SC_NM: '경기도' });
const CORPUS = Object.entries(GG_GU).map(([c, gu]) => school(`${c}초등학교`, `경기도 ${gu} 어떤로 ${c.slice(3)}`));

test('7. 수원 4개 일반구는 서로 다른 지역이다(41111 ≠ 41113 ≠ 41115 ≠ 41117)', () => {
  const suwon = ['41111', '41113', '41115', '41117'];
  const resolved = suwon.map((c) => resolveSchoolRegionQuery(`경기도 ${GG_GU[c]}`, c));
  assert.deepEqual(resolved.map((r) => r.sigungu), suwon.map((c) => GG_GU[c]));
  assert.ok(resolved.every((r) => r.sido === '경기도' && r.source === 'LAWD_CD'));
  assert.equal(new Set(resolved.map((r) => r.sigungu)).size, 4);
  for (const c of suwon) {
    const shown = CORPUS.filter((s) => schoolBelongsToRegion(s, `경기도 ${GG_GU[c]}`, GG_GU[c]));
    assert.deepEqual(shown.map((s) => s.SCHUL_NM), [`${c}초등학교`], c);
  }
  // lawdCd 없이 이름만 와도 시 + 일반구 전체를 유지한다(예전: "수원시"로 잘림).
  assert.equal(resolveSchoolRegionQuery('경기도 수원시 장안구').sigungu, '수원시 장안구');
});

test('8. 성남 2개 일반구도 분리되고(41131 ≠ 41133), 분당 41135도 섞이지 않는다', () => {
  for (const c of ['41131', '41133']) {
    const q = resolveSchoolRegionQuery(`경기도 ${GG_GU[c]}`, c);
    assert.equal(q.sigungu, GG_GU[c]);
    const shown = CORPUS.filter((s) => schoolBelongsToRegion(s, `경기도 ${q.sigungu}`, q.sigungu));
    assert.deepEqual(shown.map((s) => s.SCHUL_NM), [`${c}초등학교`], c);
  }
});

test('9. 다른 일반구로 넘어가는 매칭이 없다 — 시 이름만·부분 문자열·순서 뒤바뀜 모두 거부', () => {
  const jangan = '경기도 수원시 장안구 정자로 1';
  assert.equal(addressMatchesRegion(jangan, '', '수원시 장안구'), true);
  assert.equal(addressMatchesRegion(jangan, '', '수원시 권선구'), false);
  assert.equal(addressMatchesRegion('경기도 수원시 권선구 권선로 1', '', '수원시 장안구'), false);
  assert.equal(addressMatchesRegion('경기도 성남시 분당구 판교로 1', '', '성남시 수정구'), false);
  assert.equal(addressMatchesRegion('경기도 성남시 중원구 광명로 1', '', '성남시 수정구'), false);
  assert.equal(addressMatchesRegion('경기도 수원시장안구 정자로 1', '', '수원시 장안구'), false, '토큰 경계 없이 붙은 문자열');
  assert.equal(addressMatchesRegion('경기도 장안구 수원시 1', '', '수원시 장안구'), false, '순서가 다르면 아니다');
  assert.equal(addressMatchesRegion('서울특별시 동대문구 장안동 1', '', '수원시 장안구'), false);
  // 모든 쌍: 한 구의 학교가 다른 구 목록에 들어가지 않는다.
  for (const [a, guA] of Object.entries(GG_GU)) {
    for (const [b, guB] of Object.entries(GG_GU)) {
      if (a === b) continue;
      assert.equal(addressMatchesRegion(`경기도 ${guA} 어떤로 1`, '', guB), false, `${a} → ${b}`);
    }
  }
  // canonical lawdCd가 이름과 다르면 **코드가 이긴다**(이름을 잘라 합치지 않는다).
  const q = resolveSchoolRegionQuery('경기도 수원시 권선구', '41111');
  assert.equal(q.sigungu, '수원시 장안구');
  // 시도 전체(시/군/구 없음)는 lawdCd가 와도 특정 구로 바꾸지 않는다 — 기존 계약(빈 목록) 유지.
  assert.equal(resolveSchoolRegionQuery('경기도 ', '41111').sigungu, '');
  // 학원 위치 라벨: 경기 일반구 주소에서 구 이름을 동으로 잡지 않는다.
  assert.equal(dongTokenAfterSigungu('경기 수원시 장안구 정자동 111'), '정자동');
  assert.equal(dongTokenAfterSigungu('경기 의정부시 의정부동 1'), '의정부동');
  assert.equal(dongTokenAfterSigungu('부산 서구 서대신동3가 1'), '서대신동3가');
  assert.equal(dongTokenAfterSigungu(''), null);
});

test('9b. 학교 API 두 곳이 같은 해석기를 쓰고, 학교 페이지가 canonical lawdCd를 보낸다', () => {
  for (const rel of ['src/app/api/school/route.ts', 'src/app/api/school/stats/route.ts']) {
    const src = code(rel);
    assert.ok(/resolveSchoolRegionQuery\(/.test(src), rel);
    assert.ok(!/region\.split\(' '\)/.test(src), `${rel}가 아직 공백 두 번째 토큰으로 자른다`);
  }
  assert.ok(!/parts\[2\]/.test(code('src/app/api/school/stats/route.ts')));
  const client = code('src/app/school/school-client.tsx');
  assert.ok(/&lawdCd=\$\{encodeURIComponent\(region\.lawdCd\)\}/.test(client));
  assert.ok(/\/api\/school\?\$\{schoolRegionQuery\}/.test(client) && /\/api\/school\/stats\?\$\{schoolRegionQuery\}/.test(client));
});

// ── BLOCKER 5 — null 좌표 master ──────────────────────────────────────────

test('10·11. null 좌표 master는 마커가 없고 0,0이나 다른 단지 좌표로 채우지 않는다', () => {
  const idx = buildMasterCoordIndex([
    { name: '태산', umdName: '오목천동', aptSeq: '41113-19', buildYear: 1990, latitude: null, longitude: null },
    { name: '다른단지', umdName: '오목천동', aptSeq: '41113-20', buildYear: 1995, latitude: 37.25, longitude: 126.95 },
  ] as never);
  const r = resolveApartmentCoords(idx, '오목천동', '태산');
  assert.equal(r.aptSeq, '41113-19', 'identity는 유지');
  assert.equal(r.lat, null);
  assert.equal(r.lng, null);
  // 검색 결과 좌표: 없으면 null(0으로 채우지 않음). 자동완성이 0,0 sentinel로 바꿔도 지도는 이동하지 않는다.
  const search = code('src/app/api/search/route.ts');
  assert.ok(/lat: loc \? loc\.latitude : null,/.test(search) && /lng: loc \? loc\.longitude : null,/.test(search));
  assert.equal(hasUsableHandoffCoords({ lat: 0, lng: 0 }), false);
  assert.equal(hasUsableHandoffCoords({ lat: NaN, lng: NaN }), false);
  assert.equal(hasUsableHandoffCoords({ lat: 37.25, lng: 126.95 }), true);
  const map = code('src/app/map/page.tsx');
  // 마커 생성은 좌표 없는 거래를 건너뛴다(0,0 마커 없음), 좌표 없는 선택은 안내만 하고 지도를 옮기지 않는다.
  assert.ok(/if \(!item\.lat \|\| !item\.lng\) continue;/.test(map));
  assert.ok(/if \(!hasUsableHandoffCoords\(result\)\) \{\s*setOfficetelHandoffNotice\(`\$\{result\.name\}은\(는\) 위치 정보가 없어 지도에 표시할 수 없습니다\.`\);\s*return;/.test(map));
});

// ── STEP 6 — beta 설정 시뮬레이션 ─────────────────────────────────────────

test('6-sim. 켜면 경기 8구만 app·search·map·detail이 열리고 report는 닫힘, 지도 안내도 따라간다', () => {
  const allow = allowWith(ON);
  for (const c of GG8) {
    for (const axis of ['app', 'search', 'map', 'detail'] as const) assert.equal(allow(c, axis), true, `${c} ${axis}`);
    for (const axis of ['report', 'stats', 'sitemap', 'seoIndex', 'cronSync'] as const) assert.equal(allow(c, axis), false, `${c} ${axis}`);
    assert.equal(shouldShowMapRegionNotice(c, allow), false, `켜면 ${c}는 지원 지역`);
    assert.equal(getRegionByLawdCd(c)?.isMolitLeaf, true);
  }
});

// ── STEP 7 — 회귀 ─────────────────────────────────────────────────────────

const ALL_AXES = ['app', 'search', 'map', 'detail', 'report', 'stats', 'sitemap', 'seoIndex'] as const;

test('12. 나머지 경기는 현재도·켜도 전 축 닫힘(부모 시 포함), 지도 안내 표시·리포트 없음', () => {
  for (const flags of [NOW, ON]) {
    for (const c of GG_OTHER) {
      for (const axis of ALL_AXES) assert.equal(allowWith(flags)(c, axis), false, `${c} ${axis}`);
      assert.equal(shouldShowMapRegionNotice(c, allowWith(flags)), true, c);
      assert.equal(publicAptReportHref(aptSeq(c), allowWith(flags)), null, c);
    }
  }
  for (const c of [...GG8, ...GG_OTHER]) for (const axis of ALL_AXES) assert.equal(isPublicRegionAllowed(c, axis), false, `런타임 ${c} ${axis}`);
});

test('13. 41135(분당)는 켜도 전 축 닫힘', () => {
  assert.ok(!GG8.includes('41135'));
  for (const axis of [...ALL_AXES, 'cronSync'] as const) assert.equal(allowWith(ON)('41135', axis), false, axis);
  assert.equal(shouldShowMapRegionNotice('41135', allowWith(ON)), true);
});

test('14. 부산 16구 회귀: 전 축 열림, 안내 없음, 리포트 CTA 그대로, 학교 파싱 결과 동일', () => {
  assert.equal(BUSAN16.length, 16);
  for (const flags of [NOW, ON]) {
    for (const c of BUSAN16) {
      for (const axis of [...ALL_AXES, 'cronSync'] as const) assert.equal(allowWith(flags)(c, axis), true, `${c} ${axis}`);
      assert.equal(shouldShowMapRegionNotice(c, allowWith(flags)), false);
      assert.equal(publicAptReportHref(aptSeq(c), allowWith(flags)), `/report/apt/${c}-1`);
    }
  }
  for (const c of BUSAN16) {
    const node = getRegionByLawdCd(c)!;
    const gu = node.fullName.replace(/^부산광역시 /, '');
    const region = `부산광역시 ${gu}`;
    // 예전 파서(region.split(' ')[1])와 같은 결과 — lawdCd가 있든 없든.
    assert.equal(resolveSchoolRegionQuery(region).sigungu, region.split(' ')[1], c);
    assert.equal(resolveSchoolRegionQuery(region, c).sigungu, region.split(' ')[1], c);
    assert.equal(resolveSchoolRegionQuery(region, c).sido, '부산광역시');
  }
  // "서구"는 "강서구" 학교를 잡지 않는다(기존 계약).
  assert.equal(addressMatchesRegion('부산광역시 강서구 명지국제7로 60', '부산광역시 서구', '서구'), false);
  assert.equal(addressMatchesRegion('부산광역시 서구 구덕로 225', '부산광역시 서구', '서구'), true);
});

test('15. 서울 회귀: 승인 8구 search·map·detail 유지 + report 닫힘, 차단 17구는 계속 차단', () => {
  assert.equal(SEOUL8.length, 8);
  assert.equal(SEOUL_BLOCKED.length, 17);
  for (const flags of [NOW, ON]) {
    for (const c of SEOUL8) {
      for (const axis of ['app', 'search', 'map', 'detail'] as const) assert.equal(allowWith(flags)(c, axis), true, `${c} ${axis}`);
      for (const axis of ['report', 'stats', 'sitemap', 'seoIndex'] as const) assert.equal(allowWith(flags)(c, axis), false, `${c} ${axis}`);
    }
    for (const c of SEOUL_BLOCKED) for (const axis of ALL_AXES) assert.equal(allowWith(flags)(c, axis), false, `${c} ${axis}`);
  }
  // 전국(registry 밖·그 밖 시도)은 닫힘.
  for (const c of ['27110', '28110', '99999']) for (const axis of ALL_AXES) assert.equal(isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
});
