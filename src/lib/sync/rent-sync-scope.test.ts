import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SEOUL_RENT_SYNC_LAWDCDS_A,
  SEOUL_RENT_SYNC_LAWDCDS_B,
  SEOUL_RENT_SYNC_LAWDCDS_C,
  SEOUL_RENT_ALL_25_LAWDCDS,
  resolveRentSyncScope,
} from './rent-sync-scope';
import { REGION_NODES } from '../region/registry';

test('서울 전월세 수집 스코프 — 25개 구가 누락이나 중복 없이 3개 shard로 분할된다', () => {
  assert.equal(SEOUL_RENT_SYNC_LAWDCDS_A.length, 8);
  assert.equal(SEOUL_RENT_SYNC_LAWDCDS_B.length, 9);
  assert.equal(SEOUL_RENT_SYNC_LAWDCDS_C.length, 8);
  assert.equal(SEOUL_RENT_ALL_25_LAWDCDS.length, 25);

  const seoul25FromRegistry = REGION_NODES.filter((n) => n.sidoCode === '11').map((n) => n.lawdCd);
  assert.equal(seoul25FromRegistry.length, 25);
  assert.deepEqual([...SEOUL_RENT_ALL_25_LAWDCDS].sort(), [...seoul25FromRegistry].sort());

  // 중복이 없어야 함
  const uniqueSet = new Set(SEOUL_RENT_ALL_25_LAWDCDS);
  assert.equal(uniqueSet.size, 25);
});

test('resolveRentSyncScope — 기본값은 부산(undefined)이며 명시된 스코프만 안전하게 해석한다', () => {
  // null -> busan (undefined lawdCds)
  const defaultScope = resolveRentSyncScope(null);
  assert.deepEqual(defaultScope, { ok: true, scope: 'busan', lawdCds: undefined });

  // seoul / seoul-a
  const seoulA = resolveRentSyncScope('seoul-a');
  assert.ok(seoulA.ok);
  assert.equal(seoulA.lawdCds?.length, 8);
  assert.ok(seoulA.lawdCds?.includes('11110')); // 종로구

  // seoul-b
  const seoulB = resolveRentSyncScope('seoul-b');
  assert.ok(seoulB.ok);
  assert.equal(seoulB.lawdCds?.length, 9);
  assert.ok(seoulB.lawdCds?.includes('11680') === false); // 강남구는 C shard
  assert.ok(seoulB.lawdCds?.includes('11350')); // 노원구

  // seoul-c
  const seoulC = resolveRentSyncScope('seoul-c');
  assert.ok(seoulC.ok);
  assert.equal(seoulC.lawdCds?.length, 8);
  assert.ok(seoulC.lawdCds?.includes('11680')); // 강남구
  assert.ok(seoulC.lawdCds?.includes('11650')); // 서초구

  // seoul-all
  const seoulAll = resolveRentSyncScope('seoul-all');
  assert.ok(seoulAll.ok);
  assert.equal(seoulAll.lawdCds?.length, 25);

  // 잘못된 스코프는 안전하게 거부
  assert.deepEqual(resolveRentSyncScope(''), { ok: false, error: 'invalid rent sync scope' });
  assert.deepEqual(resolveRentSyncScope('incheon'), { ok: false, error: 'invalid rent sync scope' });
  assert.deepEqual(resolveRentSyncScope('11680'), { ok: false, error: 'invalid rent sync scope' });
});
