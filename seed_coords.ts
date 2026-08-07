import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const aptCoords: Record<string, [number, number]> = {
  '대신푸르지오': [129.0157, 35.1165],
  '대신해모로센트럴': [129.0189, 35.1121],
  '동대신역비스타동원': [129.0190, 35.1145],
  '대신롯데캐슬': [129.0165, 35.1150],
  '힐스테이트이진베이시티': [129.0225, 35.0772],
  '송도자이하늘채': [129.0261, 35.0734]
};

async function main() {
  const txs = await prisma.transaction.findMany();
  for (const tx of txs) {
    let name = tx.name;
    // 일부 이름 매칭
    if (name.includes('푸르지오')) name = '대신푸르지오';
    if (name.includes('해모로')) name = '대신해모로센트럴';
    if (name.includes('롯데캐슬')) name = '대신롯데캐슬';
    if (name.includes('힐스테이트')) name = '힐스테이트이진베이시티';
    
    if (aptCoords[name]) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          lng: aptCoords[name][0],
          lat: aptCoords[name][1],
        }
      });
      console.log(`Updated ${tx.name} with coords ${aptCoords[name]}`);
    } else {
      // 대충 근처 좌표 아무거나 할당 (대신동 기준)
      const r = Math.random() * 0.01;
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          lng: 129.0150 + r,
          lat: 35.1150 + r,
        }
      });
      console.log(`Assigned random Daeshin coords for ${tx.name}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
