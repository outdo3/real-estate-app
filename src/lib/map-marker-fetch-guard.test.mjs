import assert from 'node:assert/strict';
import test from 'node:test';
import { isStaleMarkerResponse, isMarkerCacheFresh } from './map-marker-fetch-guard.ts';

test('isStaleMarkerResponse: 요청 순번이 최신 순번과 같으면 stale이 아니다', () => {
  assert.equal(isStaleMarkerResponse(3, 3), false);
});

test('isStaleMarkerResponse: 더 최신 요청이 발급된 뒤에는 stale이다(먼저 보낸 요청의 응답 무시)', () => {
  assert.equal(isStaleMarkerResponse(2, 3), true);
});

test('isMarkerCacheFresh: TTL 이내면 fresh', () => {
  assert.equal(isMarkerCacheFresh(1000, 1000 + 30_000, 60_000), true);
});

test('isMarkerCacheFresh: TTL을 넘으면 fresh 아님(재요청 필요)', () => {
  assert.equal(isMarkerCacheFresh(1000, 1000 + 60_001, 60_000), false);
});

test('isMarkerCacheFresh: 경계값(정확히 TTL)은 fresh 아님', () => {
  assert.equal(isMarkerCacheFresh(1000, 1000 + 60_000, 60_000), false);
});
