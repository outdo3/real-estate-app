import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMasterRowPlan, buildAllPlans, BUSAN_GU_BY_LAWDCD } from './repair-recent-missing-masters-logic.ts';

const readyCandidate = {
  aptSeq: '26290-2594',
  canonicalName: '햇살좋은집',
  lawdCd: '26290',
  dong: '대연동',
  jibun: '1506-19',
  buildYear: 2017,
  masterCreateReadiness: 'READY_FOR_MASTER_CREATE',
};

// A. dry-run deterministic — 같은 입력이면 항상 같은 plan(순수 함수 보장)
test('A: 동일 입력에 대해 buildAllPlans가 항상 동일한 결과를 낸다(dry-run 재현성)', () => {
  const candidates = [readyCandidate];
  const p1 = buildAllPlans(candidates, new Set());
  const p2 = buildAllPlans(candidates, new Set());
  assert.deepEqual(p1, p2);
});

// B. 16 candidate exact — READY_FOR_MASTER_CREATE 16건이 전부 INSERT 계획으로 이어짐
test('B: READY_FOR_MASTER_CREATE 16건이 전부 INSERT 대상이 된다(중복/결측 없을 때)', () => {
  const sixteen = Array.from({ length: 16 }, (_, i) => ({
    ...readyCandidate,
    aptSeq: `26290-${1000 + i}`,
  }));
  const plans = buildAllPlans(sixteen, new Set());
  assert.equal(plans.filter((p) => p.action === 'INSERT').length, 16);
});

// C. duplicate aptSeq skipped
test('C: 이미 Master에 존재하는 aptSeq는 SKIP_DUPLICATE로 분류되고 data가 없다', () => {
  const plan = buildMasterRowPlan(readyCandidate, new Set([readyCandidate.aptSeq]));
  assert.equal(plan.action, 'SKIP_DUPLICATE');
  assert.equal(plan.data, null);
});

// D. missing required identity rejected
test('D: 필수 identity 필드(jibun)가 없으면 REJECT_MISSING_FIELD로 분류된다', () => {
  const broken = { ...readyCandidate, jibun: '' };
  const plan = buildMasterRowPlan(broken, new Set());
  assert.equal(plan.action, 'REJECT_MISSING_FIELD');
  assert.equal(plan.data, null);
});

// E. existing rows not updated — SKIP_DUPLICATE는 INSERT/UPDATE 어느 쪽도 아니다(스크립트가
// .create()만 호출하고 이 action에 대해서는 아무 DB 호출도 하지 않음을 로직 레벨에서 보장).
test('E: 중복 aptSeq는 UPDATE 계획으로 이어지지 않는다(action이 INSERT가 아님)', () => {
  const plan = buildMasterRowPlan(readyCandidate, new Set([readyCandidate.aptSeq]));
  assert.notEqual(plan.action, 'INSERT');
});

// F. secondary null accepted — totalHouseholds 등 secondary 필드를 아예 넣지 않는다
// (Prisma가 스키마 기본값/null로 채우도록 위임 — 임의 추정값 없음).
test('F: 생성 data에는 identity 필드만 있고 secondary metadata 키가 전혀 없다', () => {
  const plan = buildMasterRowPlan(readyCandidate, new Set());
  assert.equal(plan.action, 'INSERT');
  const keys = Object.keys(plan.data);
  for (const forbidden of ['totalHouseholds', 'latitude', 'longitude', 'parkingCount', 'floorAreaRatio', 'buildingCoverageRatio', 'useApprovalDate', 'mainBuildingCount']) {
    assert.ok(!keys.includes(forbidden), `${forbidden} 필드는 생성 데이터에 포함되면 안 된다`);
  }
  assert.deepEqual(keys.sort(), ['aptSeq', 'buildYear', 'jibun', 'name', 'normalizedName', 'sggCd', 'sido', 'sigungu', 'umdName'].sort());
});

test('masterCreateReadiness가 READY_FOR_MASTER_CREATE가 아니면 SKIP_NOT_READY로 분류된다(승인 범위 강제)', () => {
  const plan = buildMasterRowPlan({ ...readyCandidate, masterCreateReadiness: 'REVIEW_REQUIRED' }, new Set());
  assert.equal(plan.action, 'SKIP_NOT_READY');
});

test('BUSAN_GU_BY_LAWDCD 매핑이 16개 구·군을 전부 포함한다', () => {
  assert.equal(Object.keys(BUSAN_GU_BY_LAWDCD).length, 16);
  assert.equal(BUSAN_GU_BY_LAWDCD['26290'], '남구');
});

test('sigungu 매핑이 없는 lawdCd는 sigungu=null로 안전하게 처리된다(추측하지 않음)', () => {
  const plan = buildMasterRowPlan({ ...readyCandidate, lawdCd: '99999' }, new Set());
  assert.equal(plan.action, 'INSERT');
  assert.equal(plan.data.sigungu, null);
  assert.equal(plan.data.sggCd, '99999');
});
