/**
 * E-JIP 서울 V3.9-B — 외과적 정밀 롤백 (Surgical Rollback) 관리 모듈
 *
 * 핵심 개선 사항:
 * - 포괄적 DELETE(lawd_cd LIKE '11%')를 일절 사용하지 않음
 * - 개별 실행(Backfill / Pilot) 단위의 고유 runId 부여
 * - 실제 신규 INSERT된 거래의 자연키 목록을 영속화 매니페스트로 보존
 * - 롤백 시 매니페스트에 기록된 정확한 자연키 튜플만 타겟팅하여 원자적 제거
 * - 기존 unchanged 거래 및 부산(26xxx) 데이터는 100% 무영향 보장
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { RentRowInput } from '../rent-trade-history/rent-history-logic';
import { rentNaturalKeyStr } from '../rent-trade-history/rent-group-guard-logic';

export interface NaturalKeyTuple {
  groupKeyStr: string;
  deposit: number;
  monthlyRent: number;
  dealDate: string; // YYYY-MM-DD
  floor: number | null;
  occurrenceIndex: number;
}

export interface BackfillExecutionManifest {
  runId: string;
  targetDbEnv: 'LOCAL_DOCKER_QA' | 'OPERATIONAL_SUPABASE';
  lawdCd: string;
  dealYmd: string;
  districtName: string;
  startedAt: string;
  completedAt?: string;
  transactionSuccess: boolean;
  totalCacheRows: number;
  plannedInserts: number;
  unchangedCount: number;
  guardedSkippedCount: number;
  actualInsertedCount: number;
  insertedKeys: NaturalKeyTuple[];
  rollbackStatus: 'NOT_TRIGGERED' | 'ROLLED_BACK' | 'FAILED';
  rolledBackAt?: string;
}

export const MANIFESTS_DIR = path.resolve(process.cwd(), 'tmp/qa-seoul-rent/rollback-manifests');

/**
 * 롤백 매니페스트 저장
 */
export function saveRollbackManifest(manifest: BackfillExecutionManifest): string {
  if (!fs.existsSync(MANIFESTS_DIR)) {
    fs.mkdirSync(MANIFESTS_DIR, { recursive: true });
  }
  const filePath = path.join(MANIFESTS_DIR, `${manifest.runId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
  return filePath;
}

/**
 * 롤백 매니페스트 로드
 */
export function loadRollbackManifest(runId: string): BackfillExecutionManifest {
  const filePath = path.join(MANIFESTS_DIR, `${runId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Rollback manifest not found for runId: ${runId} at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * 정밀 롤백 SQL 생성 (외과적 정밀 타겟팅)
 */
export function generateSurgicalRollbackSql(manifest: BackfillExecutionManifest): string {
  if (manifest.insertedKeys.length === 0) {
    return '-- No keys to rollback in this manifest';
  }

  const valuesClauses = manifest.insertedKeys.map((k) => {
    const floorVal = k.floor === null ? 'NULL::integer' : `${k.floor}::integer`;
    const escapedGroupKey = k.groupKeyStr.replace(/'/g, "''");
    return `('${escapedGroupKey}', ${k.deposit}, ${k.monthlyRent}, '${k.dealDate}'::date, ${floorVal}, ${k.occurrenceIndex})`;
  }).join(',\n      ');

  return `-- ==============================================================================
-- E-JIP SURGICAL ROLLBACK SCRIPT
-- Run ID: ${manifest.runId}
-- Cell: ${manifest.lawdCd}:${manifest.dealYmd} (${manifest.districtName})
-- Target Exact Keys Count: ${manifest.insertedKeys.length}
-- ==============================================================================

BEGIN;

-- 1. 삭제 전 매칭 대상 행수 확인
DO $$
DECLARE
  v_match_count bigint;
BEGIN
  SELECT count(*) INTO v_match_count
  FROM apartment_rent_histories h
  JOIN (
    VALUES
      ${valuesClauses}
  ) AS t(g_key, dep, m_rent, d_date, flr, occ_idx)
  ON h.group_key = t.g_key
 AND h.deposit = t.dep
 AND h.monthly_rent = t.m_rent
 AND h.deal_date = t.d_date
 AND (h.floor IS NOT DISTINCT FROM t.flr)
 AND h.occurrence_index = t.occ_idx
 WHERE h.lawd_cd = '${manifest.lawdCd}' AND h.deal_ymd = '${manifest.dealYmd}';

  RAISE NOTICE 'Rollback Pre-check: Target Matching Rows = % (Expected: ${manifest.insertedKeys.length})', v_match_count;
END $$;

-- 2. 외과적 정밀 삭제 (오직 이 실행에서 생성된 자연키만 삭제)
DELETE FROM apartment_rent_histories h
USING (
  VALUES
    ${valuesClauses}
) AS t(g_key, dep, m_rent, d_date, flr, occ_idx)
WHERE h.group_key = t.g_key
  AND h.deposit = t.dep
  AND h.monthly_rent = t.m_rent
  AND h.deal_date = t.d_date
  AND (h.floor IS NOT DISTINCT FROM t.flr)
  AND h.occurrence_index = t.occ_idx
  AND h.lawd_cd = '${manifest.lawdCd}'
  AND h.deal_ymd = '${manifest.dealYmd}';

COMMIT;
`;
}

/**
 * 정밀 롤백 실행 (Prisma 트랜잭션 기반)
 */
export async function executeSurgicalRollback(
  manifest: BackfillExecutionManifest,
  prisma: PrismaClient
): Promise<{ deletedCount: number; durationMs: number }> {
  const startTime = Date.now();
  if (manifest.insertedKeys.length === 0) {
    return { deletedCount: 0, durationMs: 0 };
  }

  let totalDeleted = 0;
  // 청크 단위(500건 이하)로 원자적 삭제 실행
  const CHUNK_SIZE = 500;
  for (let i = 0; i < manifest.insertedKeys.length; i += CHUNK_SIZE) {
    const chunk = manifest.insertedKeys.slice(i, i + CHUNK_SIZE);
    const subManifest: BackfillExecutionManifest = {
      ...manifest,
      insertedKeys: chunk,
    };
    const sql = generateSurgicalRollbackSql(subManifest);

    await prisma.$transaction(async (tx) => {
      // Chunk delete using VALUES clause
      for (const k of chunk) {
        const deleted = await tx.$executeRawUnsafe(
          `DELETE FROM apartment_rent_histories
           WHERE lawd_cd = $1
             AND deal_ymd = $2
             AND group_key = $3
             AND deposit = $4
             AND monthly_rent = $5
             AND deal_date = $6::date
             AND (floor IS NOT DISTINCT FROM $7)
             AND occurrence_index = $8;`,
          manifest.lawdCd,
          manifest.dealYmd,
          k.groupKeyStr,
          k.deposit,
          k.monthlyRent,
          k.dealDate,
          k.floor ?? null,
          k.occurrenceIndex
        );
        totalDeleted += deleted;
      }
    });
  }

  manifest.rollbackStatus = 'ROLLED_BACK';
  manifest.rolledBackAt = new Date().toISOString();
  saveRollbackManifest(manifest);

  return {
    deletedCount: totalDeleted,
    durationMs: Date.now() - startTime,
  };
}
