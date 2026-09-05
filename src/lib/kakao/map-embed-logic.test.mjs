// OFFICETEL_V1 STEP 6 §18 — 지도 임베드 결정 로직 회귀 테스트.
//
// SDK를 흉내 내는 통합 테스트는 만들지 않는다(깨지기 쉽고 실제를 보증하지 못한다).
// 대신 이 기능의 신뢰 계약 — "저장된 좌표 모드는 절대 지오코딩하지 않는다" — 을
// 순수 함수 수준에서 못 박는다. 실제 렌더/토글은 Production QA로 확인한다.
//
// 실행: node --experimental-strip-types --test src/lib/kakao/map-embed-logic.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planMapEmbed,
  planUsesGeocoding,
  isRenderableCoordinate,
  officetelLocationState,
  toggleLocationView,
  kakaoSdkErrorMessage,
} from './map-embed-logic.ts';

// ── §2/§6 좌표 모드는 지오코딩을 우회한다 ─────────────────────────────
test('좌표 모드는 저장된 좌표를 그대로 쓰고 지오코딩하지 않는다', () => {
  const plan = planMapEmbed({ mode: 'coordinate', latitude: 35.1631, longitude: 129.1637 });
  assert.equal(plan.kind, 'USE_STORED_COORDINATE');
  assert.equal(plan.latitude, 35.1631);
  assert.equal(plan.longitude, 129.1637);
  assert.equal(planUsesGeocoding(plan), false);
});

test('좌표 모드는 좌표가 깨져도 주소로 폴백하지 않는다', () => {
  for (const bad of [
    { latitude: NaN, longitude: 129 },
    { latitude: 0, longitude: 0 },
    { latitude: 999, longitude: 129 },
    { latitude: 35.1, longitude: 999 },
  ]) {
    const plan = planMapEmbed({ mode: 'coordinate', ...bad });
    assert.equal(plan.kind, 'UNRESOLVABLE', JSON.stringify(bad));
    assert.equal(plan.reason, 'INVALID_COORDINATE');
    assert.equal(planUsesGeocoding(plan), false);
  }
});

// ── §3 아파트 주소 모드 보존 ──────────────────────────────────────────
test('주소 모드는 기존대로 런타임 주소 해석을 계획한다', () => {
  const plan = planMapEmbed({ mode: 'address', address: '부산 해운대구 우동 1441', jibunAddress: '우동 1441' });
  assert.equal(plan.kind, 'RESOLVE_BY_ADDRESS');
  assert.equal(plan.address, '부산 해운대구 우동 1441');
  assert.equal(plan.jibunAddress, '우동 1441');
  assert.equal(planUsesGeocoding(plan), true);
});

test('주소 모드에서 지번이 없어도 주소 해석 계획은 유효하다', () => {
  const plan = planMapEmbed({ mode: 'address', address: '부산 남구 대연동 1' });
  assert.equal(plan.kind, 'RESOLVE_BY_ADDRESS');
  assert.equal(plan.jibunAddress, undefined);
});

test('빈 주소는 해석 불가이며 좌표로 대체되지 않는다', () => {
  const plan = planMapEmbed({ mode: 'address', address: '   ' });
  assert.equal(plan.kind, 'UNRESOLVABLE');
  assert.equal(plan.reason, 'EMPTY_ADDRESS');
});

// ── §6 좌표 유효성 ───────────────────────────────────────────────────
test('isRenderableCoordinate는 널섬/비수치/범위밖을 거부한다', () => {
  assert.equal(isRenderableCoordinate(35.1631, 129.1637), true);
  assert.equal(isRenderableCoordinate(0, 0), false);
  assert.equal(isRenderableCoordinate(null, 129), false);
  assert.equal(isRenderableCoordinate('35.1', '129.1'), false);
  assert.equal(isRenderableCoordinate(Infinity, 129), false);
  assert.equal(isRenderableCoordinate(35.1, undefined), false);
});

// ── §7 좌표 없는 8개 master ──────────────────────────────────────────
test('좌표가 없으면 NO_COORDINATE — 빈 지도를 그리지 않는다', () => {
  assert.equal(officetelLocationState(null), 'NO_COORDINATE');
  assert.equal(officetelLocationState(undefined), 'NO_COORDINATE');
  assert.equal(officetelLocationState({ latitude: 0, longitude: 0 }), 'NO_COORDINATE');
});

test('정상 좌표는 MAP_READY', () => {
  assert.equal(officetelLocationState({ latitude: 35.1631, longitude: 129.1637 }), 'MAP_READY');
});

// ── §5 지도 ↔ 로드뷰 ─────────────────────────────────────────────────
test('지도↔로드뷰는 양방향으로 오간다', () => {
  assert.equal(toggleLocationView('map'), 'roadview');
  assert.equal(toggleLocationView('roadview'), 'map');
  assert.equal(toggleLocationView(toggleLocationView('map')), 'map');
});

// ── SDK 오류 문구 ────────────────────────────────────────────────────
test('SDK 오류는 원인별로 다른 문구를 준다', () => {
  assert.match(kakaoSdkErrorMessage(new Error('KAKAO_SDK_NO_KEY')), /API 키/);
  assert.match(kakaoSdkErrorMessage(new Error('KAKAO_SDK_SCRIPT_ERROR')), /스크립트/);
  assert.match(kakaoSdkErrorMessage(new Error('KAKAO_SDK_TIMEOUT')), /잠시 후/);
  assert.equal(kakaoSdkErrorMessage(new Error('WAT')), '지도를 표시할 수 없습니다.');
});
