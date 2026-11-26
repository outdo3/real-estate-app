import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  CHECKPOINT_FILE,
  CACHE_DIR,
  HARD_CAP_API_CALLS,
} from './seoul-rent-a-dryrun-runner';
import { SEOUL_RENT_SYNC_LAWDCDS_A } from '../../src/lib/sync/rent-sync-scope';

describe('Seoul-A 8 Districts 12-Month Dry-Run Verification Tests (V3.7-A)', () => {
  it('1. verifies that the checkpoint file exists and all 96 cells are COMPLETE in DRY_RUN mode', () => {
    assert.equal(fs.existsSync(CHECKPOINT_FILE), true, 'Checkpoint file must exist');

    const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    assert.equal(checkpoint.shard, 'seoul-a');
    assert.equal(checkpoint.executionMode, 'DRY_RUN');
    assert.equal(checkpoint.totalPlannedCells, 96);
    assert.equal(checkpoint.executedCells, 96);
    assert.ok(checkpoint.totalApiCalls <= HARD_CAP_API_CALLS, `API calls (${checkpoint.totalApiCalls}) must be <= ${HARD_CAP_API_CALLS}`);

    const cellKeys = Object.keys(checkpoint.cells);
    assert.equal(cellKeys.length, 96, 'Exactly 96 cells must be in checkpoint');

    let completeCount = 0;
    let totalCollected = 0;
    for (const record of Object.values<any>(checkpoint.cells)) {
      assert.equal(record.executionMode, 'DRY_RUN');
      assert.equal(record.status, 'COMPLETE');
      assert.equal(record.dbWritesAttempted, 0);
      assert.equal(record.aptSeqMissingCount, 0);
      assert.equal(record.normalizationInvalidCount, 0);
      completeCount++;
      totalCollected += record.collectedCount;
    }

    assert.equal(completeCount, 96, 'All 96 cells must have status COMPLETE');
    assert.equal(totalCollected, 47817, 'Total collected rows must match exactly 47,817');
  });

  it('2. verifies that all 96 cache files exist in seoul-a-cache for 0-call Apply phase reuse', () => {
    assert.equal(fs.existsSync(CACHE_DIR), true, 'Cache dir must exist');

    const months = [
      '202511', '202512', '202601', '202602', '202603', '202604',
      '202605', '202606', '202607', '202608', '202609', '202610',
    ];

    let cachedFilesCount = 0;
    let totalCachedRows = 0;

    for (const lawdCd of SEOUL_RENT_SYNC_LAWDCDS_A) {
      for (const ymd of months) {
        const cacheFile = path.join(CACHE_DIR, `${lawdCd}-${ymd}.json`);
        assert.equal(fs.existsSync(cacheFile), true, `Cache file must exist for ${lawdCd}-${ymd}`);

        const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        assert.equal(cacheData.lawdCd, lawdCd);
        assert.equal(cacheData.dealYmd, ymd);
        assert.ok(Array.isArray(cacheData.items));
        assert.ok(Array.isArray(cacheData.normalizedRows));
        assert.equal(cacheData.items.length, cacheData.normalizedRows.length);

        cachedFilesCount++;
        totalCachedRows += cacheData.items.length;
      }
    }

    assert.equal(cachedFilesCount, 96);
    assert.equal(totalCachedRows, 47817);
  });
});
