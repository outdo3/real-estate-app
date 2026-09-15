import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { buildDetailMapUrl } from './registry';
import { DEFAULT_LAWD_CD, parseMapStateFromSearchParams } from '../map-marker-share';
import { shouldApplyLateGps } from '../map-initial-location';

/**
 * APT_DETAIL_MAP_CONTEXT_V1 — 상세 "지도에서 주변 단지와 보기" → 해당 단지 중심·선택 유지.
 *
 * 재현된 원인: router.push로 /map에 가면 지도 초기 상태 읽기(window.location.search)가 새 URL 반영 전에 실행돼
 * 상세 쿼리(lat 없음)를 읽고 GPS→IP 흐름이 컨텍스트를 덮었다. 상세 버튼은 이제 같은 URL로 전체 이동한다.
 */

const ROOT = resolve(__dirname, '../../..');
const code = (p: string) =>
  readFileSync(join(ROOT, p), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const DETAIL = code('src/app/apt/[name]/apt-client.tsx');
const MAP = code('src/app/map/page.tsx');
const handler = DETAIL.slice(DETAIL.indexOf('const handleViewOnMap = async () => {'), DETAIL.indexOf('const reportHref'));

const SAMPLE = { lawdCd: '26350', dong: '우동', name: '롯데', aptSeq: '26350-9', lat: 35.1634441587193, lng: 129.147619699842 };

test('1·5. aptSeq identity가 지도 URL에 실리고, 지도 파서가 그 aptSeq로 선택을 복원한다', () => {
  const state = parseMapStateFromSearchParams(new URLSearchParams(buildDetailMapUrl(SAMPLE).split('?')[1]));
  assert.ok(state);
  assert.deepEqual(state!.restoreIdentity, { aptSeq: '26350-9' }, 'aptSeq 우선(이름 매칭 아님)');
  assert.match(MAP, /useState<RestoreIdentity \| null>\(\s*\(\) => readInitialMapStateFromUrl\(\)\?\.restoreIdentity \?\? null\s*\)/);
});

test('2. 서버가 확정한 canonical 좌표를 그대로 중심으로 쓴다', () => {
  const state = parseMapStateFromSearchParams(new URLSearchParams(buildDetailMapUrl(SAMPLE).split('?')[1]));
  assert.deepEqual(state!.center, { lat: SAMPLE.lat, lng: SAMPLE.lng });
  assert.match(handler, /const coords = canonicalCoord;/);
  assert.match(handler, /lat: coords\?\.lat,\s*lng: coords\?\.lng,/);
  assert.match(handler, /aptSeq: canonicalAptSeq \|\| undefined,/);
});

test('3·4. 명시적 단지 컨텍스트가 기본 지역·늦은 GPS를 이긴다(URL 좌표 = 확정 위치, 지오로케이션 생략)', () => {
  const state = parseMapStateFromSearchParams(new URLSearchParams(buildDetailMapUrl(SAMPLE).split('?')[1]));
  assert.equal(state!.lawdCd, '26350');
  assert.notEqual(state!.lawdCd, DEFAULT_LAWD_CD);
  // 지도: URL center가 있으면 source 'url'로 바로 확정, lawdCd가 있으면 지오로케이션 effect 자체를 건너뜀
  assert.match(MAP, /return fromUrl\s*\? \{ resolved: true, source: 'url', center: fromUrl \}/);
  assert.match(MAP, /useEffect\(\(\) => \{\s*if \(initialShareLawdCdRef\.current\) return;/);
  assert.equal(shouldApplyLateGps('url', { lat: SAMPLE.lat, lng: SAMPLE.lng }, { lat: SAMPLE.lat, lng: SAMPLE.lng }), false, '늦은 GPS는 URL 출처를 덮지 않음');
});

test('원인 고정: 상세 버튼은 router.push(클라이언트 전환)가 아니라 같은 URL로 전체 이동한다', () => {
  assert.match(handler, /window\.location\.assign\(\s*buildDetailMapUrl\(\{/);
  assert.ok(!/router\.(push|replace)\(/.test(handler), '지도 초기 상태가 이전 페이지 URL을 읽는 전환 경로를 쓰지 않음');
  // 지도 페이지는 여전히 초기화 시점에 window.location.search를 읽는다 — 그래서 전체 이동이 필요하다(구조 무변경)
  assert.match(MAP, /function readInitialMapStateFromUrl\(\) \{\s*if \(typeof window === 'undefined'\) return null;\s*if \(window\.location\.pathname !== '\/map'\) return null;\s*return parseMapStateFromSearchParams\(new URLSearchParams\(window\.location\.search\)\);/);
});

test('6. 좌표가 없으면 추측하지 않는다: lat/lng 없는 URL → 공유 링크로 보지 않고 기존 안전 폴백', () => {
  const url = buildDetailMapUrl({ lawdCd: '26350', dong: '우동', name: '롯데', aptSeq: '26350-9' });
  const qs = new URLSearchParams(url.split('?')[1]);
  assert.equal(qs.has('lat') || qs.has('lng'), false);
  assert.equal(parseMapStateFromSearchParams(qs), null, '가짜 중심을 만들지 않음');
  assert.ok(!/geocode|keywordSearch|Geocoder|places\./i.test(handler), '클릭 시 이름 기반 지오코딩 없음');
});

test('8. 뒤로가기: 새 history 항목으로 이동(assign) — replace로 상세 기록을 지우지 않음', () => {
  assert.ok(!/location\.replace\(|history\.replaceState\(/.test(handler));
  assert.match(handler, /window\.location\.assign\(/);
});

test('9. 특정 단지 하드코딩 없음', () => {
  assert.ok(!/\d{5}-\d+|롯데|그린시티|연산자이|35\.\d{3}|129\.\d{3}/.test(handler));
});

test('7·10. 다른 지도 진입·지도 코어는 이번 변경 범위 밖(그대로)', () => {
  // 검색 결과 → 지도 이동은 SEARCH_MAP_CONTEXT_V1에서 같은 방식으로 고쳤다(search-map-context.test.ts)
  assert.match(code('src/components/HomeApartmentSearch.tsx'), /window\.location\.assign\(buildRegionMapUrl\(result\)\);/);
  assert.match(code('src/components/ApartmentQuickSearch.tsx'), /window\.location\.assign\(buildRegionMapUrl\(result\)\);/);
  // 지도 레이어·마커 우선순위·지오로케이션 정책 코드가 그대로 있다
  assert.match(MAP, /const \[layers, setLayers\] = useState<Record<LayerKey, boolean>>\(\(\) => \{/);
  assert.match(MAP, /return locateInitialCenter\(DEFAULT_MAP_CENTER, \{/);
  assert.match(MAP, /const restored = readInitialMapStateFromUrl\(\)\?\.layers;/);
});
