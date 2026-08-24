// E-JIP SCORE V2 STEP 0.7 §12-14 — 3개 벤치마크(구덕금호/대신해모로센트럴/협성르네상스)
// registry 2-tier 조회 + resolver 판정 trace. 구덕금호는 negative benchmark(COORD_LOW/
// DISPLAY_ONLY 자체 — STEP 0.6에서 이미 확인) — 억지로 정상처럼 보이게 만들지 않는다.
// READ-ONLY.
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), quiet: true });

const BENCHMARKS = ['26140-11', '26140-1356', '26140-51']; // 구덕금호 / 대신해모로센트럴 / 협성르네상스(서구)

async function main() {
  const { prisma } = await import('../../src/lib/prisma');
  const { probeRegistryTwoTier } = await import('./lib/step07-registry-probe');
  const { classifyRecovery } = await import('./lib/step07-recovery-resolver');

  for (const aptSeq of BENCHMARKS) {
    const m = await prisma.apartmentMaster.findUnique({
      where: { aptSeq },
      select: { aptSeq: true, name: true, sggCd: true, umdCd: true, umdName: true, jibun: true, roadAddress: true, jibunAddress: true, totalHouseholds: true, buildYear: true, geocodeQuality: true, latitude: true, longitude: true },
    });
    if (!m) { console.log(`${aptSeq}: ApartmentMaster에 없음`); continue; }
    console.log(`\n${'='.repeat(70)}\n${m.aptSeq} ${m.name} — 현재 DB 상태`);
    console.log(JSON.stringify({ dong: m.umdName, jibun: m.jibun, roadAddress: m.roadAddress, totalHouseholds: m.totalHouseholds, geocodeQuality: m.geocodeQuality, buildYear: m.buildYear }, null, 1));

    if (!m.umdCd || !m.jibun) { console.log('umdCd/jibun 없음 — registry 조회 불가'); continue; }
    const probe = await probeRegistryTwoTier(m.sggCd!, m.umdCd, m.jibun);
    console.log('registry probe 결과:', JSON.stringify(probe, null, 1));
    const rec = classifyRecovery({ aptSeq: m.aptSeq!, aptName: m.name, buildYear: m.buildYear, probe });
    console.log('resolver 판정:', JSON.stringify(rec, null, 1));
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
