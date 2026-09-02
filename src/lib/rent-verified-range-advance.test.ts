import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeVerifiedRangeFromManifest } from './rent-verified-range';

const DISTRICTS = ['A', 'B', 'C']; // 작은 합성 district 집합 — 실제 16개 부산 구 대신 사용

function manifestWith(cells: Record<string, { status: string }>) {
  return { legacyBootstrap: { from: '202408', to: '202608' }, cells };
}

test('cells가 비어 있으면 legacyBootstrap 그대로 반환한다(회귀: 이전 하드코딩 값과 동일)', () => {
  const result = computeVerifiedRangeFromManifest(manifestWith({}), DISTRICTS, new Date('2026-09-03'));
  assert.deepEqual(result, { from: '202408', to: '202608' });
});

test('16/16(합성: 3/3) 전부 COMPLETE인 다음 달은 verified로 전진한다', () => {
  const cells = { 'A:202609': { status: 'COMPLETE' }, 'B:202609': { status: 'COMPLETE' }, 'C:202609': { status: 'COMPLETE' } };
  const result = computeVerifiedRangeFromManifest(manifestWith(cells), DISTRICTS, new Date('2026-10-15'));
  assert.equal(result.to, '202609');
});

test('15/16(합성: 2/3)만 COMPLETE면 그 달은 전진하지 않는다', () => {
  const cells = { 'A:202609': { status: 'COMPLETE' }, 'B:202609': { status: 'COMPLETE' }, 'C:202609': { status: 'PARTIAL' } };
  const result = computeVerifiedRangeFromManifest(manifestWith(cells), DISTRICTS, new Date('2026-10-15'));
  assert.equal(result.to, '202608'); // legacyBootstrap.to 그대로, 전진 없음
});

test('일부 구가 아예 cells에 없어도(아직 sync 안 됨) 전진하지 않는다', () => {
  const cells = { 'A:202609': { status: 'COMPLETE' }, 'B:202609': { status: 'COMPLETE' } }; // C 없음
  const result = computeVerifiedRangeFromManifest(manifestWith(cells), DISTRICTS, new Date('2026-10-15'));
  assert.equal(result.to, '202608');
});

test('재시도로 실패했던 구가 나중에 COMPLETE가 되면 그때 전진한다(retry completion)', () => {
  // 첫 시도: C 실패
  const attempt1 = manifestWith({ 'A:202609': { status: 'COMPLETE' }, 'B:202609': { status: 'COMPLETE' }, 'C:202609': { status: 'PARTIAL' } });
  assert.equal(computeVerifiedRangeFromManifest(attempt1, DISTRICTS, new Date('2026-10-15')).to, '202608');

  // 재시도 후: C도 COMPLETE
  const attempt2 = manifestWith({ 'A:202609': { status: 'COMPLETE' }, 'B:202609': { status: 'COMPLETE' }, 'C:202609': { status: 'COMPLETE' } });
  assert.equal(computeVerifiedRangeFromManifest(attempt2, DISTRICTS, new Date('2026-10-15')).to, '202609');
});

test('연속된 여러 달이 전부 COMPLETE면 계속 전진한다', () => {
  const cells = {
    'A:202609': { status: 'COMPLETE' }, 'B:202609': { status: 'COMPLETE' }, 'C:202609': { status: 'COMPLETE' },
    'A:202610': { status: 'COMPLETE' }, 'B:202610': { status: 'COMPLETE' }, 'C:202610': { status: 'COMPLETE' },
  };
  const result = computeVerifiedRangeFromManifest(manifestWith(cells), DISTRICTS, new Date('2026-11-15'));
  assert.equal(result.to, '202610');
});

test('중간에 미완료 달이 끼면 그 이전까지만 전진한다(연속성 유지)', () => {
  const cells = {
    'A:202609': { status: 'COMPLETE' }, 'B:202609': { status: 'COMPLETE' }, 'C:202609': { status: 'COMPLETE' },
    // 202610은 미완료
    'A:202611': { status: 'COMPLETE' }, 'B:202611': { status: 'COMPLETE' }, 'C:202611': { status: 'COMPLETE' },
  };
  const result = computeVerifiedRangeFromManifest(manifestWith(cells), DISTRICTS, new Date('2026-12-15'));
  assert.equal(result.to, '202609'); // 202611이 COMPLETE라도 202610 gap 때문에 거기서 멈춤
});

test('현재 달(진행 중)은 manifest에 COMPLETE로 잘못 기록돼 있어도 verified에 포함하지 않는다', () => {
  // 방어적 가드 — 정상 sync 엔진이라면 애초에 현재월을 COMPLETE로 안 남기지만, 이 함수
  // 자체도 독립적으로 같은 규칙을 강제해야 한다(§17 단일 실패 지점 의존 금지).
  const cells = { 'A:202609': { status: 'COMPLETE' }, 'B:202609': { status: 'COMPLETE' }, 'C:202609': { status: 'COMPLETE' } };
  // "지금"이 2026-09이면 202609는 아직 진행 중인 달이다.
  const result = computeVerifiedRangeFromManifest(manifestWith(cells), DISTRICTS, new Date('2026-09-15'));
  assert.equal(result.to, '202608'); // 202609로 전진하지 않음
});

test('from은 항상 legacyBootstrap.from 그대로다(역방향 확장 없음)', () => {
  const cells = { 'A:202609': { status: 'COMPLETE' }, 'B:202609': { status: 'COMPLETE' }, 'C:202609': { status: 'COMPLETE' } };
  const result = computeVerifiedRangeFromManifest(manifestWith(cells), DISTRICTS, new Date('2026-10-15'));
  assert.equal(result.from, '202408');
});
