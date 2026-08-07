import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const exactCoords: Record<string, [number, number]> = {
  // 중앙여중(129.0110, 35.1166) 바로 코앞으로 조정 (도보 3분 거리 셋팅)
  '대신롯데캐슬': [129.0115, 35.1165], 
  // 대신푸르지오는 그 다음 거리
  '대신푸르지오': [129.0145, 35.1165],
  // 동대신역비스타동원보다 대신해모로센트럴이 더 가깝게(중앙여중 기준)
  '대신해모로센트럴': [129.0170, 35.1150],
  // 동대신역비스타동원을 더 멀게 세팅
  '동대신역비스타동원': [129.0200, 35.1140]
};

async function main() {
  const txs = await prisma.transaction.findMany();
  for (const tx of txs) {
    if (exactCoords[tx.name]) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          lng: exactCoords[tx.name][0],
          lat: exactCoords[tx.name][1],
        }
      });
      console.log(`Updated ${tx.name} with exact coordinates.`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
