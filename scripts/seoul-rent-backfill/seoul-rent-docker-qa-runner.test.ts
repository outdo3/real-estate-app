import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { runDockerQaVerification, FullQaVerificationResult } from './seoul-rent-docker-qa-runner';

describe('Seoul Rent Docker PostgreSQL Isolated Live Ingestion Tests (V3.4-R)', () => {
  it('executes full live PostgreSQL ingestion and validates parity, duplicates, guards, and capacity', async () => {
    const result: FullQaVerificationResult = await runDockerQaVerification();

    // 1. 격리 DB 확인
    assert.equal(result.dbEnvironmentCheck.host, '127.0.0.1');
    assert.equal(result.dbEnvironmentCheck.isIsolated, true);
    assert.equal(result.dbEnvironmentCheck.status, 'READY');

    // 2. MOLIT 데이터 확보 (캐시 재사용, 추가 API 호출 0회)
    assert.equal(result.molitFetchResult.fromCache, true);
    assert.equal(result.molitFetchResult.totalCount, 140);
    assert.equal(result.molitFetchResult.returnedCount, 140);
    assert.equal(result.molitFetchResult.jeonseCount, 55);
    assert.equal(result.molitFetchResult.wolseCount, 85);
    assert.equal(result.molitFetchResult.aptSeqMissingCount, 0);

    // 3. 1차 최초 INSERT
    assert.equal(result.firstInsertResult.insertedCount, 140);
    assert.equal(result.firstInsertResult.totalRowsInDb, 140);

    // 4. 동일 데이터 재실행 시 중복 0건 증가 검증
    assert.equal(result.reexecutionResult.plannedInserts, 0);
    assert.equal(result.reexecutionResult.unchangedCount, 140);
    assert.equal(result.reexecutionResult.totalRowsInDbAfterRerun, 140);
    assert.equal(result.reexecutionResult.isDuplicatePrevented, true);

    // 5. 자연키 충돌 없음 및 occurrenceIndex 정합성
    assert.equal(result.naturalKeyIntegrityResult.hasDuplicateKey, false);
    assert.equal(result.naturalKeyIntegrityResult.occurrenceMaxIndex, 2);
    assert.equal(result.naturalKeyIntegrityResult.siblingTradeCount, 6);

    // 6. Option E 그룹 가드
    assert.equal(result.optionEGuardResult.detectedDiffCount, 1);
    assert.equal(result.optionEGuardResult.guardedGroupsCount, 1);
    assert.equal(result.optionEGuardResult.isGuardTriggeredSafely, true);

    // 7. 조회 경로 정합성
    assert.equal(result.queryVerification.jeonseDbCount, 55);
    assert.equal(result.queryVerification.wolseDbCount, 85);
    assert.equal(result.queryVerification.sampleApartmentsCount, 50);
  });
});
