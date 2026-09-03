// SALE_CANCELLATION_COVERAGE_V1 §8 — legacy upsert true→false 역전 FAIL-SAFE 테스트.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCancellationUpdateFields, wouldHaveReversedCancellation } from './cancellation-write-guard.ts';

test('원천이 취소면 false→true를 적용한다(승인된 유일한 UPDATE)', () => {
  const f = buildCancellationUpdateFields({ dealCanceled: true, cancelDate: '25.07.29', registryDate: null });
  assert.equal(f.dealCanceled, true);
  assert.equal(f.cancelDate, '25.07.29');
});

test('원천이 비취소면 dealCanceled를 update 절에 아예 넣지 않는다', () => {
  const f = buildCancellationUpdateFields({ dealCanceled: false, cancelDate: null, registryDate: '2026-01-05' });
  assert.equal('dealCanceled' in f, false, 'update 절에 존재하면 기존 true를 덮어쓴다');
  assert.equal('cancelDate' in f, false, 'canceled=true인데 cancelDate만 지워지는 상태를 만들면 안 된다');
  assert.equal(f.registryDate, '2026-01-05', '등기일자는 취소와 무관하므로 계속 갱신한다');
});

test('어떤 입력으로도 dealCanceled=false를 쓰지 않는다(구조적 단방향성)', () => {
  for (const dealCanceled of [true, false]) {
    for (const cancelDate of ['25.07.29', null]) {
      for (const registryDate of ['2026-01-05', null]) {
        const f = buildCancellationUpdateFields({ dealCanceled, cancelDate, registryDate });
        assert.notEqual(f.dealCanceled, false, `false를 쓰는 조합이 있으면 안 된다: ${dealCanceled}/${cancelDate}/${registryDate}`);
      }
    }
  }
});

test('이미 취소된 행을 원천이 비취소로 되돌려도 취소 상태가 보존된다', () => {
  const existing = { dealCanceled: true, cancelDate: '25.07.29' };
  const f = buildCancellationUpdateFields({ dealCanceled: false, cancelDate: null, registryDate: null });
  const after = { ...existing, ...f };
  assert.equal(after.dealCanceled, true, '역전이 일어나면 V2/V3 보정 10,852건이 무너진다');
  assert.equal(after.cancelDate, '25.07.29');
});

test('취소가 아닌 행은 그대로 비취소로 남는다(손실 없음)', () => {
  const existing = { dealCanceled: false, cancelDate: null };
  const after = { ...existing, ...buildCancellationUpdateFields({ dealCanceled: false, cancelDate: null, registryDate: null }) };
  assert.equal(after.dealCanceled, false);
});

test('가드가 실제로 역전을 막은 경우를 감지할 수 있다(관측용)', () => {
  assert.equal(wouldHaveReversedCancellation({ dealCanceled: false, cancelDate: null, registryDate: null }, { dealCanceled: true }), true);
  assert.equal(wouldHaveReversedCancellation({ dealCanceled: true, cancelDate: null, registryDate: null }, { dealCanceled: false }), false);
  assert.equal(wouldHaveReversedCancellation({ dealCanceled: false, cancelDate: null, registryDate: null }, { dealCanceled: false }), false);
  assert.equal(wouldHaveReversedCancellation({ dealCanceled: false, cancelDate: null, registryDate: null }, undefined), false);
});
