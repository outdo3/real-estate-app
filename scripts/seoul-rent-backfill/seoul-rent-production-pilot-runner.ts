/**
 * E-JIP 서울 V3.9-C — 종로구 202610 전월세 140건 운영 Supabase 전용 시범 적재 실행기
 *
 * 엄격한 운영 안전 제약:
 * 1. 대상 단일 셀 영구 고정: lawdCd = '11110' (종로구), dealYmd = '202610'
 * 2. 신규 INSERT 상한: 최대 140건 (초과 시 즉각 실행 차단)
 * 3. 서울 전체(240,856건) 또는 타 샤드 실행 원천 불가능하도록 구조적 격리
 * 4. 5중 안전 가드:
 *    - Guard 1: ALLOW_PRODUCTION_WRITE === 'true'
 *    - Guard 2: CLI 인자 --confirm-production-write
 *    - Guard 3: PRODUCTION_CONFIRMATION_PASSPHRASE === 'CONFIRM_APPLY_SEOUL_RENT_2026'
 *    - Guard 4: Supabase Project ID 일치 ('ztlnagzmwksgjkappfyh')
 *    - Guard 5: Pilot Cell Scope Lockdown (11110:202610, max 140 rows)
 * 5. 외부 MOLIT API 호출 0회 (로컬 캐시 tmp/qa-seoul-rent/seoul-a-cache/11110-202610.json 만 소비)
 * 6. 단일 원자적 트랜잭션 (140건 일괄 트랜잭션, 실패 시 전원 롤백)
 * 7. 사전 외과적 정밀 롤백 매니페스트 생성 및 영속화
 * 8. 사후 읽기 전용 정합성 검증 (종로 140건 / 전세 55 / 월세 85 / 부산 134,475건 불변 / 타 서울 0건)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { RentRowInput } from '../rent-trade-history/rent-history-logic';
import { planRentCellWrites, RentComparableRow } from '../rent-trade-history/rent-group-guard-logic';
import {
  NaturalKeyTuple,
  BackfillExecutionManifest,
  saveRollbackManifest,
} from './seoul-rent-surgical-rollback';
import { CheckpointData } from './seoul-rent-backfill-engine';

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

export const PILOT_TARGET = {
  lawdCd: '11110',
  dealYmd: '202610',
  districtName: '종로구',
  expectedCount: 140,
  expectedJeonse: 55,
  expectedWolse: 85,
  expectedSha256: '366c1c028f74c27df0162c4df19e4cb71061016d776af597fe9db52e7e01af30',
};

export const EXPECTED_OPERATIONAL_PROJECT_ID = 'ztlnagzmwksgjkappfyh';
export const REQUIRED_CONFIRMATION_PASSPHRASE = 'CONFIRM_APPLY_SEOUL_RENT_2026';
export const PILOT_CHECKPOINT_PATH = path.resolve(
  process.cwd(),
  'tmp/qa-seoul-rent/seoul-production-pilot-checkpoint.json'
);

export interface PilotWriteGuards {
  allowProductionWriteEnv: boolean;
  cliArgConfirmed: boolean;
  passphraseValid: boolean;
  projectIdMatched: boolean;
  scopeLockedToPilot: boolean;
  detectedProjectId: string | null;
  allGuardsPassed: boolean;
}

export interface PilotExecutionResult {
  executionMode: 'DRY_RUN_SAFE' | 'LIVE_EXECUTION';
  guards: PilotWriteGuards;
  targetDb: {
    hostDomainMasked: string;
    projectId: string | null;
  };
  pilotCell: {
    lawdCd: string;
    dealYmd: string;
    districtName: string;
  };
  cacheIntegrity: {
    cachePath: string;
    cacheSha256: string;
    shaMatched: boolean;
    totalRows: number;
    jeonseRows: number;
    wolseRows: number;
    duplicateNaturalKeys: number;
  };
  preflightDbState: {
    pilotCellExistingRows: number;
    totalSeoulExistingRows: number;
    busanBaselineRows: number;
  };
  planSummary: {
    plannedInserts: number;
    unchangedRows: number;
    guardedSkipped: number;
  };
  executionOutcome?: {
    insertedCount: number;
    durationMs: number;
    manifestRunId: string;
    manifestPath: string;
  };
  postVerification?: {
    pilotCellTotalRows: number;
    pilotCellJeonseRows: number;
    pilotCellWolseRows: number;
    pilotCellDuplicatesInDb: number;
    busanCurrentRows: number;
    busanRowsUnchanged: boolean;
    otherSeoulRows: number;
    otherSeoulRowsUnchanged: boolean;
    checkpointStatus: string;
    allPostChecksPassed: boolean;
  };
  error?: string;
}

/**
 * 5중 안전 가드 평가
 */
export function evaluatePilotGuards(argv: string[] = process.argv): PilotWriteGuards {
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
  const scopeLocked = true; // Hardcoded to pilot in this dedicated runner

  return {
    allowProductionWriteEnv: allowEnv,
    cliArgConfirmed: cliConfirmed,
    passphraseValid: passValid,
    projectIdMatched: projMatched,
    scopeLockedToPilot: scopeLocked,
    detectedProjectId,
    allGuardsPassed: allowEnv && cliConfirmed && passValid && projMatched && scopeLocked,
  };
}

/**
 * 조작 불가능한 단일 셀 캐시 경로
 */
export function getPilotCachePath(): string {
  return path.resolve(process.cwd(), `tmp/qa-seoul-rent/seoul-a-cache/${PILOT_TARGET.lawdCd}-${PILOT_TARGET.dealYmd}.json`);
}

/**
 * 종로구 202610 시범 적재 실행 함수 (Dry-Run / Live)
 */
export async function executeSeoulRentPilot(options: {
  dryRunOnly?: boolean;
  checkpointPath?: string;
} = {}): Promise<PilotExecutionResult> {
  const startTime = Date.now();
  const guards = evaluatePilotGuards();
  const isLive = !options.dryRunOnly && guards.allGuardsPassed;

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

  try {
    // 1. 캐시 무결성 검증
    const cachePath = getPilotCachePath();
    if (!fs.existsSync(cachePath)) {
      throw new Error(`CRITICAL: Pilot cache file not found at ${cachePath}`);
    }

    const rawCacheBuffer = fs.readFileSync(cachePath);
    const actualSha = crypto.createHash('sha256').update(rawCacheBuffer).digest('hex');
    const cacheContent = JSON.parse(rawCacheBuffer.toString('utf-8'));
    const normalizedRows: RentRowInput[] = cacheContent.normalizedRows || [];

    let jeonseCount = 0;
    let wolseCount = 0;
    const natKeySet = new Set<string>();
    let duplicateKeysCount = 0;

    for (const r of normalizedRows) {
      const dt = (r.dealType || '').toLowerCase();
      if (dt === 'jeonse') jeonseCount++;
      else if (dt === 'wolse') wolseCount++;
      const k = `${r.groupKeyStr}#${r.deposit}#${r.monthlyRent}#${r.dealDate}#${r.floor}#${r.occurrenceIndex}`;
      if (natKeySet.has(k)) duplicateKeysCount++;
      natKeySet.add(k);
    }

    if (normalizedRows.length !== PILOT_TARGET.expectedCount) {
      throw new Error(`CRITICAL: Pilot cache rows count mismatch. Expected ${PILOT_TARGET.expectedCount}, got ${normalizedRows.length}`);
    }
    if (jeonseCount !== PILOT_TARGET.expectedJeonse || wolseCount !== PILOT_TARGET.expectedWolse) {
      throw new Error(`CRITICAL: Deal type counts mismatch. Expected J=${PILOT_TARGET.expectedJeonse}/W=${PILOT_TARGET.expectedWolse}, got J=${jeonseCount}/W=${wolseCount}`);
    }
    if (duplicateKeysCount !== 0) {
      throw new Error(`CRITICAL: Duplicate natural keys detected in cache: ${duplicateKeysCount}`);
    }

    // 2. Pre-flight 운영 DB 상태 실측
    // 2.1 대상 셀 종로 202610 기존 데이터
    const cellRowsRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd = $1 AND deal_ymd = $2;`,
      PILOT_TARGET.lawdCd,
      PILOT_TARGET.dealYmd
    );
    const pilotCellExisting = Number(cellRowsRes[0].cnt);

    // 2.2 서울 전체 기존 데이터
    const seoulRowsRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd LIKE '11%';`
    );
    const totalSeoulExisting = Number(seoulRowsRes[0].cnt);

    // 2.3 부산 기존 데이터 기준선
    const busanRowsRes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd LIKE '26%';`
    );
    const busanBaseline = Number(busanRowsRes[0].cnt);

    if (pilotCellExisting > 0 && pilotCellExisting !== PILOT_TARGET.expectedCount) {
      throw new Error(`SAFETY STOP: Unexpected partial data exists in pilot cell ${PILOT_TARGET.lawdCd}:${PILOT_TARGET.dealYmd} (${pilotCellExisting} rows, expected 0 or ${PILOT_TARGET.expectedCount}). Aborting to prevent collision.`);
    }

    // 3. 쓰기 계획 수립 (Option E 가드 적용)
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
      PILOT_TARGET.lawdCd,
      PILOT_TARGET.dealYmd
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

    if (plan.inserts.length > PILOT_TARGET.expectedCount) {
      throw new Error(`CRITICAL: Planned inserts (${plan.inserts.length}) exceeds authorized upper limit (${PILOT_TARGET.expectedCount}).`);
    }

    const result: PilotExecutionResult = {
      executionMode: isLive ? 'LIVE_EXECUTION' : 'DRY_RUN_SAFE',
      guards,
      targetDb: {
        hostDomainMasked,
        projectId: guards.detectedProjectId,
      },
      pilotCell: {
        lawdCd: PILOT_TARGET.lawdCd,
        dealYmd: PILOT_TARGET.dealYmd,
        districtName: PILOT_TARGET.districtName,
      },
      cacheIntegrity: {
        cachePath,
        cacheSha256: actualSha,
        shaMatched: actualSha === PILOT_TARGET.expectedSha256,
        totalRows: normalizedRows.length,
        jeonseRows: jeonseCount,
        wolseRows: wolseCount,
        duplicateNaturalKeys: duplicateKeysCount,
      },
      preflightDbState: {
        pilotCellExistingRows: pilotCellExisting,
        totalSeoulExistingRows: totalSeoulExisting,
        busanBaselineRows: busanBaseline,
      },
      planSummary: {
        plannedInserts: plan.inserts.length,
        unchangedRows: plan.unchanged,
        guardedSkipped: plan.skippedInserts.length,
      },
    };

    // 4. LIVE 쓰기 실행 (승인된 140건 단일 트랜잭션 적재)
    if (isLive) {
      const insertedKeys: NaturalKeyTuple[] = plan.inserts.map((r) => ({
        groupKeyStr: r.groupKeyStr,
        deposit: r.deposit,
        monthlyRent: r.monthlyRent,
        dealDate: r.dealDate,
        floor: r.floor ?? null,
        occurrenceIndex: r.occurrenceIndex ?? 0,
      }));

      const runId = `pilot-manifest-${PILOT_TARGET.lawdCd}-${PILOT_TARGET.dealYmd}-${Date.now()}`;
      const manifest: BackfillExecutionManifest = {
        runId,
        targetDbEnv: 'OPERATIONAL_SUPABASE',
        lawdCd: PILOT_TARGET.lawdCd,
        dealYmd: PILOT_TARGET.dealYmd,
        districtName: PILOT_TARGET.districtName,
        startedAt: new Date(startTime).toISOString(),
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

      // 4.1 사전 정밀 롤백 매니페스트 저장
      const savedManifestPath = saveRollbackManifest(manifest);

      // 4.2 단일 원자적 트랜잭션 적재 (140건)
      const txStart = Date.now();
      await prisma.$transaction(async (tx) => {
        for (const row of plan.inserts) {
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
      const txDuration = Date.now() - txStart;

      // 트랜잭션 성공 마킹 및 매니페스트 갱신
      manifest.transactionSuccess = true;
      manifest.completedAt = new Date().toISOString();
      saveRollbackManifest(manifest);

      result.executionOutcome = {
        insertedCount: plan.inserts.length,
        durationMs: txDuration,
        manifestRunId: runId,
        manifestPath: savedManifestPath,
      };

      // 4.3 체크포인트 기록 (오직 1개 셀만 COMPLETE)
      const cpPath = options.checkpointPath || PILOT_CHECKPOINT_PATH;
      const checkpoint: CheckpointData = {
        version: 1,
        scope: 'pilot-jongno-202610',
        fromYmd: '202610',
        toYmd: '202610',
        lastUpdated: new Date().toISOString(),
        totalCellCount: 1,
        completedCellCount: 1,
        environment: 'OPERATIONAL_SUPABASE',
        cells: {
          [`${PILOT_TARGET.lawdCd}-${PILOT_TARGET.dealYmd}`]: {
            cellKey: `${PILOT_TARGET.lawdCd}-${PILOT_TARGET.dealYmd}`,
            lawdCd: PILOT_TARGET.lawdCd,
            districtName: PILOT_TARGET.districtName,
            dealYmd: PILOT_TARGET.dealYmd,
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
            durationMs: txDuration,
            processedAt: new Date().toISOString(),
          },
        },
      };
      const cpDir = path.dirname(cpPath);
      if (!fs.existsSync(cpDir)) fs.mkdirSync(cpDir, { recursive: true });
      fs.writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2), 'utf-8');

      // 5. 사후 읽기 전용 정합성 검증
      // 5.1 종로구 202610 건수 및 전월세 분필
      const postCellRes = await prisma.$queryRawUnsafe<any[]>(
        `SELECT 
           count(*)::bigint AS total_cnt,
           count(*) FILTER (WHERE deal_type = 'jeonse')::bigint AS jeonse_cnt,
           count(*) FILTER (WHERE deal_type = 'wolse')::bigint AS wolse_cnt
         FROM apartment_rent_histories
         WHERE lawd_cd = $1 AND deal_ymd = $2;`,
        PILOT_TARGET.lawdCd,
        PILOT_TARGET.dealYmd
      );
      const postTotal = Number(postCellRes[0].total_cnt);
      const postJeonse = Number(postCellRes[0].jeonse_cnt);
      const postWolse = Number(postCellRes[0].wolse_cnt);

      // 5.2 자연키 중복 검증 in DB
      const dupRes = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*) - count(DISTINCT (group_key, deposit, monthly_rent, deal_date, floor, occurrence_index))::bigint AS dup_cnt
         FROM apartment_rent_histories
         WHERE lawd_cd = $1 AND deal_ymd = $2;`,
        PILOT_TARGET.lawdCd,
        PILOT_TARGET.dealYmd
      );
      const postDups = Number(dupRes[0].dup_cnt || 0);

      // 5.3 부산 데이터 기준선 불변 확인
      const postBusanRes = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories WHERE lawd_cd LIKE '26%';`
      );
      const postBusan = Number(postBusanRes[0].cnt);

      // 5.4 기타 서울 지역 데이터 0건 유지 확인
      const postOtherSeoulRes = await prisma.$queryRawUnsafe<any[]>(
        `SELECT count(*)::bigint AS cnt FROM apartment_rent_histories 
         WHERE lawd_cd LIKE '11%' AND (lawd_cd != $1 OR deal_ymd != $2);`,
        PILOT_TARGET.lawdCd,
        PILOT_TARGET.dealYmd
      );
      const postOtherSeoul = Number(postOtherSeoulRes[0].cnt);

      const allChecksOk =
        postTotal === PILOT_TARGET.expectedCount &&
        postJeonse === PILOT_TARGET.expectedJeonse &&
        postWolse === PILOT_TARGET.expectedWolse &&
        postDups === 0 &&
        postBusan === busanBaseline &&
        postOtherSeoul === 0;

      result.postVerification = {
        pilotCellTotalRows: postTotal,
        pilotCellJeonseRows: postJeonse,
        pilotCellWolseRows: postWolse,
        pilotCellDuplicatesInDb: postDups,
        busanCurrentRows: postBusan,
        busanRowsUnchanged: postBusan === busanBaseline,
        otherSeoulRows: postOtherSeoul,
        otherSeoulRowsUnchanged: postOtherSeoul === 0,
        checkpointStatus: 'COMPLETE (1 cell)',
        allPostChecksPassed: allChecksOk,
      };
    }

    return result;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

if (require.main === module || process.argv[1]?.endsWith('seoul-rent-production-pilot-runner.ts')) {
  executeSeoulRentPilot()
    .then((res) => {
      console.log('=== E-JIP JONGNO 202610 PRODUCTION PILOT REPORT ===');
      console.log(JSON.stringify(res, null, 2));
    })
    .catch((err) => {
      console.error('Pilot execution failed:', err);
      process.exit(1);
    });
}
