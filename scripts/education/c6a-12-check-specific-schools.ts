import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const names = ['금성초등학교','공덕초등학교','신연초등학교','주학초등학교','양동초등학교','개림초등학교'];
  for (const n of names) {
    const rows = await prisma.school.findMany({ where: { schoolName: { contains: n.replace('등학교','') }, sigunguCode: { startsWith: '26' } }, select: { id: true, schoolName: true, sigunguCode: true, isActive: true } });
    console.log(n, '->', JSON.stringify(rows));
  }
  await prisma.$disconnect();
}
main().catch(console.error);
