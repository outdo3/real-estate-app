/**
 * E-JIP 서울 V3.9-A — 서울 240,856건 운영 Supabase 적재 안전 실행기 (Apply Runner)
 *
 * 절대 안전 원칙:
 * 1. 기본 동작은 DRY-RUN 및 안전 점검 (운영 DB 쓰기 차단)
 * 2. 4중 안전 가드가 모두 충족되지 않으면 쓰기를 원천 거부함:
 *    - Guard 1: ALLOW_PRODUCTION_WRITE === 'true'
 *    - Guard 2: CLI 인자 --confirm-production-write
 *    - Guard 3: PRODUCTION_CONFIRMATION_PASSPHRASE === 'CONFIRM_APPLY_SEOUL_RENT_2026'
 *    - Guard 4: Supabase Project ID 일치 (ztlnagzmwksgjkappfyh)
 * 3. 외부 국토부 API 호출 0회 (로컬 300개 캐시만 소비)
 * 4. 500건 청크 단위 트랜잭션 및 실패 시 트랜잭션 롤백 & Fail-Fast 중단
 * 5. DB 커밋 성공 확인 후 Checkpoint('OPERATIONAL_SUPABASE') 기록
 * 6. 재실행 시 중복 방지 (자연키 멱등성 및 unchanged 식별)
 * 7. 부산 기존 134,475건 데이터 보호 (lawd_cd LIKE '26%' 영향 0건)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  SEOUL_RENT_SYNC_LAWDCDS_A,
  SEOUL_RENT_SYNC_LAWDCDS_B,
  SEOUL_RENT_SYNC_LAWDCDS_C,
  SEOUL_RENT_ALL_25_LAWDCDS,
} from '../../src/lib/sync/rent-sync-scope';
import {
  SEOUL_DISTRICT_NAMES,
  generateMonthList,
  CheckpointData,
  CellExecutionRecord,
} from './seoul-rent-backfill-engine';
import {
  planRentCellWrites,
  RentComparableRow,
} from '../rent-trade-history/rent-group-guard-logic';
import { RentRowInput } from '../rent-trade-history/rent-history-logic';
import {
  NaturalKeyTuple,
  BackfillExecutionManifest,
  saveRollbackManifest,
} from './seoul-rent-surgical-rollback';

// Load env safely
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
export const REQUIRED_CONFIRMATION_PASSPHRASE = 'CONFIRM_APPLY_SEOUL_RENT_2026';
export const PRODUCTION_CHECKPOINT_PATH = path.resolve(
  process.cwd(),
  'tmp/qa-seoul-rent/seoul-production-applied-checkpoint.json'
);
export const BATCH_CHUNK_SIZE = 500;

export interface ProductionWriteGuards {
  allowProductionWriteEnv: boolean;
  cliArgConfirmed: boolean;
  passphraseValid: boolean;
  projectIdMatched: boolean;
  detectedProjectId: string | null;
  allGuardsPassed: boolean;
}

export interface ProductionApplyCellResult {
  lawdCd: string;
  dealYmd: string;
  districtName: string;
  totalCacheRows: number;
  plannedInserts: number;
  unchangedRows: number;
  skippedGuarded: number;
  status: 'APPLIED' | 'SKIPPED_BY_CHECKPOINT' | 'DRY_RUN_PLAN' | 'FAILED';
  error?: string;
}

export interface ProductionApplyRunnerSummary {
  mode: 'DRY_RUN_SAFE' | 'LIVE_EXECUTION';
  guards: ProductionWriteGuards;
  targetDb: {
    hostDomainMasked: string;
    projectId: string | null;
    isVerifiedOperationalDb: boolean;
  };
  totalPlannedCells: number;
  totalExecutedCells: number;
  totalSkippedByCheckpoint: number;
  totalPlannedInserts: number;
  totalUnchangedRows: number;
  totalGuardedSkipped: number;
  initialBusanRows: number;
  finalBusanRows?: number;
  busanDataPreserved: boolean;
  durationMs: number;
  cellRecords: ProductionApplyCellResult[];
  checkpointFile: string;
}

/**
 * 4중 운영 쓰기 가드 상태 평가
 */
export function evaluateProductionWriteGuards(argv: string[] = process.argv): ProductionWriteGuards {
  const allowEnv = process.env.ALLOW_PRODUCTION_WRITE === 'true';
  const cliConfirmed = argv.includes('--confirm-production-write');
  const passValid = process.env.PRODUCTION_CONFIRMATION_PASSPHRASE === REQUIRED_CONFIRMATION_PASSPHRASE;

  let detectedProjectId: string | null = null;
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
  if (!detectedProjectId && process.env.DATABASE_URL) {
    try {
      const u = new URL(process.env.DATABASE_URL);
      if (u.username.includes('.')) {
        detectedProjectId = u.username.split('.')[1];
      } else if (u.hostname.endsWith('.supabase.co')) {
        detectedProjectId = u.hostname.replace('.supabase.co', '');
      }
    } catch {}
  }

  const projMatched = detectedProjectId === EXPECTED_OPERATIONAL_PROJECT_ID;
  const allPassed = allowEnv && cliConfirmed && passValid && projMatched;

  return {
    allowProductionWriteEnv: allowEnv,
    cliArgConfirmed: cliConfirmed,
    passphraseValid: passValid,
    projectIdMatched: projMatched,
    detectedProjectId,
    allGuardsPassed: allPassed,
  };
}

/**
 * 캐시 파일 경로 해석 (300개 셀 전수 매핑)
 */
export function resolveCacheFilePath(lawdCd: string, dealYmd: string, baseDir?: string): string {
  const root = baseDir || path.resolve(process.cwd(), 'tmp/qa-seoul-rent');
  let shardSubdir = 'seoul-a-cache';
  if ((SEOUL_RENT_SYNC_LAWDCDS_A as readonly string[]).includes(lawdCd)) {
    shardSubdir = 'seoul-a-cache';
  } else if ((SEOUL_RENT_SYNC_LAWDCDS_B as readonly string[]).includes(lawdCd)) {
    shardSubdir = 'seoul-b-cache';
  } else if ((SEOUL_RENT_SYNC_LAWDCDS_C as readonly string[]).includes(lawdCd)) {
    shardSubdir = 'seoul-c-cache';
  }

  return path.join(root, shardSubdir, `${lawdCd}-${dealYmd}.json`);
}

/**
 * 운영 적재 체크포인트 로드 (운영 환경 엄격 격리)
 */
export function loadProductionCheckpoint(cpPath: string = PRODUCTION_CHECKPOINT_PATH): CheckpointData {
  if (fs.existsSync(cpPath)) {
    try {
      const data: CheckpointData = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
      if (data.environment && data.environment !== 'OPERATIONAL_SUPABASE') {
        throw new Error(
          `SECURITY MISMATCH: Checkpoint environment is '${data.environment}', expected 'OPERATIONAL_SUPABASE'. Refusing to use mismatched checkpoint.`
        );
      }
      return data;
    } catch (e: any) {
      if (e.message.startsWith('SECURITY MISMATCH')) throw e;
    }
  }

  return {
    version: 1,
    scope: 'seoul-all',
    fromYmd: '202511',
    toYmd: '202610',
    lastUpdated: new Date().toISOString(),
    totalCellCount: 300,
    completedCellCount: 0,
    environment: 'OPERATIONAL_SUPABASE',
    cells: {},
  };
}

/**
 * 운영 적재 체크포인트 저장
 */
export function saveProductionCheckpoint(data: CheckpointData, cpPath: string = PRODUCTION_CHECKPOINT_PATH): void {
  data.lastUpdated = new Date().toISOString();
  data.environment = 'OPERATIONAL_SUPABASE';
  const dir = path.dirname(cpPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(cpPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 운영 적재 실행기 (Dry-Run / Live 공용 제어)
 */
export async function runProductionApply(options: {
  dryRunOnly?: boolean;
  targetLawdCds?: string[];
  targetMonths?: string[];
  checkpointPath?: string;
  cacheBaseDir?: string;
} = {}): Promise<ProductionApplyRunnerSummary> {
  const startTime = Date.now();
  const guards = evaluateProductionWriteGuards();
  const isLive = !options.dryRunOnly && guards.allGuardsPassed;

  const cpPath = options.checkpointPath || PRODUCTION_CHECKPOINT_PATH;
  const checkpoint = loadProductionCheckpoint(cpPath);

  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  let hostDomainMasked = 'unknown';
  try {
    const u = new URL(rawDbUrl);
    const hostParts = u.hostname.split('.');
    if (hostParts.length > 2) {
      hostDomainMasked = `${hostParts[0]}.${hostParts[1] === 'pooler' ? 'pooler.' : ''}***.${hostParts.slice(-2).join('.')}`;
    } else {
      hostDomainMasked = u.hostname;
    }
  } catch {}

  const prisma = new PrismaClient({
    datasources: { db: { url: rawDbUrl } },
  });

  const targetDistricts = options.targetLawdCds || SEOUL_RENT_ALL_25_LAWDCDS;
  const targetMonths = options.targetMonths || generateMonthList('202511', '202610');
  const totalPlannedCells = targetDistricts.length * targetMonths.length;

  const cellRecords: ProductionApplyCellResult[] = [];
  let totalPlannedInserts = 0;
  let totalUnchangedRows = 0;
  let totalGuardedSkipped = 0;
  let totalSkippedByCheckpoint = 0;
  let totalExecutedCells = 0;

  // 1. Check initial Busan rows to ensure preservation
  let initialBusanRows = 0;
  try {
    const busanCountRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd LIKE '26%';`
    );
    initialBusanRows = Number(busanCountRes[0].cnt);
  } catch (err: any) {
    await prisma.$disconnect().catch(() => {});
    throw new Error(`Failed to query initial Busan rows: ${err.message}`);
  }

  try {
    for (const lawdCd of targetDistricts) {
      const distName = SEOUL_DISTRICT_NAMES[lawdCd] || lawdCd;

      for (const dealYmd of targetMonths) {
        const cellKey = `${lawdCd}-${dealYmd}`;

        // Checkpoint skip check
        if (checkpoint.cells[cellKey]?.status === 'COMPLETE') {
          totalSkippedByCheckpoint++;
          cellRecords.push({
            lawdCd,
            dealYmd,
            districtName: distName,
            totalCacheRows: checkpoint.cells[cellKey].persistedCount || 0,
            plannedInserts: 0,
            unchangedRows: checkpoint.cells[cellKey].persistedCount || 0,
            skippedGuarded: 0,
            status: 'SKIPPED_BY_CHECKPOINT',
          });
          continue;
        }

        // Cache file check (Zero-Call enforced)
        const cacheFilePath = resolveCacheFilePath(lawdCd, dealYmd, options.cacheBaseDir);
        if (!fs.existsSync(cacheFilePath)) {
          throw new Error(`CRITICAL: Cache file not found for cell ${cellKey} at ${cacheFilePath}`);
        }

        const cacheContent = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
        const normalizedRows: RentRowInput[] = cacheContent.normalizedRows || [];

        // Fetch existing rows for this specific cell (strictly filtered by lawdCd & dealYmd)
        const existingInDb = await prisma.$queryRawUnsafe<any[]>(
          `SELECT 
             group_key AS "groupKeyStr",
             deposit,
             monthly_rent AS "monthlyRent",
             deal_date::text AS "dealDate",
             floor,
             occurrence_index AS "occurrenceIndex",
             contract_type AS "contractType",
             contract_term AS "contractTerm",
             pre_deposit AS "preDeposit",
             pre_monthly_rent AS "preMonthlyRent",
             use_renewal_right AS "useRenewalRight"
           FROM apartment_rent_histories
           WHERE lawd_cd = $1 AND deal_ymd = $2;`,
          lawdCd,
          dealYmd
        );

        const existingComparable: RentComparableRow[] = existingInDb.map((r: any) => ({
          groupKeyStr: r.groupKeyStr,
          deposit: r.deposit,
          monthlyRent: r.monthlyRent,
          dealDate: r.dealDate,
          floor: r.floor,
          occurrenceIndex: r.occurrenceIndex,
          contractType: r.contractType,
          contractTerm: r.contractTerm,
          preDeposit: r.preDeposit,
          preMonthlyRent: r.preMonthlyRent,
          useRenewalRight: r.useRenewalRight,
        }));

        // Plan writes with Option E guard
        const plan = planRentCellWrites(normalizedRows, existingComparable);

        totalPlannedInserts += plan.inserts.length;
        totalUnchangedRows += plan.unchanged;
        totalGuardedSkipped += plan.skippedInserts.length;

        if (isLive) {
          // LIVE WRITE EXECUTION (In chunks within transactions)
          if (plan.inserts.length > 0) {
            const insertedKeys: NaturalKeyTuple[] = plan.inserts.map((r) => ({
              groupKeyStr: r.groupKeyStr,
              deposit: r.deposit,
              monthlyRent: r.monthlyRent,
              dealDate: r.dealDate,
              floor: r.floor ?? null,
              occurrenceIndex: r.occurrenceIndex ?? 0,
            }));

            for (let i = 0; i < plan.inserts.length; i += BATCH_CHUNK_SIZE) {
              const chunk = plan.inserts.slice(i, i + BATCH_CHUNK_SIZE);
              await prisma.$transaction(async (tx) => {
                for (const row of chunk) {
                  await tx.$executeRawUnsafe(
                    `INSERT INTO apartment_rent_histories (
                       lawd_cd, deal_ymd, apt_seq, identity_key, deal_type, group_key,
                       apt_name, dong, jibun, exclusive_area, deposit, monthly_rent,
                       deal_year, deal_month, deal_day, deal_date, floor, build_year,
                       contract_type, contract_term, pre_deposit, pre_monthly_rent,
                       use_renewal_right, occurrence_index, source, source_fetched_at,
                       created_at, updated_at
                     ) VALUES (
                       $1, $2, $3, $4, $5, $6,
                       $7, $8, $9, $10, $11, $12,
                       $13, $14, $15, $16::date, $17, $18,
                       $19, $20, $21, $22,
                       $23, $24, 'MOLIT', NOW(),
                       NOW(), NOW()
                     )
                     ON CONFLICT (group_key, deposit, monthly_rent, deal_date, floor, occurrence_index)
                     DO NOTHING;`,
                    row.lawdCd,
                    row.dealYmd,
                    row.aptSeq,
                    row.identityKey,
                    row.dealType,
                    row.groupKeyStr,
                    row.aptName,
                    row.dong,
                    row.jibun || null,
                    row.exclusiveArea,
                    row.deposit,
                    row.monthlyRent,
                    row.dealYear,
                    row.dealMonth,
                    row.dealDay,
                    row.dealDate,
                    row.floor ?? null,
                    row.buildYear ?? null,
                    row.contractType ?? null,
                    row.contractTerm ?? null,
                    row.preDeposit ?? null,
                    row.preMonthlyRent ?? null,
                    row.useRenewalRight ?? null,
                    row.occurrenceIndex ?? 0
                  );
                }
              });
            }

            // Save surgical rollback manifest for this cell execution
            const runId = `manifest-${lawdCd}-${dealYmd}-${Date.now()}`;
            saveRollbackManifest({
              runId,
              targetDbEnv: 'OPERATIONAL_SUPABASE',
              lawdCd,
              dealYmd,
              districtName: distName,
              startedAt: new Date(startTime).toISOString(),
              completedAt: new Date().toISOString(),
              transactionSuccess: true,
              totalCacheRows: normalizedRows.length,
              plannedInserts: plan.inserts.length,
              unchangedCount: plan.unchanged,
              guardedSkippedCount: plan.skippedInserts.length,
              actualInsertedCount: plan.inserts.length,
              insertedKeys,
              rollbackStatus: 'NOT_TRIGGERED',
            });
          }

          // Record cell success in Checkpoint
          checkpoint.cells[cellKey] = {
            cellKey,
            lawdCd,
            districtName: distName,
            dealYmd,
            executionMode: 'APPLIED',
            targetDbEnv: 'OPERATIONAL_SUPABASE',
            status: 'COMPLETE',
            totalCount: normalizedRows.length,
            collectedCount: normalizedRows.length,
            plannedInserts: plan.inserts.length,
            skippedGuarded: plan.skippedInserts.length,
            unchanged: plan.unchanged,
            reviewDiffCount: 0,
            persistedCount: plan.inserts.length,
            durationMs: 0,
            processedAt: new Date().toISOString(),
          };
          checkpoint.completedCellCount = Object.keys(checkpoint.cells).length;
          saveProductionCheckpoint(checkpoint, cpPath);

          cellRecords.push({
            lawdCd,
            dealYmd,
            districtName: distName,
            totalCacheRows: normalizedRows.length,
            plannedInserts: plan.inserts.length,
            unchangedRows: plan.unchanged,
            skippedGuarded: plan.skippedInserts.length,
            status: 'APPLIED',
          });
        } else {
          // DRY RUN MODE
          cellRecords.push({
            lawdCd,
            dealYmd,
            districtName: distName,
            totalCacheRows: normalizedRows.length,
            plannedInserts: plan.inserts.length,
            unchangedRows: plan.unchanged,
            skippedGuarded: plan.skippedInserts.length,
            status: 'DRY_RUN_PLAN',
          });
        }

        totalExecutedCells++;
      }
    }

    // Verify Busan data preserved
    let finalBusanRows: number | undefined;
    if (isLive) {
      const finalBusanRes = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd LIKE '26%';`
      );
      finalBusanRows = Number(finalBusanRes[0].cnt);
    }

    return {
      mode: isLive ? 'LIVE_EXECUTION' : 'DRY_RUN_SAFE',
      guards,
      targetDb: {
        hostDomainMasked,
        projectId: guards.detectedProjectId,
        isVerifiedOperationalDb: guards.projectIdMatched,
      },
      totalPlannedCells,
      totalExecutedCells,
      totalSkippedByCheckpoint,
      totalPlannedInserts,
      totalUnchangedRows,
      totalGuardedSkipped,
      initialBusanRows,
      finalBusanRows,
      busanDataPreserved: finalBusanRows !== undefined ? finalBusanRows === initialBusanRows : true,
      durationMs: Date.now() - startTime,
      cellRecords,
      checkpointFile: cpPath,
    };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

export interface PilotPreconditionsCheckResult {
  operationalProjectId: string | null;
  projectIdMatched: boolean;
  targetCell: {
    lawdCd: string;
    dealYmd: string;
    districtName: string;
    existingRowsInOperationalDb: number;
    cellIsEmptyInProduction: boolean;
  };
  cacheStatus: {
    cacheFilePath: string;
    cacheExists: boolean;
    cacheRowsCount: number;
    jeonseCount: number;
    wolseCount: number;
    matchesExpected140: boolean;
  };
  guardsStatus: ProductionWriteGuards;
  busanProtection: {
    initialBusanRows: number;
    expectedBusanRows: number;
    busanRowsIntact: boolean;
  };
  chunkSizeRequirement: {
    batchChunkSize: number;
    withinLimit: boolean;
  };
  postInsertVerificationSql: string;
  errorRecoveryProcedure: string;
  allPreconditionsReady: boolean;
}

export async function probePilotPreconditions(): Promise<PilotPreconditionsCheckResult> {
  const guards = evaluateProductionWriteGuards();
  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) {
    throw new Error('DATABASE_URL is not set.');
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: rawDbUrl } },
  });

  const pilotLawdCd = '11110';
  const pilotDealYmd = '202610';
  const pilotDistrictName = '종로구';

  try {
    // 1. Existing rows in operational DB for Jongno 202610
    const cellCountRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd = $1 AND deal_ymd = $2;`,
      pilotLawdCd,
      pilotDealYmd
    );
    const existingInProd = Number(cellCountRes[0].cnt);

    // 2. Busan row count
    const busanCountRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd LIKE '26%';`
    );
    const initialBusan = Number(busanCountRes[0].cnt);

    // 3. Cache inspection
    const cachePath = resolveCacheFilePath(pilotLawdCd, pilotDealYmd);
    const cacheExists = fs.existsSync(cachePath);
    let cacheCount = 0;
    let jeonseCount = 0;
    let wolseCount = 0;

    if (cacheExists) {
      const content = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      const rows: RentRowInput[] = content.normalizedRows || [];
      cacheCount = rows.length;
      for (const r of rows) {
        const dt = (r.dealType || '').toLowerCase();
        if (dt === 'jeonse') jeonseCount++;
        else if (dt === 'wolse') wolseCount++;
      }
    }

    const postInsertSql = `SELECT count(*) AS total_inserted,
       count(*) FILTER (WHERE deal_type = 'jeonse') AS jeonse_count,
       count(*) FILTER (WHERE deal_type = 'wolse') AS wolse_count
FROM apartment_rent_histories
WHERE lawd_cd = '${pilotLawdCd}' AND deal_ymd = '${pilotDealYmd}';`;

    const recoveryProc =
      '1. Chunk transaction automatic rollback on failure.\n' +
      '2. In case of post-validation failure, run surgical rollback using saved manifest to delete only inserted natural keys.\n' +
      '3. Verify Busan data remains 134,475 rows.';

    const allReady =
      guards.projectIdMatched &&
      existingInProd === 0 &&
      cacheExists &&
      cacheCount === 140 &&
      initialBusan === 134475;

    return {
      operationalProjectId: guards.detectedProjectId,
      projectIdMatched: guards.projectIdMatched,
      targetCell: {
        lawdCd: pilotLawdCd,
        dealYmd: pilotDealYmd,
        districtName: pilotDistrictName,
        existingRowsInOperationalDb: existingInProd,
        cellIsEmptyInProduction: existingInProd === 0,
      },
      cacheStatus: {
        cacheFilePath: cachePath,
        cacheExists,
        cacheRowsCount: cacheCount,
        jeonseCount,
        wolseCount,
        matchesExpected140: cacheCount === 140,
      },
      guardsStatus: guards,
      busanProtection: {
        initialBusanRows: initialBusan,
        expectedBusanRows: 134475,
        busanRowsIntact: initialBusan === 134475,
      },
      chunkSizeRequirement: {
        batchChunkSize: BATCH_CHUNK_SIZE,
        withinLimit: cacheCount <= BATCH_CHUNK_SIZE,
      },
      postInsertVerificationSql: postInsertSql,
      errorRecoveryProcedure: recoveryProc,
      allPreconditionsReady: allReady,
    };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module || process.argv[1]?.endsWith('seoul-rent-production-apply-runner.ts')) {
  if (process.argv.includes('--probe-pilot')) {
    probePilotPreconditions()
      .then((res) => {
        console.log('=== JONGNO 202610 PILOT PRECONDITIONS PROBE ===');
        console.log(JSON.stringify(res, null, 2));
      })
      .catch((err) => {
        console.error('Pilot probe failed:', err);
        process.exit(1);
      });
  } else {
    runProductionApply({ dryRunOnly: true })
      .then((summary) => {
        console.log('=== E-JIP SEOUL RENT PRODUCTION APPLY RUNNER (DRY-RUN CHECK) ===');
        console.log(`Execution Mode: ${summary.mode}`);
        console.log(`Target Host: ${summary.targetDb.hostDomainMasked}`);
        console.log(`Project ID: ${summary.targetDb.projectId} (Verified: ${summary.targetDb.isVerifiedOperationalDb})`);
        console.log(`All 4 Guards Passed: ${summary.guards.allGuardsPassed}`);
        console.log(`Total Planned Cells: ${summary.totalPlannedCells}`);
        console.log(`Planned Inserts: ${summary.totalPlannedInserts.toLocaleString()}`);
        console.log(`Unchanged Rows: ${summary.totalUnchangedRows.toLocaleString()}`);
        console.log(`Skipped Guarded: ${summary.totalGuardedSkipped.toLocaleString()}`);
        console.log(`Initial Busan Rows: ${summary.initialBusanRows.toLocaleString()}`);
        console.log(`Busan Data Preserved: ${summary.busanDataPreserved}`);
      })
      .catch((err) => {
        console.error('Runner failed:', err);
        process.exit(1);
      });
  }
}
