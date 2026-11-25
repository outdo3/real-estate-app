import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { runMultipageDockerQa, MultipageDockerQaResult } from './seoul-rent-multipage-docker-qa';

describe('Seoul Rent Multipage Docker PostgreSQL Ingestion Tests (V3.6)', () => {
  it('executes full live PostgreSQL ingestion for Songpa-gu 1,404 items and validates parity, duplicates, guards, and capacity', async () => {
    const result: MultipageDockerQaResult = await runMultipageDockerQa();

    // 1. 격리 DB 확인
    assert.equal(result.dbEnvironmentCheck.host, '127.0.0.1');
    assert.equal(result.dbEnvironmentCheck.isIsolated, true);
    assert.equal(result.dbEnvironmentCheck.status, 'READY');

    // 2. 1차 최초 INSERT (1,404건)
    assert.equal(result.totalLoadedRows, 1404);
    assert.equal(result.initialInsertCount, 1404);
    assert.equal(result.totalDbRowsAfterInsert, 1404);

    // 3. 동일 1,404건 데이터 재실행 시 중복 0건 증가 검증
    assert.equal(result.reexecutionResult.plannedInserts, 0);
    assert.equal(result.reexecutionResult.isDuplicatePrevented, true);
    assert.equal(result.reexecutionResult.totalDbRowsAfterRerun, 1404);

    // 4. 고유 인덱스 및 자연키 무결성 (중복 0건)
    assert.equal(result.uniqueIndexIntegrity.duplicateKeyCount, 0);
    assert.equal(result.uniqueIndexIntegrity.siblingTradeCount, 42);
    assert.equal(result.uniqueIndexIntegrity.maxOccurrenceIndex, 1);

    // 5. Checkpoint APPLIED 처리 및 후속 스킵
    assert.equal(result.checkpointAppliedResult.recordedMode, 'APPLIED');
    assert.equal(result.checkpointAppliedResult.recordedStatus, 'COMPLETE');
    assert.equal(result.checkpointAppliedResult.persistedCount, 1404);
    assert.equal(result.checkpointAppliedResult.skippedOnSubsequentRun, true);

    // 6. 중간 실패 셀 복구
    assert.equal(result.interruptionRecoveryResult.partialCellPersisted, true);
    assert.equal(result.interruptionRecoveryResult.recoveredToAppliedOnRetry, true);

    // 7. 실측 용량 지표 검증 (PostgreSQL relation size 및 bytesPerRow 산출 확인)
    assert.ok(result.capacityMetrics.totalBytes > 0);
    assert.ok(result.capacityMetrics.bytesPerRow > 0);
  });
});
