// SCHOOL V2-INTEGRATION-1 — read-only 검증 스크립트(DB write 없음).
// Kindergarten 367건 유지 여부, School canonical taxonomy 664 총계,
// 실제 ingestion 재실행 없이 count만 확인.
import { PrismaClient } from '@prisma/client';
import { finalSchoolTypeBucket } from './lib/school-type-taxonomy';
const prisma = new PrismaClient();

async function main() {
  const kinderCount = await prisma.kindergarten.count({ where: { sigunguCode: { startsWith: '26' } } });
  const kinderSample = await prisma.kindergarten.findFirst({
    where: { sigunguCode: { startsWith: '26' } },
    select: {
      officialCode: true, latitude: true, longitude: true, coordinateSource: true, coordinateType: true,
      stats: { select: { capacity: true, enrollment: true, classCount: true, ageBreakdown: true }, take: 1 },
    },
  });
  const kinderRows = await prisma.kindergarten.findMany({ where: { sigunguCode: { startsWith: '26' } }, select: { officialCode: true } });
  const codeSeen = new Map<string, number>();
  for (const r of kinderRows) if (r.officialCode) codeSeen.set(r.officialCode, (codeSeen.get(r.officialCode) || 0) + 1);
  const kinderCodeDupes = [...codeSeen.values()].filter((n) => n > 1).length;

  console.log('=== Kindergarten(부산) ===');
  console.log('count:', kinderCount);
  console.log('sample:', JSON.stringify(kinderSample, null, 1));
  console.log('duplicate officialCode groups:', kinderCodeDupes);

  const allSchools = await prisma.school.findMany({ select: { schoolLevel: true } });
  const bucketCounts: Record<string, number> = {};
  for (const s of allSchools) {
    const b = finalSchoolTypeBucket(s.schoolLevel);
    bucketCounts[b] = (bucketCounts[b] || 0) + 1;
  }
  console.log('=== School canonical taxonomy(최종 5버킷) ===');
  console.log(JSON.stringify(bucketCounts, null, 1));
  console.log('TOTAL:', allSchools.length);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
