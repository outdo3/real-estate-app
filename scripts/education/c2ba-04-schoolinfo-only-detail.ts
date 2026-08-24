import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SCRATCHPAD = 'C:\\Users\\123\\AppData\\Local\\Temp\\claude\\D--anti2-aaa-real-estate-app\\d12c257a-d49f-44c6-b1f1-1c67dc226310\\scratchpad';

async function main() {
  const canonical = await prisma.school.findMany({ select: { schoolName: true, sigunguCode: true } });
  const canonicalKeys = new Set(canonical.map((c) => c.sigunguCode + '|' + c.schoolName));
  const raw = JSON.parse(readFileSync(`${SCRATCHPAD}\\schoolinfo-busan-universe.json`, 'utf-8'));
  const onlyInSchoolInfo = raw.filter((r: any) => !canonicalKeys.has(r.__sggCode + '|' + r.SCHUL_NM));
  console.log('count:', onlyInSchoolInfo.length);
  console.log(JSON.stringify(onlyInSchoolInfo.map((r: any) => ({ name: r.SCHUL_NM, kind: r.SCHUL_KND_SC_CODE, addr: r.ADRES_BRKDN, absch: r.ABSCH_YN, sgg: r.__sggName })), null, 1));
  await prisma.$disconnect();
}
main().catch(console.error);
