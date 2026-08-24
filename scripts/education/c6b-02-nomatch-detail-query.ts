import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const seqs = ['26230-264', '26230-235', '26530-48', '26260-314'];
  const rows = await p.apartmentMaster.findMany({
    where: { aptSeq: { in: seqs } },
    select: { aptSeq: true, name: true, jibun: true, buildYear: true, useApprovalDate: true, geocodeQuality: true, mainBuildingCount: true, totalHouseholds: true },
  });
  console.log(JSON.stringify(rows, null, 2));
  await p.$disconnect();
})();
