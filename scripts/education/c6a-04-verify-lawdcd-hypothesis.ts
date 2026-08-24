import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const distinctSigungu = await prisma.school.findMany({
    where: { sigunguCode: { not: null } },
    select: { sigunguCode: true, sidoCode: true },
    distinct: ['sigunguCode'],
  });
  console.log('distinct School.sigunguCode (sample):', JSON.stringify(distinctSigungu.slice(0, 20), null, 1));

  const aptCount = await prisma.apartmentMaster.count();
  const busanAptCount = await prisma.apartmentMaster.count({ where: { sggCd: { startsWith: '26' } } });
  const busanAptWithCoords = await prisma.apartmentMaster.count({ where: { sggCd: { startsWith: '26' }, latitude: { not: null }, longitude: { not: null } } });
  console.log('TOTAL_APARTMENTS:', aptCount, 'BUSAN_APARTMENTS(sggCd 26%):', busanAptCount, 'BUSAN_WITH_COORDS:', busanAptWithCoords);

  const distinctSgg = await prisma.apartmentMaster.findMany({ where: { sggCd: { startsWith: '26' } }, select: { sggCd: true }, distinct: ['sggCd'] });
  console.log('distinct busan apt sggCd:', JSON.stringify(distinctSgg.map(s=>s.sggCd).sort()));

  await prisma.$disconnect();
}
main().catch(console.error);
