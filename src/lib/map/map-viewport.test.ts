import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isValidMapCoord, mapViewportKey, resolveMapViewport, validMapPoints, type MapPoint } from './map-viewport';

/**
 * 공용 지도 viewport 판정 계약.
 *
 * 같은 버그가 두 화면에서 따로 발견돼 규칙을 이 모듈로 모았다:
 *   · 통계 > 공급(입주지도)  — center를 `mapMarkers[0]`으로, zoom을 상수로
 *   · 통계 > 변동지도        — center를 geocode가 먼저 돌아온 항목으로, zoom을 상수 9/7로
 *
 * 여기서 고정하는 것은 "좌표 목록 → bounds / center / none" 판정뿐이다. 화면별 조정값
 * (여백 px, 단일 지점 zoom)은 각 화면 옆에 있고 그 값은 화면별 테스트가 고정한다.
 */

const ROOT = resolve(__dirname, '../../..');
const SOURCE = readFileSync(resolve(ROOT, 'src/lib/map/map-viewport.ts'), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 코드를 인용한다 — 소스 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const LEVEL = 7;

// ── 1. 서로 다른 좌표 2개 이상 → bounds ───────────────────────────────────────

test('서로 다른 좌표가 여러 개면 전부 감싸는 bounds가 된다', () => {
  const points: MapPoint[] = [
    { lat: 35.1728, lng: 129.07389 },
    { lat: 35.09286, lng: 128.99532 },
    { lat: 35.32036, lng: 129.24011 },
  ];
  const v = resolveMapViewport(points, LEVEL);
  assert.equal(v.kind, 'bounds');
  if (v.kind !== 'bounds') return;
  assert.deepEqual(v.box, { minLat: 35.09286, maxLat: 35.32036, minLng: 128.99532, maxLng: 129.24011 });
  assert.equal(v.points.length, 3);
  // 모든 점이 box 안에 있다.
  for (const p of points) {
    assert.ok(p.lat >= v.box.minLat && p.lat <= v.box.maxLat);
    assert.ok(p.lng >= v.box.minLng && p.lng <= v.box.maxLng);
  }
  // center는 box 중심이다(첫 원소가 아니다).
  assert.equal(v.center.lat, (35.09286 + 35.32036) / 2);
  assert.equal(v.center.lng, (128.99532 + 129.24011) / 2);
  assert.notDeepEqual(v.center, points[0]);
});

test('입력 순서가 바뀌어도 같은 viewport가 나온다 — 먼저 도착한 좌표가 center를 정하지 않는다', () => {
  // 변동지도의 근본 원인: center가 geocode 콜백이 **먼저 돌아온 항목**이었다.
  // 순서는 네트워크 경쟁 결과라 같은 지역을 두 번 열면 지도가 다른 곳을 봤다.
  const a: MapPoint[] = [
    { lat: 35.1728, lng: 129.07389 },
    { lat: 35.09286, lng: 128.99532 },
    { lat: 35.32036, lng: 129.24011 },
  ];
  const b: MapPoint[] = [a[2], a[0], a[1]];
  const va = resolveMapViewport(a, LEVEL);
  const vb = resolveMapViewport(b, LEVEL);
  assert.equal(va.kind, 'bounds');
  assert.equal(vb.kind, 'bounds');
  if (va.kind !== 'bounds' || vb.kind !== 'bounds') return;
  assert.deepEqual(va.box, vb.box);
  assert.deepEqual(va.center, vb.center);
});

test('원본 배열을 변형하지 않는다', () => {
  const points: MapPoint[] = [{ lat: 35.1, lng: 129.0 }, { lat: 35.2, lng: 129.1 }];
  const v = resolveMapViewport(points, LEVEL);
  assert.equal(points.length, 2);
  if (v.kind !== 'bounds') return;
  // 돌려준 배열은 사본이다(호출부가 흔들어도 입력이 바뀌지 않는다).
  v.points.push({ lat: 0, lng: 0 });
  assert.equal(points.length, 2);
});

// ── 2. 좌표 1개 → center + 화면이 정한 level ───────────────────────────────────

test('좌표가 하나면 그 지점 center와 호출부가 준 level을 쓴다', () => {
  const v = resolveMapViewport([{ lat: 35.1728, lng: 129.07389 }], 5);
  assert.equal(v.kind, 'center');
  if (v.kind !== 'center') return;
  assert.deepEqual(v.center, { lat: 35.1728, lng: 129.07389 });
  assert.equal(v.level, 5);
  // level은 파라미터다 — 화면마다 다른 값을 쓸 수 있다(공급 5 / 변동지도 7).
  const other = resolveMapViewport([{ lat: 35.1728, lng: 129.07389 }], 7);
  assert.equal(other.kind === 'center' && other.level, 7);
});

// ── 3. 좌표가 전부 같은 여러 행 → single-point 취급 ───────────────────────────

test('서로 다른 행이어도 좌표가 모두 같으면 bounds가 아니라 center다', () => {
  // 폭·높이 0인 bounds를 setBounds에 주면 지도가 최대 배율로 튄다.
  const same = { lat: 35.23808, lng: 129.09413 };
  const v = resolveMapViewport([{ ...same }, { ...same }, { ...same }], LEVEL);
  assert.equal(v.kind, 'center', 'degenerate bounds로 갔다');
  if (v.kind !== 'center') return;
  assert.deepEqual(v.center, same);
  assert.equal(v.level, LEVEL);
});

test('좌표가 미세하게라도 다르면 bounds다 — 같은 값만 접는다', () => {
  const v = resolveMapViewport([
    { lat: 35.23808, lng: 129.09413 },
    { lat: 35.23809, lng: 129.09413 },
  ], LEVEL);
  assert.equal(v.kind, 'bounds');
});

// ── 4. 좌표 0개 → 잘못된 fallback 없음 ────────────────────────────────────────

test('유효 좌표가 0개면 none이다 — center도 level도 주지 않는다', () => {
  const v = resolveMapViewport([], LEVEL);
  assert.deepEqual(v, { kind: 'none' });
  assert.ok(!('center' in v), 'none에 center가 있으면 호출부가 없는 위치를 가리킬 수 있다');
  assert.ok(!('level' in v));
});

test('좌표 상수를 발명하지 않았다 — 이 모듈에 위경도 리터럴이 없다', () => {
  const code = codeOf(SOURCE);
  assert.ok(!/\b3[0-9]\.\d{3,}/.test(code), '위도 상수가 하드코딩됐다');
  assert.ok(!/\b12[0-9]\.\d{3,}/.test(code), '경도 상수가 하드코딩됐다');
  // 허용되는 숫자는 좌표 유효범위뿐이다.
  assert.ok(/lat < -90 \|\| lat > 90/.test(code));
  assert.ok(/lng < -180 \|\| lng > 180/.test(code));
});

// ── 5. 좌표 유효성 ───────────────────────────────────────────────────────────

test('유효 좌표만 통과시킨다', () => {
  assert.ok(isValidMapCoord(35.1728, 129.07389));
  assert.ok(isValidMapCoord(-33.8, 151.2), '남반구/동경 좌표도 형식상 유효하다');
  assert.ok(isValidMapCoord(90, 180), '경계값은 유효하다');
  assert.ok(isValidMapCoord(-90, -180));

  assert.equal(isValidMapCoord(null, 129.1), false);
  assert.equal(isValidMapCoord(35.1, undefined), false);
  assert.equal(isValidMapCoord('35.1', '129.1'), false, '문자열 좌표를 통과시킨다');
  assert.equal(isValidMapCoord(NaN, 129.1), false, 'parseFloat 실패값을 통과시킨다');
  assert.equal(isValidMapCoord(35.1, Infinity), false);
  assert.equal(isValidMapCoord(90.1, 129.1), false);
  assert.equal(isValidMapCoord(35.1, 180.1), false);
  assert.equal(isValidMapCoord(0, 0), false, '0,0 sentinel을 실제 좌표로 취급한다');
  // 한쪽만 0이면 실제 좌표일 수 있다(적도/본초자오선).
  assert.ok(isValidMapCoord(0, 129.1));
  assert.ok(isValidMapCoord(35.1, 0));
});

test('무효 좌표는 목록에서만 빠지고 원본은 그대로다', () => {
  const items = [
    { lat: 35.1728, lng: 129.07389 },
    { lat: null, lng: null },
    { lat: NaN, lng: 129.1 },
    { lat: 0, lng: 0 },
    { lat: '35.2', lng: '129.2' },
    { lat: 35.2049, lng: 129.06726 },
  ];
  const points = validMapPoints(items);
  assert.equal(points.length, 2);
  assert.deepEqual(points, [{ lat: 35.1728, lng: 129.07389 }, { lat: 35.2049, lng: 129.06726 }]);
  assert.equal(items.length, 6, '원본 배열이 변형됐다');
});

test('무효 좌표만 있으면 none이다 — 0,0으로 지도를 열지 않는다', () => {
  assert.deepEqual(resolveMapViewport(validMapPoints([{ lat: 0, lng: 0 }, { lat: NaN, lng: NaN }]), LEVEL), { kind: 'none' });
});

// ── 6. viewport 키 ───────────────────────────────────────────────────────────

test('스코프나 좌표가 바뀌면 viewport 키가 바뀐다', () => {
  const a: MapPoint[] = [{ lat: 35.1, lng: 129.0 }, { lat: 35.2, lng: 129.1 }];
  const b: MapPoint[] = [{ lat: 35.1, lng: 129.0 }];
  assert.notEqual(mapViewportKey('부산광역시', a), mapViewportKey('부산광역시 해운대구', a), '스코프가 달라도 같은 키다');
  assert.notEqual(mapViewportKey('부산광역시', a), mapViewportKey('부산광역시', b), '좌표가 달라도 같은 키다');
  assert.equal(mapViewportKey('부산광역시', a), mapViewportKey('부산광역시', [...a]), '같은 입력인데 키가 다르다');
});

// ── 7. 순수성 ────────────────────────────────────────────────────────────────

test('SDK·DOM·React에 의존하지 않는다 — 지도 없이 검증 가능하다', () => {
  const code = codeOf(SOURCE);
  assert.ok(!/kakao|window|document|react|useState|useEffect/i.test(code), '순수 로직에 SDK/DOM 의존이 섞였다');
  assert.ok(!/^import /m.test(code), '런타임 의존이 생겼다');
});
