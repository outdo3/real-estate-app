import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPendingSelectedApt, resolveSelectedMarker, isPendingStillNeeded } from './map-selected-marker.ts';

const apartmentResult = {
  type: 'APARTMENT',
  name: '연산동한솔솔파크',
  lat: 35.1876,
  lng: 129.1041,
  dong: '연산동',
  aptSeq: '26470-1040',
  completionYear: 2007,
};

// C. 검색 결과가 갖고 있던 aptSeq를 그대로 보존한다(identity 유지)
test('buildPendingSelectedApt: aptSeq를 id/aptSeq 양쪽에 그대로 보존한다', () => {
  const pending = buildPendingSelectedApt(apartmentResult);
  assert.equal(pending.id, '26470-1040');
  assert.equal(pending.aptSeq, '26470-1040');
  assert.equal(pending.name, '연산동한솔솔파크');
});

// D. fast path는 aptSeq + 좌표가 모두 있을 때만 동작한다
test('buildPendingSelectedApt: aptSeq가 없으면 null(fast path 미적용)', () => {
  const pending = buildPendingSelectedApt({ ...apartmentResult, aptSeq: null });
  assert.equal(pending, null);
});

test('buildPendingSelectedApt: 좌표가 유효하지 않으면(NaN) null', () => {
  const pending = buildPendingSelectedApt({ ...apartmentResult, lat: NaN });
  assert.equal(pending, null);
});

test('buildPendingSelectedApt: type이 REGION이면 null(아파트가 아니면 만들지 않는다)', () => {
  const pending = buildPendingSelectedApt({ ...apartmentResult, type: 'REGION' });
  assert.equal(pending, null);
});

// E. name-only identity 금지 — 값을 지어내지 않고 정직하게 "정보 없음" 유지
test('buildPendingSelectedApt: 가격을 지어내지 않고 정직하게 "정보 없음"으로 표시한다', () => {
  const pending = buildPendingSelectedApt(apartmentResult);
  assert.equal(pending.hasRecentPrice, false);
  assert.equal(pending.price, '시세 정보 없음');
});

// F. 진짜 마커가 도착하면 임시 마커보다 우선한다(dedupe/reconcile)
test('resolveSelectedMarker: 진짜 aptClusters에 있으면 그 마커를 반환(임시 마커 아님)', () => {
  const real = { id: '26470-1040', name: '연산동한솔솔파크', dong: '연산동', price: '3억 3,000만', hasRecentPrice: true, lat: 35.1876, lng: 129.1041 };
  const pending = buildPendingSelectedApt(apartmentResult);
  const clusters = [{ id: 'c1', lat: 35.1876, lng: 129.1041, markers: [real] }];
  const resolved = resolveSelectedMarker('26470-1040', clusters, pending);
  assert.equal(resolved, real);
  assert.equal(resolved.hasRecentPrice, true);
});

test('resolveSelectedMarker: 진짜 마커가 아직 없으면 임시 마커로 폴백한다', () => {
  const pending = buildPendingSelectedApt(apartmentResult);
  const resolved = resolveSelectedMarker('26470-1040', [], pending);
  assert.equal(resolved, pending);
});

test('resolveSelectedMarker: activeMarkerId가 없으면 null', () => {
  const pending = buildPendingSelectedApt(apartmentResult);
  assert.equal(resolveSelectedMarker(null, [], pending), null);
});

test('resolveSelectedMarker: 다른 단지가 선택 중이면 엉뚱한 임시 마커를 반환하지 않는다', () => {
  const pending = buildPendingSelectedApt(apartmentResult);
  assert.equal(resolveSelectedMarker('26140-1164', [], pending), null);
});

test('isPendingStillNeeded: 진짜 데이터가 도착해 같은 id를 포함하면 false(정리 대상)', () => {
  const pending = buildPendingSelectedApt(apartmentResult);
  const real = { id: '26470-1040', name: '연산동한솔솔파크', dong: '연산동', price: '3억 3,000만', hasRecentPrice: true, lat: 35.1876, lng: 129.1041 };
  const clusters = [{ id: 'c1', lat: 35.1876, lng: 129.1041, markers: [real] }];
  assert.equal(isPendingStillNeeded(clusters, pending), false);
});

test('isPendingStillNeeded: 아직 도착 안 했으면 true(계속 표시)', () => {
  const pending = buildPendingSelectedApt(apartmentResult);
  assert.equal(isPendingStillNeeded([], pending), true);
});

test('isPendingStillNeeded: pending 자체가 없으면 false', () => {
  assert.equal(isPendingStillNeeded([], null), false);
});
