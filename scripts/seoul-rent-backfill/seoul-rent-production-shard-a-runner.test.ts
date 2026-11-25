import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  evaluateShardAWriteGuards,
  loadShardACheckpoint,
  runSeoulAShardProductionApply,
  EXPECTED_OPERATIONAL_PROJECT_ID,
  MAX_AUTHORIZED_NEW_INSERTS,
  DEFAULT_CACHE_DIR,
} from './seoul-rent-production-shard-a-runner';
import { runShardAPostVerification } from './seoul-rent-production-shard-a-post-verification';

describe('Seoul Rent Production Shard-A Runner Safety & Verification', () => {
  it('should block live execution when guard flags are missing', () => {
    const guards = evaluateShardAWriteGuards();
    expect(guards.allGuardsPassed).toBe(false);
    expect(guards.scopeLockedToShardA).toBe(true);
    expect(guards.projectIdMatched).toBe(true);
    expect(guards.detectedProjectId).toBe(EXPECTED_OPERATIONAL_PROJECT_ID);
  });

  it('should reject lawdCd outside seoul-a scope', () => {
    // 11680 is Gangnam (seoul-c)
    const guardsOutOfScope = evaluateShardAWriteGuards(['11110', '11680']);
    expect(guardsOutOfScope.scopeLockedToShardA).toBe(false);
    expect(guardsOutOfScope.allGuardsPassed).toBe(false);
  });

  it('should verify seoul-a cache folder has exactly 96 files', () => {
    expect(fs.existsSync(DEFAULT_CACHE_DIR)).toBe(true);
    const files = fs.readdirSync(DEFAULT_CACHE_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(96);
  });

  it('should load checkpoint and verify all 96 cells are COMPLETE', () => {
    const cp = loadShardACheckpoint();
    expect(cp.scope).toBe('seoul-a-8-districts');
    expect(cp.totalCellCount).toBe(96);
    expect(cp.environment).toBe('OPERATIONAL_SUPABASE');
    expect(cp.completedCellCount).toBe(96);
    const completeCount = Object.values(cp.cells).filter((c: any) => c.status === 'COMPLETE').length;
    expect(completeCount).toBe(96);
  });

  it('should verify full operational post-verification PASS', async () => {
    const report = await runShardAPostVerification();
    expect(report.overallVerdict).toBe('PASS');
    expect(report.seoulATotals.totalRows).toBe(47817);
    expect(report.seoulATotals.jeonseRows).toBe(21918);
    expect(report.seoulATotals.wolseRows).toBe(25899);
    expect(report.seoulATotals.duplicateNaturalKeys).toBe(0);
    expect(report.busanProtection.preserved).toBe(true);
    expect(report.busanProtection.currentRows).toBe(134475);
    expect(report.unauthorizedScopeProtection.isZero).toBe(true);
  });

  it('should demonstrate idempotency: all 96 cells skipped on re-run with 0 new inserts', async () => {
    const res = await runSeoulAShardProductionApply({
      dryRunOnly: false,
    });

    expect(res.totalPlannedCells).toBe(96);
    expect(res.skippedCellsCount).toBe(96);
    expect(res.executedCellsCount).toBe(0);
    expect(res.totalActualInserted).toBe(0);
    expect(res.busanPreserved).toBe(true);
  });
});
