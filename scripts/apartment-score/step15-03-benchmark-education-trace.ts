/**
 * E-JIP SCORE V2 STEP 1.5 §20-21 — 대신해모/협성/구덕금호 education facts를
 * SCHOOL V2 merged contract(getApartmentEducationZone, DB Kindergarten)로
 * READ-ONLY trace. 숫자 Score 생성 없음.
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

async function main() {
  const { getApartmentEducationZone } = await import('@/lib/education/attendance-zone');
  const { prisma } = await import('@/lib/prisma');

  const TARGETS = [
    { label: '대신해모로센트럴아파트', aptSeq: '26140-1356' },
    { label: '협성르네상스(서구)', aptSeq: '26140-51' },
    { label: '구덕금호', aptSeq: '26140-11' },
  ];

  for (const t of TARGETS) {
    console.log(`\n=== ${t.label} (${t.aptSeq}) ===`);
    const zone = getApartmentEducationZone(t.aptSeq);
    console.log('elementaryAttendanceZone:', JSON.stringify(zone?.elementary, null, 1));
    console.log('middleSchoolGroup:', JSON.stringify(zone?.middle, null, 1));

    const master = await prisma.apartmentMaster.findUnique({ where: { aptSeq: t.aptSeq }, select: { latitude: true, longitude: true } });
    if (master?.latitude != null && master.longitude != null) {
      const nearKg = await prisma.kindergarten.findMany({
        select: { kindergartenName: true, latitude: true, longitude: true },
        take: 500,
      });
      const withDist = nearKg
        .filter((k) => k.latitude != null && k.longitude != null)
        .map((k) => {
          const dLat = (k.latitude! - master.latitude!) * 111000;
          const dLng = (k.longitude! - master.longitude!) * 88000; // 부산 위도 대략 보정
          return { name: k.kindergartenName, approxDistanceM: Math.round(Math.sqrt(dLat * dLat + dLng * dLng)) };
        })
        .sort((a, b) => a.approxDistanceM - b.approxDistanceM)
        .slice(0, 3);
      console.log('nearest kindergartens(근사 거리, DB Kindergarten 367건 기준):', JSON.stringify(withDist));
    } else {
      console.log('nearest kindergartens: 좌표 없음(COORD 미확보)');
    }
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
