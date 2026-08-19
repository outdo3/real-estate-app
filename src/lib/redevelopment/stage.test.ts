import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapMolitStage, mapBusanStage, deriveProjectStatus } from './stage';

test('mapMolitStage — 실측된 7개 코드 전부 매핑(1, 8~16은 관측 안 됨)', () => {
  assert.equal(mapMolitStage('2)정비구역지정'), 'ZONE_DESIGNATED');
  assert.equal(mapMolitStage('3)추진위구성'), 'PROMOTION_COMMITTEE');
  assert.equal(mapMolitStage('4)조합설립인가'), 'ASSOCIATION_APPROVED');
  assert.equal(mapMolitStage('5)사업시행인가'), 'PROJECT_IMPLEMENTATION_APPROVED');
  assert.equal(mapMolitStage('6)관리처분인가'), 'MANAGEMENT_DISPOSITION_APPROVED');
  assert.equal(mapMolitStage('7)착공'), 'CONSTRUCTION');
  assert.equal(mapMolitStage('17)사업시행자지정'), 'PUBLIC_OPERATOR_DESIGNATED');
});

test('mapMolitStage — 관측되지 않은 코드는 추정하지 않고 UNKNOWN', () => {
  assert.equal(mapMolitStage('1)미관측코드'), 'UNKNOWN');
  assert.equal(mapMolitStage('코드없음'), 'UNKNOWN');
});

test('mapBusanStage — 12종 실측값 전부 매핑', () => {
  const cases: Array<[string, string]> = [
    ['예정구역지정', 'PLANNED'],
    ['정비계획 수립 및 정비구역 지정', 'ZONE_DESIGNATED'],
    ['추진위원회 구성', 'PROMOTION_COMMITTEE'],
    ['조합설립인가', 'ASSOCIATION_APPROVED'],
    ['건축심의 및 통합심의', 'ARCHITECTURAL_REVIEW'],
    ['사업시행계획인가', 'PROJECT_IMPLEMENTATION_APPROVED'],
    ['관리처분계획', 'MANAGEMENT_DISPOSITION_APPROVED'],
    ['착공', 'CONSTRUCTION'],
    ['준공', 'COMPLETED'],
    ['이전고시', 'TRANSFER_REGISTERED'],
    ['조합해산', 'DISSOLVED'],
    ['해제', 'CANCELLED'],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(mapBusanStage(raw), expected, `${raw} -> ${expected}`);
  }
});

test('mapBusanStage — 새로운 값(다른 지자체 등)은 추정하지 않고 UNKNOWN', () => {
  assert.equal(mapBusanStage('처음보는단계'), 'UNKNOWN');
});

test('deriveProjectStatus — 모든 stage가 4개 상태 중 하나로 떨어진다', () => {
  assert.equal(deriveProjectStatus('COMPLETED'), 'COMPLETED');
  assert.equal(deriveProjectStatus('TRANSFER_REGISTERED'), 'COMPLETED');
  assert.equal(deriveProjectStatus('CANCELLED'), 'CANCELLED');
  assert.equal(deriveProjectStatus('DISSOLVED'), 'UNKNOWN');
  assert.equal(deriveProjectStatus('UNKNOWN'), 'UNKNOWN');
  assert.equal(deriveProjectStatus('CONSTRUCTION'), 'ACTIVE');
  assert.equal(deriveProjectStatus('ZONE_DESIGNATED'), 'ACTIVE');
});
