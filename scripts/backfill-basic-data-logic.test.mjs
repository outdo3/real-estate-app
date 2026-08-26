import assert from 'node:assert/strict';
import test from 'node:test';
import { planField, calcParkingPerHousehold } from './backfill-basic-data-logic.ts';

// E. null 필드 → fill
test('기존 값이 null이면 FILL_NULL로 분류하고 새 값을 채운다', () => {
  const plan = planField('floorAreaRatio', null, 535.3);
  assert.equal(plan.action, 'FILL_NULL');
  assert.equal(plan.newValue, 535.3);
});

// D. 기존 non-null 값과 충돌 → overwrite 금지, CONFLICT_REVIEW로만 기록
test('기존 값이 non-null이고 새 값과 다르면 CONFLICT_REVIEW로 분류하고 덮어쓰지 않는다', () => {
  const plan = planField('totalHouseholds', 165, 200);
  assert.equal(plan.action, 'CONFLICT_REVIEW');
  // 실제 DB write는 processRow에서 FILL_NULL 액션만 반영하므로, 이 테스트는 그 판단
  // 근거(action이 CONFLICT_REVIEW면 쓰지 않음)가 올바른지만 검증한다.
});

test('기존 값과 새 값이 사실상 같으면(부동소수 오차 허용) MATCH_EXISTING으로 분류한다', () => {
  const plan = planField('floorAreaRatio', 249.53, 249.529999);
  assert.equal(plan.action, 'MATCH_EXISTING');
});

test('기존 값이 있고 새로 조회한 값이 없으면 UNCHANGED로 분류한다(기존 값 보존)', () => {
  const plan = planField('parkingCount', 888, null);
  assert.equal(plan.action, 'UNCHANGED');
});

// G. parkingPerHousehold
test('세대수 > 0이고 주차대수가 있으면 세대당 주차대수를 계산한다', () => {
  assert.equal(calcParkingPerHousehold(204, 165), 204 / 165);
});

test('세대수가 0이거나 없으면 세대당 주차대수를 계산하지 않는다(0으로 나누기 금지)', () => {
  assert.equal(calcParkingPerHousehold(204, 0), null);
  assert.equal(calcParkingPerHousehold(204, null), null);
});

test('주차대수가 없으면 세대당 주차대수를 계산하지 않는다', () => {
  assert.equal(calcParkingPerHousehold(null, 165), null);
});
