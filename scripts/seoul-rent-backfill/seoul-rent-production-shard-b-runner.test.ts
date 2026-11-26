import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import {
  evaluateShardBWriteGuards,
  loadShardBCheckpoint,
  runSeoulBShardProductionApply,
  EXPECTED_OPERATIONAL_PROJECT_ID,
  MAX_AUTHORIZED_NEW_INSERTS,
  DEFAULT_CACHE_DIR,
} from './seoul-rent-production-shard-b-runner';
import { runShardBPostVerification } from './seoul-rent-production-shard-b-post-verification';

describe('Seoul Rent Production Shard-B Runner Safety & Verification Tests', () => {
  it('should block live execution when guard flags are missing', () => {
    const guards = evaluateShardBWriteGuards();
    expect(guards.allGuardsPassed).toBe(false);
    expect(guards.scopeLockedToShardB).toBe(true);
    expect(guards.projectIdMatched).toBe(true);
    expect(guards.detectedProjectId).toBe(EXPECTED_OPERATIONAL_PROJECT_ID);
  });

  it('should reject lawdCd outside seoul-b scope', () => {
    // 11110 is Jongno (seoul-a), 11680 is Gangnam (seoul-c)
    const guardsA = evaluateShardBWriteGuards(['11200', '11110']);
    expect(guardsA.scopeLockedToShardB).toBe(false);
    expect(guardsA.allGuardsPassed).toBe(false);

    const guardsC = evaluateShardBWriteGuards(['11200', '11680']);
    expect(guardsC.scopeLockedToShardB).toBe(false);
    expect(guardsC.allGuardsPassed).toBe(false);
  });

  it('should verify seoul-b cache folder has exactly 108 files', () => {
    expect(fs.existsSync(DEFAULT_CACHE_DIR)).toBe(true);
    const files = fs.readdirSync(DEFAULT_CACHE_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(108);
  });

  it('should load checkpoint and verify all 108 cells are COMPLETE', () => {
    const cp = loadShardBCheckpoint();
    expect(cp.scope).toBe('seoul-b-9-districts');
    expect(cp.totalCellCount).toBe(108);
    expect(cp.environment).toBe('OPERATIONAL_SUPABASE');
    expect(cp.completedCellCount).toBe(108);
    const completeCount = Object.values(cp.cells).filter((c: any) => c.status === 'COMPLETE').length;
    expect(completeCount).toBe(108);
  });

  it('should verify full operational post-verification PASS', async () => {
    const report = await runShardBPostVerification();
    expect(report.overallVerdict).toBe('PASS');
    expect(report.seoulBTotals.totalRows).toBe(85612);
    expect(report.seoulBTotals.jeonseRows).toBe(44801);
    expect(report.seoulBTotals.wolseRows).toBe(40811);
    expect(report.seoulBTotals.duplicateNaturalKeys).toBe(0);
    expect(report.seoulAProtection.preserved).toBe(true);
    expect(report.seoulAProtection.currentRows).toBe(47817);
    expect(report.busanProtection.preserved).toBe(true);
    expect(report.busanProtection.currentRows).toBe(134475);
    expect(report.unauthorizedScopeProtection.isZero).toBe(true);
    expect(report.checkpointAudit.completedCells).toBe(108);
    expect(report.sampleFieldParity.mismatches).toBe(0);
  });

  it('should demonstrate idempotency: all 108 cells skipped on re-run with 0 new inserts', async () => {
    const res = await runSeoulBShardProductionApply({
      dryRunOnly: false,
    });

    expect(res.totalPlannedCells).toBe(108);
    expect(res.skippedCellsCount).toBe(108);
    expect(res.executedCellsCount).toBe(0);
    expect(res.totalActualInserted).toBe(0);
    expect(res.busanPreserved).toBe(true);
    expect(res.seoulAPreserved).toBe(true);
    expect(res.seoulCPreserved).toBe(true);
  });
});
