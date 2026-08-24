/**
 * BUSAN SCORE DATA V1.1 — 특정 aptSeq의 calculateApartmentScore() 결과를
 * read-only로 조회한다(DB write 없음, production 함수를 그대로 호출).
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

import { prisma } from '@/lib/prisma';
import { calculateApartmentScore } from '@/lib/apartment-score/server/calculate';

async function main() {
  const aptSeq = process.argv[2] || '26350-2360';
  const master = await prisma.apartmentMaster.findUnique({ where: { aptSeq }, select: { latitude: true, longitude: true, geocodeQuality: true } });
  const feature = await prisma.apartmentLocationFeature.findUnique({ where: { aptSeq } });
  const result = await calculateApartmentScore(aptSeq);
  console.log(`=== ${aptSeq} ===`);
  console.log('ApartmentMaster:', JSON.stringify(master));
  console.log('ApartmentLocationFeature exists:', !!feature, feature ? `qualityFlag=${feature.qualityFlag}` : '');
  console.log('calculateApartmentScore:', JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
