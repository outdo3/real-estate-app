/**
 * SUPABASE_DATA_API_DISABLE_V1 — Data API 노출 before/after 확인 (STRICT READ ONLY).
 *
 * 출력은 HTTP status, 개수, boolean뿐이다. 키·토큰·행 값은 절대 출력하지 않는다.
 * DB write 0, Storage write 0. Data API에는 행 데이터를 요청하지 않는다(OpenAPI 루트와
 * 존재하지 않는 경로, limit=0 HEAD 수준만).
 *
 * 실행:
 *   ALLOW_PROD_DB_READ=1 npx tsx scripts/audit-supabase-data-api-exposure.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });

import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';

async function status(url: string, init?: RequestInit): Promise<{ code: number; body: string }> {
  try {
    const r = await fetch(url, init);
    return { code: r.status, body: await r.text() };
  } catch (e) {
    return { code: -1, body: (e as Error).message };
  }
}

async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'audit-supabase-data-api-exposure');
  const base = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serverKey = process.env.SUPABASE_KEY || '';
  if (!base || !serverKey) throw new Error('SUPABASE_URL / SUPABASE_KEY 이름의 env가 필요하다(값은 출력하지 않음)');
  const serverHeaders = { apikey: serverKey, Authorization: `Bearer ${serverKey}` };

  console.log(`# SUPABASE DATA API EXPOSURE CHECK ${new Date().toISOString()}`);

  // 1) Data API — 키 없음(게이트웨이 단계)
  const noKey = await status(`${base}/rest/v1/`);
  console.log(`data-api root, no key            HTTP ${noKey.code}`);

  // 2) Data API — 서버 키로 OpenAPI 루트. 활성이면 200 + 노출 경로 목록.
  const root = await status(`${base}/rest/v1/`, { headers: serverHeaders });
  let exposed = 0;
  let sensitive = { accounts: false, sessions: false, users: false };
  try {
    const paths = Object.keys(JSON.parse(root.body).paths || {});
    exposed = paths.filter((p) => p !== '/').length;
    sensitive = { accounts: paths.includes('/accounts'), sessions: paths.includes('/sessions'), users: paths.includes('/users') };
  } catch { /* 비활성 시 JSON 아님/에러 */ }
  console.log(`data-api root, server key        HTTP ${root.code}  exposed-paths=${exposed}  accounts=${sensitive.accounts} sessions=${sensitive.sessions} users=${sensitive.users}`);

  // 3) Data API — 민감 테이블 경로, 행 0개 요청(HEAD, limit=0). 값은 받지 않는다.
  for (const t of ['accounts', 'sessions', 'users']) {
    const r = await status(`${base}/rest/v1/${t}?select=id&limit=0`, { method: 'HEAD', headers: serverHeaders });
    console.log(`data-api /${t} HEAD limit=0      HTTP ${r.code}`);
  }

  // 4) Storage API — Data API와 별개 서비스인지(변경 후에도 200이어야 함)
  const buckets = await status(`${base}/storage/v1/bucket`, { headers: serverHeaders });
  let bucketCount: number | string = '?';
  try { const j = JSON.parse(buckets.body); bucketCount = Array.isArray(j) ? j.length : 'non-array'; } catch { /* */ }
  console.log(`storage bucket list, server key  HTTP ${buckets.code}  buckets=${bucketCount}`);

  // 5) Prisma(직접 Postgres) — read-only
  const prisma = new PrismaClient();
  try {
    const t0 = Date.now();
    const [one, posts, masters] = await Promise.all([
      prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`,
      prisma.post.count(),
      prisma.apartmentMaster.count(),
    ]);
    console.log(`prisma direct postgres           ok=${one[0].ok === 1} posts=${posts} apartmentMasters=${masters} ${Date.now() - t0}ms`);
    // 권한 구조(변경하지 않음 — 기록만): anon이 SELECT 가능한 public 테이블 수
    const g = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT table_name) n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND grantee='anon' AND privilege_type='SELECT'`;
    console.log(`public tables with anon SELECT grant (unchanged by this step): ${Number(g[0].n)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error('check failed:', (e as Error).message); process.exitCode = 1; });
