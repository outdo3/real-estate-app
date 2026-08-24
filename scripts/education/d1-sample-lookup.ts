import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
(async () => {
  const seqs = ['26140-35', '26260-75', '26230-144', '26440-147'];
  const rows = await prisma.apartmentMaster.findMany({
    where: { aptSeq: { in: seqs } },
    select: { aptSeq: true, name: true, umdName: true, sggCd: true, latitude: true, longitude: true },
  });
  console.log(JSON.stringify(rows, null, 1));

  // 유치원/고등학교 nearby가 잘 보일만한 부산진구/동래구 등 밀집지역 표본 몇 개
  const denseSample = await prisma.apartmentMaster.findMany({
    where: { sggCd: { in: ['26230', '26260', '26140'] }, latitude: { not: null } },
    select: { aptSeq: true, name: true, umdName: true, sggCd: true },
    take: 5,
  });
  console.log('dense sample:', JSON.stringify(denseSample, null, 1));
  await prisma.$disconnect();
})();
