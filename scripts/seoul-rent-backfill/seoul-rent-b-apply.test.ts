/**
 * E-JIP 서울 V3.7-B — seoul-a 47,817건 격리 DB 적재 및 무결성 자동화 테스트
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { runSeoulAApplyVerification } from './seoul-rent-b-apply-runner';

test('runSeoulAApplyVerification: 47,817건 격리 DB 전체 적재, 중복 방지, 멱등성, 체크포인트 검증', async () => {
  const result = await runSeoulAApplyVerification();

  // 1. 캐시 무결성
  assert.strictEqual(result.cacheIntegrity.totalFiles, 96, '96개 캐시 파일 전수 존재');
  assert.strictEqual(result.cacheIntegrity.totalRawRows, 47817, '총 47,817건 원천 행 일치');
  assert.strictEqual(result.cacheIntegrity.totalJeonse, 21918, '전세 21,918건 일치');
  assert.strictEqual(result.cacheIntegrity.totalWolse, 25899, '월세 25,899건 일치');
  assert.strictEqual(result.cacheIntegrity.allComplete, true, '전 셀 COMPLETE 상태');

  // 2. 1차 적재 결과 (종로 202610 140건은 기존 데이터와 동일하여 unchanged 감지)
  assert.strictEqual(result.firstApplyExecution.totalExecutedCells, 96, '96셀 전체 실행');
  assert.strictEqual(result.firstApplyExecution.totalPersistedRows, 47677, '신규 INSERT는 47,677건이어야 함');
  assert.strictEqual(result.firstApplyExecution.totalUnchangedRows, 140, '기존 종로구 202610 140건은 unchanged 감지되어야 함');
  assert.strictEqual(result.firstApplyExecution.totalGuardedSkipped, 0, 'Option E 가드 보류는 0건이어야 함');
  assert.strictEqual(result.firstApplyExecution.totalInvalidCells, 0, 'INVALID 셀 0건');

  // 3. PostgreSQL 실제 질의 결과
  assert.strictEqual(result.databaseVerification.totalSeoulARows, 47817, 'DB에 seoul-a 8개 구 데이터가 정확히 47,817건 적재되어야 함');
  assert.strictEqual(result.databaseVerification.jeonseCount, 21918, 'DB 전세 건수가 정확히 21,918건이어야 함');
  assert.strictEqual(result.databaseVerification.wolseCount, 25899, 'DB 월세 건수가 정확히 25,899건이어야 함');
  assert.strictEqual(result.databaseVerification.duplicateNaturalKeysCount, 0, '자연키 중복 건수가 0건이어야 함');
  assert.strictEqual(result.databaseVerification.songpaPreserved, true, '기존 송파구 1,404건이 삭제되지 않고 보존되어야 함');

  // 8개 구별 건수 확인
  assert.strictEqual(result.databaseVerification.districtCounts['11440'], 11723, '마포구 11,723건');
  assert.strictEqual(result.databaseVerification.districtCounts['11230'], 9192, '동대문구 9,192건');
  assert.strictEqual(result.databaseVerification.districtCounts['11410'], 7069, '서대문구 7,069건');
  assert.strictEqual(result.databaseVerification.districtCounts['11170'], 6192, '용산구 6,192건');
  assert.strictEqual(result.databaseVerification.districtCounts['11215'], 4705, '광진구 4,705건');
  assert.strictEqual(result.databaseVerification.districtCounts['11140'], 3639, '중구 3,639건');
  assert.strictEqual(result.databaseVerification.districtCounts['11545'], 3064, '금천구 3,064건');
  assert.strictEqual(result.databaseVerification.districtCounts['11110'], 2233, '종로구 2,233건');

  // 4. 동일 캐시 2차 재실행 시 중복 0건 (완전한 멱등성)
  assert.strictEqual(result.reexecutionVerification.unchangedCount, 47817, '재실행 시 47,817건 전수가 unchanged로 식별되어야 함');
  assert.strictEqual(result.reexecutionVerification.newInsertsCount, 0, '재실행 시 신규 INSERT는 0건이어야 함');
  assert.strictEqual(result.reexecutionVerification.isZeroDuplicateIncrement, true, '재실행 후 DB 레코드 증가량이 0건이어야 함');

  // 5. Checkpoint 상태 검증
  assert.strictEqual(result.checkpointVerification.allApplied, true, '96개 셀 모두 APPLIED 상태여야 함');
  assert.strictEqual(result.checkpointVerification.appliedCellCount, 96, 'APPLIED 셀 수가 96개여야 함');
  assert.strictEqual(result.checkpointVerification.skippedOnNormalRerun, true, '정상 재실행 시 체크포인트에 의해 96셀 전수 스킵되어야 함');

  // 6. 중단/재개 검증
  assert.strictEqual(result.interruptionRecovery.partialResumedSuccessfully, true, '48셀 완료 체크포인트에서 재개 시 정확히 잔여 48셀만 처리되어야 함');
});
