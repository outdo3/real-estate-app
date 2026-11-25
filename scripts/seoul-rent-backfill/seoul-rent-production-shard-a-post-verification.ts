/**
 * E-JIP 서울 V3.9-D — seoul-a 8개 구 96셀 운영 Supabase 적재 사후 정합성 검증 스크립트
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import {
  SEOUL_RENT_SYNC_LAWDCDS_A,
  SEOUL_RENT_SYNC_LAWDCDS_B,
  SEOUL_RENT_SYNC_LAWDCDS_C,
} from '../../src/lib/sync/rent-sync-scope';
import { SEOUL_DISTRICT_NAMES } from './seoul-rent-backfill-engine';
import { verifySeoulACacheIntegrity } from './seoul-rent-cache-integrity';

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

export const EXPECTED_BUSAN_BASELINE = 134475;
export const EXPECTED_TOTAL_SEOUL_A = 47817;
export const EXPECTED_TOTAL_JEONSE = 21918;
export const EXPECTED_TOTAL_WOLSE = 25899;

export interface PostVerificationReport {
  timestamp: string;
  projectId: string;
  seoulATotals: {
    totalRows: number;
    expectedRows: number;
    totalMatched: boolean;
    jeonseRows: number;
    expectedJeonse: number;
    jeonseMatched: boolean;
    wolseRows: number;
    expectedWolse: number;
    wolseMatched: boolean;
    duplicateNaturalKeys: number;
    hasDuplicates: boolean;
  };
  districtBreakdown: Record<string, {
    districtName: string;
    actualTotal: number;
    expectedTotal: number;
    actualJeonse: number;
    expectedJeonse: number;
    actualWolse: number;
    expectedWolse: number;
    matched: boolean;
  }>;
  busanProtection: {
    baselineRows: number;
    currentRows: number;
    difference: number;
    preserved: boolean;
  };
  unauthorizedScopeProtection: {
    seoulBRows: number;
    seoulCRows: number;
    isZero: boolean;
  };
  checkpointValidation: {
    checkpointPath: string;
    totalCellCount: number;
    completedCellCount: number;
    allComplete: boolean;
  };
  rollbackManifestsValidation: {
    manifestsCount: number;
    totalTrackedInsertedKeys: number;
  };
  overallVerdict: 'PASS' | 'FAIL';
}

export async function runShardAPostVerification(): Promise<PostVerificationReport> {
  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) throw new Error('DATABASE_URL is not set.');

  let projectId = 'unknown';
  try {
    const u = new URL(rawDbUrl);
    if (u.username.includes('.')) {
      projectId = u.username.split('.')[1];
    } else if (u.hostname.endsWith('.supabase.co')) {
      projectId = u.hostname.replace('.supabase.co', '');
    }
  } catch {}

  const prisma = new PrismaClient({
    datasources: { db: { url: rawDbUrl } },
  });

  // Verify against the source of truth (cache report)
  const cacheReport = verifySeoulACacheIntegrity();

  try {
    // 1. Shard A 총계 및 전월세 구분
    const seoulALawdList = (SEOUL_RENT_SYNC_LAWDCDS_A as readonly string[]).map((c) => `'${c}'`).join(',');
    const seoulATotalsRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
         count(*)::bigint AS total_cnt,
         count(*) FILTER (WHERE deal_type = 'jeonse')::bigint AS jeonse_cnt,
         count(*) FILTER (WHERE deal_type = 'wolse')::bigint AS wolse_cnt
       FROM apartment_rent_histories
       WHERE lawd_cd IN (${seoulALawdList});`
    );

    const totalRows = Number(seoulATotalsRes[0].total_cnt);
    const jeonseRows = Number(seoulATotalsRes[0].jeonse_cnt);
    const wolseRows = Number(seoulATotalsRes[0].wolse_cnt);

    // 2. 자연키 중복 검증
    const dupRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*) - count(DISTINCT (group_key, deposit, monthly_rent, deal_date, floor, occurrence_index))::bigint AS dup_cnt
       FROM apartment_rent_histories
       WHERE lawd_cd IN (${seoulALawdList});`
    );
    const duplicateNaturalKeys = Number(dupRes[0].dup_cnt);

    // 3. 구별 상세 내역 실측
    const districtBreakdown: Record<string, any> = {};
    const districtRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
         lawd_cd,
         count(*)::bigint AS total_cnt,
         count(*) FILTER (WHERE deal_type = 'jeonse')::bigint AS jeonse_cnt,
         count(*) FILTER (WHERE deal_type = 'wolse')::bigint AS wolse_cnt
       FROM apartment_rent_histories
       WHERE lawd_cd IN (${seoulALawdList})
       GROUP BY lawd_cd
       ORDER BY lawd_cd;`
    );

    const districtMap = new Map<string, { total: number; jeonse: number; wolse: number }>();
    for (const r of districtRes) {
      districtMap.set(r.lawd_cd, {
        total: Number(r.total_cnt),
        jeonse: Number(r.jeonse_cnt),
        wolse: Number(r.wolse_cnt),
      });
    }

    let allDistrictsMatched = true;
    for (const lawdCd of (SEOUL_RENT_SYNC_LAWDCDS_A as readonly string[])) {
      const exp = cacheReport.districtSummary[lawdCd];
      const act = districtMap.get(lawdCd) || { total: 0, jeonse: 0, wolse: 0 };
      const matched =
        act.total === exp.rawItems &&
        act.jeonse === exp.jeonse &&
        act.wolse === exp.wolse;

      if (!matched) allDistrictsMatched = false;

      districtBreakdown[lawdCd] = {
        districtName: SEOUL_DISTRICT_NAMES[lawdCd] || lawdCd,
        actualTotal: act.total,
        expectedTotal: exp.rawItems,
        actualJeonse: act.jeonse,
        expectedJeonse: exp.jeonse,
        actualWolse: act.wolse,
        expectedWolse: exp.wolse,
        matched,
      };
    }

    // 4. 부산 데이터 보존 확인
    const busanRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd LIKE '26%';`
    );
    const busanCurrent = Number(busanRes[0].cnt);

    // 5. 미승인 샤드 (seoul-b, seoul-c) 침범 여부 확인
    const seoulBLawdList = (SEOUL_RENT_SYNC_LAWDCDS_B as readonly string[]).map((c) => `'${c}'`).join(',');
    const seoulCLawdList = (SEOUL_RENT_SYNC_LAWDCDS_C as readonly string[]).map((c) => `'${c}'`).join(',');

    const seoulBRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd IN (${seoulBLawdList});`
    );
    const seoulCRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd IN (${seoulCLawdList});`
    );

    const seoulBRows = Number(seoulBRes[0].cnt);
    const seoulCRows = Number(seoulCRes[0].cnt);

    // 6. 체크포인트 파일 검증
    const cpPath = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/seoul-production-shard-a-checkpoint.json');
    let cpTotal = 0;
    let cpCompleted = 0;
    let cpAllComplete = false;

    if (fs.existsSync(cpPath)) {
      const cpData = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
      cpTotal = cpData.totalCellCount || 0;
      cpCompleted = Object.values(cpData.cells || {}).filter((c: any) => c.status === 'COMPLETE').length;
      cpAllComplete = cpTotal === 96 && cpCompleted === 96;
    }

    // 7. 정밀 롤백 매니페스트 확인
    const manifestDir = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/rollback-manifests');
    let manifestsCount = 0;
    let totalTrackedInsertedKeys = 0;

    if (fs.existsSync(manifestDir)) {
      const files = fs.readdirSync(manifestDir).filter((f) => f.endsWith('.json') && (f.startsWith('operational-shard-a-') || f.startsWith('pilot-manifest-')));
      manifestsCount = files.length;
      for (const mf of files) {
        try {
          const mfc = JSON.parse(fs.readFileSync(path.join(manifestDir, mf), 'utf-8'));
          totalTrackedInsertedKeys += (mfc.insertedKeys?.length || mfc.actualInsertedCount || 0);
        } catch {}
      }
    }

    const overallVerdict: 'PASS' | 'FAIL' =
      totalRows === EXPECTED_TOTAL_SEOUL_A &&
      jeonseRows === EXPECTED_TOTAL_JEONSE &&
      wolseRows === EXPECTED_TOTAL_WOLSE &&
      duplicateNaturalKeys === 0 &&
      allDistrictsMatched &&
      busanCurrent === EXPECTED_BUSAN_BASELINE &&
      seoulBRows === 0 &&
      seoulCRows === 0 &&
      cpAllComplete
        ? 'PASS'
        : 'FAIL';

    return {
      timestamp: new Date().toISOString(),
      projectId,
      seoulATotals: {
        totalRows,
        expectedRows: EXPECTED_TOTAL_SEOUL_A,
        totalMatched: totalRows === EXPECTED_TOTAL_SEOUL_A,
        jeonseRows,
        expectedJeonse: EXPECTED_TOTAL_JEONSE,
        jeonseMatched: jeonseRows === EXPECTED_TOTAL_JEONSE,
        wolseRows,
        expectedWolse: EXPECTED_TOTAL_WOLSE,
        wolseMatched: wolseRows === EXPECTED_TOTAL_WOLSE,
        duplicateNaturalKeys,
        hasDuplicates: duplicateNaturalKeys > 0,
      },
      districtBreakdown,
      busanProtection: {
        baselineRows: EXPECTED_BUSAN_BASELINE,
        currentRows: busanCurrent,
        difference: busanCurrent - EXPECTED_BUSAN_BASELINE,
        preserved: busanCurrent === EXPECTED_BUSAN_BASELINE,
      },
      unauthorizedScopeProtection: {
        seoulBRows,
        seoulCRows,
        isZero: seoulBRows === 0 && seoulCRows === 0,
      },
      checkpointValidation: {
        checkpointPath: cpPath,
        totalCellCount: cpTotal,
        completedCellCount: cpCompleted,
        allComplete: cpAllComplete,
      },
      rollbackManifestsValidation: {
        manifestsCount,
        totalTrackedInsertedKeys,
      },
      overallVerdict,
    };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (process.argv[1] && process.argv[1].endsWith('seoul-rent-production-shard-a-post-verification.ts')) {
  runShardAPostVerification()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.overallVerdict === 'PASS' ? 0 : 1);
    })
    .catch((err) => {
      console.error('POST VERIFICATION FAILED:', err);
      process.exit(1);
    });
}
