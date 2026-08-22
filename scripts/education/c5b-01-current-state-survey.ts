// SCHOOL V2-C5-B §1/§13 — School/Kindergarten/Childcare 현재 DB 상태(좌표/coordinateType)
// read-only survey. write 없음.
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function surveyEntity(label: string, model: any) {
  const total = await model.count();
  const withCoords = await model.count({ where: { latitude: { not: null }, longitude: { not: null } } });
  const byType = await model.groupBy({ by: ['coordinateType'], _count: true });
  const bySource = await model.groupBy({ by: ['coordinateSource'], _count: true });

  console.log(`\n=== ${label} ===`);
  console.log('total:', total);
  console.log('with lat/lng:', withCoords, `(${((withCoords / total) * 100).toFixed(1)}%)`);
  console.log('coordinateType breakdown:', JSON.stringify(byType));
  console.log('coordinateSource breakdown:', JSON.stringify(bySource));
}

async function main() {
  await surveyEntity('School', prisma.school);
  await surveyEntity('Kindergarten', prisma.kindergarten);
  await surveyEntity('Childcare', prisma.childcare);

  // School level breakdown (초/중/고/기타) coordinate coverage — §1 표용
  console.log('\n=== School coordinate coverage by level ===');
  const levels = await prisma.school.groupBy({ by: ['schoolLevel'], _count: true });
  for (const l of levels) {
    const withCoords = await prisma.school.count({
      where: { schoolLevel: l.schoolLevel, latitude: { not: null } },
    });
    console.log(`${l.schoolLevel}: total=${l._count}, withCoords=${withCoords}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
});
