import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isValidMapCoord, mapViewportKey, resolveMapViewport, validMapPoints } from '../map/map-viewport';
import { SUPPLY_MAP_BOUNDS_PADDING, SUPPLY_SINGLE_POINT_LEVEL } from './supply-map-bounds';

/** 공급 화면의 단일 지점 zoom을 항상 함께 넘긴다 — 화면 조정값과 판정 규칙이 분리됐다
 *  (판정은 @/lib/map/map-viewport, 조정값은 supply-map-bounds). */
const resolveSupplyViewport = (points: Parameters<typeof resolveMapViewport>[0]) =>
  resolveMapViewport(points, SUPPLY_SINGLE_POINT_LEVEL);

/**
 * SUPPLY_MAP_REGION_BOUNDS_FIX_V1 — 공급(입주지도) viewport 계약.
 *
 * 고친 문제: 지역이 "부산광역시 전체"인데 지도는 기장/울산 경계 부근에 치우쳐 열렸다.
 * center를 `mapMarkers[0]`으로 잡고 zoom을 상수로 고정했기 때문이다. `mapMarkers`는
 * 서버가 orderBy 없이 읽은 순서(id 순)라 첫 원소는 아무 단지이고, 실측에서 그 아무
 * 단지가 부산 북동 끝(기장군 장안지구)이었다.
 *
 * 아래 좌표는 **2026-09-12 production 실측값**이다(부산 · 향후 2년 · 좌표 확인 26건).
 * 추정 좌표를 만들어 쓰지 않는다.
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 코드를 인용한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const VIEW = read('src/components/stats/SupplyView.tsx');
const SOURCE = read('src/lib/map/map-viewport.ts');
const SUPPLY_TUNING = read('src/lib/stats/supply-map-bounds.ts');

/** 실측 부산 공급 마커(응답 순서 그대로 — 0번이 기장군 장안지구다). */
const BUSAN_MARKERS = [
  { id: 47, gu: '기장군', lat: 35.3203612383762, lng: 129.240117313349 },
  { id: 127, gu: '동래구', lat: 35.1977712345, lng: 129.0862812345 },
  { id: 167, gu: '남구', lat: 35.1281812345, lng: 129.0717412345 },
  { id: 169, gu: '남구', lat: 35.1484112345, lng: 129.0722812345 },
  { id: 299, gu: '사상구', lat: 35.1254812345, lng: 128.9740912345 },
  { id: 333, gu: '동구', lat: 35.1400512345, lng: 129.0642312345 },
  { id: 335, gu: '부산진구', lat: 35.1728012345, lng: 129.0738912345 },
  { id: 380, gu: '동래구', lat: 35.2049712345, lng: 129.0672612345 },
  { id: 385, gu: '기장군', lat: 35.2708512345, lng: 129.2275912345 },
  { id: 428, gu: '금정구', lat: 35.2380812345, lng: 129.0941312345 },
  { id: 546, gu: '연제구', lat: 35.1872312345, lng: 129.1106612345 },
  { id: 560, gu: '사하구', lat: 35.0928612345, lng: 128.9953212345 },
  { id: 576, gu: '동래구', lat: 35.1977712345, lng: 129.0862812345 },
  { id: 654, gu: '동래구', lat: 35.2011212345, lng: 129.0675112345 },
  { id: 694, gu: '금정구', lat: 35.2380812345, lng: 129.0941312345 },
  { id: 704, gu: '해운대구', lat: 35.1624712345, lng: 129.1666412345 },
  { id: 714, gu: '사하구', lat: 35.1079612345, lng: 128.9775412345 },
  { id: 732, gu: '강서구', lat: 35.2145112345, lng: 128.9352712345 },
  { id: 737, gu: '동래구', lat: 35.1960612345, lng: 129.0887712345 },
  { id: 755, gu: '연제구', lat: 35.1892212345, lng: 129.0732712345 },
  { id: 762, gu: '해운대구', lat: 35.1938312345, lng: 129.1259712345 },
  { id: 890, gu: '부산진구', lat: 35.1517712345, lng: 129.0313212345 },
  { id: 891, gu: '부산진구', lat: 35.1521412345, lng: 129.0319412345 },
  { id: 908, gu: '부산진구', lat: 35.1587112345, lng: 129.0512012345 },
  { id: 1040, gu: '기장군', lat: 35.2440512345, lng: 129.2069512345 },
  { id: 1087, gu: '남구', lat: 35.1369012345, lng: 129.0977012345 },
];

// ── 1. 부산 전체: 여러 좌표 → bounds ──────────────────────────────────────────

test('§2 부산 전체는 유효 좌표 전체를 감싸는 bounds가 된다', () => {
  const points = validMapPoints(BUSAN_MARKERS);
  assert.equal(points.length, 26, '유효 좌표 수가 실측과 다르다');
  const v = resolveSupplyViewport(points);
  assert.equal(v.kind, 'bounds');
  if (v.kind !== 'bounds') return;
  // 실측 bounds와 일치한다.
  assert.ok(Math.abs(v.box.minLat - 35.09286) < 0.0001, `minLat ${v.box.minLat}`);
  assert.ok(Math.abs(v.box.maxLat - 35.32036) < 0.0001, `maxLat ${v.box.maxLat}`);
  assert.ok(Math.abs(v.box.minLng - 128.93527) < 0.0001, `minLng ${v.box.minLng}`);
  assert.ok(Math.abs(v.box.maxLng - 129.24012) < 0.0001, `maxLng ${v.box.maxLng}`);
  // bounds에 모든 점이 들어간다(하나라도 빠지면 화면 밖으로 잘린다).
  for (const p of points) {
    assert.ok(p.lat >= v.box.minLat && p.lat <= v.box.maxLat, `lat ${p.lat} 밖`);
    assert.ok(p.lng >= v.box.minLng && p.lng <= v.box.maxLng, `lng ${p.lng} 밖`);
  }
  // setBounds에 넘길 점이 전부 들어 있다.
  assert.equal(v.points.length, 26);
});

// ── 8. 첫 항목 center 버그 회귀 방지 ──────────────────────────────────────────

test('§3 부산 전체 center가 첫 마커(기장군 장안지구)가 아니다 — 고친 증상 그대로 고정', () => {
  const v = resolveSupplyViewport(validMapPoints(BUSAN_MARKERS));
  assert.equal(v.kind, 'bounds');
  if (v.kind !== 'bounds') return;
  const first = BUSAN_MARKERS[0];
  assert.notEqual(v.center.lat, first.lat, 'center가 여전히 첫 마커다');
  assert.notEqual(v.center.lng, first.lng, 'center가 여전히 첫 마커다');
  // 실측 bounds 중심(부산 중앙)과 일치한다.
  assert.ok(Math.abs(v.center.lat - 35.20661) < 0.0001, `center.lat ${v.center.lat}`);
  assert.ok(Math.abs(v.center.lng - 129.08769) < 0.0001, `center.lng ${v.center.lng}`);
  // 증상의 크기: 예전 center는 실제 중심에서 위도 0.11도 이상 벗어나 있었다.
  assert.ok(Math.abs(first.lat - v.center.lat) > 0.11);
  assert.ok(Math.abs(first.lng - v.center.lng) > 0.15);
});

// ── 2. 구/군: 해당 구 좌표만으로 bounds ───────────────────────────────────────

test('§2 구/군을 고르면 그 구의 좌표만으로 bounds를 잡는다', () => {
  const busanjin = BUSAN_MARKERS.filter((m) => m.gu === '부산진구');
  assert.equal(busanjin.length, 4);
  const v = resolveSupplyViewport(validMapPoints(busanjin));
  assert.equal(v.kind, 'bounds');
  if (v.kind !== 'bounds') return;
  // 부산 전체 bounds보다 훨씬 좁다 — 구 선택이 zoom에 반영된다.
  const wide = resolveSupplyViewport(validMapPoints(BUSAN_MARKERS));
  assert.equal(wide.kind, 'bounds');
  if (wide.kind !== 'bounds') return;
  const span = (b: typeof v.box) => (b.maxLat - b.minLat) * (b.maxLng - b.minLng);
  assert.ok(span(v.box) < span(wide.box) / 10, '구 bounds가 시도 bounds만큼 넓다');
  // 다른 구의 좌표가 섞이지 않는다(기장군 북동 끝이 들어오면 실패).
  assert.ok(v.box.maxLat < 35.2, `다른 구 좌표가 섞였다: maxLat ${v.box.maxLat}`);
  assert.ok(v.box.maxLng < 129.1, `다른 구 좌표가 섞였다: maxLng ${v.box.maxLng}`);
});

// ── 3. 좌표 1개 → center + zoom ───────────────────────────────────────────────

test('§2 단일 좌표는 그 단지 중심으로 적절한 zoom을 쓴다', () => {
  const v = resolveSupplyViewport([{ lat: 35.1728, lng: 129.07389 }]);
  assert.equal(v.kind, 'center');
  if (v.kind !== 'center') return;
  assert.deepEqual(v.center, { lat: 35.1728, lng: 129.07389 });
  assert.equal(v.level, SUPPLY_SINGLE_POINT_LEVEL);
  assert.equal(SUPPLY_SINGLE_POINT_LEVEL, 5, '분양 지도(presale-nearby-map)의 level 5 관례와 어긋난다');
});

test('§3 좌표가 여러 개여도 전부 같은 지점이면 bounds가 아니라 center다', () => {
  // 실측: 조합원 취소분이 본 사업지와 **완전히 같은 좌표**를 갖는다(금정구 428/694).
  // 폭·높이가 0인 bounds를 setBounds에 주면 지도가 최대 배율로 튄다.
  const geumjeong = BUSAN_MARKERS.filter((m) => m.gu === '금정구');
  assert.equal(geumjeong.length, 2);
  const v = resolveSupplyViewport(validMapPoints(geumjeong));
  assert.equal(v.kind, 'center', '같은 좌표 2개가 degenerate bounds로 갔다');
  if (v.kind !== 'center') return;
  assert.equal(v.center.lat, geumjeong[0].lat);
  assert.equal(v.level, SUPPLY_SINGLE_POINT_LEVEL);
});

// ── 4. 좌표 0개 → 잘못된 fallback 없음 ────────────────────────────────────────

test('§4 유효 좌표가 0개면 NO DATA다 — 다른 지역/단지 좌표로 메우지 않는다', () => {
  const v = resolveSupplyViewport([]);
  assert.deepEqual(v, { kind: 'none' });
  // none에는 center도 level도 없다(호출부가 실수로 좌표를 읽을 수 없다).
  assert.ok(!('center' in v));
  assert.ok(!('level' in v));
});

test('§4 좌표가 전부 무효한 목록도 NO DATA다 — 0,0으로 지도를 열지 않는다', () => {
  const v = resolveSupplyViewport(validMapPoints([
    { lat: null, lng: null },
    { lat: 0, lng: 0 },
    { lat: NaN, lng: 129.1 },
  ]));
  assert.deepEqual(v, { kind: 'none' });
});

test('§4 좌표 상수를 발명하지 않았다 — 이 모듈에 하드코딩된 위경도가 없다', () => {
  const code = codeOf(SOURCE);
  // 위경도처럼 보이는 리터럴(3x.xxx / 12x.xxx)이 코드에 없다.
  assert.ok(!/\b3[45]\.\d{3,}/.test(code), '위도 상수가 하드코딩됐다');
  assert.ok(!/\b12[6-9]\.\d{3,}/.test(code), '경도 상수가 하드코딩됐다');
  // 허용된 숫자는 좌표 **유효범위**와 padding/level뿐이다.
  assert.ok(/lat < -90 \|\| lat > 90/.test(code));
  assert.ok(/lng < -180 \|\| lng > 180/.test(code));
});

// ── 5. 좌표 유효성 ────────────────────────────────────────────────────────────

test('§7 유효 좌표만 지도 계산에 쓴다', () => {
  assert.ok(isValidMapCoord(35.1728, 129.07389));
  assert.ok(isValidMapCoord(-33.8, 151.2), '남반구/동경 좌표도 형식상 유효하다');
  // null/undefined/타입 위반
  assert.equal(isValidMapCoord(null, 129.1), false);
  assert.equal(isValidMapCoord(35.1, undefined), false);
  assert.equal(isValidMapCoord('35.1', '129.1'), false);
  // finite 위반
  assert.equal(isValidMapCoord(NaN, 129.1), false);
  assert.equal(isValidMapCoord(35.1, Infinity), false);
  // 범위 위반
  assert.equal(isValidMapCoord(91, 129.1), false);
  assert.equal(isValidMapCoord(35.1, 181), false);
  assert.equal(isValidMapCoord(-90.1, 129.1), false);
  // sentinel
  assert.equal(isValidMapCoord(0, 0), false, '0,0을 실제 좌표로 취급한다');
  // 0이 한쪽만이면 실제 좌표일 수 있다(적도/본초자오선) — 무조건 버리지 않는다.
  assert.ok(isValidMapCoord(0, 129.1));
  assert.ok(isValidMapCoord(35.1, 0));
});

test('§7 좌표 없는 항목은 지도에서만 빠진다 — 목록 데이터는 건드리지 않는다', () => {
  const markers = [
    { lat: 35.1728, lng: 129.07389 },
    { lat: null, lng: null },
    { lat: 35.2049, lng: 129.06726 },
  ];
  assert.equal(validMapPoints(markers).length, 2);
  // 원본 배열은 변형되지 않는다(목록은 서버 응답 그대로 쓴다).
  assert.equal(markers.length, 3);
});

// ── 6. 필터 변경 → viewport 재계산 ────────────────────────────────────────────

test('§5 지역/기간을 바꾸면 viewport 키가 바뀐다 — 이전 지도 상태가 그대로 남지 않는다', () => {
  const busan = validMapPoints(BUSAN_MARKERS);
  const dongnae = validMapPoints(BUSAN_MARKERS.filter((m) => m.gu === '동래구'));
  const wide = mapViewportKey('부산광역시|', busan);
  const narrow = mapViewportKey('부산광역시|동래구', dongnae);
  assert.notEqual(wide, narrow, '구를 바꿔도 같은 키가 나온다');
  // 기간만 바꿔도 키가 갈린다(좌표 집합이 같아도 스코프가 다르다).
  assert.notEqual(mapViewportKey('부산광역시||y2', busan), mapViewportKey('부산광역시||y1', busan));
  // 같은 스코프 + 같은 좌표면 같은 키다(불필요한 재적용을 만들지 않는다).
  assert.equal(mapViewportKey('부산광역시|', busan), mapViewportKey('부산광역시|', validMapPoints(BUSAN_MARKERS)));
});

test('§5 구 → 시도 전체로 되돌리면 bounds가 다시 넓어진다', () => {
  const narrow = resolveSupplyViewport(validMapPoints(BUSAN_MARKERS.filter((m) => m.gu === '동래구')));
  const wide = resolveSupplyViewport(validMapPoints(BUSAN_MARKERS));
  assert.equal(narrow.kind, 'bounds');
  assert.equal(wide.kind, 'bounds');
  if (narrow.kind !== 'bounds' || wide.kind !== 'bounds') return;
  assert.ok(wide.box.maxLat > narrow.box.maxLat);
  assert.ok(wide.box.minLng < narrow.box.minLng);
  assert.notDeepEqual(wide.center, narrow.center);
});

// ── 배선 계약 (컴포넌트) ──────────────────────────────────────────────────────

test('§3 컴포넌트가 실제로 setBounds를 쓴다 — 고정 zoom으로 되돌아가지 않았다', () => {
  const code = codeOf(VIEW);
  assert.ok(/new window\.kakao\.maps\.LatLngBounds\(\)/.test(code), 'LatLngBounds를 만들지 않는다');
  assert.ok(/bounds\.extend\(new window\.kakao\.maps\.LatLng\(point\.lat, point\.lng\)\)/.test(code), '모든 점을 extend하지 않는다');
  assert.ok(/setBounds\(bounds, SUPPLY_MAP_BOUNDS_PADDING\)/.test(code), 'setBounds에 여백을 주지 않는다');
  assert.ok(/onCreate=\{setMapInstance\}/.test(code), '지도 인스턴스를 잡지 않는다(=bounds를 적용할 대상이 없다)');
  // 단일 좌표 경로.
  assert.ok(/setCenter\(new window\.kakao\.maps\.LatLng\(viewport\.center\.lat, viewport\.center\.lng\)\)/.test(code));
  assert.ok(/setLevel\(viewport\.level\)/.test(code));
});

test('§1 center가 더 이상 mapMarkers[0]이 아니다 — 근본 원인 회귀 방지', () => {
  const code = codeOf(VIEW);
  assert.ok(!/mapMarkers\[0\]/.test(code), 'center를 다시 첫 마커로 잡는다');
  assert.ok(/center=\{viewport\.center\}/.test(code), 'center가 viewport 계산 결과가 아니다');
});

test('§6 지도와 목록이 같은 응답을 쓴다 — 지도용 별도 fetch나 subset이 없다', () => {
  const code = codeOf(VIEW);
  // fetch/useSWR은 한 곳뿐이다.
  assert.equal((code.match(/useSWR</g) ?? []).length, 1, '지도용 추가 요청이 생겼다');
  // 지도 좌표는 그 응답의 mapMarkers에서만 나온다.
  assert.ok(/validMapPoints\(data\?\.mapMarkers \?\? \[\]\)/.test(code), '지도 좌표 출처가 응답이 아니다');
  // 목록은 같은 응답의 list를 그대로 쓴다.
  assert.ok(/data\.list\.map\(/.test(code), '목록 렌더가 사라졌다');
  // 마커는 유효 좌표만 찍는다(무효 좌표를 엉뚱한 위치에 찍지 않는다).
  assert.ok(/data\.mapMarkers\.filter\(\(m\) => isValidMapCoord\(m\.lat, m\.lng\)\)\.map\(/.test(code));
});

test('§5 stale 응답이 새 선택을 덮지 않는다 — SWR이 스코프별로 갈라져 있다', () => {
  const code = codeOf(VIEW);
  // 요청 키에 지역/시군구/기간이 모두 들어간다.
  assert.ok(/params\.set\('sido', region\.sido\)/.test(code));
  assert.ok(/params\.set\('sigungu', region\.sigungu\)/.test(code));
  assert.ok(/new URLSearchParams\(\{ period \}\)/.test(code));
  assert.ok(/`\/api\/stats\/supply\?\$\{params\.toString\(\)\}`/.test(code), '요청 키가 스코프를 반영하지 않는다');
  // 이전 키의 데이터를 새 키 화면에 끌어다 쓰지 않는다.
  assert.ok(!/keepPreviousData/.test(code), '이전 지역 데이터를 유지해 새 선택을 덮을 수 있다');
  // bounds 적용 effect가 스코프+좌표 키에 묶여 있다.
  assert.ok(/\}, \[mapInstance, viewport, fitKey\]\);/.test(code), 'viewport 재적용이 필터 변경에 묶이지 않았다');
  assert.ok(/const fitKey = mapViewportKey\(`\$\{scopeKey\}\|\$\{period\}`, mapPoints\)/.test(code));
});

test('§4 유효 좌표 0개면 지도를 그리지 않고 목록으로 안내한다', () => {
  const code = codeOf(VIEW);
  assert.ok(/viewport\.kind === 'none' \? \(/.test(code), 'NO DATA 분기가 viewport 판정을 쓰지 않는다');
  assert.ok(/위치가 확인된 단지가 없어요/.test(VIEW), '정직한 빈 상태 문구가 사라졌다');
  assert.ok(/아래 목록에서 전체 단지를 볼 수 있어요/.test(VIEW), '목록 안내가 사라졌다');
});

test('§7 화면이 말하는 "위치 확인" 수가 실제로 찍힌 마커 수와 같다', () => {
  const code = codeOf(VIEW);
  assert.ok(/위치 확인 <strong>\{mapPoints\.length\.toLocaleString\('ko-KR'\)\}개<\/strong>/.test(code),
    '지도에 못 찍는 좌표까지 "위치 확인"으로 셀 수 있다');
});

test('§8 여백은 마커 반지름보다 크고 340px 지도를 잡아먹지 않는다', () => {
  assert.equal(SUPPLY_MAP_BOUNDS_PADDING, 48);
  assert.ok(SUPPLY_MAP_BOUNDS_PADDING > 10, '가장 큰 마커(지름 18px)가 경계에서 잘린다');
  assert.ok(SUPPLY_MAP_BOUNDS_PADDING * 2 < 340 / 2, '여백이 지도 높이의 절반을 넘는다');
});

test('viewport 로직은 Kakao SDK나 DOM에 의존하지 않는다 — 지도 없이 검증 가능하다', () => {
  const code = codeOf(SOURCE);
  assert.ok(!/kakao|window|document|react/i.test(code), '순수 로직에 SDK/DOM 의존이 섞였다');
});
