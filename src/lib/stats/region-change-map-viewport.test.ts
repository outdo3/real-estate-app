import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { mapViewportKey, resolveMapViewport, validMapPoints, type MapPoint } from '../map/map-viewport';

/**
 * REGION_CHANGE_MAP_BOUNDS_FIX_V1 — 변동지도(통계 > 변동) viewport 계약.
 *
 * 고친 문제: `BucketBubbles`가 지도 center를 `points[pointEntries[0][0]]`으로 잡았다.
 * 그 `points`는 Kakao Geocoder 콜백이 **도착한 순서대로** 채워지는 객체다 — 즉 center가
 * "네트워크에서 가장 먼저 돌아온 지역"이었고, 같은 지역을 두 번 열면 지도가 다른 곳을
 * 볼 수 있었다. zoom도 `uiLevel === 'sido' ? 9 : 7`로 고정이라 지역 범위와 무관했다.
 *
 * 두 번째 문제는 더 조용했다: `points`는 **한 번도 비워지지 않고** bucket key로만
 * 색인된다. 동 단위에서 그 key는 **동 이름**이라(중앙동처럼 여러 구에 같은 이름이 있다)
 * 구를 옮기면 다른 구의 같은 이름 동이 옛 좌표를 물려받았다.
 *
 * 아래 좌표는 지어낸 값이 아니라 SUPPLY_MAP_REGION_BOUNDS_FIX_V1에서 production으로
 * 실측한 부산 좌표를 재사용한다(geocoder 응답을 위조하지 않기 위해).
 */

const ROOT = resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
/** 주석은 고친 내력을 설명하느라 옛 코드를 인용한다 — 배선 검사는 코드만 본다. */
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const VIEW = read('src/components/stats/RegionChangeMapView.tsx');
const SUPPLY_VIEW = read('src/components/stats/SupplyView.tsx');

/** 이 화면의 단일 지점 zoom(컴포넌트 상수와 같은 값 — 아래 배선 검사가 고정한다). */
const REGION_CHANGE_SINGLE_POINT_LEVEL = 7;
const resolveRegionViewport = (points: ReadonlyArray<MapPoint>) =>
  resolveMapViewport(points, REGION_CHANGE_SINGLE_POINT_LEVEL);

/** 부산 구/군 실측 좌표(공급 감사에서 확인된 값 재사용). */
const HAEUNDAE = { lat: 35.1624712345, lng: 129.1666412345 };
const SAHA = { lat: 35.0928612345, lng: 128.9953212345 };
const GIJANG = { lat: 35.3203612383762, lng: 129.240117313349 };
const GANGSEO = { lat: 35.2145112345, lng: 128.9352712345 };
const GEUMJEONG = { lat: 35.2380812345, lng: 129.0941312345 };

/** `points` state를 흉내낸다 — 키는 bucket key(구는 lawdCd, 동은 동 이름). */
type PointMap = Record<string, { lat: number; lng: number }>;

/** 컴포넌트가 하는 것과 **같은 방식**으로 현재 buckets의 좌표만 모은다(§3 DATA PARITY). */
function bucketPointsOf(buckets: { key: string }[], points: PointMap): MapPoint[] {
  const list: { lat: unknown; lng: unknown }[] = [];
  for (const b of buckets) {
    const point = points[b.key];
    if (point) list.push(point);
  }
  return validMapPoints(list);
}

// ── 1. 여러 구 → bounds ──────────────────────────────────────────────────────

test('§2 구/군 버블이 여러 개면 전부 감싸는 bounds가 된다', () => {
  const buckets = [{ key: '26350' }, { key: '26380' }, { key: '26710' }, { key: '26440' }];
  const points: PointMap = { '26350': HAEUNDAE, '26380': SAHA, '26710': GIJANG, '26440': GANGSEO };
  const v = resolveRegionViewport(bucketPointsOf(buckets, points));
  assert.equal(v.kind, 'bounds');
  if (v.kind !== 'bounds') return;
  assert.equal(v.points.length, 4);
  assert.equal(v.box.minLat, SAHA.lat);
  assert.equal(v.box.maxLat, GIJANG.lat);
  assert.equal(v.box.minLng, GANGSEO.lng);
  assert.equal(v.box.maxLng, GIJANG.lng);
});

// ── 7. first-item center 회귀 방지 (근본 원인) ────────────────────────────────

test('§2 center가 geocode가 먼저 돌아온 항목이 아니다 — 도착 순서가 지도를 흔들지 않는다', () => {
  // 동 단위 bucket key는 **동 이름**이라 객체 키 삽입 순서가 그대로 보존된다(구 단위
  // 키는 lawdCd = 정수형 문자열이라 V8이 오름차순으로 재배열한다 — 그래서 예전 버그의
  // 비결정성은 동 단위에서 드러났고, 구 단위에서는 "항상 가장 작은 lawdCd"라는 다른
  // 방식으로 틀렸다). 실제로 순서가 보존되는 쪽으로 검사한다.
  const buckets = [{ key: '우동' }, { key: '중동' }, { key: '재송동' }];
  const UDONG = { lat: 35.1638, lng: 129.1636 };
  const JUNGDONG = { lat: 35.1691, lng: 129.1729 };
  const JAESONG = { lat: 35.1889, lng: 129.1268 };
  const udongFirst: PointMap = { 우동: UDONG, 중동: JUNGDONG, 재송동: JAESONG };
  const jaesongFirst: PointMap = { 재송동: JAESONG, 우동: UDONG, 중동: JUNGDONG };
  assert.notDeepEqual(Object.keys(udongFirst), Object.keys(jaesongFirst), '두 케이스의 도착 순서가 같으면 검사 의미가 없다');

  const a = resolveRegionViewport(bucketPointsOf(buckets, udongFirst));
  const b = resolveRegionViewport(bucketPointsOf(buckets, jaesongFirst));
  assert.equal(a.kind, 'bounds');
  assert.equal(b.kind, 'bounds');
  if (a.kind !== 'bounds' || b.kind !== 'bounds') return;
  assert.deepEqual(a.box, b.box, '도착 순서에 따라 bounds가 달라진다');
  assert.deepEqual(a.center, b.center, '도착 순서에 따라 center가 달라진다');
  // 예전 동작(첫 도착 항목이 center)과 다르다.
  assert.notDeepEqual(a.center, UDONG);
  assert.notDeepEqual(b.center, JAESONG);
});

test('§2 구 단위에서도 center가 "가장 작은 lawdCd"가 아니다', () => {
  // 구 단위 key는 정수형 문자열이라 Object.keys가 오름차순으로 재배열된다 — 예전 코드의
  // `pointEntries[0]`은 사실상 **항상 가장 작은 lawdCd의 구**를 center로 잡았다.
  const buckets = [{ key: '26350' }, { key: '26380' }, { key: '26710' }, { key: '26440' }];
  const points: PointMap = { '26710': GIJANG, '26350': HAEUNDAE, '26380': SAHA, '26440': GANGSEO };
  assert.equal(Object.keys(points)[0], '26350', '정수형 키 재배열 가정이 깨졌다');
  const v = resolveRegionViewport(bucketPointsOf(buckets, points));
  assert.equal(v.kind, 'bounds');
  if (v.kind !== 'bounds') return;
  assert.notDeepEqual(v.center, HAEUNDAE, 'center가 여전히 가장 작은 lawdCd의 구다');
});

test('§2 컴포넌트에서 첫 항목 center와 고정 zoom이 사라졌다', () => {
  const code = codeOf(VIEW);
  assert.ok(!/pointEntries/.test(code), 'center를 여전히 points의 첫 항목으로 잡는다');
  assert.ok(!/36\.5/.test(code) && !/127\.8/.test(code), '하드코딩된 전국 center 좌표가 남아 있다');
  assert.ok(/center=\{viewport\.center\}/.test(code), 'center가 viewport 계산 결과가 아니다');
  // zoom은 더 이상 최종값이 아니다 — 이름부터 초기값임을 드러낸다.
  assert.ok(!/zoomLevel/.test(code), '고정 zoom prop이 남아 있다');
  assert.ok(/initialLevel=\{uiLevel === 'sido' \? 9 : 7\}/.test(code), '초기 zoom 전달이 사라졌다');
  assert.ok(/level=\{viewport\.kind === 'center' \? viewport\.level : initialLevel\}/.test(code));
});

test('§2 컴포넌트가 실제로 setBounds를 쓴다', () => {
  const code = codeOf(VIEW);
  assert.ok(/new window\.kakao\.maps\.LatLngBounds\(\)/.test(code), 'LatLngBounds를 만들지 않는다');
  assert.ok(/bounds\.extend\(new window\.kakao\.maps\.LatLng\(point\.lat, point\.lng\)\)/.test(code), '모든 점을 extend하지 않는다');
  assert.ok(/setBounds\(bounds, REGION_CHANGE_MAP_BOUNDS_PADDING\)/.test(code), 'setBounds에 여백을 주지 않는다');
  assert.ok(/onCreate=\{setMapInstance\}/.test(code), '지도 인스턴스를 잡지 않는다(=bounds를 적용할 대상이 없다)');
  assert.ok(/setCenter\(new window\.kakao\.maps\.LatLng\(viewport\.center\.lat, viewport\.center\.lng\)\)/.test(code));
  assert.ok(/setLevel\(viewport\.level\)/.test(code));
  // 이 화면의 조정값이 컴포넌트 안에 있고, 단일 지점 zoom은 기존 시군구 축척(7)이다.
  assert.ok(/const REGION_CHANGE_MAP_BOUNDS_PADDING = 40;/.test(code));
  assert.ok(new RegExp(`const REGION_CHANGE_SINGLE_POINT_LEVEL = ${REGION_CHANGE_SINGLE_POINT_LEVEL};`).test(code));
});

// ── 2. 좌표 1개 → center ─────────────────────────────────────────────────────

test('§2 버블이 하나면 그 좌표 center + level 7', () => {
  const v = resolveRegionViewport(bucketPointsOf([{ key: '26350' }], { '26350': HAEUNDAE }));
  assert.equal(v.kind, 'center');
  if (v.kind !== 'center') return;
  assert.deepEqual(v.center, HAEUNDAE);
  assert.equal(v.level, REGION_CHANGE_SINGLE_POINT_LEVEL);
});

// ── 3. 좌표 동일한 여러 행 → single-point ────────────────────────────────────

test('§5 서로 다른 구인데 geocode가 같은 좌표를 주면 최대 확대로 튀지 않는다', () => {
  // Geocoder가 두 질의에 같은 대표 좌표를 줄 수 있다(같은 행정 중심을 가리키는 경우).
  const buckets = [{ key: 'A' }, { key: 'B' }];
  const v = resolveRegionViewport(bucketPointsOf(buckets, { A: GEUMJEONG, B: { ...GEUMJEONG } }));
  assert.equal(v.kind, 'center', 'degenerate bounds로 갔다');
  if (v.kind !== 'center') return;
  assert.deepEqual(v.center, GEUMJEONG);
});

// ── 4. 좌표 0개 → 잘못된 fallback 없음 ───────────────────────────────────────

test('§2 geocode가 하나도 성공하지 않으면 지도를 그리지 않는다', () => {
  const v = resolveRegionViewport(bucketPointsOf([{ key: '26350' }, { key: '26380' }], {}));
  assert.deepEqual(v, { kind: 'none' });
});

test('§2 none이면 컴포넌트가 null을 돌려준다 — 기존 truthful empty 유지', () => {
  const code = codeOf(VIEW);
  assert.ok(/if \(!apiKey \|\| !ready \|\| !KakaoMap \|\| viewport\.kind === 'none'\) return null;/.test(code),
    '좌표가 없을 때 지도를 억지로 그린다');
  // 목록과 빈 상태 분기는 그대로다(지도만 사라지고 데이터는 계속 보인다).
  assert.ok(/선택한 기간에 비교 가능한 거래가 없어요/.test(VIEW), '빈 상태 문구가 사라졌다');
  assert.ok(/데이터를 불러오지 못했어요/.test(VIEW), '오류 분기가 사라졌다');
});

// ── 5. 무효 좌표 배제 ────────────────────────────────────────────────────────

test('§4 geocoder의 parseFloat 실패값(NaN)이 bounds를 망치지 않는다', () => {
  const buckets = [{ key: 'A' }, { key: 'B' }, { key: 'C' }];
  // parseFloat('') === NaN — 응답 형식이 어긋나면 실제로 이 값이 들어온다.
  const points = { A: HAEUNDAE, B: { lat: NaN, lng: NaN }, C: SAHA } as unknown as PointMap;
  const v = resolveRegionViewport(bucketPointsOf(buckets, points));
  assert.equal(v.kind, 'bounds');
  if (v.kind !== 'bounds') return;
  assert.equal(v.points.length, 2, '무효 좌표가 bounds에 들어갔다');
  assert.ok(Number.isFinite(v.center.lat) && Number.isFinite(v.center.lng));
});

test('§4 무효 좌표는 버블도 찍지 않는다', () => {
  const code = codeOf(VIEW);
  assert.ok(/if \(!point \|\| !isValidMapCoord\(point\.lat, point\.lng\)\) return null;/.test(code),
    '무효 좌표를 엉뚱한 위치에 찍을 수 있다');
});

// ── 6. 지역 변경 / stale ─────────────────────────────────────────────────────

test('§6 지역을 바꾸면 이전 지역 좌표가 bounds에 섞이지 않는다', () => {
  // 시도(구 4개) → 시군구(동 2개)로 이동. points에는 옛 구 좌표가 남아 있을 수 있다.
  const stale: PointMap = { '26350': HAEUNDAE, '26380': SAHA, '26710': GIJANG, '26440': GANGSEO };
  const afterNavigate: PointMap = { ...stale, 우동: { lat: 35.1638, lng: 129.1636 }, 중동: { lat: 35.1691, lng: 129.1729 } };
  const dongBuckets = [{ key: '우동' }, { key: '중동' }];
  const v = resolveRegionViewport(bucketPointsOf(dongBuckets, afterNavigate));
  assert.equal(v.kind, 'bounds');
  if (v.kind !== 'bounds') return;
  assert.equal(v.points.length, 2, '이전 지역 좌표가 bounds 계산에 들어갔다');
  // 기장군(북동 끝)이 섞이면 bounds가 통째로 벌어진다.
  assert.ok(v.box.maxLat < GIJANG.lat, '이전 지역 좌표가 bounds를 넓혔다');
  assert.ok(v.box.minLng > GANGSEO.lng);
});

test('§6 지역이 바뀌면 좌표 캐시를 비운다 — 같은 이름 동이 옛 좌표를 물려받지 않는다', () => {
  const code = codeOf(VIEW);
  // queryPrefix(= "부산광역시" / "부산광역시 해운대구")가 바뀌면 points를 초기화한다.
  assert.ok(/setPoints\(\{\}\);/.test(code), '지역 변경 시 좌표를 비우지 않는다');
  const at = code.indexOf('setPoints({});');
  const after = code.slice(at, at + 120);
  assert.ok(/\}, \[queryPrefix\]\);/.test(after), '초기화가 지역 변경에 묶이지 않았다');
});

test('§6 viewport 재적용이 지역·좌표 키에 묶여 있다', () => {
  const code = codeOf(VIEW);
  assert.ok(/const fitKey = mapViewportKey\(queryPrefix, bucketPoints\);/.test(code), 'fit 키가 지역을 반영하지 않는다');
  assert.ok(/\}, \[mapInstance, viewport, fitKey\]\);/.test(code), 'viewport 재적용이 지역 변경에 묶이지 않았다');
});

test('§6 기존 fetch race 보호가 그대로다', () => {
  const code = codeOf(VIEW);
  // 스코프 fetch는 여전히 취소 플래그를 쓰고, 새 요청 전에 이전 데이터를 비운다.
  assert.ok(/let cancelled = false;/.test(code), 'fetch 취소 플래그가 사라졌다');
  assert.ok(/setScopedData\(null\);/.test(code), '이전 지역 데이터를 비우지 않는다');
  assert.ok(/\.then\(\(d\) => !cancelled && setScopedData\(d\)\)/.test(code), 'stale 응답이 새 선택을 덮을 수 있다');
  assert.ok(/geocoder\.addressSearch\(query, \(result: any\[\], status: string\) => \{\s*if \(cancelled\) return;/.test(code.replace(/\s+/g, ' ').replace(/\{ if/g, '{\n      if')) ||
    /if \(cancelled\) return;/.test(code), 'geocode 콜백의 취소 가드가 사라졌다');
});

test('§6 지역 변경 시 viewport 키가 갈린다', () => {
  const busan = [HAEUNDAE, SAHA, GIJANG];
  const haeundae = [{ lat: 35.1638, lng: 129.1636 }, { lat: 35.1691, lng: 129.1729 }];
  assert.notEqual(mapViewportKey('부산광역시', busan), mapViewportKey('부산광역시 해운대구', haeundae));
});

// ── 8. 지도/목록 dataset parity ──────────────────────────────────────────────

test('§3 bounds 계산 대상과 버블 렌더 대상이 같은 buckets다', () => {
  const code = codeOf(VIEW);
  // bounds는 현재 buckets를 순회해 모은 좌표만 쓴다.
  assert.ok(/for \(const b of buckets\) \{/.test(code), 'bounds가 buckets를 기준으로 모이지 않는다');
  assert.ok(/const point = points\[b\.key\];/.test(code));
  assert.ok(/return validMapPoints\(list\);/.test(code), '좌표 유효성 검사를 거치지 않는다');
  // 버블도 같은 buckets를 순회한다.
  assert.ok(/\{buckets\.map\(\(b\) => \{/.test(code), '버블 렌더가 buckets 기준이 아니다');
  // 목록도 같은 buckets에서 나온다(별도 subset이 없다).
  assert.ok(/\[\.\.\.buckets\]\s*\.sort\(/.test(code.replace(/\s+/g, ' ').replace(/\] \./g, ']\n  .')) || /\[\.\.\.buckets\]/.test(code),
    '목록이 buckets에서 나오지 않는다');
});

test('§3 지도용 별도 데이터 요청이 없다 — 좌표만 geocode한다', () => {
  const code = codeOf(VIEW);
  // 지도 컴포넌트 안에서 region-change API를 다시 부르지 않는다.
  const at = code.indexOf('function BucketBubbles');
  const body = code.slice(at);
  assert.ok(!/\/api\/stats\/region-change/.test(body), '지도가 데이터를 따로 받아온다');
});

// ── 9. 공급 지도 회귀 없음 ───────────────────────────────────────────────────

test('§1 공급 지도는 같은 공용 helper를 계속 쓴다 — 두 화면이 한 규칙을 공유한다', () => {
  for (const [name, src] of [['변동지도', VIEW], ['공급', SUPPLY_VIEW]] as const) {
    const code = codeOf(src);
    assert.ok(/from '@\/lib\/map\/map-viewport'/.test(code), `${name}가 공용 helper를 쓰지 않는다`);
    assert.ok(/resolveMapViewport\(/.test(code), `${name}가 viewport 판정을 직접 다시 만든다`);
    assert.ok(/setBounds\(bounds,/.test(code), `${name}에 setBounds가 없다`);
  }
  // 공급 화면의 조정값은 그대로 공급 쪽에 있다(화면별 값이 섞이지 않았다).
  assert.ok(/SUPPLY_MAP_BOUNDS_PADDING, SUPPLY_SINGLE_POINT_LEVEL/.test(codeOf(SUPPLY_VIEW)));
  assert.ok(!/SUPPLY_/.test(codeOf(VIEW)), '변동지도가 공급 조정값을 끌어다 쓴다');
  assert.ok(!/REGION_CHANGE_/.test(codeOf(SUPPLY_VIEW)), '공급이 변동지도 조정값을 끌어다 쓴다');
});
