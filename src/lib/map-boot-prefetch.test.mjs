// PERCEIVED_PERFORMANCE_V2_4 §1/§2/§3 — 부트 프리페치 판정과 기본 지역 상수의 순수 규칙.
//
// 이 규칙은 map/layout.tsx의 인라인 부트 스크립트가 **같은 내용으로 옮겨 적혀** 있다.
// 두 곳이 어긋나면 (a) 요청을 두 번 받거나 (b) 아파트 레이어가 꺼진 링크에서도 받거나
// (c) 다른 구의 마커를 미리 받아버린다. 그래서 규칙 자체를 여기서 고정한다.
//
// 확장자를 붙여 import한다 — node 네이티브 ESM 로더는 확장자 없는 상대경로를 해석하지
// 못한다(map-marker-coords.test.mjs와 같은 관례).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LAWD_CD,
  DEFAULT_MAP_CENTER,
  isDefaultMapCenter,
  aptMarkerRequestPath,
  bootPrefetchLawdCd,
  parseMapStateFromSearchParams,
} from './map-marker-share.ts';

test('기본 지역 상수는 기존 fallback(26140/서구)과 같은 값이다', () => {
  assert.equal(DEFAULT_LAWD_CD, '26140');
  // parseMapStateFromSearchParams의 lawdCd fallback이 같은 상수를 쓰는지 — 두 곳이
  // 갈라지면 부트에서 받아둔 지역과 페이지가 쓰는 지역이 달라진다.
  const parsed = parseMapStateFromSearchParams(new URLSearchParams('lat=35.1&lng=129.0'));
  assert.equal(parsed.lawdCd, DEFAULT_LAWD_CD);
});

test('기본 center는 정확히 일치할 때만 기본 지역으로 인정한다', () => {
  assert.equal(isDefaultMapCenter(DEFAULT_MAP_CENTER), true);
  assert.equal(isDefaultMapCenter({ lat: DEFAULT_MAP_CENTER.lat, lng: DEFAULT_MAP_CENTER.lng }), true);
  // 근처 좌표는 다른 구일 수 있으므로 절대 기본으로 단정하지 않는다.
  assert.equal(isDefaultMapCenter({ lat: 35.0980, lng: 129.0244 }), false);
  assert.equal(isDefaultMapCenter({ lat: 35.1627, lng: 129.0532 }), false);
});

test('마커 요청 경로는 단일 지점에서만 만들어진다', () => {
  assert.equal(
    aptMarkerRequestPath('26230'),
    '/api/transactions?type=apt&lawdCd=26230&months=12&fields=marker'
  );
});

test('lawdCd가 있으면 그 지역을, 없으면 기본 지역을 미리 받는다', () => {
  assert.equal(bootPrefetchLawdCd('?lat=35.1&lng=129.0&zoom=4&lawdCd=26230'), '26230');
  assert.equal(bootPrefetchLawdCd(''), DEFAULT_LAWD_CD);
  assert.equal(bootPrefetchLawdCd('?zoom=4'), DEFAULT_LAWD_CD);
});

test('아파트 레이어가 꺼진 링크에서는 미리 받지 않는다', () => {
  // '-'는 "모두 꺼짐"의 직렬화 값이다(serializeLayers 계약).
  assert.equal(bootPrefetchLawdCd('?lawdCd=26230&layers=-'), null);
  assert.equal(bootPrefetchLawdCd('?lawdCd=26230&layers=officetel'), null);
  assert.equal(bootPrefetchLawdCd('?lawdCd=26230&layers=officetel,school'), null);
  // 아파트가 켜져 있으면 다른 레이어가 함께 있어도 받는다.
  assert.equal(bootPrefetchLawdCd('?lawdCd=26230&layers=apt,officetel'), '26230');
  // layers 파라미터가 아예 없으면 아파트가 기본 ON이다.
  assert.equal(bootPrefetchLawdCd('?lawdCd=26230'), '26230');
});

test('신뢰할 수 없는 lawdCd는 요청하지 않는다', () => {
  assert.equal(bootPrefetchLawdCd('?lawdCd=abcde'), null);
  assert.equal(bootPrefetchLawdCd('?lawdCd=2623'), null);
  assert.equal(bootPrefetchLawdCd('?lawdCd=262300'), null);
  assert.equal(bootPrefetchLawdCd('?lawdCd=../../etc'), null);
});
