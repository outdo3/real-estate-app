import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { buildDetailMapUrl, buildRegionMapUrl } from './registry';
import { DEFAULT_LAWD_CD, parseMapStateFromSearchParams } from '../map-marker-share';
import { shouldApplyLateGps } from '../map-initial-location';

/**
 * MAP_ENTRY_POINT_CONTEXT_AUDIT_V1 — 모든 /map 진입점 전수 감사.
 *
 * 분류: A 일반(현재 위치→IP→기본) · B 단지 컨텍스트(aptSeq+canonical 좌표) · C 지역 컨텍스트(lat/lng+lawdCd).
 * 재현된 버그: 학교 상세(`/school/…?lat&lng&lawdCd`)에서 일반 "지도" 탭(router.push('/map'))을 누르면
 * 지도가 이전 페이지 쿼리를 공유 링크로 읽어 학교 좌표로 열렸다 → 지도는 주소가 /map일 때만 URL을 읽는다.
 */

const ROOT = resolve(__dirname, '../../..');
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'));
const MAP = code('src/app/map/page.tsx');
const DETAIL = code('src/app/apt/[name]/apt-client.tsx');

function scanMapLiterals(): Record<string, number> {
  const out: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) {
        const hits = strip(readFileSync(p, 'utf8')).match(/['"`]\/map(?=[?'"`])/g);
        if (hits) out[relative(ROOT, p).replace(/\\/g, '/')] = hits.length;
      }
    }
  };
  walk(join(ROOT, 'src'));
  return out;
}

// 코드 안의 '/map' 문자열 전부와 그 의미. 새 진입점이 생기면 이 표에서 분류하고 컨텍스트 규칙을 확인한다.
const INVENTORY: Record<string, { count: number; kind: string }> = {
  'src/lib/bottom-nav-items.tsx': { count: 2, kind: 'A 하단 탭/헤더 "지도"(href + isActive) — router.push' },
  'src/app/home-client.tsx': { count: 1, kind: 'A 홈 "지도에서 찾기" — Link' },
  'src/app/my/page.tsx': { count: 1, kind: 'A MY 빈 상태 "지도에서 찾아보기" — Link' },
  'src/app/report/page.tsx': { count: 1, kind: 'A 리포트 허브 가이드 카드 — Link' },
  'src/components/report/ReportActions.tsx': { count: 1, kind: 'A 지역/일일 리포트 "지도 보기"(detailHref 없을 때) — Link' },
  'src/lib/decision-journey/registry.ts': { count: 3, kind: 'B buildDetailMapUrl · C buildRegionMapUrl(+좌표 없음 /map) — assign' },
  'src/app/map/page.tsx': { count: 1, kind: '지도 자신: URL 읽기 가드(pathname === /map)' },
  'src/lib/admin-analytics/query.ts': { count: 1, kind: '진입점 아님: 관리자 집계 SQL' },
  'src/app/map/layout.tsx': { count: 1, kind: '진입점 아님: 지도 SEO canonical/og:url 경로(메타데이터, REGIONAL_SEO_KEYWORD_LANDING_V1)' },
};

const GENERIC = { lat: 35.1907501823457, lng: 129.08614968725 };

test('1. /map 진입점 전수 목록 — 코드의 모든 /map 문자열이 분류돼 있다', () => {
  const found = scanMapLiterals();
  const expected = Object.fromEntries(Object.entries(INVENTORY).map(([k, v]) => [k, v.count]));
  assert.deepEqual(found, expected, '새 /map 진입점이 생기면 INVENTORY에 분류하고 컨텍스트 규칙을 확인할 것');
  // 명시적 진입(B/C)은 buildDetailMapUrl/buildRegionMapUrl 두 곳만 만든다
  assert.equal((DETAIL.match(/buildDetailMapUrl\(\{/g) ?? []).length, 1);
});

test('2. 일반 진입은 쿼리 없는 /map + 일반 흐름(현재 위치→IP→기본) 그대로', () => {
  assert.match(code('src/lib/bottom-nav-items.tsx'), /\{ href: '\/map', label: '지도'/);
  assert.match(code('src/components/Header.tsx'), /onClick=\{\(\) => router\.push\(href\)\}/);
  assert.match(code('src/components/ui/BottomNav.tsx'), /onClick=\{\(\) => router\.push\(item\.href\)\}/);
  assert.equal(parseMapStateFromSearchParams(new URLSearchParams('')), null);
  assert.match(MAP, /useEffect\(\(\) => \{\s*if \(initialShareLawdCdRef\.current\) return;\s*const geolocation/);
  // 재현된 버그의 원인 고정: 클라이언트 전환 중(이전 페이지 주소)에는 URL을 컨텍스트로 읽지 않는다
  assert.match(MAP, /function readInitialMapStateFromUrl\(\) \{\s*if \(typeof window === 'undefined'\) return null;\s*if \(window\.location\.pathname !== '\/map'\) return null;/);
  // 학교 상세 쿼리 자체는 파서가 공유 링크로 인식하는 모양이다 — 그래서 경로 가드가 필요하다
  const schoolQuery = new URLSearchParams({ name: '학교', lat: String(GENERIC.lat), lng: String(GENERIC.lng), lawdCd: '26470' });
  assert.ok(parseMapStateFromSearchParams(schoolQuery), '가드가 없으면 일반 진입이 이전 페이지 좌표를 상속');
  // 지도 초기 상태 읽기는 모두 이 한 함수를 거친다(다른 곳에서 window.location.search로 상태를 만들지 않음)
  assert.equal((MAP.match(/parseMapStateFromSearchParams\(/g) ?? []).length, 1);
});

test('3. 단지 컨텍스트: aptSeq + canonical 좌표 + lawdCd, 전체 이동', () => {
  const handler = DETAIL.slice(DETAIL.indexOf('const handleViewOnMap = async () => {'), DETAIL.indexOf('const reportHref'));
  assert.match(handler, /window\.location\.assign\(\s*buildDetailMapUrl\(\{/);
  const state = parseMapStateFromSearchParams(new URLSearchParams(buildDetailMapUrl({ lawdCd: '26470', dong: '연산동', name: 'X', aptSeq: '26470-1', ...GENERIC }).split('?')[1]))!;
  assert.deepEqual(state.restoreIdentity, { aptSeq: '26470-1' });
  assert.deepEqual(state.center, GENERIC);
  assert.equal(state.lawdCd, '26470');
});

test('4. 지역 컨텍스트: lat/lng + 5자리 lawdCd, 전체 이동', () => {
  for (const p of ['src/components/HomeApartmentSearch.tsx', 'src/components/ApartmentQuickSearch.tsx']) {
    assert.match(code(p), /window\.location\.assign\(buildRegionMapUrl\(result\)\);/);
  }
  const state = parseMapStateFromSearchParams(new URLSearchParams(buildRegionMapUrl({ ...GENERIC, lawdCd: '26470' }).split('?')[1]))!;
  assert.equal(state.lawdCd, '26470');
  assert.notEqual(state.lawdCd, DEFAULT_LAWD_CD);
});

test('5·6. 명시적 컨텍스트 > 지오로케이션 > IP > 기본 지역', () => {
  // URL center = source url로 즉시 확정, URL lawdCd가 있으면 GPS/IP 조회 effect 자체를 건너뜀
  assert.match(MAP, /return fromUrl\s*\? \{ resolved: true, source: 'url', center: fromUrl \}/);
  const effect = MAP.slice(MAP.indexOf('if (initialShareLawdCdRef.current) return;'));
  assert.ok(effect.indexOf("fetch('https://ipinfo.io/json'") > 0, 'IP 조회는 건너뛰는 그 effect 안에만 있다');
  // 그 밖의 IP 조회는 사용자가 누르는 "내 위치" 버튼(getCurrentPosition 실패 콜백) 하나뿐 — 시작 흐름이 아니다
  assert.equal((MAP.match(/ipinfo\.io/g) ?? []).length, 2);
  assert.match(MAP, /async \(err\) => \{\s*try \{\s*const res = await fetch\('https:\/\/ipinfo\.io\/json'\);/);
  assert.equal(shouldApplyLateGps('url', GENERIC, GENERIC), false, '늦은 GPS는 URL 출처를 덮지 않음');
});

test('7. 좌표가 없으면 추측하지 않는다', () => {
  assert.equal(parseMapStateFromSearchParams(new URLSearchParams(buildDetailMapUrl({ lawdCd: '26470', aptSeq: '26470-1' }).split('?')[1])), null);
  assert.equal(buildRegionMapUrl({ lat: 0, lng: 0, lawdCd: '26470' }), '/map');
});

test('8. 뒤로가기: 진입은 새 history 항목, 지도 안의 위치 반영은 replaceState', () => {
  assert.match(MAP, /window\.history\.replaceState\(window\.history\.state, '', next\);/);
  assert.ok(!/window\.history\.pushState\(/.test(MAP), '지도는 이동할 때마다 history를 쌓지 않음');
  // 지도 → 상세/오피스텔은 기존 router.push(뒤로가기 시 주소가 이미 /map이라 가드를 통과해 복원)
  assert.match(MAP, /router\.push\(`\/apt\/\$\{encodeURIComponent\(selectedMarker\.name\)\}\?lawdCd=\$\{currentLawdCd\}/);
  assert.match(MAP, /router\.push\(`\/officetel\/\$\{selectedOfficetel\.officetelId\}`\)/);
});

test('9. 특정 단지·지역 하드코딩 없음', () => {
  const guard = MAP.slice(MAP.indexOf('function readInitialMapStateFromUrl()'), MAP.indexOf('function readInitialMapStateFromUrl()') + 260);
  assert.ok(!/\d{5}|35\.\d|129\.\d|school/i.test(guard));
});

test('10. 지도 코어(레이어·지오로케이션·마커 프리패치)는 그대로', () => {
  assert.match(MAP, /const \[layers, setLayers\] = useState<Record<LayerKey, boolean>>\(\(\) => \{/);
  assert.match(MAP, /return locateInitialCenter\(DEFAULT_MAP_CENTER, \{/);
  assert.match(MAP, /const lawdCd = initialShareLawdCdRef\.current \?\? bootPrefetchLawdCd\(window\.location\.search\);/);
  assert.match(MAP, /initialShareLawdCdRef\.current \?\? \(isDefaultMapCenter\(center\) \? DEFAULT_LAWD_CD : undefined\);/);
});
