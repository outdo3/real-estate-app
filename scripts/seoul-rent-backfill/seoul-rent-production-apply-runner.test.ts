import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  evaluateProductionWriteGuards,
  resolveCacheFilePath,
  loadProductionCheckpoint,
  runProductionApply,
  EXPECTED_OPERATIONAL_PROJECT_ID,
  REQUIRED_CONFIRMATION_PASSPHRASE,
} from './seoul-rent-production-apply-runner';

describe('Seoul Rent Production Apply Runner Safety Guards', () => {
  it('should strictly block writes when guard flags are missing', () => {
    const guards = evaluateProductionWriteGuards([]);
    expect(guards.allGuardsPassed).toBe(false);
  });

  it('should verify correct mapping of cache file paths across shards', () => {
    const aPath = resolveCacheFilePath('11110', '202610');
    expect(aPath).toContain('seoul-a-cache');
    expect(aPath).toContain('11110-202610.json');

    const bPath = resolveCacheFilePath('11200', '202610');
    expect(bPath).toContain('seoul-b-cache');
    expect(bPath).toContain('11200-202610.json');

    const cPath = resolveCacheFilePath('11680', '202610');
    expect(cPath).toContain('seoul-c-cache');
    expect(cPath).toContain('11680-202610.json');
  });

  it('should reject QA checkpoint with SECURITY MISMATCH', () => {
    const tempQaCpPath = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/temp-test-qa-mismatch-cp.json');
    fs.writeFileSync(
      tempQaCpPath,
      JSON.stringify({
        version: 1,
        scope: 'test',
        environment: 'LOCAL_DOCKER_QA',
        cells: {},
      }),
      'utf-8'
    );

    try {
      expect(() => loadProductionCheckpoint(tempQaCpPath)).toThrow(/SECURITY MISMATCH/);
    } finally {
      if (fs.existsSync(tempQaCpPath)) {
        fs.unlinkSync(tempQaCpPath);
      }
    }
  });

  it('should run in DRY_RUN_SAFE mode for a single test cell without writing to DB', async () => {
    const summary = await runProductionApply({
      dryRunOnly: true,
      targetLawdCds: ['11110'], // Jongno
      targetMonths: ['202610'], // 1 month
    });

    expect(summary.mode).toBe('DRY_RUN_SAFE');
    expect(summary.totalPlannedCells).toBe(1);
    expect(summary.totalExecutedCells).toBe(1);
    expect(summary.totalPlannedInserts).toBe(140); // 140 transactions in Jongno 202610
    expect(summary.busanDataPreserved).toBe(true);
    expect(summary.initialBusanRows).toBe(134475); // Busan data in production intact
    expect(summary.cellRecords[0].status).toBe('DRY_RUN_PLAN');
  });
});
