// RENT_TRADE_HISTORY_V1 PHASE B §23 — production migration 적용 후 검증(읽기 전용).
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRawUnsafe<any[]>(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'apartment_rent_histories' ORDER BY ordinal_position`
  );
  console.log('COLUMNS:');
  console.table(columns);

  const indexes = await prisma.$queryRawUnsafe<any[]>(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'apartment_rent_histories' ORDER BY indexname`
  );
  console.log('INDEXES:');
  for (const i of indexes) console.log(` - ${i.indexname}: ${i.indexdef}`);

  const constraints = await prisma.$queryRawUnsafe<any[]>(
    `SELECT conname, contype FROM pg_constraint WHERE conrelid = 'apartment_rent_histories'::regclass ORDER BY conname`
  );
  console.log('CONSTRAINTS:');
  for (const c of constraints) console.log(` - ${c.conname} (${c.contype})`);

  const fks = await prisma.$queryRawUnsafe<any[]>(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'apartment_rent_histories'::regclass AND contype = 'f'`
  );
  console.log(`FOREIGN KEYS: ${fks.length} (기대값: 0 — ApartmentMaster FK 강제 없음, §22)`);

  const count = await prisma.apartmentRentHistory.count();
  console.log(`ROW COUNT: ${count} (기대값: 0, 아직 write 전)`);

  await prisma.$disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
