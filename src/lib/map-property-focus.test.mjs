// MAP_LAYER_TOGGLE_V1 §24 — 독립 토글 / 확대 밀도 / 동일 좌표 그룹핑 / 정확 identity의
// 순수 로직 테스트. Kakao SDK 내부에는 의존하지 않는다 — 규칙만 검증한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INDIVIDUAL_MARKER_MAX_LEVEL,
  MIXED_OFFICETEL_INDIVIDUAL_MAX_LEVEL,
  MIXED_OFFICETEL_NAME_MAX_LEVEL,
  OFFICETEL_MAX_ZOOM_LEVEL,
  OFFICETEL_NAME_MAX_LEVEL,
  ensurePropertyLayerVisible,
  findExactOfficetelMarker,
  groupByExactCoordinate,
  hasNoPropertyLayer,
  hasUsableHandoffCoords,
  isMixedPropertyMode,
  isMultiMasterGroup,
  markerDensityMode,
  mixedOverlapOffsetY,
  propertyLayerForSearchResult,
  showsOfficetelName,
  togglePropertyLayer,
} from './map-property-focus.ts';

const layers = (over = {}) => ({
  apt: true,
  officetel: false,
  livingLodging: false,
  redevelopment: false,
  auction: false,
  school: false,
  ...over,
});

// ── §2 독립 토글 ──────────────────────────────────────────────────────────────

test('§2 아파트는 독립적으로 켜고 꺼진다', () => {
  const off = togglePropertyLayer(layers(), 'apt');
  assert.equal(off.apt, false);
  assert.equal(off.officetel, false, '반대편 종류를 강제로 켜지 않는다');
  const on = togglePropertyLayer(off, 'apt');
  assert.equal(on.apt, true);
});

test('§2 오피스텔은 독립적으로 켜고 꺼진다', () => {
  const on = togglePropertyLayer(layers(), 'officetel');
  assert.equal(on.officetel, true);
  assert.equal(on.apt, true, '반대편 종류를 강제로 끄지 않는다');
  const off = togglePropertyLayer(on, 'officetel');
  assert.equal(off.officetel, false);
  assert.equal(off.apt, true);
});

test('§2 네 가지 조합이 모두 도달 가능하다', () => {
  const both = togglePropertyLayer(layers(), 'officetel');
  assert.deepEqual([both.apt, both.officetel], [true, true], '둘 다 ON');

  const officetelOnly = togglePropertyLayer(both, 'apt');
  assert.deepEqual([officetelOnly.apt, officetelOnly.officetel], [false, true], '오피스텔만');

  const none = togglePropertyLayer(officetelOnly, 'officetel');
  assert.deepEqual([none.apt, none.officetel], [false, false], '둘 다 OFF');

  const aptOnly = togglePropertyLayer(none, 'apt');
  assert.deepEqual([aptOnly.apt, aptOnly.officetel], [true, false], '아파트만');
});

test('§2 매물 토글은 다른 레이어(학교 등)를 건드리지 않는다', () => {
  const withOthers = layers({ school: true, redevelopment: true });
  const next = togglePropertyLayer(withOthers, 'officetel');
  assert.equal(next.school, true);
  assert.equal(next.redevelopment, true);
  assert.equal(next.livingLodging, false);
  assert.equal(next.auction, false);
});

test('§14 둘 다 꺼진 상태는 정상 상태로 판정된다(빈 지도 방지 로직 없음)', () => {
  assert.equal(hasNoPropertyLayer({ apt: false, officetel: false }), true);
  assert.equal(hasNoPropertyLayer({ apt: true, officetel: false }), false);
  assert.equal(hasNoPropertyLayer({ apt: false, officetel: true }), false);
  assert.equal(hasNoPropertyLayer({ apt: true, officetel: true }), false);
});

test('§6 혼합 모드 판정', () => {
  assert.equal(isMixedPropertyMode({ apt: true, officetel: true }), true);
  assert.equal(isMixedPropertyMode({ apt: true, officetel: false }), false);
  assert.equal(isMixedPropertyMode({ apt: false, officetel: true }), false);
  assert.equal(isMixedPropertyMode({ apt: false, officetel: false }), false);
});

// ── §9 검색 ───────────────────────────────────────────────────────────────────

test('§9 검색 결과 종류를 레이어 키로 옮긴다', () => {
  assert.equal(propertyLayerForSearchResult('APARTMENT'), 'apt');
  assert.equal(propertyLayerForSearchResult('OFFICETEL'), 'officetel');
  assert.equal(propertyLayerForSearchResult('REGION'), null);
  assert.equal(propertyLayerForSearchResult('무엇인가'), null);
});

test('§9 오피스텔 검색은 오피스텔을 켜고 아파트 상태를 보존한다', () => {
  // 아파트 ON + 오피스텔 OFF 에서 오피스텔 검색 → 둘 다 ON
  const fromAptOnly = ensurePropertyLayerVisible(layers(), 'officetel');
  assert.deepEqual([fromAptOnly.apt, fromAptOnly.officetel], [true, true]);

  // 아파트 OFF + 오피스텔 OFF 에서 오피스텔 검색 → 오피스텔만 ON(아파트는 그대로 OFF)
  const fromNone = ensurePropertyLayerVisible(layers({ apt: false }), 'officetel');
  assert.deepEqual([fromNone.apt, fromNone.officetel], [false, true]);
});

test('§9 아파트 검색은 아파트를 켜고 오피스텔 상태를 보존한다', () => {
  const fromOfficetelOnly = ensurePropertyLayerVisible(layers({ apt: false, officetel: true }), 'apt');
  assert.deepEqual([fromOfficetelOnly.apt, fromOfficetelOnly.officetel], [true, true]);

  const fromNone = ensurePropertyLayerVisible(layers({ apt: false }), 'apt');
  assert.deepEqual([fromNone.apt, fromNone.officetel], [true, false]);
});

test('§9 이미 켜져 있으면 상태 객체를 그대로 둔다(불필요한 리렌더 방지)', () => {
  const l = layers();
  assert.equal(ensurePropertyLayerVisible(l, 'apt'), l);
});

// ── §6 확대 단계별 밀도 ────────────────────────────────────────────────────────

test('§6 단독 모드 — 레벨 3 이하만 낱개, 그보다 축소되면 묶음', () => {
  for (const lv of [1, 2, 3]) {
    assert.equal(markerDensityMode('apt', lv), 'individual');
    assert.equal(markerDensityMode('officetel', lv), 'individual');
  }
  for (const lv of [4, 5, 6]) {
    assert.equal(markerDensityMode('apt', lv), 'grouped');
    assert.equal(markerDensityMode('officetel', lv), 'grouped');
  }
  assert.equal(INDIVIDUAL_MARKER_MAX_LEVEL, 3);
});

test('§6 혼합 모드 — 오피스텔 예산만 한 단계 조이고 아파트는 그대로', () => {
  // 레벨 3: 단독이면 오피스텔도 낱개지만, 혼합이면 묶음으로 접힌다.
  assert.equal(markerDensityMode('officetel', 3, false), 'individual');
  assert.equal(markerDensityMode('officetel', 3, true), 'grouped');
  // 아파트는 혼합에서도 레벨 3에서 낱개 가격 칩을 유지한다(정보량이 큰 쪽을 남긴다).
  assert.equal(markerDensityMode('apt', 3, true), 'individual');
  assert.equal(markerDensityMode('apt', 3, false), 'individual');
  assert.equal(MIXED_OFFICETEL_INDIVIDUAL_MAX_LEVEL, 2);
});

test('§6 혼합 모드에서 오피스텔 이름 표시도 한 단계 조인다', () => {
  assert.equal(showsOfficetelName(2, false), true);
  assert.equal(showsOfficetelName(2, true), false);
  assert.equal(showsOfficetelName(1, true), true);
  assert.equal(OFFICETEL_NAME_MAX_LEVEL, 2);
  assert.equal(MIXED_OFFICETEL_NAME_MAX_LEVEL, 1);
});

test('§6 오피스텔은 데이터가 시군구 단위라 아주 축소하면 그리지 않는다', () => {
  assert.equal(markerDensityMode('officetel', OFFICETEL_MAX_ZOOM_LEVEL), 'grouped');
  assert.equal(markerDensityMode('officetel', OFFICETEL_MAX_ZOOM_LEVEL + 1), 'hidden');
  assert.equal(markerDensityMode('officetel', OFFICETEL_MAX_ZOOM_LEVEL + 1, true), 'hidden');
  // 아파트는 같은 단계에서도 묶음으로 계속 보인다(회귀 방지).
  assert.equal(markerDensityMode('apt', OFFICETEL_MAX_ZOOM_LEVEL + 1), 'grouped');
  assert.equal(markerDensityMode('apt', 12, true), 'grouped');
});

test('§8 혼합 모드에서만 오피스텔 오버레이를 내린다', () => {
  assert.equal(mixedOverlapOffsetY(false), 0, '단독 모드는 기존 위치 그대로');
  assert.ok(mixedOverlapOffsetY(true) > 0);
});

// ── §8 동일 좌표 다중 master ──────────────────────────────────────────────────

test('§8 좌표가 완전히 같은 항목만 한 그룹으로 묶는다', () => {
  const items = [
    { id: 'offi-807', lat: 35.0970287465743, lng: 128.962625731291 },
    { id: 'offi-808', lat: 35.0970287465743, lng: 128.962625731291 },
    { id: 'offi-809', lat: 35.0970287465743, lng: 128.962625731291 },
    { id: 'offi-900', lat: 35.0970287465744, lng: 128.962625731291 }, // 아주 미세하게 다름
    { id: 'offi-901', lat: 35.1, lng: 129.1 },
  ];
  const groups = groupByExactCoordinate(items);
  assert.deepEqual(groups.map((g) => g.members.length).sort(), [1, 1, 3]);

  const big = groups.find((g) => g.members.length === 3);
  assert.ok(isMultiMasterGroup(big));
  assert.deepEqual(big.members.map((m) => m.id), ['offi-807', 'offi-808', 'offi-809']);
  assert.equal(big.lat, 35.0970287465743);

  // 반올림으로 묶지 않는다: 소수점 13자리만 달라도 다른 위치다.
  assert.equal(groups.find((g) => g.members.some((m) => m.id === 'offi-900')).members.length, 1);
});

test('§8 단일 항목 그룹은 원래 id를 유지하고 목록으로 펼치지 않는다', () => {
  const groups = groupByExactCoordinate([{ id: 'offi-1', lat: 1, lng: 2 }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'offi-1');
  assert.equal(isMultiMasterGroup(groups[0]), false);
});

test('§8 그룹 id는 멤버 구성이 바뀌면 함께 바뀐다(오래된 그룹이 재사용되지 않는다)', () => {
  const a = groupByExactCoordinate([
    { id: 'offi-1', lat: 1, lng: 2 },
    { id: 'offi-2', lat: 1, lng: 2 },
  ])[0];
  const b = groupByExactCoordinate([
    { id: 'offi-1', lat: 1, lng: 2 },
    { id: 'offi-3', lat: 1, lng: 2 },
  ])[0];
  assert.notEqual(a.id, b.id);
});

test('빈 입력은 빈 그룹 목록', () => {
  assert.deepEqual(groupByExactCoordinate([]), []);
});

// ── §9/§10 정확 identity ──────────────────────────────────────────────────────

test('§10 검색 핸드오프는 정확히 같은 master id만 선택한다', () => {
  const markers = [
    { id: 'offi-807', officetelId: 807, displayName: 'A동' },
    { id: 'offi-808', officetelId: 808, displayName: 'B동' },
    { id: 'offi-2243', officetelId: 2243, displayName: '한일오르듀' },
  ];
  assert.equal(findExactOfficetelMarker(markers, 808).displayName, 'B동');
  assert.equal(findExactOfficetelMarker(markers, 2243).displayName, '한일오르듀');

  // 없는 id면 **아무것도 고르지 않는다** — 이웃/첫 결과로 대체하지 않는다.
  assert.equal(findExactOfficetelMarker(markers, 9999), null);
  assert.equal(findExactOfficetelMarker(markers, null), null);
  assert.equal(findExactOfficetelMarker(markers, undefined), null);
  assert.equal(findExactOfficetelMarker(markers, Number.NaN), null);
  assert.equal(findExactOfficetelMarker([], 807), null);
});

test('§9 좌표가 없는 검색 결과로는 지도를 이동하지 않는다', () => {
  assert.equal(hasUsableHandoffCoords({ lat: 35.1554, lng: 129.1466 }), true);
  // 좌표 미해결 master는 0,0으로 내려온다 — 원점이 아니라 "모름"이다.
  assert.equal(hasUsableHandoffCoords({ lat: 0, lng: 0 }), false);
  assert.equal(hasUsableHandoffCoords({ lat: Number.NaN, lng: 129 }), false);
  assert.equal(hasUsableHandoffCoords({ lat: 35, lng: Number.POSITIVE_INFINITY }), false);
});
