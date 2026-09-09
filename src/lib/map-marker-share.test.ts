import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMapShareParams,
  buildMapRestoreParams,
  parseMapStateFromSearchParams,
  serializeLayers,
  parseLayerParam,
  mapParamsToQueryString,
  matchRestoreIdentity,
} from './map-marker-share';

// PERCEIVED_PERFORMANCE_V2_1 §1 — 지도 view 복원 계약.
// 여기서 지키려는 것은 성능이 아니라 (a) 공유 URL 계약 불변 (b) identity 안전이다.

const CENTER = { lat: 35.1899, lng: 129.0661 };
const LAYERS_DEFAULT = { apt: true, officetel: false, livingLodging: false, redevelopment: false, auction: false, school: false };

const marker = (over: Record<string, unknown> = {}) =>
  ({ id: 'm1', aptSeq: '26470-3048', name: '레이카운티(2단지)', dong: '거제동', lat: 35.1, lng: 129.0, ...over }) as never;

test('serializeLayers: 켜진 키만 정렬해 직렬화한다', () => {
  assert.equal(serializeLayers(LAYERS_DEFAULT), 'apt');
  assert.equal(serializeLayers({ ...LAYERS_DEFAULT, officetel: true }), 'apt,officetel');
  assert.equal(serializeLayers({ officetel: true, apt: true }), 'apt,officetel'); // 입력 순서와 무관
});

test('serializeLayers: 전부 꺼짐은 빈 문자열이 아니라 "-" — "말하지 않음"과 구분한다', () => {
  assert.equal(serializeLayers({ apt: false, officetel: false }), '-');
});

test('parseLayerParam: 파라미터가 없으면 null(기본값 유지), "-"는 빈 배열(전부 꺼짐)', () => {
  assert.equal(parseLayerParam(null), null);
  assert.equal(parseLayerParam(''), null);
  assert.deepEqual(parseLayerParam('-'), []);
  assert.deepEqual(parseLayerParam('apt,officetel'), ['apt', 'officetel']);
});

test('parseMapStateFromSearchParams: layers가 없으면 null이라 기존 공유 링크 동작이 그대로다', () => {
  const st = parseMapStateFromSearchParams(new URLSearchParams('lat=35.1&lng=129.0&zoom=3&lawdCd=26470'));
  assert.ok(st);
  assert.equal(st.layers, null);
  assert.equal(st.lawdCd, '26470');
  assert.equal(st.zoomLevel, 3);
});

test('parseMapStateFromSearchParams: layers가 있으면 그 목록을 돌려준다', () => {
  const st = parseMapStateFromSearchParams(new URLSearchParams('lat=35.1&lng=129.0&layers=apt,officetel'));
  assert.deepEqual(st?.layers, ['apt', 'officetel']);
});

test('lat/lng가 없으면 여전히 null — 공유 링크가 아니라는 기존 계약 유지', () => {
  assert.equal(parseMapStateFromSearchParams(new URLSearchParams('lawdCd=26470&layers=apt')), null);
});

test('buildMapShareParams(공유 계약)는 layers를 포함하지 않는다 — 계약 불변', () => {
  const p = buildMapShareParams(CENTER, 3, '26470', marker());
  assert.equal(p.layers, undefined);
  assert.equal(p.aptSeq, '26470-3048');
});

test('buildMapRestoreParams는 공유 파라미터 + layers다', () => {
  const p = buildMapRestoreParams(CENTER, 3, '26470', marker(), LAYERS_DEFAULT);
  assert.equal(p.lat, String(CENTER.lat));
  assert.equal(p.zoom, '3');
  assert.equal(p.lawdCd, '26470');
  assert.equal(p.aptSeq, '26470-3048');
  assert.equal(p.layers, 'apt');
});

test('identity 규칙 유지: aptSeq가 있으면 aptSeq만, 없으면 dong+name, name-only는 절대 없다', () => {
  const withSeq = buildMapRestoreParams(CENTER, 3, '26470', marker(), LAYERS_DEFAULT);
  assert.equal(withSeq.aptSeq, '26470-3048');
  assert.equal(withSeq.name, undefined);

  const noSeq = buildMapRestoreParams(CENTER, 3, '26470', marker({ aptSeq: null }), LAYERS_DEFAULT);
  assert.equal(noSeq.aptSeq, undefined);
  assert.equal(noSeq.dong, '거제동');
  assert.equal(noSeq.name, '레이카운티(2단지)');

  // dong이 없으면 name만으로는 절대 싣지 않는다.
  const nameOnly = buildMapRestoreParams(CENTER, 3, '26470', marker({ aptSeq: null, dong: '' }), LAYERS_DEFAULT);
  assert.equal(nameOnly.name, undefined);
  assert.equal(nameOnly.dong, undefined);
});

test('round-trip: 만든 쿼리스트링을 다시 파싱하면 같은 상태가 나온다', () => {
  const layers = { ...LAYERS_DEFAULT, officetel: true };
  const qs = mapParamsToQueryString(buildMapRestoreParams(CENTER, 5, '26350', marker(), layers));
  const st = parseMapStateFromSearchParams(new URLSearchParams(qs));
  assert.ok(st);
  assert.deepEqual(st.center, CENTER);
  assert.equal(st.zoomLevel, 5);
  assert.equal(st.lawdCd, '26350');
  assert.deepEqual(st.restoreIdentity, { aptSeq: '26470-3048' });
  assert.deepEqual(st.layers, ['apt', 'officetel']);
});

test('round-trip: 선택 단지가 없으면 identity 없이 view만 복원된다', () => {
  const qs = mapParamsToQueryString(buildMapRestoreParams(CENTER, 4, '26110', null, LAYERS_DEFAULT));
  const st = parseMapStateFromSearchParams(new URLSearchParams(qs));
  assert.equal(st?.restoreIdentity, null);
  assert.deepEqual(st?.layers, ['apt']);
});

test('mapParamsToQueryString: 값이 없는 키는 넣지 않는다', () => {
  const qs = mapParamsToQueryString(buildMapRestoreParams(CENTER, 4, '26110', null, LAYERS_DEFAULT));
  assert.equal(qs.includes('aptSeq'), false);
  assert.equal(qs.includes('name'), false);
});

test('matchRestoreIdentity: 복원 대상이 실제 마커 목록에 없으면 다른 단지로 대체하지 않는다', () => {
  const markers = [marker({ aptSeq: '26470-9999' })];
  assert.equal(matchRestoreIdentity({ aptSeq: '26470-3048' }, markers as never), null);
});
