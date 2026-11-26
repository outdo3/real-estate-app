import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import {
  BackfillExecutionManifest,
  saveRollbackManifest,
  loadRollbackManifest,
  generateSurgicalRollbackSql,
  executeSurgicalRollback,
  MANIFESTS_DIR,
} from './seoul-rent-surgical-rollback';

describe('Seoul Rent Surgical Precision Rollback Logic', () => {
  const dummyManifest: BackfillExecutionManifest = {
    runId: 'test-pilot-surgical-001',
    targetDbEnv: 'LOCAL_DOCKER_QA',
    lawdCd: '11110',
    dealYmd: '202610',
    districtName: '종로구',
    startedAt: new Date().toISOString(),
    transactionSuccess: true,
    totalCacheRows: 2,
    plannedInserts: 2,
    unchangedCount: 0,
    guardedSkippedCount: 0,
    actualInsertedCount: 2,
    insertedKeys: [
      {
        groupKeyStr: 'id:11110-test1::84.95::jeonse',
        deposit: 70000,
        monthlyRent: 0,
        dealDate: '2026-10-12',
        floor: 8,
        occurrenceIndex: 0,
      },
      {
        groupKeyStr: 'id:11110-test2::59.88::wolse',
        deposit: 20000,
        monthlyRent: 80,
        dealDate: '2026-10-15',
        floor: null,
        occurrenceIndex: 0,
      },
    ],
    rollbackStatus: 'NOT_TRIGGERED',
  };

  it('should save and load backfill execution manifest with exact natural keys', () => {
    const savedPath = saveRollbackManifest(dummyManifest);
    expect(fs.existsSync(savedPath)).toBe(true);

    const loaded = loadRollbackManifest(dummyManifest.runId);
    expect(loaded.runId).toBe(dummyManifest.runId);
    expect(loaded.insertedKeys).toHaveLength(2);
    expect(loaded.insertedKeys[0].groupKeyStr).toBe(dummyManifest.insertedKeys[0].groupKeyStr);
    expect(loaded.insertedKeys[1].floor).toBeNull();
  });

  it('should generate surgical rollback SQL targeting only matching natural keys', () => {
    const sql = generateSurgicalRollbackSql(dummyManifest);
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
    expect(sql).toContain('DELETE FROM apartment_rent_histories');
    expect(sql).toContain('id:11110-test1::84.95::jeonse');
    expect(sql).toContain('id:11110-test2::59.88::wolse');
    expect(sql).toContain("NULL::integer");
    expect(sql).toContain("h.lawd_cd = '11110' AND h.deal_ymd = '202610'");
  });

  it('should execute surgical rollback in Docker QA, deleting only specified keys without affecting other rows', async () => {
    const qaPrisma = new PrismaClient({
      datasources: { db: { url: 'postgresql://qa_tester:qa_test_pass_secure@127.0.0.1:54332/ejip_seoul_rent_qa?schema=public' } },
    });

    try {
      // 1. Initial count in Docker QA
      const initialCountRes = await qaPrisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::bigint AS cnt FROM apartment_rent_histories;`
      );
      const initialCount = Number(initialCountRes[0].cnt);

      // 2. Insert 2 synthetic test rows
      const testRunId = `test-run-qa-surgical-${Date.now()}`;
      const testKeys = [
        {
          groupKeyStr: `test-synthetic-key-1-${Date.now()}`,
          deposit: 99999,
          monthlyRent: 0,
          dealDate: '2026-10-01',
          floor: 5,
          occurrenceIndex: 999,
        },
        {
          groupKeyStr: `test-synthetic-key-2-${Date.now()}`,
          deposit: 88888,
          monthlyRent: 50,
          dealDate: '2026-10-02',
          floor: null,
          occurrenceIndex: 999,
        },
      ];

      for (const k of testKeys) {
        await qaPrisma.$executeRawUnsafe(
          `INSERT INTO apartment_rent_histories (
             lawd_cd, deal_ymd, apt_seq, identity_key, deal_type, group_key,
             apt_name, dong, exclusive_area, deposit, monthly_rent,
             deal_year, deal_month, deal_day, deal_date, floor, build_year,
             occurrence_index, source, source_fetched_at, created_at, updated_at
           ) VALUES (
             '11110', '202610', 'test-apt', 'test-identity', 'jeonse', $1,
             '테스트단지', '청운동', 84.5, $2, $3,
             2026, 10, 1, $4::date, $5, 2020,
             $6, 'TEST', NOW(), NOW(), NOW()
           );`,
          k.groupKeyStr,
          k.deposit,
          k.monthlyRent,
          k.dealDate,
          k.floor ?? null,
          k.occurrenceIndex
        );
      }

      // Check count increased by 2
      const postInsertCountRes = await qaPrisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::bigint AS cnt FROM apartment_rent_histories;`
      );
      expect(Number(postInsertCountRes[0].cnt)).toBe(initialCount + 2);

      // 3. Create manifest for these test keys
      const testManifest: BackfillExecutionManifest = {
        runId: testRunId,
        targetDbEnv: 'LOCAL_DOCKER_QA',
        lawdCd: '11110',
        dealYmd: '202610',
        districtName: '종로구',
        startedAt: new Date().toISOString(),
        transactionSuccess: true,
        totalCacheRows: 2,
        plannedInserts: 2,
        unchangedCount: 0,
        guardedSkippedCount: 0,
        actualInsertedCount: 2,
        insertedKeys: testKeys,
        rollbackStatus: 'NOT_TRIGGERED',
      };

      // 4. Execute surgical rollback
      const rollbackResult = await executeSurgicalRollback(testManifest, qaPrisma);
      expect(rollbackResult.deletedCount).toBe(2);

      // 5. Final count should be exactly back to initialCount
      const finalCountRes = await qaPrisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::bigint AS cnt FROM apartment_rent_histories;`
      );
      expect(Number(finalCountRes[0].cnt)).toBe(initialCount);

      // Verify manifest state updated
      const reloadedManifest = loadRollbackManifest(testRunId);
      expect(reloadedManifest.rollbackStatus).toBe('ROLLED_BACK');
      expect(reloadedManifest.rolledBackAt).toBeDefined();

      // Clean up manifest file
      const manifestPath = path.join(MANIFESTS_DIR, `${testRunId}.json`);
      if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    } finally {
      await qaPrisma.$disconnect().catch(() => {});
    }
  });
});
