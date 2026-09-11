import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  locationCardState,
  officetelLocationState,
  planMapEmbed,
  planUsesGeocoding,
  toggleLocationView,
  isRenderableCoordinate,
  type LocationView,
} from './map-embed-logic';
import { ANALYTICS_EVENT_NAMES } from '../analytics/events';
import { toGaEventName } from '../analytics/ga-events';

/**
 * APT_DETAIL_INLINE_MAP_ROADVIEW_V1 §20 — 인라인 위치 카드의 계약.
 *
 * 카드 자체는 Kakao SDK가 있어야 그려지므로, 여기서는 **SDK 없이 검증 가능한
 * 결정 로직**만 본다: 좌표 신뢰, 지오코딩 금지, 모드 토글, 이벤트 taxonomy.
 */

// ── §17 좌표 신뢰 — 틀린 위치는 위치 없음보다 나쁘다 ────────────────────────

test('G. 좌표가 없으면 NO_COORDINATE — 지도를 그리지 않는다', () => {
  assert.equal(locationCardState(null), 'NO_COORDINATE');
  assert.equal(locationCardState(undefined), 'NO_COORDINATE');
});

test('G. 좌표가 있으면 MAP_READY', () => {
  assert.equal(locationCardState({ latitude: 35.1366, longitude: 129.0814 }), 'MAP_READY');
});

test('널섬(0,0)과 말이 안 되는 좌표는 좌표로 인정하지 않는다', () => {
  assert.equal(locationCardState({ latitude: 0, longitude: 0 }), 'NO_COORDINATE');
  assert.equal(locationCardState({ latitude: 91, longitude: 129 }), 'NO_COORDINATE');
  assert.equal(locationCardState({ latitude: 35.1, longitude: 181 }), 'NO_COORDINATE');
  assert.equal(locationCardState({ latitude: NaN, longitude: 129 }), 'NO_COORDINATE');
  assert.equal(isRenderableCoordinate('35.1' as unknown, 129), false, '문자열 좌표는 받지 않는다');
});

test('중립 이름과 기존 오피스텔 이름은 같은 판정이다(호출부를 깨지 않는다)', () => {
  const cases = [null, { latitude: 0, longitude: 0 }, { latitude: 35.1366, longitude: 129.0814 }];
  for (const c of cases) assert.equal(locationCardState(c), officetelLocationState(c));
});

// ── §5 런타임 지오코딩 금지 ─────────────────────────────────────────────────

test('좌표 모드는 런타임 지오코딩을 절대 유발하지 않는다', () => {
  const plan = planMapEmbed({ mode: 'coordinate', latitude: 35.1366, longitude: 129.0814 });
  assert.equal(plan.kind, 'USE_STORED_COORDINATE');
  assert.equal(planUsesGeocoding(plan), false);
});

test('좌표가 잘못돼도 주소 모드로 떨어지지 않는다(다른 장소를 집을 경로)', () => {
  const plan = planMapEmbed({ mode: 'coordinate', latitude: 0, longitude: 0 });
  assert.equal(plan.kind, 'UNRESOLVABLE');
  assert.equal(planUsesGeocoding(plan), false, '폴백 지오코딩이 생기면 다른 단지를 가리킬 수 있다');
});

test('저장 좌표는 그대로 렌더 authority다(반올림/이동 없음)', () => {
  const plan = planMapEmbed({ mode: 'coordinate', latitude: 35.1366640597835, longitude: 129.081465332824 });
  assert.equal(plan.kind, 'USE_STORED_COORDINATE');
  if (plan.kind !== 'USE_STORED_COORDINATE') return;
  assert.equal(plan.latitude, 35.1366640597835);
  assert.equal(plan.longitude, 129.081465332824);
});

// ── §11 모드 상태 — 단일 상태, 불리언 여러 개 아님 ──────────────────────────

test('D/E. 지도 ↔ 로드뷰는 한 상태를 오간다', () => {
  assert.equal(toggleLocationView('map'), 'roadview');
  assert.equal(toggleLocationView('roadview'), 'map');
});

test('H. 반복 전환해도 상태가 두 값 사이에서만 움직인다', () => {
  let view: LocationView = 'map';
  const seen: LocationView[] = [view];
  for (let i = 0; i < 10; i += 1) {
    view = toggleLocationView(view);
    seen.push(view);
  }
  assert.deepEqual([...new Set(seen)].sort(), ['map', 'roadview']);
  // 짝수 번 전환하면 처음으로 돌아온다 — 중간 상태가 쌓이지 않는다.
  assert.equal(seen[10], 'map');
});

// ── §19 분석 이벤트 ─────────────────────────────────────────────────────────

test('인라인 위치 카드 이벤트 3종이 taxonomy와 GA4 매핑에 모두 있다', () => {
  for (const name of ['detail_map_view', 'detail_roadview_open', 'detail_map_return'] as const) {
    assert.ok((ANALYTICS_EVENT_NAMES as readonly string[]).includes(name), `${name}이 taxonomy에 없다`);
    assert.equal(toGaEventName(name), name, `${name}의 GA4 매핑이 없다`);
  }
});

test('패닝/줌 같은 고빈도 이벤트는 만들지 않았다', () => {
  for (const noisy of ['detail_map_pan', 'detail_map_zoom', 'detail_map_drag', 'detail_map_move']) {
    assert.ok(
      !(ANALYTICS_EVENT_NAMES as readonly string[]).includes(noisy),
      `${noisy}는 노이즈라 만들지 않는다`
    );
  }
});

test('좌표를 실을 수 있는 이벤트 파라미터를 새로 열지 않았다', async () => {
  const { GA_PARAM_ALLOWLIST } = await import('../analytics/ga');
  for (const forbidden of ['latitude', 'longitude', 'lat', 'lng', 'address', 'apt_name', 'coord']) {
    assert.ok(
      !(GA_PARAM_ALLOWLIST as readonly string[]).includes(forbidden),
      `${forbidden}가 allowlist에 있으면 좌표가 새어 나갈 수 있다`
    );
  }
});
