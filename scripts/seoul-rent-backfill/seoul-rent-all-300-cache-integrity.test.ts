import { describe, it, expect } from 'vitest';
import { verifyAll300Caches } from './seoul-rent-all-300-cache-integrity';

describe('Seoul Rent All 300 Caches Integrity Verification', () => {
  const report = verifyAll300Caches();

  it('should verify all 300 cells exist across 25 districts', () => {
    expect(report.totalExpectedCells).toBe(300);
    expect(report.totalActualCells).toBe(300);
    expect(report.allFilesExist).toBe(true);
  });

  it('should match the exact total transaction count of 240,856', () => {
    expect(report.totalRows).toBe(240856);
    expect(report.totalRowsExpectedMatch).toBe(true);
  });

  it('should match exact jeonse (119,510) and wolse (121,346) counts', () => {
    expect(report.totalJeonse).toBe(119510);
    expect(report.totalWolse).toBe(121346);
    expect(report.totalJeonseExpectedMatch).toBe(true);
    expect(report.totalWolseExpectedMatch).toBe(true);
    expect(report.jeonsePlusWolseEqualsTotal).toBe(true);
  });

  it('should guarantee zero global natural key duplicates across all 240,856 transactions', () => {
    expect(report.globalDuplicateNaturalKeys).toBe(0);
    expect(report.duplicateKeysSample).toHaveLength(0);
  });

  it('should correctly account for each shard breakdown', () => {
    // seoul-a: 8 districts, 96 cells, 47,817 rows
    expect(report.shardSummaries['seoul-a'].actualCells).toBe(96);
    expect(report.shardSummaries['seoul-a'].totalRows).toBe(47817);
    expect(report.shardSummaries['seoul-a'].totalJeonse).toBe(21918);
    expect(report.shardSummaries['seoul-a'].totalWolse).toBe(25899);
    expect(report.shardSummaries['seoul-a'].matched).toBe(true);

    // seoul-b: 9 districts, 108 cells, 85,612 rows
    expect(report.shardSummaries['seoul-b'].actualCells).toBe(108);
    expect(report.shardSummaries['seoul-b'].totalRows).toBe(85612);
    expect(report.shardSummaries['seoul-b'].totalJeonse).toBe(44801);
    expect(report.shardSummaries['seoul-b'].totalWolse).toBe(40811);
    expect(report.shardSummaries['seoul-b'].matched).toBe(true);

    // seoul-c: 8 districts, 96 cells, 107,427 rows
    expect(report.shardSummaries['seoul-c'].actualCells).toBe(96);
    expect(report.shardSummaries['seoul-c'].totalRows).toBe(107427);
    expect(report.shardSummaries['seoul-c'].totalJeonse).toBe(52791);
    expect(report.shardSummaries['seoul-c'].totalWolse).toBe(54636);
    expect(report.shardSummaries['seoul-c'].matched).toBe(true);
  });

  it('should verify Songpa 202610 cache presence and integrity', () => {
    expect(report.songpa202610Status.existsInShardC).toBe(true);
    expect(report.songpa202610Status.rowCount).toBe(1404);
    expect(report.songpa202610Status.sha256).toBeDefined();
    expect(report.songpa202610Status.sha256.length).toBe(64);
  });

  it('should fail-fast when cache directory is missing', () => {
    expect(() => verifyAll300Caches('/non/existent/path')).toThrow(/CRITICAL: Cache directory missing/);
  });
});
