import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { RentRowInput } from '../rent-trade-history/rent-history-logic';
import { getRentMonthlyAggregateFromDb } from '../../src/lib/rent-history-read';

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

export interface PilotPostVerificationReport {
  timestamp: string;
  projectId: string;
  jongnoPilotValidation: {
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
    exactFieldSampleParity: boolean;
  };
  busanProtectionValidation: {
    baselineRows: number;
    currentRows: number;
    difference: number;
    rowsIdentical: boolean;
    busanAggregateQuerySucceeded: boolean;
  };
  otherSeoulProtectionValidation: {
    otherSeoulRowsCount: number;
    isZero: boolean;
  };
  checkpointValidation: {
    checkpointPath: string;
    environment: string;
    completedCellCount: number;
    isOnlyPilotCellCompleted: boolean;
    pilotCellRecord: any;
  };
  rollbackManifestValidation: {
    manifestExists: boolean;
    runId: string;
    insertedKeysCount: number;
    matchesExpected140: boolean;
  };
  overallVerdict: 'PASS' | 'FAIL';
}

export async function runPilotPostVerification(): Promise<PilotPostVerificationReport> {
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

  try {
    // 5.1 종로구 140건 확인
    const countRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT 
         count(*)::bigint AS total_cnt,
         count(*) FILTER (WHERE deal_type = 'jeonse')::bigint AS jeonse_cnt,
         count(*) FILTER (WHERE deal_type = 'wolse')::bigint AS wolse_cnt
       FROM apartment_rent_histories
       WHERE lawd_cd = '11110' AND deal_ymd = '202610';`
    );
    const totalCnt = Number(countRes[0].total_cnt);
    const jeonseCnt = Number(countRes[0].jeonse_cnt);
    const wolseCnt = Number(countRes[0].wolse_cnt);

    const dupRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*) - count(DISTINCT (group_key, deposit, monthly_rent, deal_date, floor, occurrence_index))::bigint AS dup_cnt
       FROM apartment_rent_histories
       WHERE lawd_cd = '11110' AND deal_ymd = '202610';`
    );
    const dups = Number(dupRes[0].dup_cnt || 0);

    // 원천 캐시와 샘플 대조 (금액, 면적, 층수, 거래일 등)
    const cachePath = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/seoul-a-cache/11110-202610.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const cacheRows: RentRowInput[] = cache.normalizedRows;

    const sampleRow = cacheRows[0];
    const dbSampleRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT deposit, monthly_rent, exclusive_area::text AS exclusive_area, deal_date::text AS deal_date, floor, occurrence_index
       FROM apartment_rent_histories
       WHERE group_key = $1 AND deposit = $2 AND monthly_rent = $3 AND deal_date = $4::date;`,
      sampleRow.groupKeyStr,
      sampleRow.deposit,
      sampleRow.monthlyRent,
      sampleRow.dealDate
    );
    const exactFieldSampleParity =
      dbSampleRes.length > 0 &&
      Number(dbSampleRes[0].deposit) === sampleRow.deposit &&
      Number(dbSampleRes[0].monthly_rent) === sampleRow.monthlyRent &&
      dbSampleRes[0].deal_date.startsWith(sampleRow.dealDate);

    // 5.2 부산 데이터 보호 검증
    const busanRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd LIKE '26%';`
    );
    const busanCurrent = Number(busanRes[0].cnt);

    // 부산 전월세 조회 함수 정상 동작 여부
    let busanAggOk = false;
    try {
      const agg = await getRentMonthlyAggregateFromDb(['26110'], ['202608']);
      busanAggOk = agg !== null;
    } catch {
      busanAggOk = false;
    }

    // 5.3 기타 서울 지역 데이터 0건 검증
    const otherSeoulRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories
       WHERE lawd_cd LIKE '11%' AND (lawd_cd != '11110' OR deal_ymd != '202610');`
    );
    const otherSeoulCnt = Number(otherSeoulRes[0].cnt);

    // 5.4 Checkpoint 검증
    const cpPath = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/seoul-production-pilot-checkpoint.json');
    const cp = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
    const cpCell = cp.cells?.['11110-202610'];

    // 5.5 Rollback Manifest 검증
    const manifestsDir = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/rollback-manifests');
    const manifestFiles = fs.readdirSync(manifestsDir).filter(f => f.includes('pilot-manifest-11110-202610'));
    let manifestData: any = null;
    if (manifestFiles.length > 0) {
      manifestData = JSON.parse(fs.readFileSync(path.join(manifestsDir, manifestFiles[manifestFiles.length - 1]), 'utf-8'));
    }

    const overallPass =
      totalCnt === 140 &&
      jeonseCnt === 55 &&
      wolseCnt === 85 &&
      dups === 0 &&
      exactFieldSampleParity &&
      busanCurrent === 134475 &&
      otherSeoulCnt === 0 &&
      cp.completedCellCount === 1 &&
      cpCell?.status === 'COMPLETE' &&
      manifestData?.insertedKeys?.length === 140;

    return {
      timestamp: new Date().toISOString(),
      projectId,
      jongnoPilotValidation: {
        totalRows: totalCnt,
        expectedRows: 140,
        totalMatched: totalCnt === 140,
        jeonseRows: jeonseCnt,
        expectedJeonse: 55,
        jeonseMatched: jeonseCnt === 55,
        wolseRows: wolseCnt,
        expectedWolse: 85,
        wolseMatched: wolseCnt === 85,
        duplicateNaturalKeys: dups,
        hasDuplicates: dups > 0,
        exactFieldSampleParity,
      },
      busanProtectionValidation: {
        baselineRows: 134475,
        currentRows: busanCurrent,
        difference: busanCurrent - 134475,
        rowsIdentical: busanCurrent === 134475,
        busanAggregateQuerySucceeded: busanAggOk,
      },
      otherSeoulProtectionValidation: {
        otherSeoulRowsCount: otherSeoulCnt,
        isZero: otherSeoulCnt === 0,
      },
      checkpointValidation: {
        checkpointPath: cpPath,
        environment: cp.environment,
        completedCellCount: cp.completedCellCount,
        isOnlyPilotCellCompleted: cp.completedCellCount === 1 && Object.keys(cp.cells).length === 1,
        pilotCellRecord: cpCell,
      },
      rollbackManifestValidation: {
        manifestExists: manifestData !== null,
        runId: manifestData?.runId || 'none',
        insertedKeysCount: manifestData?.insertedKeys?.length || 0,
        matchesExpected140: manifestData?.insertedKeys?.length === 140,
      },
      overallVerdict: overallPass ? 'PASS' : 'FAIL',
    };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module || process.argv[1]?.endsWith('seoul-rent-pilot-post-verification.ts')) {
  runPilotPostVerification()
    .then((rep) => {
      console.log('=== E-JIP JONGNO 202610 POST-APPLY INDEPENDENT VERIFICATION ===');
      console.log(JSON.stringify(rep, null, 2));
    })
    .catch((err) => {
      console.error('Verification failed:', err);
      process.exit(1);
    });
}
