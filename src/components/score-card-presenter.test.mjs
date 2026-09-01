import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveScoreCardState, derivePeerVerdict } from './score-card-presenter.ts';

// ── deriveScoreCardState ─────────────────────────────────────────────────
test('deriveScoreCardState: result이 null/undefined -> no-result', () => {
  assert.deepEqual(deriveScoreCardState(null), { kind: 'no-result' });
  assert.deepEqual(deriveScoreCardState(undefined), { kind: 'no-result' });
});

test('deriveScoreCardState: _shadowV2가 없으면 -> v2-absent', () => {
  assert.deepEqual(deriveScoreCardState({}), { kind: 'v2-absent' });
});

test('deriveScoreCardState: _shadowV2.eligibility=NOT_ENOUGH_DATA -> not-enough-data', () => {
  const result = { _shadowV2: { eligibility: 'NOT_ENOUGH_DATA' } };
  assert.deepEqual(deriveScoreCardState(result), { kind: 'not-enough-data' });
});

test('deriveScoreCardState: SCORE_AVAILABLE -> ok', () => {
  const v2 = { eligibility: 'SCORE_AVAILABLE', overallScore: 77 };
  const result = { _shadowV2: v2 };
  assert.deepEqual(deriveScoreCardState(result), { kind: 'ok', v2 });
});

test('deriveScoreCardState: LIMITED -> ok', () => {
  const v2 = { eligibility: 'LIMITED', overallScore: 60 };
  const result = { _shadowV2: v2 };
  assert.deepEqual(deriveScoreCardState(result), { kind: 'ok', v2 });
});

// PHASE 2의 핵심 수정사항 — V1의 status/coverage는 더 이상 표시 여부를 가리지
// 않는다(PHASE 1.5/1.6에서 발견한 구조적 결함). V1이 실패/coverage 부족이어도
// V2 자신의 eligibility가 SCORE_AVAILABLE/LIMITED면 카드가 떠야 한다.
test('deriveScoreCardState: V1 status가 실패/coverage 부족이어도 V2 eligibility가 살아있으면 ok (V1/V2 게이트 독립)', () => {
  const v2 = { eligibility: 'SCORE_AVAILABLE', overallScore: 55 };
  const resultWithFailedV1 = {
    status: 'INSUFFICIENT_DATA', // V1 자신의 status — 이제 이 필드는 무시되어야 한다
    score: null,
    coverage: 0.2,
    _shadowV2: v2,
  };
  assert.deepEqual(deriveScoreCardState(resultWithFailedV1), { kind: 'ok', v2 });
});

test('deriveScoreCardState: V1 status가 OK여도 V2가 NOT_ENOUGH_DATA면 not-enough-data (V2가 최종 판단)', () => {
  const resultWithOkV1 = {
    status: 'OK',
    score: 80,
    _shadowV2: { eligibility: 'NOT_ENOUGH_DATA' },
  };
  assert.deepEqual(deriveScoreCardState(resultWithOkV1), { kind: 'not-enough-data' });
});

// ── derivePeerVerdict ────────────────────────────────────────────────────
test('derivePeerVerdict: peer가 null/available=false/percentile=null -> unavailable', () => {
  assert.deepEqual(derivePeerVerdict(null), { kind: 'unavailable' });
  assert.deepEqual(derivePeerVerdict(undefined), { kind: 'unavailable' });
  assert.deepEqual(derivePeerVerdict({ available: false, confidence: 'NOT_AVAILABLE', percentile: null }), { kind: 'unavailable' });
  assert.deepEqual(derivePeerVerdict({ available: true, confidence: 'HIGH', percentile: null }), { kind: 'unavailable' });
});

test('derivePeerVerdict: HIGH confidence -> exact, 정확한 topPercent 노출', () => {
  const v = derivePeerVerdict({ available: true, confidence: 'HIGH', percentile: 90 });
  assert.equal(v.kind, 'exact');
  assert.equal(v.topPercent, 10);
  assert.equal(v.direction, 'up');
});

test('derivePeerVerdict: HIGH, percentile 낮으면 direction=down', () => {
  const v = derivePeerVerdict({ available: true, confidence: 'HIGH', percentile: 15 });
  assert.equal(v.kind, 'exact');
  assert.equal(v.direction, 'down');
});

test('derivePeerVerdict: MEDIUM confidence -> directional, 정확한 숫자를 노출하지 않는다', () => {
  const v = derivePeerVerdict({ available: true, confidence: 'MEDIUM', percentile: 70 });
  assert.equal(v.kind, 'directional');
  assert.equal(v.direction, 'up');
  assert.ok(!('topPercent' in v), 'MEDIUM은 정확한 percentile 숫자를 절대 노출하지 않아야 한다(PHASE 2 §16)');
});

test('derivePeerVerdict: MEDIUM, percentile 낮으면 direction=down / 중간이면 neutral', () => {
  assert.equal(derivePeerVerdict({ available: true, confidence: 'MEDIUM', percentile: 30 }).direction, 'down');
  assert.equal(derivePeerVerdict({ available: true, confidence: 'MEDIUM', percentile: 50 }).direction, 'neutral');
});

test('derivePeerVerdict: LOW confidence -> broad, percentile 숫자/방향성 전부 감춘다', () => {
  const v = derivePeerVerdict({ available: true, confidence: 'LOW', percentile: 95 });
  assert.deepEqual(v, { kind: 'broad' });
  assert.ok(!('topPercent' in v) && !('direction' in v), 'LOW는 숫자든 방향성이든 아무것도 노출하지 않아야 한다(PHASE 2 §16)');
});
