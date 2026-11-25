import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import {
  evaluatePilotGuards,
  executeSeoulRentPilot,
  getPilotCachePath,
  PILOT_TARGET,
  EXPECTED_OPERATIONAL_PROJECT_ID,
} from './seoul-rent-production-pilot-runner';

describe('Seoul Rent Production Pilot Runner Safety & Verification', () => {
  it('should block live execution when guard flags are missing', () => {
    const guards = evaluatePilotGuards([]);
    expect(guards.allGuardsPassed).toBe(false);
    expect(guards.scopeLockedToPilot).toBe(true);
    expect(guards.projectIdMatched).toBe(true);
    expect(guards.detectedProjectId).toBe(EXPECTED_OPERATIONAL_PROJECT_ID);
  });

  it('should verify pilot cache file existence, exact counts and SHA-256 integrity', () => {
    const cachePath = getPilotCachePath();
    expect(fs.existsSync(cachePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    expect(content.lawdCd).toBe(PILOT_TARGET.lawdCd);
    expect(content.dealYmd).toBe(PILOT_TARGET.dealYmd);
    expect(content.normalizedRows).toHaveLength(PILOT_TARGET.expectedCount);

    let j = 0, w = 0;
    for (const r of content.normalizedRows) {
      if (r.dealType === 'jeonse') j++;
      else if (r.dealType === 'wolse') w++;
    }
    expect(j).toBe(PILOT_TARGET.expectedJeonse);
    expect(w).toBe(PILOT_TARGET.expectedWolse);
  });

  it('should run in DRY_RUN_SAFE mode against operational DB verifying idempotency without executing writes', async () => {
    const res = await executeSeoulRentPilot({ dryRunOnly: true });

    expect(res.executionMode).toBe('DRY_RUN_SAFE');
    expect(res.pilotCell.lawdCd).toBe('11110');
    expect(res.pilotCell.dealYmd).toBe('202610');
    expect(res.cacheIntegrity.totalRows).toBe(140);
    expect(res.cacheIntegrity.jeonseRows).toBe(55);
    expect(res.cacheIntegrity.wolseRows).toBe(85);
    expect(res.cacheIntegrity.duplicateNaturalKeys).toBe(0);
    expect(res.cacheIntegrity.shaMatched).toBe(true);

    // Pre-flight check on operational DB:
    // Jongno 202610 has 140 applied rows
    expect(res.preflightDbState.pilotCellExistingRows).toBe(140);
    // Total Seoul rows is 140
    expect(res.preflightDbState.totalSeoulExistingRows).toBe(140);
    // Busan data is preserved (134,475)
    expect(res.preflightDbState.busanBaselineRows).toBe(134475);

    // Idempotency: All 140 rows identified as unchanged, 0 planned inserts
    expect(res.planSummary.plannedInserts).toBe(0);
    expect(res.planSummary.unchangedRows).toBe(140);
    expect(res.planSummary.guardedSkipped).toBe(0);

    // Zero live execution outcome in dry run
    expect(res.executionOutcome).toBeUndefined();
    expect(res.postVerification).toBeUndefined();
  });
});
