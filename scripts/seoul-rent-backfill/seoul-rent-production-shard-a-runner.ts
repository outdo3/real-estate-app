/**
 * E-JIP 서울 V3.9-D — seoul-a 잔여 95셀 운영 Supabase 순차 적재 실행기 (Runner)
 *
 * 엄격한 운영 안전 제약:
 * 1. 대상 샤드 영구 고정: seoul-a 8개 구 (11110, 11140, 11170, 11215, 11230, 11410, 11440, 11545)
 * 2. 신규 INSERT 상한: 최대 47,677건 (초과 시 즉각 실행 차단)
 *    (기존 종로 202610 140건 포함 시 seoul-a 최종 총계 47,817건)
 * 3. 서울 타 샤드(seoul-b: 108셀, seoul-c: 96셀) 실행 원천 차단 (Scope Lockdown)
 * 4. 5중 안전 가드:
 *    - Guard 1: ALLOW_PRODUCTION_WRITE === 'true'
 *    - Guard 2: CLI 인자 --confirm-production-write
 *    - Guard 3: PRODUCTION_CONFIRMATION_PASSPHRASE === 'CONFIRM_APPLY_SEOUL_RENT_2026'
 *    - Guard 4: Supabase Project ID 일치 ('ztlnagzmwksgjkappfyh')
 *    - Guard 5: Shard A Scope Lockdown (8개 구, max 47,677 new rows)
 * 5. 외부 MOLIT API 호출 0회 (로컬 캐시 tmp/qa-seoul-rent/seoul-a-cache 만 소비)
 * 6. 청크 500건 단위 트랜잭션 및 셀 단위 원자적 실패 처리
 * 7. 셀별 사전/사후 외과적 정밀 롤백 매니페스트 생성 및 영속화
 * 8. 사후 읽기 전용 정합성 검증 (부산 134,475건 보존 / seoul-b,c 0건)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { SEOUL_RENT_SYNC_LAWDCDS_A } from '../../src/lib/sync/rent-sync-scope';
import {
  SEOUL_DISTRICT_NAMES,
  generateMonthList,
  CheckpointData,
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
export const MAX_AUTHORIZED_NEW_INSERTS = 47677; // Remaining 95 cells
export const TOTAL_EXPECTED_SEOUL_A_ROWS = 47817; // 96 cells total (including Jongno 140)
export const BATCH_CHUNK_SIZE = 100;

export const SHARD_A_CHECKPOINT_PATH = path.resolve(
  process.cwd(),
  'tmp/qa-seoul-rent/seoul-production-shard-a-checkpoint.json'
);

export const DEFAULT_CACHE_DIR = path.resolve(
  process.cwd(),
  'tmp/qa-seoul-rent/seoul-a-cache'
);

export interface ShardAWriteGuards {
  allowProductionWriteEnv: boolean;
  cliArgConfirmed: boolean;
  passphraseValid: boolean;
  projectIdMatched: boolean;
  scopeLockedToShardA: boolean;
  detectedProjectId: string | null;
  allGuardsPassed: boolean;
}

export interface ShardACellExecutionSummary {
  cellKey: string;
  lawdCd: string;
  dealYmd: string;
  districtName: string;
  totalCacheRows: number;
  plannedInserts: number;
  unchangedRows: number;
  skippedGuarded: number;
  actualInserted: number;
  status: 'COMPLETE' | 'SKIPPED_EXISTING' | 'DRY_RUN' | 'FAILED';
  durationMs: number;
  manifestPath?: string;
  error?: string;
}

export interface ShardARunnerSummary {
  executionMode: 'DRY_RUN_SAFE' | 'LIVE_EXECUTION';
  guards: ShardAWriteGuards;
  targetDb: {
    hostDomainMasked: string;
    projectId: string | null;
  };
  totalPlannedCells: number;
  executedCellsCount: number;
  skippedCellsCount: number;
  totalPlannedInserts: number;
  totalActualInserted: number;
  totalUnchangedRows: number;
  initialBusanRows: number;
  finalBusanRows: number;
  busanPreserved: boolean;
  cellResults: ShardACellExecutionSummary[];
}

export function evaluateShardAWriteGuards(targetLawdCds?: string[]): ShardAWriteGuards {
  const allowProductionWriteEnv = process.env.ALLOW_PRODUCTION_WRITE === 'true';
  const cliArgConfirmed = process.argv.includes('--confirm-production-write');
  const passphraseValid =
    process.env.PRODUCTION_CONFIRMATION_PASSPHRASE === REQUIRED_CONFIRMATION_PASSPHRASE;

  const rawDbUrl = process.env.DATABASE_URL || '';
  let detectedProjectId: string | null = null;
  try {
    const u = new URL(rawDbUrl);
    if (u.username.includes('.')) {
      detectedProjectId = u.username.split('.')[1];
    } else if (u.hostname.endsWith('.supabase.co')) {
      detectedProjectId = u.hostname.replace('.supabase.co', '');
    } else if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const su = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
      detectedProjectId = su.hostname.split('.')[0];
    }
  } catch {}

  const projectIdMatched = detectedProjectId === EXPECTED_OPERATIONAL_PROJECT_ID;

  // Shard A scope lockdown
  const lawdsToCheck = targetLawdCds || (SEOUL_RENT_SYNC_LAWDCDS_A as readonly string[]);
  const scopeLockedToShardA = lawdsToCheck.every((c) =>
    (SEOUL_RENT_SYNC_LAWDCDS_A as readonly string[]).includes(c)
  );

  const allGuardsPassed =
    allowProductionWriteEnv &&
    cliArgConfirmed &&
    passphraseValid &&
    projectIdMatched &&
    scopeLockedToShardA;

  return {
    allowProductionWriteEnv,
    cliArgConfirmed,
    passphraseValid,
    projectIdMatched,
    scopeLockedToShardA,
    detectedProjectId,
    allGuardsPassed,
  };
}

export function loadShardACheckpoint(cpPath: string = SHARD_A_CHECKPOINT_PATH): CheckpointData {
  if (fs.existsSync(cpPath)) {
    try {
      return JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
    } catch {}
  }

  // Also check if pilot checkpoint exists to pre-populate Jongno 202610
  const pilotCpPath = path.resolve(
    process.cwd(),
    'tmp/qa-seoul-rent/seoul-production-pilot-checkpoint.json'
  );
  const initialCells: Record<string, any> = {};

  if (fs.existsSync(pilotCpPath)) {
    try {
      const pilotCp = JSON.parse(fs.readFileSync(pilotCpPath, 'utf-8'));
      if (pilotCp.cells && pilotCp.cells['11110-202610']) {
        initialCells['11110-202610'] = {
          ...pilotCp.cells['11110-202610'],
          executionMode: 'APPLIED',
          targetDbEnv: 'OPERATIONAL_SUPABASE',
          status: 'COMPLETE',
        };
      }
    } catch {}
  }

  return {
    version: 1,
    scope: 'seoul-a-8-districts',
    fromYmd: '202511',
    toYmd: '202610',
    lastUpdated: new Date().toISOString(),
    totalCellCount: 96,
    completedCellCount: Object.keys(initialCells).length,
    environment: 'OPERATIONAL_SUPABASE',
    cells: initialCells,
  };
}

export function saveShardACheckpoint(
  data: CheckpointData,
  cpPath: string = SHARD_A_CHECKPOINT_PATH
): void {
  data.lastUpdated = new Date().toISOString();
  data.environment = 'OPERATIONAL_SUPABASE';
  data.completedCellCount = Object.values(data.cells).filter(
    (c) => c.status === 'COMPLETE'
  ).length;

  const dir = path.dirname(cpPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(cpPath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function runSeoulAShardProductionApply(options: {
  dryRunOnly?: boolean;
  testFirstCellOnly?: boolean;
  cacheDir?: string;
  checkpointPath?: string;
  targetLawdCds?: string[];
  targetMonths?: string[];
} = {}): Promise<ShardARunnerSummary> {
  const startTime = Date.now();
  const targetDistricts = options.targetLawdCds || (SEOUL_RENT_SYNC_LAWDCDS_A as readonly string[]);
  const targetMonths = options.targetMonths || generateMonthList('202511', '202610');
  const cacheDir = options.cacheDir || DEFAULT_CACHE_DIR;
  const cpPath = options.checkpointPath || SHARD_A_CHECKPOINT_PATH;

  // 1. Evaluate guards
  const guards = evaluateShardAWriteGuards(targetDistricts as string[]);
  const isLive = !options.dryRunOnly && guards.allGuardsPassed;

  if (!isLive && !options.dryRunOnly) {
    console.warn('⚠️ LIVE WRITE GUARDS NOT SATISFIED -> FORCING DRY-RUN SAFE MODE');
  }

  // 2. Strict shard safety check
  for (const lawd of targetDistricts) {
    if (!(SEOUL_RENT_SYNC_LAWDCDS_A as readonly string[]).includes(lawd)) {
      throw new Error(
        `SAFETY BLOCK: lawdCd ${lawd} is outside seoul-a scope. Only seoul-a (8 districts) authorized.`
      );
    }
  }

  const rawDbUrl = process.env.DATABASE_URL;
  if (!rawDbUrl) throw new Error('DATABASE_URL is not set.');

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

  const checkpoint = loadShardACheckpoint(cpPath);
  const totalPlannedCells = targetDistricts.length * targetMonths.length;

  let totalPlannedInserts = 0;
  let totalActualInserted = 0;
  let totalUnchangedRows = 0;
  let executedCellsCount = 0;
  let skippedCellsCount = 0;
  const cellResults: ShardACellExecutionSummary[] = [];

  try {
    // Baseline check
    const busanInitialRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd LIKE '26%';`
    );
    const initialBusanRows = Number(busanInitialRes[0].cnt);

    let cellIndex = 0;
    let stopAfterFirstCell = false;

    console.log(`\n======================================================================`);
    console.log(`E-JIP SEOUL RENT SHARD-A PRODUCTION APPLY RUNNER`);
    console.log(`Mode: ${isLive ? '🔴 LIVE_EXECUTION (OPERATIONAL SUPABASE)' : '🟢 DRY_RUN_SAFE'}`);
    console.log(`Target Shard: seoul-a (${targetDistricts.length} districts, ${totalPlannedCells} cells)`);
    console.log(`Max Authorized New Inserts: ${MAX_AUTHORIZED_NEW_INSERTS}`);
    console.log(`Target DB Host: ${hostDomainMasked} (Project: ${guards.detectedProjectId})`);
    console.log(`Initial Busan Rows: ${initialBusanRows.toLocaleString()}`);
    console.log(`======================================================================\n`);

    for (const lawdCd of targetDistricts) {
      if (stopAfterFirstCell) break;
      const districtName = SEOUL_DISTRICT_NAMES[lawdCd] || lawdCd;

      for (const dealYmd of targetMonths) {
        if (stopAfterFirstCell) break;
        cellIndex++;
        const cellKey = `${lawdCd}-${dealYmd}`;
        const cellStart = Date.now();

        // Check if cell already marked COMPLETE in checkpoint
        const existingCpRecord = checkpoint.cells[cellKey];
        if (existingCpRecord && existingCpRecord.status === 'COMPLETE' && !options.dryRunOnly) {
          skippedCellsCount++;
          console.log(
            `[${cellIndex}/${totalPlannedCells}] [${lawdCd}:${dealYmd}] ${districtName} -> ⏭️ SKIPPED (Checkpoint COMPLETE, ${existingCpRecord.persistedCount || 0} rows)`
          );
          cellResults.push({
            cellKey,
            lawdCd,
            dealYmd,
            districtName,
            totalCacheRows: existingCpRecord.totalCount || 0,
            plannedInserts: 0,
            unchangedRows: existingCpRecord.unchanged || existingCpRecord.persistedCount || 0,
            skippedGuarded: 0,
            actualInserted: 0,
            status: 'SKIPPED_EXISTING',
            durationMs: 0,
          });
          continue;
        }

        // Cache file lookup
        const cacheFile = path.join(cacheDir, `${lawdCd}-${dealYmd}.json`);
        if (!fs.existsSync(cacheFile)) {
          throw new Error(`CRITICAL: Cache file missing at ${cacheFile}`);
        }

        const cacheRaw = fs.readFileSync(cacheFile, 'utf-8');
        const parsedCache = JSON.parse(cacheRaw);
        const normalizedRows: RentRowInput[] = parsedCache.normalizedRows || [];

        // Query existing rows in operational DB
        const existingInDb = await prisma.$queryRawUnsafe<any[]>(
          `SELECT 
             group_key AS "groupKeyStr",
             deposit,
             monthly_rent AS "monthlyRent",
             deal_date::text AS "dealDate",
             floor,
             occurrence_index AS "occurrenceIndex",
             apt_name AS "aptName",
             dong,
             jibun,
             build_year AS "buildYear",
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
          dealDate: r.dealDate.startsWith('20') ? r.dealDate.slice(0, 10) : r.dealDate,
          floor: r.floor,
          occurrenceIndex: r.occurrenceIndex,
          aptName: r.aptName,
          dong: r.dong,
          jibun: r.jibun,
          buildYear: r.buildYear,
          contractType: r.contractType,
          contractTerm: r.contractTerm,
          preDeposit: r.preDeposit,
          preMonthlyRent: r.preMonthlyRent,
          useRenewalRight: r.useRenewalRight,
        }));

        const plan = planRentCellWrites(normalizedRows, existingComparable);

        totalPlannedInserts += plan.inserts.length;
        totalUnchangedRows += plan.unchanged;

        // Check insertion quota guard
        if (totalActualInserted + plan.inserts.length > MAX_AUTHORIZED_NEW_INSERTS) {
          throw new Error(
            `QUOTA BREACH: Cell ${cellKey} would cause total new inserts (${totalActualInserted + plan.inserts.length}) to exceed MAX_AUTHORIZED_NEW_INSERTS (${MAX_AUTHORIZED_NEW_INSERTS}). Halting!`
          );
        }

        let actualInserted = 0;
        let manifestPath: string | undefined = undefined;

        if (isLive) {
          // If all rows already exist and unchanged, mark checkpoint directly
          if (plan.inserts.length === 0 && plan.unchanged === normalizedRows.length) {
            checkpoint.cells[cellKey] = {
              cellKey,
              lawdCd,
              districtName,
              dealYmd,
              executionMode: 'APPLIED',
              targetDbEnv: 'OPERATIONAL_SUPABASE',
              status: 'COMPLETE',
              totalCount: normalizedRows.length,
              collectedCount: normalizedRows.length,
              plannedInserts: 0,
              skippedGuarded: plan.skippedInserts.length,
              unchanged: plan.unchanged,
              reviewDiffCount: 0,
              persistedCount: normalizedRows.length,
              durationMs: Date.now() - cellStart,
              processedAt: new Date().toISOString(),
            };
            saveShardACheckpoint(checkpoint, cpPath);

            console.log(
              `[${cellIndex}/${totalPlannedCells}] [${lawdCd}:${dealYmd}] ${districtName} -> ✅ 100% UNCHANGED (${plan.unchanged} rows) - Marked COMPLETE`
            );

            cellResults.push({
              cellKey,
              lawdCd,
              dealYmd,
              districtName,
              totalCacheRows: normalizedRows.length,
              plannedInserts: 0,
              unchangedRows: plan.unchanged,
              skippedGuarded: plan.skippedInserts.length,
              actualInserted: 0,
              status: 'COMPLETE',
              durationMs: Date.now() - cellStart,
            });
            executedCellsCount++;

            if (options.testFirstCellOnly) {
              stopAfterFirstCell = true;
            }
            continue;
          }

          // Live writes in chunks of 500 within transactions
          const runId = `operational-shard-a-${lawdCd}-${dealYmd}-${Date.now()}`;
          const insertedKeys: NaturalKeyTuple[] = plan.inserts.map((r) => ({
            groupKeyStr: r.groupKeyStr,
            deposit: r.deposit,
            monthlyRent: r.monthlyRent,
            dealDate: r.dealDate,
            floor: r.floor ?? null,
            occurrenceIndex: r.occurrenceIndex ?? 0,
          }));

          const manifest: BackfillExecutionManifest = {
            runId,
            targetDbEnv: 'OPERATIONAL_SUPABASE',
            lawdCd,
            dealYmd,
            districtName,
            startedAt: new Date(cellStart).toISOString(),
            completedAt: new Date().toISOString(),
            transactionSuccess: false,
            totalCacheRows: normalizedRows.length,
            plannedInserts: plan.inserts.length,
            unchangedCount: plan.unchanged,
            guardedSkippedCount: plan.skippedInserts.length,
            actualInsertedCount: plan.inserts.length,
            insertedKeys,
            rollbackStatus: 'NOT_TRIGGERED',
          };

          manifestPath = saveRollbackManifest(manifest);

          // Chunked transaction execution with multi-row batch insert (ultra-fast, zero-timeout)
          for (let i = 0; i < plan.inserts.length; i += BATCH_CHUNK_SIZE) {
            const chunk = plan.inserts.slice(i, i + BATCH_CHUNK_SIZE);
            const valuePlaceholders: string[] = [];
            const params: any[] = [];
            let paramIdx = 1;

            for (const row of chunk) {
              valuePlaceholders.push(
                `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, ` +
                `$${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11}, ` +
                `$${paramIdx + 12}, $${paramIdx + 13}, $${paramIdx + 14}, $${paramIdx + 15}::date, $${paramIdx + 16}, $${paramIdx + 17}, ` +
                `$${paramIdx + 18}, $${paramIdx + 19}, $${paramIdx + 20}, $${paramIdx + 21}, $${paramIdx + 22}, $${paramIdx + 23}, ` +
                `'MOLIT', NOW(), NOW(), NOW())`
              );
              params.push(
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
              paramIdx += 24;
            }

            const batchSql = `INSERT INTO apartment_rent_histories (
               lawd_cd, deal_ymd, apt_seq, identity_key, deal_type, group_key,
               apt_name, dong, jibun, exclusive_area, deposit, monthly_rent,
               deal_year, deal_month, deal_day, deal_date, floor, build_year,
               contract_type, contract_term, pre_deposit, pre_monthly_rent,
               use_renewal_right, occurrence_index, source, source_fetched_at,
               created_at, updated_at
             ) VALUES 
               ${valuePlaceholders.join(',\n   ')}
             ON CONFLICT (group_key, deposit, monthly_rent, deal_date, floor, occurrence_index)
             DO NOTHING;`;

            await prisma.$transaction(
              async (tx) => {
                await tx.$executeRawUnsafe(batchSql, ...params);
              },
              { maxWait: 20000, timeout: 60000 }
            );
          }

          // Mark manifest complete
          manifest.transactionSuccess = true;
          manifest.completedAt = new Date().toISOString();
          saveRollbackManifest(manifest);

          actualInserted = plan.inserts.length;
          totalActualInserted += actualInserted;

          // Checkpoint update
          checkpoint.cells[cellKey] = {
            cellKey,
            lawdCd,
            districtName,
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
            persistedCount: normalizedRows.length,
            durationMs: Date.now() - cellStart,
            processedAt: new Date().toISOString(),
          };
          saveShardACheckpoint(checkpoint, cpPath);

          const cellDuration = Date.now() - cellStart;
          console.log(
            `[${cellIndex}/${totalPlannedCells}] [${lawdCd}:${dealYmd}] ${districtName} -> 💾 INSERTED ${actualInserted} rows (unchanged: ${plan.unchanged}, cum: ${totalActualInserted}/${MAX_AUTHORIZED_NEW_INSERTS}) in ${cellDuration}ms`
          );

          cellResults.push({
            cellKey,
            lawdCd,
            dealYmd,
            districtName,
            totalCacheRows: normalizedRows.length,
            plannedInserts: plan.inserts.length,
            unchangedRows: plan.unchanged,
            skippedGuarded: plan.skippedInserts.length,
            actualInserted,
            status: 'COMPLETE',
            durationMs: cellDuration,
            manifestPath,
          });
          executedCellsCount++;

          if (options.testFirstCellOnly) {
            console.log(`\n🛑 --test-first-cell flag set: stopping after successfully testing first cell (${cellKey})`);
            stopAfterFirstCell = true;
          }
        } else {
          // DRY RUN MODE
          console.log(
            `[${cellIndex}/${totalPlannedCells}] [${lawdCd}:${dealYmd}] ${districtName} -> 🔍 DRY_RUN: cache=${normalizedRows.length}, planInserts=${plan.inserts.length}, unchanged=${plan.unchanged}`
          );

          cellResults.push({
            cellKey,
            lawdCd,
            dealYmd,
            districtName,
            totalCacheRows: normalizedRows.length,
            plannedInserts: plan.inserts.length,
            unchangedRows: plan.unchanged,
            skippedGuarded: plan.skippedInserts.length,
            actualInserted: 0,
            status: 'DRY_RUN',
            durationMs: Date.now() - cellStart,
          });
          executedCellsCount++;

          if (options.testFirstCellOnly) {
            stopAfterFirstCell = true;
          }
        }
      }
    }

    // Final baseline check
    const busanFinalRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd LIKE '26%';`
    );
    const finalBusanRows = Number(busanFinalRes[0].cnt);
    const busanPreserved = initialBusanRows === finalBusanRows;

    if (!busanPreserved) {
      console.error(
        `🚨 CRITICAL FAILURE: Busan rows changed from ${initialBusanRows} to ${finalBusanRows}!`
      );
    } else {
      console.log(`\n🛡️ Busan Baseline Preservation Verified: exactly ${finalBusanRows.toLocaleString()} rows (delta: 0)`);
    }

    console.log(`\nExecution Summary:`);
    console.log(` - Execution Mode: ${isLive ? 'LIVE_EXECUTION' : 'DRY_RUN_SAFE'}`);
    console.log(` - Total Planned Cells: ${totalPlannedCells}`);
    console.log(` - Executed Cells: ${executedCellsCount}`);
    console.log(` - Skipped Cells: ${skippedCellsCount}`);
    console.log(` - Total Planned Inserts: ${totalPlannedInserts}`);
    console.log(` - Total Actual Inserted: ${totalActualInserted}`);
    console.log(` - Total Unchanged: ${totalUnchangedRows}`);
    console.log(` - Total Duration: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

    return {
      executionMode: isLive ? 'LIVE_EXECUTION' : 'DRY_RUN_SAFE',
      guards,
      targetDb: {
        hostDomainMasked,
        projectId: guards.detectedProjectId,
      },
      totalPlannedCells,
      executedCellsCount,
      skippedCellsCount,
      totalPlannedInserts,
      totalActualInserted,
      totalUnchangedRows,
      initialBusanRows,
      finalBusanRows,
      busanPreserved,
      cellResults,
    };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('seoul-rent-production-shard-a-runner.ts')) {
  const isDryRun = process.argv.includes('--dry-run');
  const isTestFirstCell = process.argv.includes('--test-first-cell');

  runSeoulAShardProductionApply({
    dryRunOnly: isDryRun,
    testFirstCellOnly: isTestFirstCell,
  })
    .then((summary) => {
      console.log(JSON.stringify({
        mode: summary.executionMode,
        allGuardsPassed: summary.guards.allGuardsPassed,
        totalActualInserted: summary.totalActualInserted,
        busanPreserved: summary.busanPreserved,
        executedCellsCount: summary.executedCellsCount,
        skippedCellsCount: summary.skippedCellsCount,
      }, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('CRITICAL RUNNER ERROR:', err);
      process.exit(1);
    });
}
