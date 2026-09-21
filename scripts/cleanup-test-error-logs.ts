/**
 * TEST_DATABASE_SAFETY_GUARD_V1 §1/§2 — ADMIN_ERROR_LOGGING_P1_V1 테스트가 실수로
 * Production `error_logs`에 남긴 **가짜 테스트 로그 4행**만 제거한다.
 *
 * 기본은 dry-run이다. 실제 삭제는 `--apply` + `APPROVE_TEST_LOG_CLEANUP=1` 둘 다 필요하다.
 *
 * 안전 설계
 *  - 대상 id를 **하드코딩**한다(범위 삭제·조건 삭제 없음).
 *  - 삭제 전에 각 행이 **문서화된 테스트 메시지와 정확히 일치**하는지 확인한다.
 *    하나라도 다르면 쓰지 않고 중단한다 — 그 사이 같은 id에 진짜 오류가 들어왔을 수 있다.
 *  - 단일 트랜잭션. affected rows가 정확히 4가 아니면 롤백한다.
 *  - 삭제 전 스냅샷을 파일로 남긴다(복구 자료).
 *  - error_logs 외 어떤 테이블도 건드리지 않는다.
 *
 *   dry-run: ALLOW_PROD_DB_READ=1 npx tsx scripts/cleanup-test-error-logs.ts
 *   apply:   ALLOW_PROD_DB_READ=1 ALLOW_PROD_DB_WRITE=1 APPROVE_TEST_LOG_CLEANUP=1 \
 *            npx tsx scripts/cleanup-test-error-logs.ts --apply
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';

const prisma = new PrismaClient();

/** 삭제 대상 — ADMIN_ERROR_LOGGING_P1_V1 §14가 기록한 4행. */
const TARGET_IDS = [125, 126, 127, 128] as const;

/** 각 id가 반드시 가져야 하는 값. 하나라도 다르면 삭제하지 않는다. */
const EXPECTED: Record<number, { source: string; message: string; url: string }> = {
  125: { source: 'server', message: '[ADMIN_OPS_FAILURE][Error] db down', url: '/api/admin/ops' },
  126: { source: 'server', message: '[ADMIN_DASHBOARD_FAILURE][Error] x', url: '/api/admin/dashboard' },
  127: { source: 'server', message: '[ADMIN_OPS_FAILURE][Error] db down', url: '/api/admin/ops' },
  128: { source: 'server', message: '[ADMIN_DASHBOARD_FAILURE][Error] x', url: '/api/admin/dashboard' },
};

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && process.env.APPROVE_TEST_LOG_CLEANUP !== '1') {
    throw new Error('apply에는 APPROVE_TEST_LOG_CLEANUP=1 이 필요하다 — 승인 없이 지우지 않는다.');
  }
  assertProductionDbAccessAllowed(apply ? 'BACKFILL' : 'DIAGNOSTIC', 'cleanup-test-error-logs.ts');

  const before = await prisma.errorLog.findMany({
    where: { id: { in: [...TARGET_IDS] } },
    select: { id: true, source: true, message: true, url: true, createdAt: true },
    orderBy: { id: 'asc' },
  });
  const totalBefore = await prisma.errorLog.count();

  const mismatches: string[] = [];
  for (const id of TARGET_IDS) {
    const row = before.find((r) => r.id === id);
    if (!row) { mismatches.push(`id ${id}: 존재하지 않음`); continue; }
    const want = EXPECTED[id];
    if (row.source !== want.source) mismatches.push(`id ${id}: source ${row.source} != ${want.source}`);
    if (row.message !== want.message) mismatches.push(`id ${id}: message 불일치`);
    if (row.url !== want.url) mismatches.push(`id ${id}: url ${row.url} != ${want.url}`);
  }

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN',
    totalBefore,
    found: before.length,
    expected: TARGET_IDS.length,
    rows: before.map((r) => ({ id: r.id, source: r.source, message: r.message, url: r.url, createdAt: r.createdAt })),
    mismatches,
  }, null, 2));

  if (before.length !== TARGET_IDS.length || mismatches.length > 0) {
    throw new Error(`PRECHECK FAILED — 예상과 다르다(found=${before.length}, mismatches=${mismatches.length}). 아무것도 지우지 않는다.`);
  }
  if (!apply) { console.log('\nDRY RUN 종료 — 아무것도 쓰지 않았다.'); return; }

  const outDir = path.resolve(__dirname, '../tmp/test-error-log-cleanup');
  fs.mkdirSync(outDir, { recursive: true });
  const snapshot = path.join(outDir, `deleted-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(snapshot, JSON.stringify({ takenAt: new Date().toISOString(), totalBefore, rows: before }, null, 2));
  console.log(`\n스냅샷: ${snapshot}`);

  const deleted = await prisma.$transaction(async (tx) => {
    const res = await tx.errorLog.deleteMany({ where: { id: { in: [...TARGET_IDS] } } });
    if (res.count !== TARGET_IDS.length) {
      throw new Error(`DELETE MISMATCH: 예상 ${TARGET_IDS.length} ≠ 실제 ${res.count} — 롤백`);
    }
    return res.count;
  });

  const totalAfter = await prisma.errorLog.count();
  const remaining = await prisma.errorLog.count({ where: { id: { in: [...TARGET_IDS] } } });
  console.log(JSON.stringify({ deleted, totalBefore, totalAfter, delta: totalAfter - totalBefore, remainingTargets: remaining }, null, 2));
}

main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); }).finally(() => prisma.$disconnect());
