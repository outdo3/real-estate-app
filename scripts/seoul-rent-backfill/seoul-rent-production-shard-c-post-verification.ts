/**
 * E-JIP 서울 V3.9-F — seoul-c 운영 적재 사후 전수 정합성 및 서울 25개 구 최종 집계 검증기 (Post-Verification)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  SEOUL_RENT_SYNC_LAWDCDS_C,
  SEOUL_RENT_SYNC_LAWDCDS_A,
  SEOUL_RENT_SYNC_LAWDCDS_B,
} from '../../src/lib/sync/rent-sync-scope';
import { SEOUL_DISTRICT_NAMES } from './seoul-rent-backfill-engine';
import { SHARD_C_CHECKPOINT_PATH, loadShardCCheckpoint } from './seoul-rent-production-shard-c-runner';

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

export interface ShardCPostVerificationReport {
  overallVerdict: 'PASS' | 'FAIL';
  executionTimestamp: string;
  seoulCTotals: {
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
  seoulBProtection: {
    expectedRows: number;
    currentRows: number;
    preserved: boolean;
  };
  busanProtection: {
    expectedRows: number;
    currentRows: number;
    preserved: boolean;
  };
  seoulAllTotals: {
    totalDistricts: number;
    totalCells: number;
    totalRows: number;
    jeonseRows: number;
    wolseRows: number;
    expectedTotal: number;
    expectedJeonse: number;
    expectedWolse: number;
    match: boolean;
  };
  grandTotalDb: {
    currentTotalRows: number;
    expectedTotalRows: number;
    match: boolean;
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

export async function runShardCPostVerification(): Promise<ShardCPostVerificationReport> {
  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) throw new Error('DATABASE_URL is not set.');

  const prisma = new PrismaClient({
    datasources: { db: { url: rawDbUrl } },
  });

  try {
    console.log('\n=== [사후 검증 1] seoul-c 8개 구 운영 DB 실측 집계 ===');
    const districtBreakdown: ShardCPostVerificationReport['districtBreakdown'] = [];

    // Expected numbers from cache analysis
    const expectedPerDistrict: Record<string, { total: number; jeonse: number; wolse: number }> = {
      '11530': { total: 10886, jeonse: 4206, wolse: 6680 },
      '11560': { total: 11187, jeonse: 5695, wolse: 5492 },
      '11590': { total: 8759, jeonse: 4791, wolse: 3968 },
      '11620': { total: 5858, jeonse: 2627, wolse: 3231 },
      '11650': { total: 14079, jeonse: 7383, wolse: 6696 },
      '11680': { total: 22695, jeonse: 10642, wolse: 12053 },
      '11710': { total: 19952, jeonse: 10258, wolse: 9694 },
      '11740': { total: 14011, jeonse: 7189, wolse: 6822 },
    };

    let grandTotalC = 0;
    let grandJeonseC = 0;
    let grandWolseC = 0;

    for (const lawdCd of SEOUL_RENT_SYNC_LAWDCDS_C) {
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

      grandTotalC += total;
      grandJeonseC += jeonse;
      grandWolseC += wolse;

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

    // Check duplicate natural keys in seoul-c
    console.log('\n=== [사후 검증 2] seoul-c 자연키 중복 검증 ===');
    const dupRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT group_key, deposit, monthly_rent, deal_date, floor, occurrence_index, COUNT(*) AS cnt
      FROM apartment_rent_histories
      WHERE lawd_cd IN (${SEOUL_RENT_SYNC_LAWDCDS_C.map(c => `'${c}'`).join(',')})
      GROUP BY group_key, deposit, monthly_rent, deal_date, floor, occurrence_index
      HAVING COUNT(*) > 1;
    `);
    const duplicateNaturalKeys = dupRes.length;
    console.log(`seoul-c 자연키 중복 건수: ${duplicateNaturalKeys}건 (목표: 0건)`);

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

    // Seoul-B Protection check
    console.log('\n=== [사후 검증 4] seoul-b 9개 구 보존 검증 ===');
    const seoulBRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*)::bigint AS cnt
      FROM apartment_rent_histories
      WHERE lawd_cd IN (${SEOUL_RENT_SYNC_LAWDCDS_B.map(c => `'${c}'`).join(',')});
    `);
    const currentSeoulBRows = Number(seoulBRes[0].cnt);
    const seoulBPreserved = currentSeoulBRows === 85612;
    console.log(`seoul-b 현재 행수: ${currentSeoulBRows.toLocaleString()}건 (기준: 85,612건, ${seoulBPreserved ? '✅ 온전 보존' : '❌ 변동 감지'})`);

    // Busan Protection check
    console.log('\n=== [사후 검증 5] 부산 데이터 134,475건 보존 검증 ===');
    const busanRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*)::bigint AS cnt
      FROM apartment_rent_histories
      WHERE lawd_cd LIKE '26%';
    `);
    const currentBusanRows = Number(busanRes[0].cnt);
    const busanPreserved = currentBusanRows === 134475;
    console.log(`부산 현재 행수: ${currentBusanRows.toLocaleString()}건 (기준: 134,475건, ${busanPreserved ? '✅ 온전 보존' : '❌ 변동 감지'})`);

    // Seoul All 25 Districts Total Check
    console.log('\n=== [사후 검증 6] 서울 전체 25개 구 300셀 최종 집계 검증 ===');
    const allSeoulLawdCds = [
      ...SEOUL_RENT_SYNC_LAWDCDS_A,
      ...SEOUL_RENT_SYNC_LAWDCDS_B,
      ...SEOUL_RENT_SYNC_LAWDCDS_C,
    ];
    const seoulAllRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT 
        COUNT(*)::bigint AS total_cnt,
        COUNT(*) FILTER (WHERE deal_type = 'jeonse')::bigint AS jeonse_cnt,
        COUNT(*) FILTER (WHERE deal_type = 'wolse')::bigint AS wolse_cnt
      FROM apartment_rent_histories
      WHERE lawd_cd IN (${allSeoulLawdCds.map(c => `'${c}'`).join(',')});
    `);
    const totalSeoulRows = Number(seoulAllRes[0].total_cnt);
    const totalSeoulJeonse = Number(seoulAllRes[0].jeonse_cnt);
    const totalSeoulWolse = Number(seoulAllRes[0].wolse_cnt);

    const seoulAllMatch =
      totalSeoulRows === 240856 &&
      totalSeoulJeonse === 119510 &&
      totalSeoulWolse === 121346;

    console.log(`서울 25개 구 총 거래: ${totalSeoulRows.toLocaleString()}건 (목표: 240,856건, ${totalSeoulRows === 240856 ? '✅ 일치' : '❌ 불일치'})`);
    console.log(`서울 25개 구 전세: ${totalSeoulJeonse.toLocaleString()}건 (목표: 119,510건, ${totalSeoulJeonse === 119510 ? '✅ 일치' : '❌ 불일치'})`);
    console.log(`서울 25개 구 월세: ${totalSeoulWolse.toLocaleString()}건 (목표: 121,346건, ${totalSeoulWolse === 121346 ? '✅ 일치' : '❌ 불일치'})`);

    // Grand Total DB check
    const grandDbRes = await prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*)::bigint AS cnt FROM apartment_rent_histories;
    `);
    const currentTotalDb = Number(grandDbRes[0].cnt);
    const grandDbMatch = currentTotalDb === 375331;
    console.log(`운영 DB 전체 행수: ${currentTotalDb.toLocaleString()}건 (목표: 375,331건, ${grandDbMatch ? '✅ 100% 일치' : '❌ 불일치'})`);

    // Checkpoint Audit
    console.log('\n=== [사후 검증 7] 운영 Checkpoint 감사 ===');
    const cp = loadShardCCheckpoint(SHARD_C_CHECKPOINT_PATH);
    const completedCells = Object.values(cp.cells).filter((c: any) => c.status === 'COMPLETE').length;
    console.log(`Checkpoint 완료 셀: ${completedCells} / ${cp.totalCellCount} (${completedCells === 96 ? '✅ 100% COMPLETE' : '⚠️ INCOMPLETE'})`);

    // Manifest Audit
    console.log('\n=== [사후 검증 8] 롤백 매니페스트 감사 ===');
    const manifestDir = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/rollback-manifests');
    let totalManifests = 0;
    let successfulManifests = 0;
    let trackedInsertedKeys = 0;

    if (fs.existsSync(manifestDir)) {
      const files = fs.readdirSync(manifestDir).filter(f => f.startsWith('operational-shard-c-') && f.endsWith('.json'));
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
    console.log(`seoul-c 롤백 매니페스트: 총 ${totalManifests}개 (성공: ${successfulManifests}개, 추적 키: ${trackedInsertedKeys.toLocaleString()}개)`);

    // Sample Field Parity Check
    console.log('\n=== [사후 검증 9] 원천 캐시 vs 운영 DB 8개 필드 무작위 대조 ===');
    const cacheDir = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/seoul-c-cache');
    let sampledCount = 0;
    let mismatchCount = 0;

    // Sample from 3 districts across 3 different months
    const sampleCells = [
      { lawdCd: '11530', dealYmd: '202511' }, // 구로구
      { lawdCd: '11680', dealYmd: '202605' }, // 강남구
      { lawdCd: '11710', dealYmd: '202610' }, // 송파구
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
      grandTotalC === 107427 &&
      grandJeonseC === 52791 &&
      grandWolseC === 54636 &&
      duplicateNaturalKeys === 0 &&
      seoulAPreserved &&
      seoulBPreserved &&
      busanPreserved &&
      seoulAllMatch &&
      grandDbMatch &&
      completedCells === 96 &&
      mismatchCount === 0
        ? 'PASS'
        : 'FAIL';

    console.log(`\n======================================================`);
    console.log(`최종 정합성 판정: ${overallVerdict === 'PASS' ? '🎉 PASS (ALL CHECKS PERFECT)' : '❌ FAIL'}`);
    console.log(`======================================================\n`);

    return {
      overallVerdict,
      executionTimestamp: new Date().toISOString(),
      seoulCTotals: {
        totalRows: grandTotalC,
        jeonseRows: grandJeonseC,
        wolseRows: grandWolseC,
        expectedTotal: 107427,
        expectedJeonse: 52791,
        expectedWolse: 54636,
        duplicateNaturalKeys,
      },
      districtBreakdown,
      seoulAProtection: {
        expectedRows: 47817,
        currentRows: currentSeoulARows,
        preserved: seoulAPreserved,
      },
      seoulBProtection: {
        expectedRows: 85612,
        currentRows: currentSeoulBRows,
        preserved: seoulBPreserved,
      },
      busanProtection: {
        expectedRows: 134475,
        currentRows: currentBusanRows,
        preserved: busanPreserved,
      },
      seoulAllTotals: {
        totalDistricts: 25,
        totalCells: 300,
        totalRows: totalSeoulRows,
        jeonseRows: totalSeoulJeonse,
        wolseRows: totalSeoulWolse,
        expectedTotal: 240856,
        expectedJeonse: 119510,
        expectedWolse: 121346,
        match: seoulAllMatch,
      },
      grandTotalDb: {
        currentTotalRows: currentTotalDb,
        expectedTotalRows: 375331,
        match: grandDbMatch,
      },
      checkpointAudit: {
        totalCells: 96,
        completedCells,
        status: completedCells === 96 ? 'COMPLETE' : 'INCOMPLETE',
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
  runShardCPostVerification()
    .then((report) => {
      process.exit(report.overallVerdict === 'PASS' ? 0 : 1);
    })
    .catch((err) => {
      console.error('Post-Verification failed:', err);
      process.exit(1);
    });
}
