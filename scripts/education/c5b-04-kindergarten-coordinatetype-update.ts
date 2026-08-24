// SCHOOL V2-C5-B §8/§13 — Kindergarten.coordinateType 정리(UNKNOWN → OFFICIAL_POINT).
// 새 좌표 데이터를 들여오는 게 아니라, 이미 저장돼 있고 이미 CLEARED된 source
// (EducationSource.code='moe_kindergarten_basicinfo_api', licenseCode=
// ATTRIBUTION_ONLY_FREE_USE, legalReviewStatus=CLEARED — DB에서 직접 확인)에서 온
// 좌표에 올바른 enum 라벨만 붙이는 metadata 정리다. --apply 없이 실행하면 dry-run만 하고
// write하지 않는다.
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });
import { PrismaClient } from '@prisma/client';
import { validateCoordinate } from './lib/coordinate-guard';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const rows = await prisma.kindergarten.findMany({
    where: { coordinateType: 'UNKNOWN' },
    select: { id: true, kindergartenName: true, latitude: true, longitude: true, coordinateSource: true, sidoCode: true },
  });

  let passCount = 0;
  const failures: { id: number; name: string; reason: string }[] = [];

  for (const r of rows) {
    const result = validateCoordinate({
      latitude: r.latitude,
      longitude: r.longitude,
      sidoCode: r.sidoCode,
      source: r.coordinateSource || '',
    });
    if (result.ok) passCount++;
    else failures.push({ id: r.id, name: r.kindergartenName, reason: result.reason });
  }

  console.log(`대상(coordinateType=UNKNOWN): ${rows.length}건`);
  console.log(`가드 통과(OFFICIAL_POINT로 전환 가능): ${passCount}건`);
  console.log(`가드 실패(전환 보류): ${failures.length}건`, JSON.stringify(failures.slice(0, 10)));

  if (!APPLY) {
    console.log('\nDRY-RUN만 실행됨 — 실제 반영하려면 --apply 옵션으로 재실행');
    await prisma.$disconnect();
    return;
  }

  const passIds = rows
    .filter((r) => validateCoordinate({ latitude: r.latitude, longitude: r.longitude, sidoCode: r.sidoCode, source: r.coordinateSource || '' }).ok)
    .map((r) => r.id);

  const updateResult = await prisma.kindergarten.updateMany({
    where: { id: { in: passIds } },
    data: { coordinateType: 'OFFICIAL_POINT' },
  });
  console.log(`\nAPPLY 완료 — ${updateResult.count}건 coordinateType='OFFICIAL_POINT'로 갱신`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
});
