import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import {
  evaluateShardCWriteGuards,
  loadShardCCheckpoint,
  runSeoulCShardProductionApply,
  EXPECTED_OPERATIONAL_PROJECT_ID,
  MAX_AUTHORIZED_NEW_INSERTS,
  DEFAULT_CACHE_DIR,
} from './seoul-rent-production-shard-c-runner';
import { runShardCPostVerification } from './seoul-rent-production-shard-c-post-verification';

describe('Seoul Rent Production Shard-C Runner Safety & Verification Tests', () => {
  it('should block live execution when guard flags are missing', () => {
    const guards = evaluateShardCWriteGuards();
    expect(guards.allGuardsPassed).toBe(false);
    expect(guards.scopeLockedToShardC).toBe(true);
    expect(guards.projectIdMatched).toBe(true);
    expect(guards.detectedProjectId).toBe(EXPECTED_OPERATIONAL_PROJECT_ID);
  });

  it('should reject lawdCd outside seoul-c scope', () => {
    // 11110 is Jongno (seoul-a), 11200 is Seongdong (seoul-b)
    const guardsA = evaluateShardCWriteGuards(['11530', '11110']);
    expect(guardsA.scopeLockedToShardC).toBe(false);
    expect(guardsA.allGuardsPassed).toBe(false);

    const guardsB = evaluateShardCWriteGuards(['11530', '11200']);
    expect(guardsB.scopeLockedToShardC).toBe(false);
    expect(guardsB.allGuardsPassed).toBe(false);
  });

  it('should verify seoul-c cache folder has exactly 96 files', () => {
    expect(fs.existsSync(DEFAULT_CACHE_DIR)).toBe(true);
    const files = fs.readdirSync(DEFAULT_CACHE_DIR).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(96);
  });

  it('should load checkpoint and verify all 96 cells are COMPLETE', () => {
    const cp = loadShardCCheckpoint();
    expect(cp.scope).toBe('seoul-c-8-districts');
    expect(cp.totalCellCount).toBe(96);
    expect(cp.environment).toBe('OPERATIONAL_SUPABASE');
    expect(cp.completedCellCount).toBe(96);
    const completeCount = Object.values(cp.cells).filter((c: any) => c.status === 'COMPLETE').length;
    expect(completeCount).toBe(96);
  });

  it('should verify full operational post-verification PASS for seoul-c and all 25 districts', async () => {
    const report = await runShardCPostVerification();
    expect(report.overallVerdict).toBe('PASS');
    expect(report.seoulCTotals.totalRows).toBe(107427);
    expect(report.seoulCTotals.jeonseRows).toBe(52791);
    expect(report.seoulCTotals.wolseRows).toBe(54636);
    expect(report.seoulCTotals.duplicateNaturalKeys).toBe(0);
    expect(report.seoulAProtection.preserved).toBe(true);
    expect(report.seoulAProtection.currentRows).toBe(47817);
    expect(report.seoulBProtection.preserved).toBe(true);
    expect(report.seoulBProtection.currentRows).toBe(85612);
    expect(report.busanProtection.preserved).toBe(true);
    expect(report.busanProtection.currentRows).toBe(134475);
    expect(report.seoulAllTotals.totalRows).toBe(240856);
    expect(report.seoulAllTotals.jeonseRows).toBe(119510);
    expect(report.seoulAllTotals.wolseRows).toBe(121346);
    expect(report.grandTotalDb.currentTotalRows).toBe(375331);
    expect(report.checkpointAudit.completedCells).toBe(96);
    expect(report.sampleFieldParity.mismatches).toBe(0);
  });

  it('should demonstrate idempotency: all 96 cells skipped on re-run with 0 new inserts', async () => {
    const res = await runSeoulCShardProductionApply({
      dryRunOnly: false,
    });

    expect(res.totalPlannedCells).toBe(96);
    expect(res.skippedCellsCount).toBe(96);
    expect(res.executedCellsCount).toBe(0);
    expect(res.totalActualInserted).toBe(0);
    expect(res.busanPreserved).toBe(true);
    expect(res.seoulAPreserved).toBe(true);
    expect(res.seoulBPreserved).toBe(true);
  });
});
