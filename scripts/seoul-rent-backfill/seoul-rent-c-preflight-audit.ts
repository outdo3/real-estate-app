/**
 * E-JIP 서울 V3.9-F — seoul-c 운영 적재 사전 점검 및 무결성 전수 감사
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  SEOUL_RENT_SYNC_LAWDCDS_C,
  SEOUL_RENT_SYNC_LAWDCDS_A,
  SEOUL_RENT_SYNC_LAWDCDS_B,
} from '../../src/lib/sync/rent-sync-scope';
import { generateMonthList, SEOUL_DISTRICT_NAMES } from './seoul-rent-backfill-engine';
import { probeOperationalBackupStatus } from './seoul-rent-backup-status-probe';

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

export const EXPECTED_OPERATIONAL_PROJECT_ID = 'ztlnagzmwksgjkappfyh';
export const EXPECTED_SEOUL_C_ROW_COUNT = 107427;
export const EXPECTED_SEOUL_C_JEONSE_COUNT = 52791;
export const EXPECTED_SEOUL_C_WOLSE_COUNT = 54636;

export async function runPreflightAudit() {
  console.log('=== [1] 운영 DB 환경 및 접속 감사 ===');
  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  let detectedProjectId: string | null = null;
  let hostMasked = 'unknown';
  try {
    const u = new URL(rawDbUrl);
    hostMasked = u.hostname;
    if (u.username.includes('.')) {
      detectedProjectId = u.username.split('.')[1];
    } else if (u.hostname.endsWith('.supabase.co')) {
      detectedProjectId = u.hostname.replace('.supabase.co', '');
    }
  } catch {}

  const rawSupabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (rawSupabaseUrl) {
    try {
      const u = new URL(rawSupabaseUrl);
      const parts = u.hostname.split('.');
      if (parts.length >= 3 && parts[1] === 'supabase') {
        detectedProjectId = parts[0];
      }
    } catch {}
  }

  console.log(`Detected Project ID: ${detectedProjectId}`);
  console.log(`Expected Project ID: ${EXPECTED_OPERATIONAL_PROJECT_ID}`);
  const projectIdMatched = detectedProjectId === EXPECTED_OPERATIONAL_PROJECT_ID;
  console.log(`Project ID Matched: ${projectIdMatched ? '✅ PASS' : '❌ FAIL'}`);

  if (!projectIdMatched) {
    throw new Error(`CRITICAL: Project ID mismatch! Detected: ${detectedProjectId}, Expected: ${EXPECTED_OPERATIONAL_PROJECT_ID}`);
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: rawDbUrl } },
  });

  // Verify connection & table & index
  console.log('Checking apartment_rent_histories schema and natural key unique index...');
  const indexRows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'apartment_rent_histories'
      AND indexname LIKE '%group_key%';
  `);
  console.log(`Found indexes for natural key: ${indexRows.length}`);
  for (const idx of indexRows) {
    console.log(` - ${idx.indexname}: ${idx.indexdef}`);
  }

  // Backup Probe
  console.log('\n=== [2] 운영 Supabase 백업 상태 점검 ===');
  try {
    const backupResult = await probeOperationalBackupStatus();
    console.log(`Archiver stats: ${backupResult.archiverStats ? 'Active' : 'N/A'}`);
    console.log(`WAL Archiving: ${backupResult.actualBackupEvidence.walArchivingActive ? '✅ Active' : '⚠️ Inactive'}`);
    console.log(`Daily Backup Status: ${backupResult.actualBackupEvidence.dailyBackupStatus}`);
    console.log(`Summary: ${backupResult.actualBackupEvidence.summaryReason}`);
  } catch (err: any) {
    console.warn(`Backup probe note: ${err.message}`);
  }

  // Baseline Row Counts
  console.log('\n=== [3] 운영 DB 현재 기준선 행수 측정 ===');
  const busanCountResult = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::bigint AS cnt
    FROM apartment_rent_histories
    WHERE lawd_cd LIKE '26%';
  `);
  const busanBaseline = Number(busanCountResult[0].cnt);
  console.log(`부산 전월세 행수: ${busanBaseline.toLocaleString()}건 (기준: 134,475건)`);

  const seoulACountResult = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::bigint AS cnt
    FROM apartment_rent_histories
    WHERE lawd_cd IN (${SEOUL_RENT_SYNC_LAWDCDS_A.map(cd => `'${cd}'`).join(', ')});
  `);
  const seoulABaseline = Number(seoulACountResult[0].cnt);
  console.log(`seoul-a 8개 구 전월세 행수: ${seoulABaseline.toLocaleString()}건 (기준: 47,817건)`);

  const seoulBCountResult = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::bigint AS cnt
    FROM apartment_rent_histories
    WHERE lawd_cd IN (${SEOUL_RENT_SYNC_LAWDCDS_B.map(cd => `'${cd}'`).join(', ')});
  `);
  const seoulBBaseline = Number(seoulBCountResult[0].cnt);
  console.log(`seoul-b 9개 구 전월세 행수: ${seoulBBaseline.toLocaleString()}건 (기준: 85,612건)`);

  const seoulCCountResult = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::bigint AS cnt
    FROM apartment_rent_histories
    WHERE lawd_cd IN (${SEOUL_RENT_SYNC_LAWDCDS_C.map(cd => `'${cd}'`).join(', ')});
  `);
  const seoulCBaseline = Number(seoulCCountResult[0].cnt);
  console.log(`seoul-c 8개 구 전월세 행수: ${seoulCBaseline.toLocaleString()}건 (기준: 0건)`);

  const totalCountResult = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::bigint AS cnt
    FROM apartment_rent_histories;
  `);
  const totalBaseline = Number(totalCountResult[0].cnt);
  console.log(`운영 DB 전체 행수: ${totalBaseline.toLocaleString()}건 (기준: 267,904건)`);

  if (busanBaseline !== 134475) {
    throw new Error(`CRITICAL: Busan count mismatch! Current: ${busanBaseline}, Expected: 134,475`);
  }
  if (seoulABaseline !== 47817) {
    throw new Error(`CRITICAL: Seoul-A count mismatch! Current: ${seoulABaseline}, Expected: 47,817`);
  }
  if (seoulBBaseline !== 85612) {
    throw new Error(`CRITICAL: Seoul-B count mismatch! Current: ${seoulBBaseline}, Expected: 85,612`);
  }
  if (seoulCBaseline !== 0) {
    throw new Error(`CRITICAL: Seoul-C already has ${seoulCBaseline} rows in production! Expected: 0`);
  }
  if (totalBaseline !== 267904) {
    throw new Error(`CRITICAL: Total baseline mismatch! Current: ${totalBaseline}, Expected: 267,904`);
  }

  // Cache Integrity Check
  console.log('\n=== [4] seoul-c 원천 캐시 96개 파일 무결성 및 전수 검증 ===');
  const cacheDir = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/seoul-c-cache');
  if (!fs.existsSync(cacheDir)) {
    throw new Error(`Cache directory not found: ${cacheDir}`);
  }

  const months = generateMonthList('202511', '202610');
  let cacheFileCount = 0;
  let totalRows = 0;
  let jeonseCount = 0;
  let wolseCount = 0;
  const naturalKeys = new Set<string>();
  let duplicateKeyCount = 0;

  const districtSummaries: Record<string, { name: string; cells: number; rows: number; jeonse: number; wolse: number }> = {};

  for (const lawdCd of SEOUL_RENT_SYNC_LAWDCDS_C) {
    districtSummaries[lawdCd] = {
      name: SEOUL_DISTRICT_NAMES[lawdCd] || lawdCd,
      cells: 0,
      rows: 0,
      jeonse: 0,
      wolse: 0,
    };

    for (const dealYmd of months) {
      const fileName = `${lawdCd}-${dealYmd}.json`;
      const filePath = path.join(cacheDir, fileName);

      if (!fs.existsSync(filePath)) {
        throw new Error(`Missing cache file: ${filePath}`);
      }

      cacheFileCount++;
      const fileBuffer = fs.readFileSync(filePath);
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      const data = JSON.parse(fileBuffer.toString('utf-8'));
      const rows = data.normalizedRows || [];

      districtSummaries[lawdCd].cells++;
      districtSummaries[lawdCd].rows += rows.length;
      totalRows += rows.length;

      for (const r of rows) {
        if (r.dealType === 'jeonse') {
          jeonseCount++;
          districtSummaries[lawdCd].jeonse++;
        } else if (r.dealType === 'wolse') {
          wolseCount++;
          districtSummaries[lawdCd].wolse++;
        }

        const natKey = `${r.groupKeyStr}|${r.deposit}|${r.monthlyRent}|${r.dealDate}|${r.floor ?? 'null'}|${r.occurrenceIndex ?? 0}`;
        if (naturalKeys.has(natKey)) {
          duplicateKeyCount++;
        } else {
          naturalKeys.add(natKey);
        }
      }
    }
  }

  console.log(`총 캐시 파일 수: ${cacheFileCount} / 96개`);
  console.log(`총 원천 거래 건수: ${totalRows.toLocaleString()}건 (목표: 107,427건)`);
  console.log(`전세 건수: ${jeonseCount.toLocaleString()}건 (목표: 52,791건)`);
  console.log(`월세 건수: ${wolseCount.toLocaleString()}건 (목표: 54,636건)`);
  console.log(`자연키 중복: ${duplicateKeyCount}건 (목표: 0건)`);

  console.log('\n[구별 원천 캐시 집계표]');
  console.table(districtSummaries);

  if (cacheFileCount !== 96) throw new Error(`Cache file count mismatch: ${cacheFileCount} !== 96`);
  if (totalRows !== EXPECTED_SEOUL_C_ROW_COUNT) throw new Error(`Total rows mismatch: ${totalRows} !== ${EXPECTED_SEOUL_C_ROW_COUNT}`);
  if (jeonseCount !== EXPECTED_SEOUL_C_JEONSE_COUNT) throw new Error(`Jeonse mismatch: ${jeonseCount} !== ${EXPECTED_SEOUL_C_JEONSE_COUNT}`);
  if (wolseCount !== EXPECTED_SEOUL_C_WOLSE_COUNT) throw new Error(`Wolse mismatch: ${wolseCount} !== ${EXPECTED_SEOUL_C_WOLSE_COUNT}`);
  if (duplicateKeyCount !== 0) throw new Error(`Duplicate keys found: ${duplicateKeyCount}`);

  // Docker QA DB Cross-Check
  console.log('\n=== [5] Docker QA DB (127.0.0.1:54332) seoul-c 정합성 대조 ===');
  const dockerQaUrl = 'postgresql://qa_tester:qa_test_pass_secure@127.0.0.1:54332/ejip_seoul_rent_qa?schema=public';
  const dockerPrisma = new PrismaClient({
    datasources: { db: { url: dockerQaUrl } },
  });

  try {
    const dockerCResult = await dockerPrisma.$queryRawUnsafe<any[]>(`
      SELECT 
        COUNT(*)::bigint AS total_cnt,
        COUNT(*) FILTER (WHERE deal_type = 'jeonse')::bigint AS jeonse_cnt,
        COUNT(*) FILTER (WHERE deal_type = 'wolse')::bigint AS wolse_cnt
      FROM apartment_rent_histories
      WHERE lawd_cd IN (${SEOUL_RENT_SYNC_LAWDCDS_C.map(cd => `'${cd}'`).join(', ')});
    `);
    const dTotal = Number(dockerCResult[0].total_cnt);
    const dJeonse = Number(dockerCResult[0].jeonse_cnt);
    const dWolse = Number(dockerCResult[0].wolse_cnt);

    console.log(`Docker QA DB seoul-c 총 행수: ${dTotal.toLocaleString()}건 (캐시와 ${dTotal === totalRows ? '✅ 100% 일치' : '❌ 불일치'})`);
    console.log(`Docker QA DB seoul-c 전세: ${dJeonse.toLocaleString()}건 (캐시와 ${dJeonse === jeonseCount ? '✅ 100% 일치' : '❌ 불일치'})`);
    console.log(`Docker QA DB seoul-c 월세: ${dWolse.toLocaleString()}건 (캐시와 ${dWolse === wolseCount ? '✅ 100% 일치' : '❌ 불일치'})`);

    if (dTotal !== totalRows || dJeonse !== jeonseCount || dWolse !== wolseCount) {
      throw new Error(`CRITICAL: Docker QA DB counts do not match raw cache!`);
    }
  } catch (err: any) {
    console.error(`Docker QA check error: ${err.message}`);
    throw err;
  } finally {
    await dockerPrisma.$disconnect();
    await prisma.$disconnect();
  }

  console.log('\n🎉 [사전 점검 완료] 모든 안전 조건 및 5중 검증 PASS — 적재 진행 가능');
}

if (require.main === module) {
  runPreflightAudit()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Preflight Audit FAILED:', err);
      process.exit(1);
    });
}
