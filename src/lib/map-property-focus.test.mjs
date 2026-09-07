// MAP_UX_V2 §26 — 포커스 모드 / 확대 밀도 / 동일 좌표 그룹핑의 순수 로직 테스트.
// Kakao SDK 내부에는 의존하지 않는다(§26) — 규칙만 검증한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INDIVIDUAL_MARKER_MAX_LEVEL,
  OFFICETEL_MAX_ZOOM_LEVEL,
  applyPropertyTypeFocus,
  currentPropertyFocus,
  findExactOfficetelMarker,
  focusForSearchResult,
  groupByExactCoordinate,
  hasUsableHandoffCoords,
  isMultiMasterGroup,
  markerDensityMode,
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

test('§4 포커스 모드 — 아파트와 오피스텔은 절대 동시에 켜지지 않는다', () => {
  const toOffi = applyPropertyTypeFocus(layers(), 'officetel');
  assert.equal(toOffi.apt, false);
  assert.equal(toOffi.officetel, true);

  const backToApt = applyPropertyTypeFocus(toOffi, 'apt');
  assert.equal(backToApt.apt, true);
  assert.equal(backToApt.officetel, false);

  // 어떤 순서로 눌러도 둘 다 켜진 상태는 만들 수 없다.
  for (const seq of [['apt'], ['officetel'], ['apt', 'officetel'], ['officetel', 'apt', 'officetel']]) {
    let l = layers();
    for (const f of seq) l = applyPropertyTypeFocus(l, f);
    assert.equal(l.apt && l.officetel, false);
    assert.equal(l.apt || l.officetel, true, '항상 정확히 하나는 켜져 있다');
  }
});

test('§4 포커스 전환은 다른 레이어(학교 등)를 건드리지 않는다', () => {
  const withSchool = layers({ school: true, redevelopment: true });
  const next = applyPropertyTypeFocus(withSchool, 'officetel');
  assert.equal(next.school, true);
  assert.equal(next.redevelopment, true);
  assert.equal(next.livingLodging, false);
  assert.equal(next.auction, false);
});

test('§4 이미 활성인 종류를 다시 눌러도 꺼지지 않는다(빈 지도 금지)', () => {
  const again = applyPropertyTypeFocus(layers(), 'apt');
  assert.equal(again.apt, true);
  const offi = applyPropertyTypeFocus(layers({ apt: false, officetel: true }), 'officetel');
  assert.equal(offi.officetel, true);
});

test('현재 포커스 읽기', () => {
  assert.equal(currentPropertyFocus({ apt: true, officetel: false }), 'apt');
  assert.equal(currentPropertyFocus({ apt: false, officetel: true }), 'officetel');
});

test('§5 검색 결과 종류가 곧 포커스가 된다', () => {
  assert.equal(focusForSearchResult('APARTMENT'), 'apt');
  assert.equal(focusForSearchResult('OFFICETEL'), 'officetel');
  // 지역 결과는 매물 종류를 바꾸지 않는다.
  assert.equal(focusForSearchResult('REGION'), null);
  assert.equal(focusForSearchResult('무엇인가'), null);
});

test('§5 오피스텔을 고르면 오피스텔 레이어가 반드시 켜진다', () => {
  const focus = focusForSearchResult('OFFICETEL');
  const next = applyPropertyTypeFocus(layers(), focus);
  assert.equal(next.officetel, true, '고른 결과가 안 보이는 상태로 끝나지 않는다');
  assert.equal(next.apt, false);
});

test('§6 확대 단계별 밀도 — 레벨 3 이하만 낱개, 그보다 축소되면 묶음', () => {
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

test('§6 오피스텔은 데이터가 시군구 단위라 아주 축소하면 그리지 않는다', () => {
  assert.equal(markerDensityMode('officetel', OFFICETEL_MAX_ZOOM_LEVEL), 'grouped');
  assert.equal(markerDensityMode('officetel', OFFICETEL_MAX_ZOOM_LEVEL + 1), 'hidden');
  // 아파트는 같은 단계에서도 묶음으로 계속 보인다(회귀 방지).
  assert.equal(markerDensityMode('apt', OFFICETEL_MAX_ZOOM_LEVEL + 1), 'grouped');
  assert.equal(markerDensityMode('apt', 12), 'grouped');
});

test('§8 좌표가 완전히 같은 항목만 한 그룹으로 묶는다', () => {
  const items = [
    { id: 'offi-807', lat: 35.0970287465743, lng: 128.962625731291 },
    { id: 'offi-808', lat: 35.0970287465743, lng: 128.962625731291 },
    { id: 'offi-809', lat: 35.0970287465743, lng: 128.962625731291 },
    { id: 'offi-900', lat: 35.0970287465744, lng: 128.962625731291 }, // 아주 미세하게 다름
    { id: 'offi-901', lat: 35.1, lng: 129.1 },
  ];
  const groups = groupByExactCoordinate(items);
  const sizes = groups.map((g) => g.members.length).sort();
  assert.deepEqual(sizes, [1, 1, 3]);

  const big = groups.find((g) => g.members.length === 3);
  assert.ok(isMultiMasterGroup(big));
  // 데이터는 합쳐지지 않는다 — 멤버가 각자 그대로 남는다.
  assert.deepEqual(big.members.map((m) => m.id), ['offi-807', 'offi-808', 'offi-809']);
  assert.equal(big.lat, 35.0970287465743);

  // 반올림으로 묶지 않는다: 소수점 13자리만 달라도 다른 위치다.
  const tiny = groups.find((g) => g.members.some((m) => m.id === 'offi-900'));
  assert.equal(tiny.members.length, 1);
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

test('§12 검색 핸드오프는 정확히 같은 master id만 선택한다', () => {
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

test('§12 좌표가 없는 검색 결과로는 지도를 이동하지 않는다', () => {
  assert.equal(hasUsableHandoffCoords({ lat: 35.1554, lng: 129.1466 }), true);
  // 좌표 미해결 master는 0,0으로 내려온다 — 원점이 아니라 "모름"이다.
  assert.equal(hasUsableHandoffCoords({ lat: 0, lng: 0 }), false);
  assert.equal(hasUsableHandoffCoords({ lat: Number.NaN, lng: 129 }), false);
  assert.equal(hasUsableHandoffCoords({ lat: 35, lng: Number.POSITIVE_INFINITY }), false);
});
