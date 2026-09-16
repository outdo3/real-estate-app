/** REGION_CONTEXT_PARAMETERIZATION_V1 §8 — parity 대상 단지 선정 (READ ONLY). */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
import { PrismaClient } from '@prisma/client';
import { assertProductionDbAccessAllowed } from './_prod-db-guard';
const prisma = new PrismaClient();
async function main() {
  assertProductionDbAccessAllowed('DIAGNOSTIC', 'qa-region-parity-pick.ts');
  const out: any[] = [];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    for (const sgg of ['26140', '26380', '26350', '26470']) {
      const rows = await tx.$queryRawUnsafe<any[]>(
        `SELECT m.apt_seq, m.name, m.sido, m.sigungu, m.umd_name, m.sgg_cd
         FROM apartment_masters m
         JOIN apartment_location_features f ON f.apt_seq = m.apt_seq
         WHERE m.sgg_cd = $1 AND m.apt_seq IS NOT NULL AND m.total_households IS NOT NULL
         ORDER BY m.total_households DESC LIMIT 2`, sgg);
      out.push(...rows);
    }
  }, { timeout: 120000 });
  console.log(JSON.stringify(out, null, 1));
}
main().catch(e=>{console.error(e.message);process.exit(1)}).finally(()=>prisma.$disconnect());
