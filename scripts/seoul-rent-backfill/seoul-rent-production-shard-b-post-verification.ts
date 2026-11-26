/**
 * E-JIP 서울 V3.9-E — seoul-b 운영 적재 사후 전수 정합성 검증기 (Post-Verification)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  SEOUL_RENT_SYNC_LAWDCDS_B,
  SEOUL_RENT_SYNC_LAWDCDS_A,
  SEOUL_RENT_SYNC_LAWDCDS_C,
} from '../../src/lib/sync/rent-sync-scope';
import { SEOUL_DISTRICT_NAMES, generateMonthList } from './seoul-rent-backfill-engine';
import { SHARD_B_CHECKPOINT_PATH, loadShardBCheckpoint } from './seoul-rent-production-shard-b-runner';

// Load env
const envSearchPaths = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env.local'),
  path.resolve(process.cwd(), '../../.env'),
];

for (const p of envSearchPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: false });
  }
}

export interface ShardBPostVerificationReport {
  overallVerdict: 'PASS' | 'FAIL';
  executionTimestamp: string;
  seoulBTotals: {
    totalRows: number;
    jeonseRows: number;
    wolseRows: number;
    expectedTotal: number;
    expectedJeonse: number;
    expectedWolse: number;
    duplicateNaturalKeys: number;
  };
  districtBreakdown: Array<{
    lawdCd: string;
    districtName: string;
    totalRows: number;
    jeonseRows: number;
    wolseRows: number;
    expectedRows: number;
    expectedJeonse: number;
    expectedWolse: number;
    match: boolean;
  }>;
  seoulAProtection: {
    expectedRows: number;
    currentRows: number;
    preserved: boolean;
  };
  busanProtection: {
    expectedRows: number;
    currentRows: number;
    preserved: boolean;
  };
  unauthorizedScopeProtection: {
    seoulCRows: number;
    isZero: boolean;
  };
  checkpointAudit: {
    totalCells: number;
    completedCells: number;
    status: 'COMPLETE' | 'INCOMPLETE';
  };
  manifestAudit: {
    totalManifests: number;
    successfulManifests: number;
    trackedInsertedKeys: number;
  };
  sampleFieldParity: {
    sampledRows: number;
    mismatches: number;
  };
}

export async function runShardBPostVerification(): Promise<ShardBPostVerificationReport> {
  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) throw new Error('DATABASE_URL is not set.');

  const prisma = new PrismaClient({
    datasources: { db: { url: rawDbUrl } },
  });

  try {
    console.log('\n=== [사후 검증 1] seoul-b 9개 구 운영 DB 실측 집계 ===');
    const districtBreakdown: ShardBPostVerificationReport['districtBreakdown'] = [];

    // Expected numbers from cache analysis
    const expectedPerDistrict: Record<string, { total: number; jeonse: number; wolse: number }> = {
      '11200': { total: 9650, jeonse: 5168, wolse: 4482 },
      '11260': { total: 8643, jeonse: 2884, wolse: 5759 },
      '11290': { total: 7823, jeonse: 4323, wolse: 3500 },
      '11305': { total: 2881, jeonse: 1353, wolse: 1528 },
      '11320': { total: 5209, jeonse: 2879, wolse: 2330 },
      '11350': { total: 17606, jeonse: 9604, wolse: 8002 },
      '11380': { total: 9500, jeonse: 4890, wolse: 4610 },
      '11470': { total: 10621, jeonse: 6260, wolse: 4361 },
      '11500': { total: 13679, jeonse: 7440, wolse: 6239 },
    };

    let grandTotal = 0;
    let grandJeonse = 0;
    let grandWolse = 0;

    for (const lawdCd of SEOUL_RENT_SYNC_LAWDCDS_B) {
      const districtName = SEOUL_DISTRICT_NAMES[lawdCd] || lawdCd;
      const res = await prisma.$queryRawUnsafe<any[]>(`
        SELECT 
          COUNT(*)::bigint AS total_cnt,
          COUNT(*) FILTER (WHERE deal_type = 'jeonse')::bigint AS jeonse_cnt,
          COUNT(*) FILTER (WHERE deal_type = 'wolse')::bigint AS wolse_cnt
        FROM apartment_rent_histories
        WHERE lawd_cd = $1;
      `, lawdCd);

      const total = Number(res[0].total_cnt);
      const jeonse = Number(res[0].jeonse_cnt);
      const wolse = Number(res[0].wolse_cnt);
      const exp = expectedPerDistrict[lawdCd] || { total: 0, jeonse: 0, wolse: 0 };
      const match = total === exp.total && jeonse === exp.jeonse && wolse === exp.wolse;

      grandTotal += total;
      grandJeonse += jeonse;
      grandWolse += wolse;

      districtBreakdown.push({
        lawdCd,
        districtName,
        totalRows: total,
        jeonseRows: jeonse,
        wolseRows: wolse,
        expectedRows: exp.total,
        expectedJeonse: exp.jeonse,
        expectedWolse: exp.wolse,
        match,
      });
    }

    console.table(districtBreakdown.map(d => ({
      구명: d.districtName,
      코드: d.lawdCd,
      '실측 총계': d.totalRows,
      '예상 총계': d.expectedRows,
      '실측 전세': d.jeonseRows,
      '예상 전세': d.expectedJeonse,
      '실측 월세': d.wolseRows,
      '예상 월세': d.expectedWolse,
      일치여부: d.match ? '✅ MATCH' : '❌ MISMATCH',
    })));

    // Check duplicate natural keys in seoul-b
    console.log('\n=== [사후 검증 2] seoul-b 자연키 중복 검증 ===');
    const dupRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT group_key, deposit, monthly_rent, deal_date, floor, occurrence_index, COUNT(*) AS cnt
      FROM apartment_rent_histories
      WHERE lawd_cd IN (${SEOUL_RENT_SYNC_LAWDCDS_B.map(c => `'${c}'`).join(',')})
      GROUP BY group_key, deposit, monthly_rent, deal_date, floor, occurrence_index
      HAVING COUNT(*) > 1;
    `);
    const duplicateNaturalKeys = dupRes.length;
    console.log(`자연키 중복 건수: ${duplicateNaturalKeys}건 (목표: 0건)`);

    // Seoul-A Protection check
    console.log('\n=== [사후 검증 3] seoul-a 8개 구 보존 검증 ===');
    const seoulARes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*)::bigint AS cnt
      FROM apartment_rent_histories
      WHERE lawd_cd IN (${SEOUL_RENT_SYNC_LAWDCDS_A.map(c => `'${c}'`).join(',')});
    `);
    const currentSeoulARows = Number(seoulARes[0].cnt);
    const seoulAPreserved = currentSeoulARows === 47817;
    console.log(`seoul-a 현재 행수: ${currentSeoulARows.toLocaleString()}건 (기준: 47,817건, ${seoulAPreserved ? '✅ 온전 보존' : '❌ 변동 감지'})`);

    // Busan Protection check
    console.log('\n=== [사후 검증 4] 부산 데이터 134,475건 보존 검증 ===');
    const busanRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*)::bigint AS cnt
      FROM apartment_rent_histories
      WHERE lawd_cd LIKE '26%';
    `);
    const currentBusanRows = Number(busanRes[0].cnt);
    const busanPreserved = currentBusanRows === 134475;
    console.log(`부산 현재 행수: ${currentBusanRows.toLocaleString()}건 (기준: 134,475건, ${busanPreserved ? '✅ 온전 보존' : '❌ 변동 감지'})`);

    // Seoul-C Protection check
    console.log('\n=== [사후 검증 5] seoul-c 8개 구 0건 보존 검증 ===');
    const seoulCRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*)::bigint AS cnt
      FROM apartment_rent_histories
      WHERE lawd_cd IN (${SEOUL_RENT_SYNC_LAWDCDS_C.map(c => `'${c}'`).join(',')});
    `);
    const currentSeoulCRows = Number(seoulCRes[0].cnt);
    const seoulCZero = currentSeoulCRows === 0;
    console.log(`seoul-c 현재 행수: ${currentSeoulCRows.toLocaleString()}건 (기준: 0건, ${seoulCZero ? '✅ 0건 유지' : '❌ 비승인 적재 감지'})`);

    // Checkpoint Audit
    console.log('\n=== [사후 검증 6] 운영 Checkpoint 감사 ===');
    const cp = loadShardBCheckpoint(SHARD_B_CHECKPOINT_PATH);
    const completedCells = Object.values(cp.cells).filter((c: any) => c.status === 'COMPLETE').length;
    console.log(`Checkpoint 완료 셀: ${completedCells} / ${cp.totalCellCount} (${completedCells === 108 ? '✅ 100% COMPLETE' : '⚠️ INCOMPLETE'})`);

    // Manifest Audit
    console.log('\n=== [사후 검증 7] 롤백 매니페스트 감사 ===');
    const manifestDir = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/rollback-manifests');
    let totalManifests = 0;
    let successfulManifests = 0;
    let trackedInsertedKeys = 0;

    if (fs.existsSync(manifestDir)) {
      const files = fs.readdirSync(manifestDir).filter(f => f.startsWith('operational-shard-b-') && f.endsWith('.json'));
      totalManifests = files.length;
      for (const f of files) {
        try {
          const m = JSON.parse(fs.readFileSync(path.join(manifestDir, f), 'utf-8'));
          if (m.transactionSuccess) {
            successfulManifests++;
            trackedInsertedKeys += (m.insertedKeys?.length || 0);
          }
        } catch {}
      }
    }
    console.log(`seoul-b 롤백 매니페스트: 총 ${totalManifests}개 (성공: ${successfulManifests}개, 추적 키: ${trackedInsertedKeys.toLocaleString()}개)`);

    // Sample Field Parity Check
    console.log('\n=== [사후 검증 8] 원천 캐시 vs 운영 DB 8개 필드 무작위 대조 ===');
    const cacheDir = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/seoul-b-cache');
    let sampledCount = 0;
    let mismatchCount = 0;

    // Sample from 3 districts across 3 different months
    const sampleCells = [
      { lawdCd: '11200', dealYmd: '202511' },
      { lawdCd: '11350', dealYmd: '202605' },
      { lawdCd: '11500', dealYmd: '202610' },
    ];

    for (const cell of sampleCells) {
      const cacheFile = path.join(cacheDir, `${cell.lawdCd}-${cell.dealYmd}.json`);
      if (fs.existsSync(cacheFile)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        const rows = cacheData.normalizedRows || [];

        const dbRows = await prisma.$queryRawUnsafe<any[]>(`
          SELECT 
            group_key AS "groupKeyStr",
            deposit,
            monthly_rent AS "monthlyRent",
            deal_date::text AS "dealDate",
            floor,
            occurrence_index AS "occurrenceIndex",
            deal_type AS "dealType",
            apt_seq AS "aptSeq"
          FROM apartment_rent_histories
          WHERE lawd_cd = $1 AND deal_ymd = $2;
        `, cell.lawdCd, cell.dealYmd);

        const dbMap = new Map<string, any>();
        for (const r of dbRows) {
          const k = `${r.groupKeyStr}|${r.deposit}|${r.monthlyRent}|${r.dealDate.slice(0, 10)}|${r.floor ?? 'null'}|${r.occurrenceIndex ?? 0}`;
          dbMap.set(k, r);
        }

        for (const r of rows) {
          sampledCount++;
          const k = `${r.groupKeyStr}|${r.deposit}|${r.monthlyRent}|${r.dealDate}|${r.floor ?? 'null'}|${r.occurrenceIndex ?? 0}`;
          const dbRow = dbMap.get(k);
          if (!dbRow) {
            mismatchCount++;
          } else {
            if (dbRow.dealType !== r.dealType || dbRow.aptSeq !== r.aptSeq) {
              mismatchCount++;
            }
          }
        }
      }
    }

    console.log(`샘플 검증: ${sampledCount}건 중 불일치 ${mismatchCount}건 (${mismatchCount === 0 ? '✅ 100% MATCH' : '❌ MISMATCH'})`);

    const allDistrictsMatch = districtBreakdown.every(d => d.match);
    const overallVerdict: 'PASS' | 'FAIL' =
      allDistrictsMatch &&
      grandTotal === 85612 &&
      grandJeonse === 44801 &&
      grandWolse === 40811 &&
      duplicateNaturalKeys === 0 &&
      seoulAPreserved &&
      busanPreserved &&
      seoulCZero &&
      completedCells === 108 &&
      mismatchCount === 0
        ? 'PASS'
        : 'FAIL';

    console.log(`\n======================================================`);
    console.log(`최종 정합성 판정: ${overallVerdict === 'PASS' ? '🎉 PASS (ALL CHECKS PERFECT)' : '❌ FAIL'}`);
    console.log(`======================================================\n`);

    return {
      overallVerdict,
      executionTimestamp: new Date().toISOString(),
      seoulBTotals: {
        totalRows: grandTotal,
        jeonseRows: grandJeonse,
        wolseRows: grandWolse,
        expectedTotal: 85612,
        expectedJeonse: 44801,
        expectedWolse: 40811,
        duplicateNaturalKeys,
      },
      districtBreakdown,
      seoulAProtection: {
        expectedRows: 47817,
        currentRows: currentSeoulARows,
        preserved: seoulAPreserved,
      },
      busanProtection: {
        expectedRows: 134475,
        currentRows: currentBusanRows,
        preserved: busanPreserved,
      },
      unauthorizedScopeProtection: {
        seoulCRows: currentSeoulCRows,
        isZero: seoulCZero,
      },
      checkpointAudit: {
        totalCells: 108,
        completedCells,
        status: completedCells === 108 ? 'COMPLETE' : 'INCOMPLETE',
      },
      manifestAudit: {
        totalManifests,
        successfulManifests,
        trackedInsertedKeys,
      },
      sampleFieldParity: {
        sampledRows: sampledCount,
        mismatches: mismatchCount,
      },
    };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module) {
  runShardBPostVerification()
    .then((report) => {
      process.exit(report.overallVerdict === 'PASS' ? 0 : 1);
    })
    .catch((err) => {
      console.error('Post-Verification failed:', err);
      process.exit(1);
    });
}
