import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGION_NODES, REGION_SIDOS,
  getRegionByLawdCd, getRegionChildren, getMolitLeafRegions,
  getRegionContext, getSidoRegions, getSido,
} from './registry';
import { getRegionEnablement, getSidoEnablement, getEnabledSidoCodes, SEOUL_BETA_LAWDCDS } from './enablement';
import { BUSAN_DISTRICTS, BUSAN_CURRENT_LAWD_CODES } from '../report/region-scope';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { REGION_DATA } from '../regions';

// REGION_REGISTRY_V1 — canonical 계층·MOLIT leaf 의미·enablement 분리를 고정한다.
// 데이터 출처는 법정동코드 프록시 실측(2026-09-16). 추측한 코드는 하나도 없다.

const codes = (ns: readonly { lawdCd: string }[]) => ns.map((n) => n.lawdCd);

// ── 1~5. 구성 ─────────────────────────────────────────────────────────────

test('1 · 부산 시군구 16개', () => {
  const busan = getSidoRegions('26');
  assert.equal(busan.length, 16);
  assert.equal(busan.filter((n) => n.isMolitLeaf).length, 16, '부산은 전부 MOLIT leaf다');
  assert.equal(busan.filter((n) => n.type === 'COUNTY').length, 1, '기장군 하나');
});

test('2 · 서울 자치구 25개, 전부 leaf', () => {
  const seoul = getSidoRegions('11');
  assert.equal(seoul.length, 25);
  assert.equal(seoul.filter((n) => n.isMolitLeaf).length, 25);
  assert.equal(seoul.filter((n) => n.parentLawdCd !== null).length, 0, '서울에는 일반구가 없다');
});

test('3 · 경기 MOLIT leaf 42개', () => {
  assert.equal(getMolitLeafRegions('41').length, 42);
});

test('4 · 경기 부모 시 6개(수원·성남·안양·안산·고양·용인)', () => {
  const parents = getSidoRegions('41').filter((n) => !n.isMolitLeaf);
  assert.equal(parents.length, 6);
  assert.deepEqual(codes(parents).sort(), ['41110', '41130', '41170', '41270', '41280', '41460']);
  for (const p of parents) {
    assert.ok(getRegionChildren(p.lawdCd).length >= 2, `${p.name}는 일반구를 가져야 한다`);
  }
});

test('5 · 경기 전체 48 = 부모 시 6 + 일반구 17 + 단일 시군 25', () => {
  const gg = getSidoRegions('41');
  assert.equal(gg.length, 48);
  const parents = gg.filter((n) => !n.isMolitLeaf).length;
  const districts = gg.filter((n) => n.type === 'GENERAL_DISTRICT').length;
  const singles = gg.filter((n) => n.isMolitLeaf && n.type !== 'GENERAL_DISTRICT').length;
  assert.deepEqual({ parents, districts, singles }, { parents: 6, districts: 17, singles: 25 });
  assert.equal(parents + districts + singles, 48);
});

// ── 6~9. lookup ───────────────────────────────────────────────────────────

test('6 · lookup 26140 = 부산 서구(자치구, leaf, 부모 없음)', () => {
  const n = getRegionByLawdCd('26140');
  assert.deepEqual(n, {
    lawdCd: '26140', name: '서구', fullName: '부산광역시 서구', sidoCode: '26',
    type: 'METROPOLITAN_DISTRICT', parentLawdCd: null, isMolitLeaf: true,
  });
});

test('7 · lookup 11680 = 서울 강남구', () => {
  const n = getRegionByLawdCd('11680');
  assert.equal(n?.fullName, '서울특별시 강남구');
  assert.equal(n?.isMolitLeaf, true);
  assert.equal(n?.parentLawdCd, null);
});

test('8 · lookup 41135 = 경기 성남시 분당구(일반구, leaf, 부모 41130)', () => {
  const n = getRegionByLawdCd('41135');
  assert.equal(n?.name, '분당구');
  assert.equal(n?.fullName, '경기도 성남시 분당구');
  assert.equal(n?.type, 'GENERAL_DISTRICT');
  assert.equal(n?.parentLawdCd, '41130');
  assert.equal(n?.isMolitLeaf, true);
  // 부모 시는 leaf가 아니다 — MOLIT를 이 코드로 부르면 중복 수집 위험.
  assert.equal(getRegionByLawdCd('41130')?.isMolitLeaf, false);
});

test('9 · lookup 41570 = 경기 김포시(단일 시, leaf, 일반구 없음)', () => {
  const n = getRegionByLawdCd('41570');
  assert.equal(n?.fullName, '경기도 김포시');
  assert.equal(n?.type, 'CITY');
  assert.equal(n?.parentLawdCd, null);
  assert.equal(n?.isMolitLeaf, true);
  assert.deepEqual(getRegionChildren('41570'), []);
});

test('10 · 모르는 코드는 null — 어떤 지역으로도 fallback하지 않는다', () => {
  for (const bad of [null, undefined, '', '99999', '2614', '261400', 'abcde', '27110']) {
    assert.equal(getRegionByLawdCd(bad), null, `${JSON.stringify(bad)}`);
    assert.equal(getRegionContext(bad), null);
  }
  assert.equal(getSido('99'), null);
  assert.deepEqual(getSidoRegions('99'), []);
});

// ── 11~12. leaf 의미 · 계층 순회 ──────────────────────────────────────────

test('11 · MOLIT leaf 목록에 부모 시 코드가 들어가지 않는다', () => {
  const leaves = codes(getMolitLeafRegions());
  for (const parent of ['41110', '41130', '41170', '41270', '41280', '41460']) {
    assert.ok(!leaves.includes(parent), `부모 시 ${parent}가 수집 대상에 섞였다`);
  }
  assert.equal(leaves.length, 16 + 25 + 42, '부산16 + 서울25 + 경기leaf42');
  assert.equal(new Set(leaves).size, leaves.length, 'leaf 목록에 중복 없음');
});

test('12 · 부모 → 자식 순회가 정확하다', () => {
  assert.deepEqual(codes(getRegionChildren('41130')).sort(), ['41131', '41133', '41135']);
  assert.deepEqual(codes(getRegionChildren('41110')).sort(), ['41111', '41113', '41115', '41117']);
  assert.deepEqual(codes(getRegionChildren('41280')).sort(), ['41281', '41285', '41287']);
  // 모든 일반구의 부모가 실제로 존재하고, 그 부모는 같은 시도다.
  for (const n of REGION_NODES.filter((x) => x.parentLawdCd)) {
    const parent = getRegionByLawdCd(n.parentLawdCd);
    assert.ok(parent, `${n.fullName}의 부모 ${n.parentLawdCd}가 없다`);
    assert.equal(parent!.sidoCode, n.sidoCode);
    assert.equal(parent!.isMolitLeaf, false, '일반구를 가진 시는 leaf가 아니어야 한다');
  }
});

test('12b · getRegionContext가 시도/시/일반구를 정확히 분해한다', () => {
  const bundang = getRegionContext('41135')!;
  assert.equal(bundang.sido.name, '경기도');
  assert.equal(bundang.city.name, '성남시');
  assert.equal(bundang.district?.name, '분당구');

  const gimpo = getRegionContext('41570')!;
  assert.equal(gimpo.city.name, '김포시');
  assert.equal(gimpo.district, null, '단일 시는 일반구가 없다');

  const seogu = getRegionContext('26140')!;
  assert.equal(seogu.sido.shortName, '부산');
  assert.equal(seogu.city.name, '서구');
  assert.equal(seogu.district, null);
});

// ── 13. fullName 형식 ─────────────────────────────────────────────────────

test('13 · fullName은 시도부터 시작하고 name으로 끝난다', () => {
  for (const n of REGION_NODES) {
    const sido = getSido(n.sidoCode)!;
    assert.ok(n.fullName.startsWith(sido.name), `${n.fullName}`);
    assert.ok(n.fullName.endsWith(n.name), `${n.fullName} / ${n.name}`);
    if (n.parentLawdCd) {
      const parent = getRegionByLawdCd(n.parentLawdCd)!;
      assert.equal(n.fullName, `${sido.name} ${parent.name} ${n.name}`, '일반구는 시도+시+구');
    } else {
      assert.equal(n.fullName, `${sido.name} ${n.name}`);
    }
  }
});

// ── 14~16. enablement 분리 ────────────────────────────────────────────────

test('14 · 부산은 모든 축에서 열려 있다(기존 상태 보존)', () => {
  const e = getSidoEnablement('26');
  assert.deepEqual(e, { app: true, report: true, stats: true, sitemap: true, seoIndex: true, cronSync: true });
  assert.deepEqual(getRegionEnablement('26140'), e);
  assert.deepEqual(getEnabledSidoCodes(), ['26'], '앱에 열린 시도는 부산뿐');
});

test('15 · 서울은 registry에 존재하지만 어떤 축도 열려 있지 않다', () => {
  assert.ok(getRegionByLawdCd('11680'), 'registry에는 있어야 한다');
  const e = getSidoEnablement('11');
  assert.deepEqual(e, { app: false, report: false, stats: false, sitemap: false, seoIndex: false, cronSync: false });
  assert.deepEqual(getRegionEnablement('11680'), e);
});

test('16 · 경기도 동일 — 존재하지만 미출시', () => {
  assert.ok(getRegionByLawdCd('41135'));
  for (const code of ['41135', '41117', '41287', '41570']) {
    const e = getRegionEnablement(code);
    assert.equal(e.app, false);
    assert.equal(e.sitemap, false);
    assert.equal(e.seoIndex, false);
    assert.equal(e.cronSync, false);
  }
  // 모르는 코드도 닫힘이 기본값이다.
  assert.equal(getRegionEnablement('99999').app, false);
});

// ── 18~19. 무결성 ─────────────────────────────────────────────────────────

test('18 · lawdCd 중복 없음, 형식은 5자리 숫자', () => {
  const all = codes(REGION_NODES);
  assert.equal(new Set(all).size, all.length, '중복 lawdCd');
  for (const c of all) assert.match(c, /^\d{5}$/);
  assert.equal(REGION_NODES.length, 16 + 25 + 48);
});

test('19 · fullName(전체 식별) 중복 없음, 시도 코드는 등록된 것만', () => {
  const names = REGION_NODES.map((n) => n.fullName);
  assert.equal(new Set(names).size, names.length, '중복 fullName');
  const sidoCodes = new Set(REGION_SIDOS.map((s) => s.code));
  for (const n of REGION_NODES) assert.ok(sidoCodes.has(n.sidoCode), n.fullName);
});

// ── 20. 기존 소비자 호환 ──────────────────────────────────────────────────

test('20a · BUSAN_DISTRICTS가 기존 리터럴과 완전히 동일하다(리포트 스코프 불변)', () => {
  // REGION_REGISTRY_V1 이전에 region-scope.ts에 직접 적혀 있던 값 그대로.
  assert.deepEqual(BUSAN_DISTRICTS, [
    { lawdCd: '26110', name: '중구', kind: 'GU' },
    { lawdCd: '26140', name: '서구', kind: 'GU' },
    { lawdCd: '26170', name: '동구', kind: 'GU' },
    { lawdCd: '26200', name: '영도구', kind: 'GU' },
    { lawdCd: '26230', name: '부산진구', kind: 'GU' },
    { lawdCd: '26260', name: '동래구', kind: 'GU' },
    { lawdCd: '26290', name: '남구', kind: 'GU' },
    { lawdCd: '26320', name: '북구', kind: 'GU' },
    { lawdCd: '26350', name: '해운대구', kind: 'GU' },
    { lawdCd: '26380', name: '사하구', kind: 'GU' },
    { lawdCd: '26410', name: '금정구', kind: 'GU' },
    { lawdCd: '26440', name: '강서구', kind: 'GU' },
    { lawdCd: '26470', name: '연제구', kind: 'GU' },
    { lawdCd: '26500', name: '수영구', kind: 'GU' },
    { lawdCd: '26530', name: '사상구', kind: 'GU' },
    { lawdCd: '26710', name: '기장군', kind: 'GUN' },
  ]);
});

test('20b · BUSAN_LAWDCD_16 / BUSAN_CURRENT_LAWD_CODES가 기존 값과 동일하다', () => {
  const expected = ['26110', '26140', '26170', '26200', '26230', '26260', '26290', '26320',
    '26350', '26380', '26410', '26440', '26470', '26500', '26530', '26710'];
  assert.deepEqual([...BUSAN_LAWDCD_16], expected);
  assert.deepEqual([...BUSAN_CURRENT_LAWD_CODES], expected);
});

test('20c · REGION_DATA(이름 기반 UI 소스)와 registry가 어긋나지 않는다', () => {
  // REGION_DATA는 전국 이름 목록이고 일반구를 담지 않는다. registry가 커버하는 3개 시도에
  // 대해, "일반구를 제외한 시군구 이름 집합"이 서로 정확히 같아야 한다(드리프트 방지).
  for (const [sidoCode, sidoName] of [['26', '부산광역시'], ['11', '서울특별시'], ['41', '경기도']] as const) {
    const fromRegistry = getSidoRegions(sidoCode)
      .filter((n) => n.type !== 'GENERAL_DISTRICT')
      .map((n) => n.name)
      .sort();
    const fromRegionData = [...REGION_DATA[sidoName]].sort();
    assert.deepEqual(fromRegistry, fromRegionData, `${sidoName} 불일치`);
  }
});

// ── 17. sitemap / SEO 안전 ────────────────────────────────────────────────

test('17 · registry에 서울·경기가 있어도 sitemap 지역 경로는 부산 17개 그대로다', async () => {
  const { buildLaunchRegionRoutes, LAUNCH_SIDO } = await import('../sitemap-scope');
  const routes = buildLaunchRegionRoutes();
  // 부산 전체 1 + 자치구·군 16 = 17. registry 확장이 이 수를 늘리면 안 된다.
  assert.equal(routes.length, 17, 'sitemap 지역 경로 수가 변했다');
  assert.equal(LAUNCH_SIDO, '부산광역시');
  const blob = JSON.stringify(routes);
  for (const code of ['11680', '11710', '11440', '41135', '41117', '41287', '41570']) {
    assert.ok(!blob.includes(code), `sitemap에 서울/경기 코드 ${code}가 들어갔다`);
  }
});

test('17b · sitemap/SEO 축이 열린 지역은 부산뿐', () => {
  const sitemapOpen = REGION_NODES.filter((n) => getRegionEnablement(n.lawdCd).sitemap);
  const seoOpen = REGION_NODES.filter((n) => getRegionEnablement(n.lawdCd).seoIndex);
  assert.equal(sitemapOpen.length, 16);
  assert.equal(seoOpen.length, 16);
  assert.ok(sitemapOpen.every((n) => n.sidoCode === '26'));
  assert.ok(seoOpen.every((n) => n.sidoCode === '26'));
});

// SEOUL_MOBILE_BETA_LAUNCH_V1 — beta가 켜지면서 서울 승인 8구가 cronSync(=DB-first 읽기) 축에 들어왔다.
// registry가 **자동으로** 넓히는 것은 여전히 없다: 부산 16 + allowlist 8 외에는 한 곳도 열리지 않는다.
test('17c · cronSync 축은 부산 leaf 16 + 서울 beta 8뿐 — registry가 자동으로 서울/경기를 돌리지 않는다', () => {
  const cronOpen = getMolitLeafRegions().filter((n) => getRegionEnablement(n.lawdCd).cronSync);
  assert.equal(cronOpen.length, 24);
  assert.deepEqual([...BUSAN_LAWDCD_16, ...SEOUL_BETA_LAWDCDS].sort(), codes(cronOpen).sort());
  assert.ok(!codes(cronOpen).includes('11680'), '강남이 열렸다');
});
