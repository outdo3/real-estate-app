import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildRegionMapUrl } from './registry';
import { DEFAULT_LAWD_CD, DEFAULT_MAP_CENTER, parseMapStateFromSearchParams } from '../map-marker-share';
import { shouldApplyLateGps } from '../map-initial-location';

/**
 * SEARCH_MAP_CONTEXT_V1 — 홈 검색·상세 빠른 검색의 "📍 지역" 결과 → /map이 선택한 지역으로 열린다.
 *
 * 재현된 원인(Production 4/4): (B) router.push 전환에서 지도 초기 상태가 이전 페이지 쿼리를 읽어
 * GPS→IP 폴백(중구)으로 열렸고, (A) URL에 검색 결과의 lawdCd가 빠져 전체 로드여도 기본 서구 마커를 불렀다.
 */

const ROOT = resolve(__dirname, '../../..');
const code = (p: string) =>
  readFileSync(join(ROOT, p), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const HOME = code('src/components/HomeApartmentSearch.tsx');
const QUICK = code('src/components/ApartmentQuickSearch.tsx');
const AUTO = code('src/components/ApartmentAutocomplete.tsx');
const SEARCH_API = code('src/app/api/search/route.ts');
const MAP = code('src/app/map/page.tsx');

const regionBranch = (src: string) => {
  const start = src.indexOf("if (result.type === 'REGION') {");
  return src.slice(start, src.indexOf('return;', start) + 'return;'.length);
};

// 검색 API가 주는 지역 결과 + 자동완성이 지오코딩한 좌표 모양(값은 테스트용)
const REGION = { type: 'REGION' as const, name: '부산 연제구 연산동', lat: 35.1825602536452, lng: 129.085536368165, lawdCd: '26470', dong: '연산동' };
const parse = (url: string) => parseMapStateFromSearchParams(new URLSearchParams(url.split('?')[1] ?? ''));

test('1. HomeApartmentSearch 지역 결과 → 명시적 지도 URL로 전체 이동(router.push 아님)', () => {
  const branch = regionBranch(HOME);
  assert.match(branch, /window\.location\.assign\(buildRegionMapUrl\(result\)\);/);
  assert.ok(!/router\.(push|replace)\(/.test(branch), '지도 초기 상태가 이전 페이지 URL을 읽는 전환 경로를 쓰지 않음');
});

test('2. ApartmentQuickSearch 지역 결과 → 같은 방식으로 전체 이동', () => {
  const branch = regionBranch(QUICK);
  assert.match(branch, /window\.location\.assign\(buildRegionMapUrl\(result\)\);/);
  assert.ok(!/router\.(push|replace)\(/.test(branch));
});

test('3. 단지 결과는 지도가 아니라 기존 상세 이동 그대로(aptSeq 유지)', () => {
  // 홈: verify 후 /apt/[name]?lawdCd&dong&aptSeq
  assert.match(HOME, /if \(aptSeq\) qs\.set\('aptSeq', aptSeq\);\s*router\.push\(`\/apt\/\$\{encodeURIComponent\(name\)\}\?\$\{qs\.toString\(\)\}`\);/);
  assert.match(HOME, /navigateToApt\(result\.name, result\.lawdCd!, result\.dong!, result\.aptSeq\);/);
  // 빠른 검색: 기존 상세 이동 그대로(이번 STEP 범위 밖)
  assert.match(QUICK, /onClose\(\);\s*router\.push\(`\/apt\/\$\{encodeURIComponent\(name\)\}\$\{query\}`\);/);
  // 지역 결과 URL은 단지 identity를 만들지 않는다(선택 복원 대상 없음 — 가짜 선택 금지)
  const url = buildRegionMapUrl(REGION);
  assert.ok(!/aptSeq=|name=|dong=/.test(url));
  assert.equal(parse(url)!.restoreIdentity, null);
});

test('4. 자동완성이 넘긴 좌표를 그대로 싣고, 검색 API의 시군구 코드를 함께 싣는다', () => {
  const url = buildRegionMapUrl(REGION);
  assert.equal(url, '/map?lat=35.1825602536452&lng=129.085536368165&lawdCd=26470');
  const state = parse(url)!;
  assert.deepEqual(state.center, { lat: REGION.lat, lng: REGION.lng });
  assert.equal(state.lawdCd, '26470');
});

test('5. 명시적 지역 컨텍스트가 기본 지역·지오로케이션을 이긴다', () => {
  const state = parse(buildRegionMapUrl(REGION))!;
  assert.notEqual(state.lawdCd, DEFAULT_LAWD_CD, 'lawdCd가 없으면 파서가 기본 서구 코드로 채워 다른 구 마커를 불렀다');
  assert.match(MAP, /return fromUrl\s*\? \{ resolved: true, source: 'url', center: fromUrl \}/);
  assert.match(MAP, /useEffect\(\(\) => \{\s*if \(initialShareLawdCdRef\.current\) return;/);
  assert.equal(shouldApplyLateGps('url', state.center, state.center), false);
  // 형식이 맞지 않는 코드는 싣지 않는다(조작/누락 값을 신뢰하지 않음) — 좌표만 유지
  assert.equal(buildRegionMapUrl({ ...REGION, lawdCd: '' }), '/map?lat=35.1825602536452&lng=129.085536368165');
  assert.equal(buildRegionMapUrl({ ...REGION, lawdCd: '26470x' }), '/map?lat=35.1825602536452&lng=129.085536368165');
});

test('6. 선택 복원 로직(단지 identity)은 그대로 — 지역 결과는 선택을 만들지 않음', () => {
  assert.match(MAP, /useState<RestoreIdentity \| null>\(\s*\(\) => readInitialMapStateFromUrl\(\)\?\.restoreIdentity \?\? null\s*\)/);
  assert.equal(parse(buildRegionMapUrl(REGION))!.restoreIdentity, null);
});

test('7. 좌표를 못 얻은 결과(0,0/NaN)는 가짜 중심을 만들지 않고 기본 진입(/map)으로', () => {
  assert.equal(buildRegionMapUrl({ lat: 0, lng: 0, lawdCd: '26470' }), '/map');
  assert.equal(buildRegionMapUrl({ lat: Number.NaN, lng: 129.08, lawdCd: '26470' }), '/map');
  assert.equal(parse('/map'), null, '기존 안전 폴백(GPS→IP→기본 지역) 그대로');
  assert.notDeepEqual(DEFAULT_MAP_CENTER, { lat: 0, lng: 0 });
  // 클릭 경로에서 이름 기반 지오코딩을 새로 하지 않는다
  assert.ok(!/geocode|keywordSearch|Geocoder|places\./i.test(regionBranch(HOME) + regionBranch(QUICK)));
});

test('8. 검색 결과 매핑은 그대로(지역 좌표 지오코딩·lawdCd 전달·API 매핑)', () => {
  assert.match(AUTO, /const address = `\$\{item\.sido\} \$\{item\.sigungu\} \$\{item\.dong\}`;\s*await new Promise<void>/);
  assert.match(AUTO, /let lat = item\.lat \|\| 0;\s*let lng = item\.lng \|\| 0;/);
  assert.match(AUTO, /lawdCd: item\.lawdCd,\s*apartmentId: item\.apartmentId,\s*aptSeq: item\.aptSeq,/);
  assert.match(SEARCH_API, /dong: r\.umdName \|\| '',\s*lawdCd: r\.sggCd \|\| ''/);
});

test('9. 뒤로가기: 새 history 항목으로 이동(assign) — replace 없음, 빠른 검색 history 처리 그대로', () => {
  for (const branch of [regionBranch(HOME), regionBranch(QUICK)]) {
    assert.ok(!/location\.replace\(|history\.replaceState\(/.test(branch));
  }
  assert.match(QUICK, /window\.history\.pushState\(\{ ejipQuickSearch: true \}, ''\);\s*const onPopState = \(\) => onClose\(\);/);
});

test('10. 지도 코어는 그대로(초기 상태 읽기·지오로케이션·레이어 복원), 특정 지역 하드코딩 없음', () => {
  assert.match(MAP, /function readInitialMapStateFromUrl\(\) \{\s*if \(typeof window === 'undefined'\) return null;\s*return parseMapStateFromSearchParams\(new URLSearchParams\(window\.location\.search\)\);/);
  assert.match(MAP, /return locateInitialCenter\(DEFAULT_MAP_CENTER, \{/);
  assert.match(MAP, /const restored = readInitialMapStateFromUrl\(\)\?\.layers;/);
  assert.ok(!/\d{5}|연산동|35\.\d{3}|129\.\d{3}/.test(regionBranch(HOME) + regionBranch(QUICK)));
});
