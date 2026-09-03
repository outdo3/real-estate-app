// SUPABASE_EGRESS_P1_CLEANUP — bounding box가 반경의 진짜 superset인지 검증한다.
//
// 이 성질이 깨지면 "반경 안 후보 2개(모호) → 채택 안 함"이 "1개 → 채택"으로 바뀌어
// 다른 단지를 잘못 반환할 수 있다. 그래서 단순 예시가 아니라 여러 방위각/위도에서
// 전수로 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundingBoxFor, haversineMeters, destinationPoint } from './geo-bounding-box.ts';

const inBox = (b, p) => p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;

test('반경 위의 모든 방위각 점이 box 안에 들어온다(부산 좌표, 80m)', () => {
  const lat = 35.1796, lng = 129.0756; // 부산
  const R = 80;
  const box = boundingBoxFor(lat, lng, R);
  for (let bearing = 0; bearing < 360; bearing += 1) {
    const p = destinationPoint(lat, lng, R, bearing);
    assert.ok(inBox(box, p), `bearing ${bearing}°의 반경 위 점이 box 밖이다 — 후보 누락 위험`);
  }
});

test('반경보다 살짝 안쪽 점도 당연히 포함된다', () => {
  const lat = 35.1796, lng = 129.0756;
  const box = boundingBoxFor(lat, lng, 80);
  for (let bearing = 0; bearing < 360; bearing += 7) {
    for (const d of [1, 20, 50, 79.9]) {
      assert.ok(inBox(box, destinationPoint(lat, lng, d, bearing)), `${d}m/${bearing}° 점이 box 밖`);
    }
  }
});

test('여러 위도에서도 superset 성질이 유지된다', () => {
  for (const lat of [33.2, 35.1, 37.5, 38.6]) { // 제주~최북단
    const box = boundingBoxFor(lat, 127.0, 80);
    for (let bearing = 0; bearing < 360; bearing += 5) {
      const p = destinationPoint(lat, 127.0, 80, bearing);
      assert.ok(inBox(box, p), `lat ${lat} bearing ${bearing}° 점이 box 밖`);
    }
  }
});

test('더 큰 반경에서도 성질이 유지된다', () => {
  for (const R of [80, 200, 500, 1000]) {
    const box = boundingBoxFor(35.1796, 129.0756, R);
    for (let bearing = 0; bearing < 360; bearing += 3) {
      assert.ok(inBox(box, destinationPoint(35.1796, 129.0756, R, bearing)), `R=${R} bearing=${bearing} 밖`);
    }
  }
});

test('box는 무한정 넓지 않다 — 실제로 후보를 줄인다', () => {
  const box = boundingBoxFor(35.1796, 129.0756, 80);
  // 80m 반경이므로 box 한 변은 1km 미만이어야 한다(그보다 크면 필터 의미가 없다).
  const latSpanM = (box.maxLat - box.minLat) * 111320;
  assert.ok(latSpanM < 1000, `box 위도 폭이 ${latSpanM.toFixed(0)}m로 너무 넓다`);
  assert.ok(latSpanM > 160, 'box가 지름(160m)보다는 커야 한다');
});

test('haversine이 알려진 거리와 일치한다(회귀 방지)', () => {
  // 위도 1도 ≈ 111.19km
  const d = haversineMeters(35.0, 129.0, 36.0, 129.0);
  assert.ok(Math.abs(d - 111195) < 500, `위도 1도 거리 계산 이상: ${d}`);
  assert.equal(Math.round(haversineMeters(35.0, 129.0, 35.0, 129.0)), 0);
});

test('destinationPoint가 요청한 거리를 실제로 만든다(테스트 도구 자체 검증)', () => {
  for (const bearing of [0, 45, 90, 180, 270]) {
    const p = destinationPoint(35.1796, 129.0756, 80, bearing);
    const back = haversineMeters(35.1796, 129.0756, p.lat, p.lng);
    assert.ok(Math.abs(back - 80) < 0.5, `bearing ${bearing}: ${back}m`);
  }
});
