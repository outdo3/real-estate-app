/**
 * E-JIP 서울 V3.8-B — seoul-c 107,427건 격리 DB 적재 및 서울 25개 구 300셀 최종 검증 테스트
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import { runSeoulCApplyVerification } from './seoul-rent-c-shard-apply-runner';

test('runSeoulCApplyVerification: seoul-c 107,427건 적재 및 서울 25개 구 300셀 240,856건 최종 정합성 검증', async () => {
  const result = await runSeoulCApplyVerification();

  // 1. seoul-c 캐시 무결성
  assert.strictEqual(result.cacheIntegrity.totalFiles, 96, '96개 캐시 파일 전수 존재');
  assert.strictEqual(result.cacheIntegrity.totalRawRows, 107427, '총 107,427건 원천 행 일치');
  assert.strictEqual(result.cacheIntegrity.totalJeonse, 52791, '전세 52,791건 일치');
  assert.strictEqual(result.cacheIntegrity.totalWolse, 54636, '월세 54,636건 일치');
  assert.strictEqual(result.cacheIntegrity.allComplete, true, '전 셀 COMPLETE 상태');

  // 2. 1차 적재 결과 (송파구 202610 1,404건은 unchanged 감지, 신규 INSERT 106,023건)
  assert.strictEqual(result.firstApplyExecution.totalExecutedCells, 96, '96셀 전체 실행');
  assert.strictEqual(result.firstApplyExecution.totalPersistedRows, 106023, '신규 INSERT는 106,023건이어야 함');
  assert.strictEqual(result.firstApplyExecution.totalUnchangedRows, 1404, '기존 송파구 202610 1,404건은 unchanged 감지되어야 함');
  assert.strictEqual(result.firstApplyExecution.totalGuardedSkipped, 0, 'Option E 가드 보류는 0건이어야 함');
  assert.strictEqual(result.firstApplyExecution.totalInvalidCells, 0, 'INVALID 셀 0건');

  // 3. PostgreSQL seoul-c 질의 결과
  assert.strictEqual(result.databaseVerification.totalSeoulCRows, 107427, 'DB에 seoul-c 8개 구 데이터가 정확히 107,427건 적재되어야 함');
  assert.strictEqual(result.databaseVerification.jeonseCount, 52791, 'seoul-c 전세 건수 52,791건');
  assert.strictEqual(result.databaseVerification.wolseCount, 54636, 'seoul-c 월세 건수 54,636건');
  assert.strictEqual(result.databaseVerification.duplicateNaturalKeysCount, 0, 'seoul-c 자연키 중복 0건');
  assert.strictEqual(result.databaseVerification.seoulAPreserved, true, '기존 seoul-a 47,817건 보존');
  assert.strictEqual(result.databaseVerification.seoulBPreserved, true, '기존 seoul-b 85,612건 보존');
  assert.strictEqual(result.databaseVerification.songpaDuplicatePrevented, true, '송파 202610 중복방지(1,404건 유지)');

  // 8개 구별 건수 확인
  assert.strictEqual(result.databaseVerification.districtCounts['11680'], 22695, '강남구 22,695건');
  assert.strictEqual(result.databaseVerification.districtCounts['11710'], 19952, '송파구 19,952건');
  assert.strictEqual(result.databaseVerification.districtCounts['11650'], 14079, '서초구 14,079건');
  assert.strictEqual(result.databaseVerification.districtCounts['11740'], 14011, '강동구 14,011건');
  assert.strictEqual(result.databaseVerification.districtCounts['11560'], 11187, '영등포구 11,187건');
  assert.strictEqual(result.databaseVerification.districtCounts['11530'], 10886, '구로구 10,886건');
  assert.strictEqual(result.databaseVerification.districtCounts['11590'], 8759,  '동작구 8,759건');
  assert.strictEqual(result.databaseVerification.districtCounts['11620'], 5858,  '관악구 5,858건');

  // 4. 서울 25개 구 300셀 최종 전수 검증
  assert.strictEqual(result.all25DistrictsVerification.total25DistrictsCount, 25, '서울 25개 구 전수 포함 (25개)');
  assert.strictEqual(result.all25DistrictsVerification.all25Present, true, '25개 구 모두 존재');
  assert.strictEqual(result.all25DistrictsVerification.grandTotalDbRows, 240856, '서울 25개 구 총 실거래 건수는 240,856건이어야 함');
  assert.strictEqual(result.all25DistrictsVerification.grandTotalJeonse, 119510, '서울 25개 구 총 전세 건수는 119,510건이어야 함');
  assert.strictEqual(result.all25DistrictsVerification.grandTotalWolse, 121346, '서울 25개 구 총 월세 건수는 121,346건이어야 함');
  assert.strictEqual(result.all25DistrictsVerification.globalDuplicateCount, 0, '서울 전체 전역 자연키 중복 0건이어야 함');

  // 5. 동일 캐시 2차 재실행 시 중복 0건 (완전한 멱등성)
  assert.strictEqual(result.reexecutionVerification.unchangedCount, 107427, '재실행 시 107,427건 전수가 unchanged로 식별');
  assert.strictEqual(result.reexecutionVerification.newInsertsCount, 0, '재실행 시 신규 INSERT 0건');
  assert.strictEqual(result.reexecutionVerification.isZeroDuplicateIncrement, true, '재실행 후 DB 레코드 증가량 0건');

  // 6. Checkpoint 상태 검증
  assert.strictEqual(result.checkpointVerification.allApplied, true, '96개 셀 모두 APPLIED 상태');
  assert.strictEqual(result.checkpointVerification.appliedCellCount, 96, 'APPLIED 셀 수 96개');
  assert.strictEqual(result.checkpointVerification.checkpointEnvironment, 'LOCAL_DOCKER_QA', '체크포인트 환경 식별자 LOCAL_DOCKER_QA');
  assert.strictEqual(result.checkpointVerification.skippedOnNormalRerun, true, '정상 재실행 시 체크포인트에 의해 96셀 전수 스킵');

  // 7. 중단/재개 검증
  assert.strictEqual(result.interruptionRecovery.partialResumedSuccessfully, true, '48셀 완료 체크포인트에서 재개 시 잔여 48셀만 정상 처리');
});
