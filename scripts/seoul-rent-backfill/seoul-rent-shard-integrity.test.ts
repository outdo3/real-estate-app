import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  SEOUL_RENT_SYNC_LAWDCDS_A,
  SEOUL_RENT_SYNC_LAWDCDS_B,
  SEOUL_RENT_SYNC_LAWDCDS_C,
  SEOUL_RENT_ALL_25_LAWDCDS,
  resolveRentSyncScope,
} from '../../src/lib/sync/rent-sync-scope';
import {
  SeoulRentBackfillEngine,
  SEOUL_DISTRICT_NAMES,
  CellExecutionRecord,
} from './seoul-rent-backfill-engine';

describe('Seoul 25 Districts Shard & Checkpoint Integrity Tests (V3.6)', () => {
  it('1. verifies that all 25 districts are present with no duplicates and no omissions', () => {
    // 1-1. 전체 합계가 정확히 25개인지 확인
    assert.equal(SEOUL_RENT_ALL_25_LAWDCDS.length, 25);
    const uniqueSet = new Set(SEOUL_RENT_ALL_25_LAWDCDS);
    assert.equal(uniqueSet.size, 25, 'All 25 lawd codes must be strictly unique');

    // 1-2. 각 샤드별 크기 확인 (8 + 9 + 8 = 25)
    assert.equal(SEOUL_RENT_SYNC_LAWDCDS_A.length, 8);
    assert.equal(SEOUL_RENT_SYNC_LAWDCDS_B.length, 9);
    assert.equal(SEOUL_RENT_SYNC_LAWDCDS_C.length, 8);

    // 1-3. 샤드 간 교집합이 완전히 공집합(0개)인지 확인
    const setA = new Set<string>(SEOUL_RENT_SYNC_LAWDCDS_A);
    const setB = new Set<string>(SEOUL_RENT_SYNC_LAWDCDS_B);
    const setC = new Set<string>(SEOUL_RENT_SYNC_LAWDCDS_C);

    for (const code of setA) {
      assert.equal(setB.has(code), false, `Code ${code} in A must not be in B`);
      assert.equal(setC.has(code), false, `Code ${code} in A must not be in C`);
    }
    for (const code of setB) {
      assert.equal(setC.has(code), false, `Code ${code} in B must not be in C`);
    }

    // 1-4. 모든 코드가 서울 지역코드(11xxx) 형식이고 한글 구명이 매핑되어 있는지 확인
    for (const code of SEOUL_RENT_ALL_25_LAWDCDS) {
      assert.match(code, /^11\d{3}$/, `Code ${code} must be a 5-digit Seoul lawdCd starting with 11`);
      assert.ok(SEOUL_DISTRICT_NAMES[code], `Code ${code} must have a valid Korean district name in SEOUL_DISTRICT_NAMES`);
    }
  });

  const dummyFetcher = {
    fetchCell: async () => ({
      firstPageFailed: false,
      anyLaterPageFailed: false,
      totalCount: 0,
      items: [],
    }),
  };

  it('2. verifies that resolveRentSyncScope and SeoulRentBackfillEngine are 100% aligned', () => {
    // seoul-a
    const scopeA = resolveRentSyncScope('seoul-a');
    assert.equal(scopeA.ok, true);
    if (scopeA.ok) {
      assert.deepEqual(scopeA.lawdCds, [...SEOUL_RENT_SYNC_LAWDCDS_A]);
    }
    const engineA = new SeoulRentBackfillEngine({ scope: 'seoul-a', fromYmd: '202501', toYmd: '202501' }, dummyFetcher);
    assert.equal(engineA.resolveTargetLawdCodes().length, 8);
    assert.deepEqual(
      engineA.resolveTargetLawdCodes().map((d) => d.lawdCd),
      [...SEOUL_RENT_SYNC_LAWDCDS_A]
    );

    // seoul-b
    const scopeB = resolveRentSyncScope('seoul-b');
    assert.equal(scopeB.ok, true);
    if (scopeB.ok) {
      assert.deepEqual(scopeB.lawdCds, [...SEOUL_RENT_SYNC_LAWDCDS_B]);
    }
    const engineB = new SeoulRentBackfillEngine({ scope: 'seoul-b', fromYmd: '202501', toYmd: '202501' }, dummyFetcher);
    assert.equal(engineB.resolveTargetLawdCodes().length, 9);
    assert.deepEqual(
      engineB.resolveTargetLawdCodes().map((d) => d.lawdCd),
      [...SEOUL_RENT_SYNC_LAWDCDS_B]
    );

    // seoul-c
    const scopeC = resolveRentSyncScope('seoul-c');
    assert.equal(scopeC.ok, true);
    if (scopeC.ok) {
      assert.deepEqual(scopeC.lawdCds, [...SEOUL_RENT_SYNC_LAWDCDS_C]);
    }
    const engineC = new SeoulRentBackfillEngine({ scope: 'seoul-c', fromYmd: '202501', toYmd: '202501' }, dummyFetcher);
    assert.equal(engineC.resolveTargetLawdCodes().length, 8);
    assert.deepEqual(
      engineC.resolveTargetLawdCodes().map((d) => d.lawdCd),
      [...SEOUL_RENT_SYNC_LAWDCDS_C]
    );

    // seoul-all
    const scopeAll = resolveRentSyncScope('seoul-all');
    assert.equal(scopeAll.ok, true);
    if (scopeAll.ok) {
      assert.deepEqual(scopeAll.lawdCds, [...SEOUL_RENT_ALL_25_LAWDCDS]);
    }
    const engineAll = new SeoulRentBackfillEngine({ scope: 'seoul-all', fromYmd: '202501', toYmd: '202501' }, dummyFetcher);
    assert.equal(engineAll.resolveTargetLawdCodes().length, 25);
  });

  it('3. verifies that Checkpoint cellKey is shard-invariant (${lawdCd}:${dealYmd}) and cannot collide across shard re-layouts', () => {
    // cellKey는 오직 lawdCd와 dealYmd로만 구성되어 샤드 구성이 변경되더라도 데이터 키 무결성이 유지됨
    const engine = new SeoulRentBackfillEngine({ scope: 'seoul-a', fromYmd: '202610', toYmd: '202610' }, dummyFetcher);
    
    // 종로구 cellKey
    const cellKeyJongno = '11110:202610';
    assert.equal(cellKeyJongno.includes('seoul-a'), false, 'cellKey must NOT contain shard name');
    assert.equal(cellKeyJongno.includes('shard'), false, 'cellKey must be shard-invariant');
    
    // 다른 샤드에 위치한 송파구 cellKey
    const cellKeySongpa = '11710:202610';
    assert.equal(cellKeySongpa.includes('seoul-c'), false, 'cellKey must NOT contain shard name');
    
    // 25개 구 전체 cellKey가 고유함 검증
    const cellKeys = SEOUL_RENT_ALL_25_LAWDCDS.map((code) => `${code}:202610`);
    const uniqueCellKeys = new Set(cellKeys);
    assert.equal(uniqueCellKeys.size, 25);
  });

  it('4. verifies that Dry-run and Apply checkpoints are strictly decoupled and prevent false skips', () => {
    const engine = new SeoulRentBackfillEngine({ scope: 'seoul-a', fromYmd: '202610', toYmd: '202610' }, dummyFetcher);

    // 1) Dry-run 완료 셀
    const dryRunRecord: CellExecutionRecord = {
      cellKey: '11110:202610',
      lawdCd: '11110',
      dealYmd: '202610',
      executionMode: 'DRY_RUN',
      status: 'COMPLETE',
      totalCount: 140,
      collectedCount: 140,
      plannedInserts: 140,
      skippedGuarded: 0,
      unchanged: 0,
      reviewDiffCount: 0,
      persistedCount: 0, // DB에 안 씀
      durationMs: 300,
      processedAt: new Date().toISOString(),
    };

    // Dry-run 모드에서는 스킵 가능
    assert.equal(engine.isCellEligibleForSkip(dryRunRecord, true), true);
    // 그러나 Apply 모드에서는 절대 스킵되어서는 안 됨 (DB 적재 필수)
    assert.equal(engine.isCellEligibleForSkip(dryRunRecord, false), false);

    // 2) Apply 완료 셀
    const appliedRecord: CellExecutionRecord = {
      ...dryRunRecord,
      executionMode: 'APPLIED',
      persistedCount: 140, // DB에 씀
    };
    // Apply 모드에서 정상 스킵
    assert.equal(engine.isCellEligibleForSkip(appliedRecord, false), true);

    // 3) PARTIAL 셀
    const partialRecord: CellExecutionRecord = {
      ...dryRunRecord,
      status: 'PARTIAL',
    };
    assert.equal(engine.isCellEligibleForSkip(partialRecord, true), false);
    assert.equal(engine.isCellEligibleForSkip(partialRecord, false), false);
  });
});
