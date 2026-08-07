import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const result = await prisma.transaction.updateMany({
    where: {
      name: '송도자이하늘채'
    },
    data: {
      name: '송도자이르네디오션'
    }
  });
  console.log(`Updated ${result.count} transactions.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
