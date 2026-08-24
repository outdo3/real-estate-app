// SCHOOL V2-C5-A §9/§10 — fix_coords.ts / fix_songdo_coords.ts가 손으로 지정한
// 좌표가 현재 DB(Transaction 테이블)에 남아있는지 READ-ONLY로 확인한다.
// DB write 없음. "정상 좌표"를 추정해서 비교하지 않는다 — 현재 값과 스크립트에
// 하드코딩된 값을 있는 그대로 대조만 한다.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// fix_coords.ts / fix_songdo_coords.ts에서 그대로 옮긴 하드코딩 값(수정 없음).
const HARDCODED: Record<string, { lng: number; lat: number; sourceScript: string }> = {
  '대신롯데캐슬': { lng: 129.0115, lat: 35.1165, sourceScript: 'fix_coords.ts' },
  '대신푸르지오': { lng: 129.0145, lat: 35.1165, sourceScript: 'fix_coords.ts' },
  '대신해모로센트럴': { lng: 129.017, lat: 35.115, sourceScript: 'fix_coords.ts' },
  '동대신역비스타동원': { lng: 129.02, lat: 35.114, sourceScript: 'fix_coords.ts' },
  '송도자이르네디오션': { lng: 129.0229, lat: 35.0828, sourceScript: 'fix_songdo_coords.ts' },
  '송도탑스빌': { lng: 129.0224, lat: 35.081, sourceScript: 'fix_songdo_coords.ts' },
  '힐스테이트이진베이시티': { lng: 129.0224, lat: 35.079, sourceScript: 'fix_songdo_coords.ts' },
};

async function main() {
  console.log('=== fix_coords/fix_songdo_coords 대상 7개 단지 현재 DB 상태 (Transaction 테이블, read-only) ===\n');

  for (const [name, hc] of Object.entries(HARDCODED)) {
    // Transaction 모델에는 dong/updatedAt 컬럼이 없다(schema.prisma 확인) — createdAt은
    // insert 시점일 뿐 fix_coords.ts의 update() 실행 시점을 반영하지 않으므로 "언제 수동
    // 조정됐는지"는 데이터만으로 판정 불가(UNKNOWN으로 보고, §9 "updatedAt 가능하면" 조건
    // 미충족).
    const txs = await prisma.transaction.findMany({
      where: { name },
      select: { id: true, name: true, lat: true, lng: true, createdAt: true },
      orderBy: { id: 'asc' },
    });

    if (txs.length === 0) {
      console.log(`[${name}] Transaction 테이블에 해당 이름 row 없음 (UNKNOWN — 개명/철자차이 가능성, 이번 STEP에서 재검색 안 함)`);
      continue;
    }

    for (const tx of txs) {
      const matchesHardcoded =
        tx.lat != null && tx.lng != null &&
        Math.abs(tx.lat - hc.lat) < 1e-6 && Math.abs(tx.lng - hc.lng) < 1e-6;

      const classification = tx.lat == null || tx.lng == null
        ? 'UNKNOWN(좌표 없음)'
        : matchesHardcoded
          ? 'A. MANUAL_COORDINATE_PRESENT'
          : 'B. CURRENT_GEOCODE_DIFFERENT';

      console.log(`[${name}] tx.id=${tx.id} createdAt=${tx.createdAt.toISOString()}`);
      console.log(`  hardcoded(${hc.sourceScript}): lat=${hc.lat}, lng=${hc.lng}`);
      console.log(`  current DB:                    lat=${tx.lat}, lng=${tx.lng}`);
      console.log(`  classification: ${classification}\n`);
    }
  }

  // 참고: ApartmentMaster에도 같은 이름이 있는지(스코어/거리 파이프라인이 실제로 쓰는 테이블은
  // ApartmentMaster이므로, Transaction 좌표 조작이 ApartmentMaster에도 영향 있는지 확인).
  console.log('=== 참고: 같은 이름의 ApartmentMaster 좌표 (스코어 파이프라인이 실제로 쓰는 테이블) ===\n');
  for (const name of Object.keys(HARDCODED)) {
    const am = await prisma.apartmentMaster.findMany({
      where: { name },
      select: { id: true, aptSeq: true, latitude: true, longitude: true, geocodeQuality: true, updatedAt: true },
    });
    console.log(`[${name}]`, am.length === 0 ? 'ApartmentMaster에 없음' : JSON.stringify(am, null, 2));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
});
