/**
 * E-JIP 서울 V3.8-A — seoul-b 85,612건 격리 DB 적재 및 무결성 자동화 테스트
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { runSeoulBApplyVerification } from './seoul-rent-b-shard-apply-runner';

test('runSeoulBApplyVerification: 85,612건 격리 DB 전체 적재, 중복 방지, 멱등성, 체크포인트 검증', async () => {
  const result = await runSeoulBApplyVerification();

  // 1. 캐시 무결성
  assert.strictEqual(result.cacheIntegrity.totalFiles, 108, '108개 캐시 파일 전수 존재');
  assert.strictEqual(result.cacheIntegrity.totalRawRows, 85612, '총 85,612건 원천 행 일치');
  assert.strictEqual(result.cacheIntegrity.totalJeonse, 44801, '전세 44,801건 일치');
  assert.strictEqual(result.cacheIntegrity.totalWolse, 40811, '월세 40,811건 일치');
  assert.strictEqual(result.cacheIntegrity.allComplete, true, '전 셀 COMPLETE 상태');

  // 2. 1차 적재 결과 (seoul-b 108셀 신규 clean INSERT)
  assert.strictEqual(result.firstApplyExecution.totalExecutedCells, 108, '108셀 전체 실행');
  assert.strictEqual(result.firstApplyExecution.totalPersistedRows, 85612, '신규 INSERT는 85,612건이어야 함');
  assert.strictEqual(result.firstApplyExecution.totalUnchangedRows, 0, '초기 적재 시 unchanged 0건');
  assert.strictEqual(result.firstApplyExecution.totalGuardedSkipped, 0, 'Option E 가드 보류는 0건이어야 함');
  assert.strictEqual(result.firstApplyExecution.totalInvalidCells, 0, 'INVALID 셀 0건');

  // 3. PostgreSQL 실제 질의 결과
  assert.strictEqual(result.databaseVerification.totalSeoulBRows, 85612, 'DB에 seoul-b 9개 구 데이터가 정확히 85,612건 적재되어야 함');
  assert.strictEqual(result.databaseVerification.totalAllDbRows, 134833, '전체 누적 건수는 134,833건(seoul-a 47,817 + 송파 1,404 + seoul-b 85,612)이어야 함');
  assert.strictEqual(result.databaseVerification.jeonseCount, 44801, 'DB 전세 건수가 정확히 44,801건이어야 함');
  assert.strictEqual(result.databaseVerification.wolseCount, 40811, 'DB 월세 건수가 정확히 40,811건이어야 함');
  assert.strictEqual(result.databaseVerification.duplicateNaturalKeysCount, 0, '자연키 중복 건수가 0건이어야 함');
  assert.strictEqual(result.databaseVerification.seoulAPreserved, true, '기존 seoul-a 47,817건이 보존되어야 함');
  assert.strictEqual(result.databaseVerification.songpaPreserved, true, '기존 송파구 1,404건이 보존되어야 함');

  // 9개 구별 건수 확인
  assert.strictEqual(result.databaseVerification.districtCounts['11350'], 17606, '노원구 17,606건');
  assert.strictEqual(result.databaseVerification.districtCounts['11500'], 13679, '강서구 13,679건');
  assert.strictEqual(result.databaseVerification.districtCounts['11470'], 10621, '양천구 10,621건');
  assert.strictEqual(result.databaseVerification.districtCounts['11200'], 9650,  '성동구 9,650건');
  assert.strictEqual(result.databaseVerification.districtCounts['11380'], 9500,  '은평구 9,500건');
  assert.strictEqual(result.databaseVerification.districtCounts['11260'], 8643,  '중랑구 8,643건');
  assert.strictEqual(result.databaseVerification.districtCounts['11290'], 7823,  '성북구 7,823건');
  assert.strictEqual(result.databaseVerification.districtCounts['11320'], 5209,  '도봉구 5,209건');
  assert.strictEqual(result.databaseVerification.districtCounts['11305'], 2881,  '강북구 2,881건');

  // 4. 동일 캐시 2차 재실행 시 중복 0건 (완전한 멱등성)
  assert.strictEqual(result.reexecutionVerification.unchangedCount, 85612, '재실행 시 85,612건 전수가 unchanged로 식별되어야 함');
  assert.strictEqual(result.reexecutionVerification.newInsertsCount, 0, '재실행 시 신규 INSERT는 0건이어야 함');
  assert.strictEqual(result.reexecutionVerification.isZeroDuplicateIncrement, true, '재실행 후 DB 레코드 증가량이 0건이어야 함');

  // 5. Checkpoint 상태 검증
  assert.strictEqual(result.checkpointVerification.allApplied, true, '108개 셀 모두 APPLIED 상태여야 함');
  assert.strictEqual(result.checkpointVerification.appliedCellCount, 108, 'APPLIED 셀 수가 108개여야 함');
  assert.strictEqual(result.checkpointVerification.checkpointEnvironment, 'LOCAL_DOCKER_QA', '체크포인트 환경 식별자가 LOCAL_DOCKER_QA여야 함');
  assert.strictEqual(result.checkpointVerification.skippedOnNormalRerun, true, '정상 재실행 시 체크포인트에 의해 108셀 전수 스킵되어야 함');

  // 6. 중단/재개 검증
  assert.strictEqual(result.interruptionRecovery.partialResumedSuccessfully, true, '54셀 완료 체크포인트에서 재개 시 정확히 잔여 54셀만 처리되어야 함');
});
