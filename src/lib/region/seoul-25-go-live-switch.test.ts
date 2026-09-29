import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SEOUL_17_BETA_LAWDCDS,
  SEOUL_17_ENABLEMENT,
  SEOUL_17_OPEN,
  SEOUL_17_PUBLIC_ENABLED,
  SEOUL_BETA_LAWDCDS,
  GYEONGGI_BETA_LAWDCDS,
  getRegionEnablement,
  getSidoEnablement,
  isDbOnlyLawdCd,
  isPublicRegionAllowed,
  isSidoWholeQuerySupported,
  resolveDbOnly,
  resolveSeoul17Open,
  simulateRegionEnablement,
  type RegionEnablement,
} from './enablement';
import { REGION_NODES } from './registry';
import { BUSAN_LAWDCD_16 } from '../rent-verified-range';
import { decideSupplyRegion, supplyCheckFrom } from '../stats/supply-region-gate';


// SEOUL25_GO_LIVE_PREP_V1 — 17구 Production 공개는 SEOUL_17_PUBLIC_ENABLED 한 줄. 지금은 false.
// "켜면"은 simulateRegionEnablement(seoul17Open: true)로 본다(Production 설정은 바꾸지 않는다).

const ROOT = resolve(__dirname, '../../..');
const code = (p: string) => readFileSync(resolve(ROOT, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const S17 = SEOUL_17_BETA_LAWDCDS as readonly string[];
const S8 = SEOUL_BETA_LAWDCDS as readonly string[];
const GG = GYEONGGI_BETA_LAWDCDS as readonly string[];
const LIVE = { seoulBeta: true, gyeonggiBeta: false, seoul17Open: true } as const;
const NOW = { seoulBeta: true, gyeonggiBeta: false } as const;
const sim = (c: string, axis: keyof RegionEnablement, flags: { seoulBeta: boolean; gyeonggiBeta: boolean; seoul17Open?: boolean } = LIVE) => simulateRegionEnablement(c, flags)[axis];

test('스위치는 한 곳 · 리터럴 false · 현재 빌드에서 17구 닫힘', () => {
  assert.equal(SEOUL_17_PUBLIC_ENABLED, false);
  assert.equal(SEOUL_17_OPEN, false);
  const src = code('src/lib/region/enablement.ts');
  assert.match(src, /export const SEOUL_17_PUBLIC_ENABLED = false;/);
  assert.equal((src.match(/SEOUL_17_PUBLIC_ENABLED/g) || []).length, 2, '스위치를 읽는 곳이 하나가 아니다(정의 + SEOUL_17_OPEN)');
  assert.match(src, /seoul17Open: SEOUL_17_OPEN,/);
  for (const c of S17) {
    for (const axis of ['app', 'search', 'map', 'detail', 'report', 'stats', 'supply', 'sitemap', 'seoIndex', 'cronSync'] as const) {
      assert.equal(isPublicRegionAllowed(c, axis), false, `${c} ${axis}`);
    }
    assert.equal(isDbOnlyLawdCd(c), false, c);
  }
});

test('열림 판정 진리표: Production 스위치 또는 Preview 스위치', () => {
  assert.equal(resolveSeoul17Open(false, false), false);
  assert.equal(resolveSeoul17Open(true, false), true);
  assert.equal(resolveSeoul17Open(false, true), true);
  assert.equal(resolveSeoul17Open(true, true), true);
});

test('go-live 시뮬레이션: 17구 검색·지도·상세·선택기·DB 읽기 열림 · 리포트·통계·공급·사이트맵·색인 닫힘', () => {
  assert.deepEqual(SEOUL_17_ENABLEMENT, { app: true, search: true, map: true, detail: true, report: false, stats: false, supply: false, sitemap: false, seoIndex: false, cronSync: true });
  for (const c of S17) {
    for (const axis of ['app', 'search', 'map', 'detail', 'cronSync'] as const) assert.equal(sim(c, axis), true, `${c} ${axis}`);
    for (const axis of ['report', 'stats', 'supply', 'sitemap', 'seoIndex'] as const) assert.equal(sim(c, axis), false, `${c} ${axis}`);
  }
  const liveSupply = supplyCheckFrom((c) => simulateRegionEnablement(c, LIVE), getSidoEnablement);
  assert.equal(decideSupplyRegion('서울특별시', '강남구', liveSupply).allowed, false, '17구 공급');
  assert.equal(decideSupplyRegion('서울특별시', null, liveSupply).allowed, false, '서울 전체 공급');
  assert.equal(decideSupplyRegion('서울특별시', '마포구', liveSupply).allowed, true, '8구 공급 그대로');
});

test('go-live 시뮬레이션: 서울 8구·부산·경기는 켜기 전과 완전히 같다', () => {
  for (const n of REGION_NODES) {
    if (S17.includes(n.lawdCd)) continue;
    assert.deepEqual(simulateRegionEnablement(n.lawdCd, LIVE), simulateRegionEnablement(n.lawdCd, NOW), n.lawdCd);
    assert.deepEqual(simulateRegionEnablement(n.lawdCd, NOW), getRegionEnablement(n.lawdCd), n.lawdCd);
  }
  for (const c of S8) assert.equal(sim(c, 'supply'), true, c);
  for (const c of BUSAN_LAWDCD_16) assert.equal(sim(c, 'report'), true, c);
  for (const c of GG) assert.equal(sim(c, 'app'), false, c);
});

test('go-live 시뮬레이션: 선택기 25구 · 중복 없음 · "서울특별시 전체" 없음', () => {
  const seoul = REGION_NODES.filter((n) => n.sidoCode === '11');
  const open = seoul.filter((n) => sim(n.lawdCd, 'app')).map((n) => n.lawdCd);
  assert.equal(open.length, 25);
  assert.equal(new Set(open).size, 25);
  assert.equal(isSidoWholeQuerySupported('11'), false);
  const modal = code('src/components/RegionSelectModal.tsx');
  assert.ok(/if \(!isSidoWholeQuerySupported\(sidoCode\)\) return;/.test(modal));
});

test('go-live: 17구는 DB 전용 — live MOLIT 관문에서 닫힘, 다른 지역은 영향 없음', () => {
  for (const c of S17) {
    assert.equal(resolveDbOnly(true, c), true, c);
    assert.equal(resolveDbOnly(false, c), false, c);
  }
  for (const c of [...S8, ...BUSAN_LAWDCD_16, ...GG, '11', '1168', '', null, undefined]) assert.equal(resolveDbOnly(true, c as string), false, String(c));
  // 관문은 fetchMolitData 맨 앞 한 곳이고, 17구 판정은 enablement의 같은 열림 값을 쓴다
  const molit = code('src/lib/api-molit.ts');
  assert.match(molit, /if \(isDbOnlyLawdCd\(params\.lawdCd\)\) return molitFailurePlaceholder\(params, DB_ONLY_MOLIT_MESSAGE\);/);
  assert.match(code('src/lib/region/enablement.ts'), /return resolveDbOnly\(SEOUL_17_OPEN, lawdCd\);/);
  // 상세·지도는 cronSync(=DB-first) 축으로 DB를 읽는다
  assert.ok(/if \(aptSeq && isTradeDbFirstLawdCd\(aptSeq\.slice\(0, 5\)\)\)/.test(code('src/app/api/apt/[name]/route.ts')));
  assert.ok(/const isDbFirstEligible = isMapMarkerShape && isTradeDbFirstLawdCd\(lawdCd\);/.test(code('src/app/api/transactions/route.ts')));
});

test('정기 수집 범위는 공개 스위치와 무관하다(sale-sync-scope는 enablement를 읽지 않는다)', () => {
  assert.ok(!/enablement/.test(code('src/lib/sync/sale-sync-scope.ts')));
  assert.ok(!/SEOUL_17_PUBLIC_ENABLED|SEOUL_17_OPEN/.test(code('src/lib/sync/sale-sync-core.ts')));
});
