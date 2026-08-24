import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { resolveAll, type CanonicalSchool, type SchoolInfoRecord } from './lib/schoolinfo-identity-resolver';
import { NON_STANDARD_LEVEL_PATTERN } from './lib/school-type-taxonomy';

const prisma = new PrismaClient();
const SCRATCHPAD = 'C:\\Users\\123\\AppData\\Local\\Temp\\claude\\D--anti2-aaa-real-estate-app\\d12c257a-d49f-44c6-b1f1-1c67dc226310\\scratchpad';

async function main() {
  const canonicalRaw = await prisma.school.findMany({
    select: { id: true, neisSchoolCode: true, schoolName: true, schoolLevel: true, sigunguCode: true, dongName: true, roadAddress: true },
  });
  const rawList: any[] = JSON.parse(readFileSync(`${SCRATCHPAD}\\schoolinfo-busan-universe.json`, 'utf-8'));
  const schoolInfoList: SchoolInfoRecord[] = rawList.map((r) => ({
    schulCode: r.SCHUL_CODE, schulNm: r.SCHUL_NM, schulKndScCode: r.SCHUL_KND_SC_CODE,
    sggCode: r.__sggCode, addrBrkdn: r.ADRES_BRKDN || '', bnhhYn: r.BNHH_YN || 'N',
  }));
  const results = resolveAll(canonicalRaw as CanonicalSchool[], schoolInfoList);
  const noMatch = results.filter((r) => r.confidence === 'NO_MATCH');

  const nullSigungu = noMatch.filter((r) => !r.canonical.sigunguCode);
  const nonStandardType = noMatch.filter((r) => r.canonical.sigunguCode && NON_STANDARD_LEVEL_PATTERN.test(r.canonical.schoolLevel || ''));
  const other = noMatch.filter((r) => !nullSigungu.includes(r) && !nonStandardType.includes(r));

  console.log('총 NO_MATCH:', noMatch.length);
  console.log('\n[A] IDENTITY_UNRESOLVED(canonical sigunguCode 자체가 null — 우리쪽 데이터 갭):', nullSigungu.length);
  console.log(JSON.stringify(nullSigungu.map((r) => ({ name: r.canonical.schoolName, level: r.canonical.schoolLevel })), null, 1));

  console.log('\n[B] SOURCE_NOT_APPLICABLE 추정(비표준 학교유형 — 방송통신/평생학교/외국인학교/공동실습소/각종학교):', nonStandardType.length);
  console.log(JSON.stringify(nonStandardType.map((r) => ({ name: r.canonical.schoolName, level: r.canonical.schoolLevel, sigungu: r.canonical.sigunguCode })), null, 1));

  console.log('\n[C] 기타(분류 불명, 개별 확인 필요):', other.length);
  console.log(JSON.stringify(other.map((r) => ({ name: r.canonical.schoolName, level: r.canonical.schoolLevel, sigungu: r.canonical.sigunguCode })), null, 1));

  await prisma.$disconnect();
}
main().catch(console.error);
