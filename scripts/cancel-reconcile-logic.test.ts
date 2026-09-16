import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileGroupCancellation,
  type CancelReconcileExistingRow,
  type CancelReconcileSourceRow,
} from './write-policy-logic';

// CANCELLATION_RATCHET_PREVENTION_FIX_V1 — 취소 reconciliation 순수 함수 테스트.
// 핵심 계약: 원천 응답의 **순서**가 결과에 영향을 주지 않는다(결함 A의 근원 제거).

const src = (canceled: boolean, cancelDate: string | null = canceled ? '26.09.02' : null): CancelReconcileSourceRow => ({
  dealCanceled: canceled,
  cancelDate,
});

const db = (
  id: number,
  occ: number,
  canceled: boolean,
  cancelDate: string | null = canceled ? '26.09.02' : null,
  registryDate: string | null = null
): CancelReconcileExistingRow => ({ id, occurrenceIndex: occ, dealCanceled: canceled, cancelDate, registryDate });

// ── 1~3. 순서 무관성 · 멱등성 ──────────────────────────────────────────────

test('1 · 원천 순서가 그대로일 때: 이미 맞으면 아무것도 하지 않는다', () => {
  const r = reconcileGroupCancellation([src(false), src(true)], [db(1, 0, false), db(2, 1, true)]);
  assert.equal(r.kind, 'noChange');
});

test('2 · 원천 순서가 뒤집혀도 결과가 같다 — 결함 A의 근원이 제거됐다', () => {
  const existing = [db(1, 0, false), db(2, 1, true)];
  const forward = reconcileGroupCancellation([src(false), src(true)], existing);
  const reversed = reconcileGroupCancellation([src(true), src(false)], existing);
  assert.equal(forward.kind, 'noChange');
  assert.deepEqual(reversed, forward, '순서만 바뀐 같은 원천은 같은 결정을 낳아야 한다');
});

test('3 · 같은 sync를 반복해도 결과가 변하지 않는다(멱등)', () => {
  const existing = [db(1, 0, false), db(2, 1, true)];
  for (let i = 0; i < 5; i++) {
    const r = reconcileGroupCancellation([src(true), src(false)], existing);
    assert.equal(r.kind, 'noChange', `${i + 1}회차`);
  }
});

// ── 4~5. 취소 건수 ────────────────────────────────────────────────────────

test('4 · 형제 2 중 원천 취소 1건 — DB도 1건이면 변화 없음', () => {
  const r = reconcileGroupCancellation([src(true), src(false)], [db(1, 0, true), db(2, 1, false)]);
  assert.equal(r.kind, 'noChange');
});

test('5 · 형제 3 중 원천 취소 2건 — DB도 2건이면 변화 없음', () => {
  const r = reconcileGroupCancellation(
    [src(true), src(true), src(false)],
    [db(1, 0, true), db(2, 1, false), db(3, 2, true)]
  );
  assert.equal(r.kind, 'noChange');
});

// ── 6. 결함 A가 만든 과다 취소가 치유된다 ───────────────────────────────────

test('6 · 과다 취소(원천 1 / DB 2)는 1건을 되돌린다 — false-cancel 치유', () => {
  const r = reconcileGroupCancellation([src(false), src(true)], [db(1, 0, true), db(2, 1, true)]);
  assert.equal(r.kind, 'reconcile');
  if (r.kind !== 'reconcile') return;
  assert.deepEqual(r.toRestore, [{ id: 2 }], 'occurrenceIndex가 큰 쪽부터 되돌린다(결정적)');
  assert.deepEqual(r.toCancel, []);
});

// ── 7~8. 정당한 양방향 전이 ────────────────────────────────────────────────

test('7 · 정상 취소 발생(원천 1 / DB 0)은 그대로 반영한다', () => {
  const r = reconcileGroupCancellation([src(false), src(true, '26.09.10')], [db(1, 0, false), db(2, 1, false)]);
  assert.equal(r.kind, 'reconcile');
  if (r.kind !== 'reconcile') return;
  assert.deepEqual(r.toCancel, [{ id: 1, cancelDate: '26.09.10' }], 'occurrenceIndex 오름차순으로 결정적 선택');
  assert.deepEqual(r.toRestore, []);
});

test('8 · 원천이 취소를 철회하면(원천 0 / DB 1) 되돌린다 — 단방향 래칫이 아니다', () => {
  const r = reconcileGroupCancellation([src(false), src(false)], [db(1, 0, false), db(2, 1, true)]);
  assert.equal(r.kind, 'reconcile');
  if (r.kind !== 'reconcile') return;
  assert.deepEqual(r.toRestore, [{ id: 2 }]);
});

// ── 9~10. 진짜 취소는 건드리지 않는다 ───────────────────────────────────────

test('9 · 진짜 전원 취소 그룹(원천 2 / DB 2)은 그대로 유지된다', () => {
  const r = reconcileGroupCancellation(
    [src(true, '26.08.01'), src(true, '26.09.05')],
    [db(1, 0, true, '26.08.01'), db(2, 1, true, '26.09.05')]
  );
  assert.equal(r.kind, 'noChange', '해제일이 다른 진짜 이중 취소를 되돌리면 안 된다');
});

test('10 · 혼합 그룹이 이미 정확하면 유지된다', () => {
  const r = reconcileGroupCancellation(
    [src(true), src(false), src(false)],
    [db(1, 0, false), db(2, 1, true), db(3, 2, false)]
  );
  assert.equal(r.kind, 'noChange');
});

// ── 11. 형제 수 불일치 → 아무것도 하지 않는다 ───────────────────────────────

test('11 · 형제 수가 원천과 다르면 추측하지 않고 건너뛴다', () => {
  const fewer = reconcileGroupCancellation([src(false)], [db(1, 0, false), db(2, 1, true)]);
  assert.deepEqual(fewer, { kind: 'skipped', reason: 'SIBLING_COUNT_MISMATCH' });
  const more = reconcileGroupCancellation([src(false), src(true), src(true)], [db(1, 0, true), db(2, 1, true)]);
  assert.deepEqual(more, { kind: 'skipped', reason: 'SIBLING_COUNT_MISMATCH' });
});

// ── 12~13. 원천 신뢰 상태 (호출부 계약) ─────────────────────────────────────
// PARTIAL/INVALID 셀에서 이 함수가 아예 호출되지 않는다는 것은 sale-sync-core의
// §11 가드가 보장한다(그 계약은 cancel-reconcile-integration.test.ts가 고정한다).
// 여기서는 "빈 원천"을 취소 철회로 착각하지 않는지만 확인한다.

test('12 · 원천이 0행이면(셀을 못 읽었을 때의 모습) 형제 수 불일치로 막힌다', () => {
  const r = reconcileGroupCancellation([], [db(1, 0, true), db(2, 1, true)]);
  assert.deepEqual(r, { kind: 'skipped', reason: 'SIBLING_COUNT_MISMATCH' }, '"못 읽음"이 "취소 아님"이 되면 안 된다');
});

test('13 · registryDate가 있는 행은 되돌리지 않는다(전제가 깨진 행)', () => {
  const r = reconcileGroupCancellation(
    [src(false), src(true)],
    [db(1, 0, true, '26.09.02', '26.04.02'), db(2, 1, true, '26.09.02', '26.04.02')]
  );
  assert.deepEqual(r, { kind: 'skipped', reason: 'UNRESTORABLE_REGISTRY_DATE' });
});

// ── 14~16. 결정성 ─────────────────────────────────────────────────────────

test('14 · 완전히 동일한 형제들 사이에서도 선택이 결정적이다', () => {
  const rows = () => [db(10, 0, true), db(20, 1, true), db(30, 2, true)];
  const a = reconcileGroupCancellation([src(true), src(false), src(false)], rows());
  const b = reconcileGroupCancellation([src(false), src(true), src(false)], rows());
  assert.deepEqual(a, b, '원천 순서가 달라도 같은 행을 고른다');
  if (a.kind !== 'reconcile') return assert.fail('reconcile 이어야 한다');
  assert.deepEqual(a.toRestore, [{ id: 30 }, { id: 20 }], 'occurrenceIndex 내림차순');
});

test('15 · 되돌린 뒤 다시 돌리면 아무 일도 하지 않는다(멱등)', () => {
  const before = [db(1, 0, true), db(2, 1, true)];
  const first = reconcileGroupCancellation([src(false), src(true)], before);
  assert.equal(first.kind, 'reconcile');
  if (first.kind !== 'reconcile') return;
  // 적용 후 상태를 만들어 다시 돌린다.
  const restored = new Set(first.toRestore.map((r) => r.id));
  const after = before.map((r) => (restored.has(r.id) ? { ...r, dealCanceled: false, cancelDate: null } : r));
  assert.equal(reconcileGroupCancellation([src(false), src(true)], after).kind, 'noChange');
});

test('16 · occurrenceIndex 순서가 바뀌어도 취소 "개수"는 달라지지 않는다', () => {
  // 같은 그룹을 occurrenceIndex만 반대로 배열한 두 스냅샷.
  const shapeA = [db(1, 0, false), db(2, 1, true)];
  const shapeB = [db(1, 1, false), db(2, 0, true)];
  for (const existing of [shapeA, shapeB]) {
    for (const source of [[src(false), src(true)], [src(true), src(false)]]) {
      const r = reconcileGroupCancellation(source, existing);
      assert.equal(r.kind, 'noChange', '취소 1건 상태는 어떤 배열에서도 유지된다');
    }
  }
});

// ── 17. 실제 21건 패턴 재현 → 예방 확인 ─────────────────────────────────────

test('17 · 결함 A 실제 패턴(원천 취소 1 / DB 형제 전원 취소, 해제일 동일)을 재현하고 치유한다', () => {
  // REPAIR_AUDIT_V1 §5 보수3차봄여름가을겨울 26110:202608 — 원천 1건(26.09.02),
  // DB는 occ0/occ1 둘 다 취소이고 해제일이 복사돼 동일하다.
  const source = [src(false), src(true, '26.09.02')];
  const dbNow = [db(949471, 0, true, '26.09.02'), db(949472, 1, true, '26.09.02')];

  const r = reconcileGroupCancellation(source, dbNow);
  assert.equal(r.kind, 'reconcile');
  if (r.kind !== 'reconcile') return;
  assert.equal(r.toRestore.length, 1, '과다 취소 1건만 되돌린다');
  assert.deepEqual(r.toRestore, [{ id: 949472 }]);

  // 치유 후 상태에서 원천 순서를 계속 뒤집어도 다시 물들지 않는다(래칫 재발 방지).
  const healed = [db(949471, 0, true, '26.09.02'), db(949472, 1, false, null)];
  for (const source2 of [[src(false), src(true, '26.09.02')], [src(true, '26.09.02'), src(false)]]) {
    assert.equal(reconcileGroupCancellation(source2, healed).kind, 'noChange');
  }
});

// ── 보강: 결함 A를 옛 정책으로 재현해 새 정책과 대비한다 ─────────────────────

test('결함 A 재현 — 옛 정책(false→true만)은 순서가 뒤집힐 때마다 취소가 늘어난다', () => {
  // 옛 정책을 그대로 흉내낸다: 자연키(=occurrenceIndex)로 매칭, false→true만 적용.
  let dbState = [
    { occ: 0, canceled: false },
    { occ: 1, canceled: false },
  ];
  const applyOldPolicy = (sourceByOcc: boolean[]) => {
    dbState = dbState.map((row) => ({
      occ: row.occ,
      canceled: row.canceled || sourceByOcc[row.occ], // false→true만, 되돌리기 없음
    }));
  };

  applyOldPolicy([true, false]); // 원천 순서 A: 취소가 먼저 왔다
  assert.equal(dbState.filter((r) => r.canceled).length, 1);
  applyOldPolicy([false, true]); // 원천 순서 B: 순서가 뒤집혔다
  assert.equal(dbState.filter((r) => r.canceled).length, 2, '옛 정책은 여기서 과다 취소를 만든다');

  // 새 정책은 같은 입력에서 절대 2건이 되지 않는다.
  const existing = [db(1, 0, false), db(2, 1, false)];
  const afterA = reconcileGroupCancellation([src(true), src(false)], existing);
  assert.equal(afterA.kind, 'reconcile');
  if (afterA.kind !== 'reconcile') return;
  assert.equal(afterA.toCancel.length, 1);

  const stateAfterA = [db(1, 0, true), db(2, 1, false)];
  const afterB = reconcileGroupCancellation([src(false), src(true)], stateAfterA);
  assert.equal(afterB.kind, 'noChange', '새 정책은 순서가 뒤집혀도 취소를 늘리지 않는다');
});
