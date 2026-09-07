// OFFICETEL_MAP_LAYER_V1 §25 — 지도 마커 계약의 순수 로직 테스트.
// Kakao SDK 내부에 의존하지 않는다(§25) — 좌표 유효성/identity/폴백 규칙만 검증한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OFFICETEL_MARKER_ID_PREFIX,
  OFFICETEL_MAX_ZOOM_LEVEL,
  OFFICETEL_RENDER_CAP,
  OfficetelMarkerQueryError,
  buildOfficetelMapMarker,
  isOfficetelMarkerId,
  officetelMarkerAddressLine,
  officetelMarkerId,
  parseOfficetelMarkerLawdCd,
} from './map-marker-contract.ts';
import { officetelFallbackDisplayName } from './detail-contract.ts';

const row = (over = {}) => ({
  id: 2243,
  canonicalKey: 'OFFI:26230:전포동:897-0:_',
  umdNm: '전포동',
  jibun: '897-0',
  buildingDong: null,
  roadAddress: '부산광역시 부산진구 서전로 000',
  hoCnt: 312,
  latitude: 35.1533,
  longitude: 129.0625,
  ...over,
});

test('lawdCd는 5자리 숫자만 받는다', () => {
  assert.equal(parseOfficetelMarkerLawdCd('26230'), '26230');
  assert.equal(parseOfficetelMarkerLawdCd(' 26500 '), '26500');
  for (const bad of [null, '', '2623', '262300', '26a30', '전포동']) {
    assert.throws(() => parseOfficetelMarkerLawdCd(bad), OfficetelMarkerQueryError);
  }
});

test('저장 좌표가 있으면 마커가 만들어지고 identity가 그대로 보존된다', () => {
  const m = buildOfficetelMapMarker(row(), '삼정그린코아');
  assert.ok(m);
  assert.equal(m.officetelId, 2243);
  assert.equal(m.canonicalKey, 'OFFI:26230:전포동:897-0:_');
  assert.equal(m.id, 'offi-2243');
  assert.equal(m.propertyType, 'officetel');
  assert.equal(m.lat, 35.1533);
  assert.equal(m.lng, 129.0625);
  assert.equal(m.hoCnt, 312);
});

test('좌표가 없거나 쓸 수 없으면 마커에서 제외한다(추정 좌표 금지)', () => {
  const cases = [
    { latitude: null, longitude: 129.0625 },
    { latitude: 35.1533, longitude: null },
    { latitude: null, longitude: null },
    { latitude: Number.NaN, longitude: 129.0625 },
    { latitude: 35.1533, longitude: Number.POSITIVE_INFINITY },
    { latitude: 0, longitude: 0 },
  ];
  for (const c of cases) {
    assert.equal(buildOfficetelMapMarker(row(c), '이름'), null);
  }
});

test('마커 id는 아파트 마커 id와 구분되는 접두사를 갖는다', () => {
  assert.equal(officetelMarkerId(7), `${OFFICETEL_MARKER_ID_PREFIX}7`);
  assert.ok(isOfficetelMarkerId('offi-7'));
  // 아파트 마커 id는 aptSeq(예: '26230-1234') 또는 `dong-name` 형태다.
  assert.equal(isOfficetelMarkerId('26230-1234'), false);
  assert.equal(isOfficetelMarkerId('전포동-삼정그린코아'), false);
  assert.equal(isOfficetelMarkerId(null), false);
  assert.equal(isOfficetelMarkerId(undefined), false);
});

test('표시명이 비어 있으면 검색/상세와 같은 "법정동 지번 오피스텔" 폴백을 쓴다', () => {
  const src = row({ officetelName: '' });
  const displayName = officetelFallbackDisplayName({ officetelName: '', umdNm: src.umdNm, jibun: src.jibun });
  assert.equal(displayName, '전포동 897-0 오피스텔');
  const m = buildOfficetelMapMarker(src, displayName);
  assert.equal(m.displayName, '전포동 897-0 오피스텔');
  // 폴백은 표시 전용이다 — identity는 여전히 master id / canonicalKey다.
  assert.equal(m.officetelId, 2243);
  assert.equal(m.canonicalKey, 'OFFI:26230:전포동:897-0:_');
});

test('주소 한 줄은 도로명 우선, 없으면 지번으로 만든다', () => {
  assert.equal(
    officetelMarkerAddressLine({ roadAddress: '부산 부산진구 서전로 10', dong: '전포동', jibun: '897-0' }),
    '부산 부산진구 서전로 10'
  );
  assert.equal(officetelMarkerAddressLine({ roadAddress: '   ', dong: '전포동', jibun: '897-0' }), '전포동 897-0');
  assert.equal(officetelMarkerAddressLine({ roadAddress: null, dong: '', jibun: '' }), null);
});

test('동일 좌표를 공유하는 master들은 각자의 identity를 유지한다(합치지 않는다)', () => {
  const a = buildOfficetelMapMarker(row({ id: 100, canonicalKey: 'OFFI:26500:광안동:1-1:A' }), 'A동');
  const b = buildOfficetelMapMarker(row({ id: 101, canonicalKey: 'OFFI:26500:광안동:1-1:B' }), 'B동');
  assert.equal(a.lat, b.lat);
  assert.equal(a.lng, b.lng);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.officetelId, b.officetelId);
  assert.notEqual(a.canonicalKey, b.canonicalKey);
});

test('렌더 상한/확대 임계값은 화면이 참조할 수 있게 계약으로 노출된다', () => {
  assert.equal(typeof OFFICETEL_RENDER_CAP, 'number');
  assert.ok(OFFICETEL_RENDER_CAP > 0);
  assert.equal(typeof OFFICETEL_MAX_ZOOM_LEVEL, 'number');
});
