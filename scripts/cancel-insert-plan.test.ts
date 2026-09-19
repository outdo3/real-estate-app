import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRow,
  planGroupInserts,
  reconcileGroupCancellation,
  type GroupInsertExistingRow,
  type GroupInsertSourceRow,
} from './write-policy-logic';

// CANCELLATION_INSERT_PATH_FIX_V1 — 새 형제 insert의 취소 상태는 원천 응답 위치가 아니라
// 그룹 개수(원천 취소 수 − DB 취소 수)로 정한다. 이 파일은 순수 정책을 고정한다.
// 원천 row의 occurrenceIndex는 normalize가 매기듯 "응답 순서"로 0..n-1을 붙인다.

type Src = GroupInsertSourceRow & { tag?: string };

function src(states: Array<'A' | 'C'>, opts: { cancelDate?: string; aptSeq?: string | null; aptName?: string; dong?: string } = {}): Src[] {
  return states.map((s, i) => ({
    occurrenceIndex: i,
    dealCanceled: s === 'C',
    cancelDate: s === 'C' ? (opts.cancelDate ?? '26.09.17') : null,
    registryDate: null,
    aptSeq: opts.aptSeq === undefined ? '26350-124' : opts.aptSeq,
    aptName: opts.aptName ?? '롯데4',
    dong: opts.dong ?? '우동',
    rawUid: `apt-26350-202608-${i}`,
    tag: s,
  }));
}

function db(states: Array<'A' | 'C'>, opts: { cancelDate?: string; aptName?: string; startIndex?: number } = {}): GroupInsertExistingRow[] {
  return states.map((s, i) => ({
    occurrenceIndex: (opts.startIndex ?? 0) + i,
    dealCanceled: s === 'C',
    cancelDate: s === 'C' ? (opts.cancelDate ?? '26.09.17') : null,
    registryDate: null,
    aptName: opts.aptName ?? '롯데4',
    dong: '우동',
  }));
}

/** 계획을 적용한 뒤 그룹의 최종 (전체, 취소) 개수. */
function finalCounts(sourceRows: Src[], existing: GroupInsertExistingRow[]) {
  const plan = planGroupInserts(sourceRows, existing);
  const inserted = plan.kind === 'insert' ? plan.rows : [];
  const total = existing.length + inserted.length;
  const canceled = existing.filter((e) => e.dealCanceled).length + inserted.filter((r) => r.dealCanceled).length;
  return { plan, inserted, total, canceled };
}

const reversed = (rows: Src[]): Src[] => [...rows].reverse().map((r, i) => ({ ...r, occurrenceIndex: i }));

test('원인 재현 — 수정 전 행 단위 insert(자연키 = 원천 순서)는 신규 7건과 같은 false-cancel을 만든다', () => {
  // 수정 전 sale-sync-core: 원천 행마다 자연키(occurrenceIndex 포함)로 DB 행을 찾고, 없으면 classifyRow가
  // 'insert'를 돌려 그 원천 행을 그대로 넣었다. 형제 수가 달라 reconcile은 skip됐다.
  const legacyInsert = (sourceRows: Src[], existing: GroupInsertExistingRow[]) => {
    const taken = new Set(existing.map((e) => e.occurrenceIndex));
    const inserted = sourceRows.filter((r) => !taken.has(r.occurrenceIndex) && classifyRow(r as never, undefined) === 'insert');
    return existing.filter((e) => e.dealCanceled).length + inserted.filter((r) => r.dealCanceled).length;
  };
  // 원천 순서 [정상, 취소] + DB 취소 1(자리 0) → 자리 1의 취소 행이 들어가 2/2 취소 — 버그.
  assert.equal(legacyInsert(src(['A', 'C']), db(['C'])), 2, '수정 전 경로는 과다 취소를 만든다(재현)');
  // 같은 원천을 반대 순서로 받으면 정상 행이 들어가 1/2 — 결과가 응답 순서에 달려 있었다.
  assert.equal(legacyInsert(src(['C', 'A']), db(['C'])), 1);
  // 새 계획은 두 순서 모두 1/2.
  assert.equal(finalCounts(src(['A', 'C']), db(['C'])).canceled, 1);
  assert.equal(finalCounts(src(['C', 'A']), db(['C'])).canceled, 1);
});

test('1 · DB 정상 1 / 원천 정상 1 + 취소 1 → 취소 1건 insert', () => {
  const r = finalCounts(src(['A', 'C']), db(['A']));
  assert.equal(r.plan.kind, 'insert');
  assert.equal(r.inserted.length, 1);
  assert.equal(r.inserted[0].dealCanceled, true);
  assert.equal(r.inserted[0].cancelDate, '26.09.17');
  assert.deepEqual([r.total, r.canceled], [2, 1]);
});

test('2 · DB 취소 1 / 원천 정상 1 + 취소 1 → 정상 1건 insert (신규 7건 패턴)', () => {
  for (const order of [['A', 'C'], ['C', 'A']] as Array<Array<'A' | 'C'>>) {
    const r = finalCounts(src(order), db(['C']));
    assert.equal(r.inserted.length, 1, order.join());
    assert.equal(r.inserted[0].dealCanceled, false, `원천 순서 ${order.join()}에서도 정상 행이 들어가야 한다`);
    assert.equal(r.inserted[0].cancelDate, null);
    assert.deepEqual([r.total, r.canceled], [2, 1]);
  }
});

test('3 · DB 정상 1 / 원천 정상 2 → 정상 insert', () => {
  const r = finalCounts(src(['A', 'A']), db(['A']));
  assert.equal(r.inserted.length, 1);
  assert.equal(r.inserted[0].dealCanceled, false);
  assert.deepEqual([r.total, r.canceled], [2, 0]);
});

test('4 · DB 2행 / 원천 2행 → insert 없음(개수 같음 = reconcile 담당)', () => {
  assert.deepEqual(planGroupInserts(src(['A', 'C']), db(['A', 'C'])), { kind: 'none' });
  assert.deepEqual(planGroupInserts(src(['A', 'C']), db(['C', 'C'])), { kind: 'none' });
});

test('5 · 원천 순서를 뒤집어도 최종 상태(취소 수·자리·내용)가 같다', () => {
  const cases: Array<[Array<'A' | 'C'>, Array<'A' | 'C'>]> = [
    [['A', 'C'], ['C']], [['A', 'C'], ['A']], [['A', 'A', 'C'], ['C']], [['C', 'C', 'A'], ['A']], [['A', 'C', 'C', 'A'], ['C', 'A']],
  ];
  for (const [s, d] of cases) {
    const forward = planGroupInserts(src(s), db(d));
    const backward = planGroupInserts(reversed(src(s)), db(d));
    assert.equal(forward.kind, 'insert');
    assert.equal(backward.kind, 'insert');
    const shape = (p: typeof forward) =>
      p.kind === 'insert' ? p.rows.map((r) => [r.occurrenceIndex, r.dealCanceled, r.cancelDate, r.registryDate]).sort() : [];
    assert.deepEqual(shape(forward), shape(backward), `${s.join('')} / db ${d.join('')}`);
  }
});

test('6 · 반복 sync 멱등 — 계획을 적용한 다음 실행에서는 insert도 취소 변경도 없다', () => {
  const s = src(['A', 'C']);
  const existing = db(['C']);
  const first = planGroupInserts(s, existing);
  assert.equal(first.kind, 'insert');
  const after: GroupInsertExistingRow[] = [...existing, ...(first.kind === 'insert' ? first.rows : [])];
  assert.deepEqual(planGroupInserts(s, after), { kind: 'none' });
  assert.deepEqual(planGroupInserts(reversed(s), after), { kind: 'none' });
  const withIds = after.map((e, i) => ({ ...e, id: i + 1 }));
  assert.deepEqual(reconcileGroupCancellation(s, withIds), { kind: 'noChange' });
});

test('7 · 원천이 DB보다 2행 많으면 정확히 2행 insert, 자연키 자리는 겹치지 않는다', () => {
  const r = finalCounts(src(['A', 'A', 'C']), db(['A']));
  assert.equal(r.inserted.length, 2);
  assert.deepEqual([r.total, r.canceled], [3, 1]);
  const slots = r.inserted.map((x) => x.occurrenceIndex).sort();
  assert.deepEqual(slots, [1, 2], 'DB가 쓰는 0을 피해 1,2를 받아야 한다');
});

test('8 · 원천 취소 수 > DB 취소 수 → 부족분만큼 정확히 취소 insert', () => {
  const r = finalCounts(src(['C', 'C', 'A', 'A']), db(['C', 'A']));
  assert.equal(r.inserted.length, 2);
  assert.equal(r.inserted.filter((x) => x.dealCanceled).length, 1);
  assert.deepEqual([r.total, r.canceled], [4, 2]);
});

test('9 · DB 취소가 이미 원천 취소 수를 채웠으면 새 행은 전부 정상', () => {
  const r = finalCounts(src(['C', 'A', 'A']), db(['C']));
  assert.equal(r.inserted.length, 2);
  assert.ok(r.inserted.every((x) => !x.dealCanceled));
  assert.deepEqual([r.total, r.canceled], [3, 1]);
});

test('10 · 원천 형제 < DB 형제(결함 B, 원천 회수) → 삭제·추측 없이 아무것도 안 함', () => {
  assert.deepEqual(planGroupInserts(src(['A']), db(['A', 'C'])), { kind: 'none' });
  assert.deepEqual(planGroupInserts([], db(['A'])), { kind: 'none' });
  // reconcile도 여전히 형제 수 불일치로 skip한다(기존 계약 유지).
  assert.deepEqual(reconcileGroupCancellation(src(['A']), db(['A', 'C']).map((e, i) => ({ ...e, id: i + 1 }))), {
    kind: 'skipped',
    reason: 'SIBLING_COUNT_MISMATCH',
  });
});

test('13 · 실제 신규 7건 패턴(기존 취소 1 + 재신고 정상 1) → 새 false-cancel 0', () => {
  // 7개 그룹 모두 원천 1/2 · 삽입 전 DB 1/1 취소였다(CANCELLATION_PREVENTION_CRON_VALIDATION_GATE_V1 §5).
  const groups = ['26.09.11', '26.09.15', '26.09.14', '26.09.16', '26.09.17', '26.09.17', '26.09.17'];
  for (const cancelDate of groups) {
    for (const order of [['A', 'C'], ['C', 'A']] as Array<Array<'A' | 'C'>>) {
      const r = finalCounts(src(order, { cancelDate }), db(['C'], { cancelDate }));
      assert.deepEqual([r.total, r.canceled], [2, 1], `${cancelDate} ${order.join()}`);
    }
  }
});

test('14 · 기존 21건 패턴(형제 수 같고 DB 과다 취소)은 insert 경로가 건드리지 않는다(악화 없음)', () => {
  assert.deepEqual(planGroupInserts(src(['A', 'C']), db(['C', 'C'])), { kind: 'none' });
  assert.deepEqual(planGroupInserts(src(['C', 'C', 'A']), db(['C', 'C', 'C'])), { kind: 'none' });
  // 과다 취소 DB에 형제가 더 오면 새 행은 전부 정상으로 들어간다 — 취소 수가 더 늘지 않는다.
  const r = finalCounts(src(['A', 'C', 'A']), db(['C', 'C']));
  assert.equal(r.canceled, 2);
  assert.ok(r.inserted.every((x) => !x.dealCanceled));
});

test('15 · 진짜 취소 insert는 보존 — 원천이 새로 취소를 보고하면 취소로 들어간다', () => {
  const r = finalCounts(src(['C', 'C']), db(['C']));
  assert.equal(r.inserted.length, 1);
  assert.equal(r.inserted[0].dealCanceled, true);
  assert.deepEqual([r.total, r.canceled], [2, 2]);
  // 신규 그룹(DB 0)은 원천 행을 그대로 넣는다 — 취소 행도 그대로.
  const fresh = finalCounts(src(['C', 'A']), []);
  assert.deepEqual([fresh.total, fresh.canceled], [2, 1]);
});

test('16 · 전원 정상 그룹 → false cancel 0', () => {
  for (let n = 2; n <= 5; n++) {
    for (let m = 1; m < n; m++) {
      const r = finalCounts(src(Array(n).fill('A')), db(Array(m).fill('A')));
      assert.equal(r.canceled, 0);
      assert.equal(r.total, n);
    }
  }
});

test('17 · 전원 취소 그룹 → 정확한 개수', () => {
  for (let n = 2; n <= 5; n++) {
    for (let m = 1; m < n; m++) {
      const r = finalCounts(src(Array(n).fill('C')), db(Array(m).fill('C')));
      assert.deepEqual([r.total, r.canceled], [n, n]);
    }
  }
});

test('보류 규칙 — 부족분이 넣을 수보다 많거나, aptSeq가 없거나, identity가 엇갈리면 추측하지 않는다', () => {
  // 원천 2/2 취소, DB 정상 1 → 새 행 1개로는 취소 2를 만들 수 없다(기존 정상 행을 바꿔야 함).
  assert.deepEqual(planGroupInserts(src(['C', 'C']), db(['A'])), { kind: 'skipped', reason: 'CANCELED_DEFICIT_EXCEEDS_MISSING', missing: 1 });
  assert.deepEqual(planGroupInserts(src(['A', 'C'], { aptSeq: null }), db(['C'])), { kind: 'skipped', reason: 'NO_APT_SEQ', missing: 1 });
  assert.deepEqual(planGroupInserts(src(['A', 'C']), db(['C'], { aptName: '롯데4차' })), { kind: 'skipped', reason: 'IDENTITY_MISMATCH', missing: 1 });
});

test('자리 배정 — DB가 쓰지 않는 occurrenceIndex만, 오름차순으로 받는다', () => {
  const p = planGroupInserts(src(['A', 'C', 'A']), db(['C'], { startIndex: 1 }));
  assert.equal(p.kind, 'insert');
  if (p.kind !== 'insert') return;
  assert.deepEqual(p.rows.map((r) => r.occurrenceIndex).sort(), [0, 2]);
  assert.ok(p.rows.every((r) => r.occurrenceIndex !== 1));
});

test('속성 — 원천 ≤4행 모든 구성 × DB 부분 구성 × 모든 원천 순서: 삽입하면 최종 취소 수 = 원천 취소 수, 순서 무관', () => {
  const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  let checked = 0;
  for (let n = 2; n <= 4; n++) {
    for (let c = 0; c <= n; c++) {
      const states: Array<'A' | 'C'> = [...Array(n - c).fill('A'), ...Array(c).fill('C')];
      for (let m = 1; m < n; m++) {
        for (let dc = 0; dc <= m; dc++) {
          const dbStates: Array<'A' | 'C'> = [...Array(m - dc).fill('A'), ...Array(dc).fill('C')];
          const outcomes = new Set<string>();
          for (const order of perms(states)) {
            const r = finalCounts(src(order), db(dbStates));
            checked++;
            if (r.plan.kind === 'insert') {
              assert.equal(r.total, n);
              // 기존 행은 바꾸지 않으므로, DB가 이미 과다 취소면 그 초과분만 남는다(악화 없음).
              assert.equal(r.canceled, Math.max(c, dc), `src ${order.join('')} db ${dbStates.join('')}`);
            } else {
              assert.equal(r.plan.kind, 'skipped');
              assert.ok(c - dc > n - m, '보류는 부족분 > 넣을 수일 때만');
            }
            outcomes.add(JSON.stringify(r.plan.kind === 'insert' ? r.inserted.map((x) => [x.occurrenceIndex, x.dealCanceled]).sort() : r.plan));
          }
          assert.equal(outcomes.size, 1, `원천 순서에 따라 결과가 달라졌다: src ${states.join('')} db ${dbStates.join('')}`);
        }
      }
    }
  }
  assert.ok(checked > 500);
});
