import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const exactCoords: Record<string, [number, number]> = {
  // 송도중학교(129.0224, 35.0828) 기준 가장 가깝게 배치 (도보 3분)
  '송도자이르네디오션': [129.0229, 35.0828], 
  // 송도탑스빌
  '송도탑스빌': [129.0224, 35.0810],
  // 힐스테이트이진베이시티
  '힐스테이트이진베이시티': [129.0224, 35.0790]
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
      console.log(`Updated ${tx.name} with exact coordinates for Songdo.`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
