// SCHOOL V2 FINAL QA §4/§5 — canonical universe counts, read-only, DB write 없음.
import { PrismaClient } from '@prisma/client';
import { finalSchoolTypeBucket } from './lib/school-type-taxonomy';
const prisma = new PrismaClient();

async function main() {
  const schools = await prisma.school.findMany({ select: { schoolLevel: true, isActive: true } });
  const bucketCounts: Record<string, number> = {};
  for (const s of schools) {
    const b = finalSchoolTypeBucket(s.schoolLevel);
    bucketCounts[b] = (bucketCounts[b] || 0) + 1;
  }
  console.log('=== School (전체 DB, isActive 무관) ===');
  console.log(JSON.stringify(bucketCounts, null, 1));
  console.log('TOTAL:', schools.length, '| isActive=false count:', schools.filter((s) => !s.isActive).length);

  const kinderCount = await prisma.kindergarten.count({ where: { sigunguCode: { startsWith: '26' } } });
  console.log('=== Kindergarten(부산, sigunguCode 26로 시작) ===');
  console.log('count:', kinderCount);

  const schoolStatCount = await prisma.schoolStat.count();
  console.log('=== SchoolStat rows (should be 0) ===', schoolStatCount);

  const childcareCount = await prisma.childcare.count();
  console.log('=== Childcare rows (should be 0, ingestion pending) ===', childcareCount);

  const aptCount = await prisma.apartmentMaster.count({ where: { sido: { contains: '부산' } } });
  console.log('=== ApartmentMaster(부산) ===', aptCount);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
