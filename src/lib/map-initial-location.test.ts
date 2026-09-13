import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  GRANTED_GPS_WAIT_CAP_MS,
  INITIAL_GEOLOCATION_OPTIONS,
  MAP_LOCATING_MESSAGE,
  initialLocationNotice,
  isValidLatLng,
  locateInitialCenter,
  parseIpLoc,
  shouldApplyLateGps,
  type InitialLocationDeps,
  type LatLng,
  type PermissionStateLike,
  type PositionLike,
} from './map-initial-location';
import { DEFAULT_MAP_CENTER } from './map-marker-share';

// E-JIP FINAL DEVICE UX FIX V1 — /map 첫 진입 위치 확정. 실제 브라우저 없이 geolocation /
// permissions / IP 조회 / 타이머를 주입해 순서와 한 번만 확정되는 규칙을 검증한다.

const SEOGU = { ...DEFAULT_MAP_CENTER };
const USER = { lat: 35.1796, lng: 129.0756 }; // 부산시청 근처 — 서구청과 다른 곳
const IP = { lat: 37.5665, lng: 126.978 };

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

interface Harness {
  deps: InitialLocationDeps;
  resolved: Array<{ center: LatLng; source: string }>;
  late: LatLng[];
  gpsCalls: number;
  ipCalls: number;
  timers: Array<{ ms: number; fn: () => void; cancelled: boolean }>;
  succeed: (c: LatLng) => void;
  fail: () => void;
  options: PositionOptions | null;
}

function harness(opts: {
  permission?: PermissionStateLike | 'throw';
  geolocation?: boolean;
  ip?: LatLng | null | 'throw';
}): Harness {
  const h: Harness = {
    resolved: [], late: [], gpsCalls: 0, ipCalls: 0, timers: [], options: null,
    succeed: () => { throw new Error('GPS not requested'); },
    fail: () => { throw new Error('GPS not requested'); },
    deps: undefined as unknown as InitialLocationDeps,
  };
  h.deps = {
    getCurrentPosition: opts.geolocation === false ? null : (ok, err, options) => {
      h.gpsCalls++;
      h.options = options;
      h.succeed = (c) => ok({ coords: { latitude: c.lat, longitude: c.lng } } as PositionLike);
      h.fail = () => err(new Error('denied'));
    },
    queryPermission: async () => {
      if (opts.permission === 'throw') throw new Error('no permissions api');
      return opts.permission ?? 'granted';
    },
    lookupIp: async () => {
      h.ipCalls++;
      if (opts.ip === 'throw') throw new Error('network');
      return opts.ip ?? null;
    },
    setTimer: (fn, ms) => {
      const t = { ms, fn, cancelled: false };
      h.timers.push(t);
      return () => { t.cancelled = true; };
    },
  };
  return h;
}

const callbacks = (h: Harness) => ({
  onResolved: (center: LatLng, source: string) => h.resolved.push({ center, source }),
  onLateGps: (center: LatLng) => h.late.push(center),
});

// MAP 1
test('위치 확인 중에는 확정하지 않는다 — 권한 프롬프트가 떠 있을 수 있으면 기본 지역(서구청)을 먼저 내보내지 않는다', async () => {
  for (const permission of ['prompt', 'unknown', 'throw'] as const) {
    const h = harness({ permission });
    locateInitialCenter(SEOGU, h.deps, callbacks(h));
    await flush();
    assert.equal(h.gpsCalls, 1, permission);
    assert.equal(h.resolved.length, 0, `${permission}: GPS 응답 전에 대체 위치로 확정했다`);
    assert.equal(h.timers.length, 0, `${permission}: 프롬프트 가능 상태에서는 대기 상한을 걸지 않는다`);
    assert.equal(h.ipCalls, 0);
  }
});

test('페이지는 위치 확정 전에는 지도를 그리지 않고 "현재 위치를 확인하고 있어요"를 보인다', () => {
  const page = readFileSync(path.resolve(__dirname, '..', 'app', 'map', 'page.tsx'), 'utf8');
  const sdkGate = page.indexOf('if (!isMapReady) {\r\n    return <FullPageLoader') >= 0
    ? page.indexOf('if (!isMapReady) {\r\n    return <FullPageLoader')
    : page.indexOf('if (!isMapReady) {\n    return <FullPageLoader');
  const locationGate = page.indexOf('if (!locationResolved) {');
  const mapMount = page.indexOf('<KakaoMap');
  assert.ok(sdkGate > 0 && locationGate > sdkGate && mapMount > locationGate, 'SDK 게이트 → 위치 게이트 → KakaoMap 순서가 아니다');
  assert.match(page, /<FullPageLoader active message=\{MAP_LOCATING_MESSAGE\} \/>/);
  assert.equal(MAP_LOCATING_MESSAGE, '현재 위치를 확인하고 있어요');
  // 최초 마커 로드와 URL 동기화도 확정을 기다린다(기본 center로 서구 마커/URL을 쓰지 않는다).
  assert.match(page, /if \(!isMapReady \|\| !locationResolved\) return;\s*\/\/ §14/);
  assert.match(page, /refreshActiveLayers\(center\.lat, center\.lng, knownLawdCd\);\s*\}, \[isMapReady, locationResolved\]\);/);
  assert.match(page, /if \(typeof window === 'undefined' \|\| !isMapReady \|\| !locationResolved\) return;/);
});

// MAP 2
test('GPS 성공 → 현재 위치로 한 번만 확정하고 IP 조회는 하지 않는다', async () => {
  const h = harness({ permission: 'granted', ip: IP });
  locateInitialCenter(SEOGU, h.deps, callbacks(h));
  await flush();
  h.succeed(USER);
  await flush();
  assert.deepEqual(h.resolved, [{ center: USER, source: 'gps' }]);
  assert.equal(h.ipCalls, 0);
  assert.equal(h.timers[0].cancelled, true, '확정 뒤 대기 상한 타이머를 정리한다');
  assert.deepEqual(h.options, INITIAL_GEOLOCATION_OPTIONS, '기존 geolocation 옵션 그대로');
  assert.deepEqual(INITIAL_GEOLOCATION_OPTIONS, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  assert.equal(initialLocationNotice('gps', USER, USER), null, '현재 위치로 열리면 안내가 없다');
});

// MAP 3
test('권한 거부 → GPS를 부르지 않고 IP → 기본 지역 순서, 기본 지역이면 그렇다고 말한다', async () => {
  const denied = harness({ permission: 'denied', ip: null });
  locateInitialCenter(SEOGU, denied.deps, callbacks(denied));
  await flush();
  assert.equal(denied.gpsCalls, 0);
  assert.deepEqual(denied.resolved, [{ center: SEOGU, source: 'default' }]);
  assert.match(initialLocationNotice('default', SEOGU, SEOGU) || '', /현재 위치를 확인하지 못해 기본 지역\(부산 서구\)/);

  const withIp = harness({ permission: 'denied', ip: IP });
  locateInitialCenter(SEOGU, withIp.deps, callbacks(withIp));
  await flush();
  assert.deepEqual(withIp.resolved, [{ center: IP, source: 'ip' }]);
  assert.match(initialLocationNotice('ip', IP, IP) || '', /접속 지역 기준/);

  const noGeo = harness({ geolocation: false, ip: 'throw' });
  locateInitialCenter(SEOGU, noGeo.deps, callbacks(noGeo));
  await flush();
  assert.deepEqual(noGeo.resolved, [{ center: SEOGU, source: 'default' }], 'IP 조회 실패도 기본 지역으로 확정(로더에 갇히지 않음)');
});

test('GPS 실패/잘못된 좌표 → IP → 기본 지역', async () => {
  const h = harness({ permission: 'prompt', ip: null });
  locateInitialCenter(SEOGU, h.deps, callbacks(h));
  await flush();
  h.fail();
  await flush();
  assert.deepEqual(h.resolved, [{ center: SEOGU, source: 'default' }]);

  const bad = harness({ permission: 'granted', ip: IP });
  locateInitialCenter(SEOGU, bad.deps, callbacks(bad));
  await flush();
  bad.succeed({ lat: Number.NaN, lng: 129 });
  await flush();
  assert.deepEqual(bad.resolved, [{ center: IP, source: 'ip' }]);
});

test('권한 허용 + GPS가 느리면 상한 뒤 대체 위치로 확정하고, 늦은 GPS는 사용자가 지도를 안 움직였을 때만 반영한다', async () => {
  const h = harness({ permission: 'granted', ip: null });
  locateInitialCenter(SEOGU, h.deps, callbacks(h));
  await flush();
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, GRANTED_GPS_WAIT_CAP_MS);
  h.timers[0].fn();
  await flush();
  assert.deepEqual(h.resolved, [{ center: SEOGU, source: 'default' }]);

  h.succeed(USER);
  await flush();
  assert.equal(h.resolved.length, 1, '확정은 한 번뿐');
  assert.deepEqual(h.late, [USER]);
  assert.equal(shouldApplyLateGps('default', SEOGU, SEOGU), true, '아직 대체 위치를 보고 있으면 현재 위치로 옮긴다');
  assert.equal(shouldApplyLateGps('default', SEOGU, { lat: 35.2, lng: 129.1 }), false, '사용자가 옮긴 지도를 덮지 않는다');
  assert.equal(shouldApplyLateGps('gps', USER, USER), false);
  assert.equal(shouldApplyLateGps('url', USER, USER), false, '공유/복원 링크 center는 덮지 않는다');
});

// MAP 4
test('옛 위치 flash 없음 — 확정은 정확히 한 번, 취소 후에는 아무것도 확정하지 않는다', async () => {
  const h = harness({ permission: 'granted', ip: IP });
  locateInitialCenter(SEOGU, h.deps, callbacks(h));
  await flush();
  h.timers[0].fn(); // 상한
  h.fail();         // 동시에 GPS 실패
  await flush();
  assert.equal(h.ipCalls, 1, '대체 경로를 두 번 돌리지 않는다');
  assert.equal(h.resolved.length, 1);

  const c = harness({ permission: 'granted', ip: IP });
  const cancel = locateInitialCenter(SEOGU, c.deps, callbacks(c));
  await flush();
  cancel();
  c.succeed(USER);
  await flush();
  assert.equal(c.resolved.length, 0);
  assert.equal(c.late.length, 0);
  assert.equal(c.timers[0].cancelled, true);

  // 안내는 지금 보이는 곳이 대체 위치일 때만 — 옮기면 사라진다.
  assert.equal(initialLocationNotice('default', SEOGU, { lat: 35.11, lng: 129.03 }), null);
  assert.equal(initialLocationNotice('url', USER, USER), null);
  assert.equal(initialLocationNotice(null, null, SEOGU), null);
});

test('공유/복원 링크는 기존대로 URL center로 바로 열린다(지오로케이션 생략)', () => {
  const page = readFileSync(path.resolve(__dirname, '..', 'app', 'map', 'page.tsx'), 'utf8');
  assert.match(page, /fromUrl\s*\?\s*\{ resolved: true, source: 'url', center: fromUrl \}/);
  assert.match(page, /useEffect\(\(\) => \{\s*if \(initialShareLawdCdRef\.current\) return;\s*const geolocation/);
});

test('좌표/IP 응답 해석', () => {
  assert.equal(isValidLatLng({ lat: 35, lng: 129 }), true);
  assert.equal(isValidLatLng({ lat: 91, lng: 129 }), false);
  assert.equal(isValidLatLng({ lat: '35', lng: 129 }), false);
  assert.deepEqual(parseIpLoc('37.5665,126.9780'), { lat: 37.5665, lng: 126.978 });
  assert.equal(parseIpLoc(undefined), null);
  assert.equal(parseIpLoc('garbage'), null);
});

// MAP 5 / 6
test('로드뷰와 지도 진입 경로는 이 수정의 영향을 받지 않는다', () => {
  const root = path.resolve(__dirname, '..', '..');
  for (const f of ['src/components/KakaoMapEmbed.tsx', 'src/components/apt/AptLocationCard.tsx']) {
    const code = readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(code, /map-initial-location/, `${f}가 지도 첫 위치 로직에 묶였다`);
    assert.match(code, /[Rr]oadview/, `${f}의 로드뷰 코드가 사라졌다`);
  }
  const nav = readFileSync(path.join(root, 'src/lib/bottom-nav-items.tsx'), 'utf8');
  assert.match(nav, /href: '\/map'/);
  const page = readFileSync(path.join(root, 'src/app/map/page.tsx'), 'utf8');
  // "내 위치" 버튼과 드래그 갱신은 그대로다.
  assert.match(page, /📍 내 위치/);
  assert.match(page, /const handleDragEnd = \(\) => \{/);
});
