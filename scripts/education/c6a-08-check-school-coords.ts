import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const total = await prisma.school.count({ where: { sigunguCode: { startsWith: '26' }, schoolLevel: '초등학교' } });
  const withCoords = await prisma.school.count({ where: { sigunguCode: { startsWith: '26' }, schoolLevel: '초등학교', latitude: { not: null }, longitude: { not: null } } });
  console.log('부산 초등학교 total:', total, 'with coords:', withCoords);
  await prisma.$disconnect();
}
main().catch(console.error);
