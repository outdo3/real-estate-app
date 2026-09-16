/**
 * MOLIT_LIVE_PAGING_FIX_V1 §17 — 배포 후 오류 추이 read-only 확인.
 * SET TRANSACTION READ ONLY. write 0. 외부 API 0.
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/qa-molit-paging-errorlog.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
const prisma = new PrismaClient();
const KIND = `CASE
  WHEN message ~* '초당|요청제한|PER_SECOND|LIMITED_NUMBER' THEN 'RATE_LIMIT'
  WHEN message ~* 'timeout|timed out|aborted|TimeoutError' THEN 'TIMEOUT'
  WHEN message ~* '불완전|절단 가능' THEN 'PAGING_PARTIAL'
  WHEN message ~* 'API 에러|공공데이터|MOLIT' THEN 'MOLIT_OTHER'
  ELSE 'NON_MOLIT' END`;
async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'qa-molit-paging-errorlog.ts');
  const out: Record<string, unknown> = {};
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");
    out.last_2h = await tx.$queryRawUnsafe(`SELECT ${KIND} AS kind, COUNT(*)::int AS n, MAX(created_at) AS latest FROM error_logs WHERE created_at >= NOW() - INTERVAL '2 hours' GROUP BY 1 ORDER BY n DESC`);
    out.last_24h = await tx.$queryRawUnsafe(`SELECT ${KIND} AS kind, COUNT(*)::int AS n, MAX(created_at) AS latest FROM error_logs WHERE created_at >= NOW() - INTERVAL '24 hours' GROUP BY 1 ORDER BY n DESC`);
    out.last_7d_daily = await tx.$queryRawUnsafe(`SELECT DATE(created_at) AS day, COUNT(*)::int AS n FROM error_logs WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY 1 ORDER BY 1 DESC`);
    out.newest = await tx.$queryRawUnsafe(`SELECT created_at, LEFT(message, 110) AS msg FROM error_logs ORDER BY created_at DESC LIMIT 5`);
  }, { timeout: 120_000 });
  console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
}
main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); }).finally(() => prisma.$disconnect());
